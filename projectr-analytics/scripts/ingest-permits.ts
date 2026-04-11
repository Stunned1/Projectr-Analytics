/**
 * NYC Building Permits Ingestion Script
 * Pulls from NYC DOB job filings (Socrata) and stores in Supabase.
 *
 * Job types we care about:
 *   NB  = New Building
 *   A1  = Major Alteration
 *   A2  = Minor Alteration
 *   DM  = Demolition
 *
 * Run: npm run ingest:permits
 * Filters to Manhattan only, last 3 years, with coordinates.
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SOCRATA_URL = 'https://data.cityofnewyork.us/resource/ic3t-wcy2.json'
const BATCH_SIZE = 500
const PAGE_SIZE = 1000
// A2 (minor alterations) excluded — too noisy (bathroom renos, window swaps, etc.)
// A1 filtered to initial_cost > $500k to keep only major renovations
const JOB_TYPES = ['NB', 'A1', 'DM']
const BOROUGHS = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND']
const A1_MIN_COST = 500_000 // filter A1s below this cost

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RawPermit {
  job__: string
  borough: string
  house__?: string
  street_name?: string
  zip_code?: string
  job_type?: string
  job_status?: string
  job_description?: string
  owner_s_business_name?: string
  initial_cost?: string
  proposed_no_of_stories?: string
  proposed_dwelling_units?: string
  pre__filing_date?: string
  gis_latitude?: string
  gis_longitude?: string
  gis_nta_name?: string
}

function parsePermit(r: RawPermit) {
  const lat = parseFloat(r.gis_latitude ?? '')
  const lng = parseFloat(r.gis_longitude ?? '')
  if (isNaN(lat) || isNaN(lng)) return null

  return {
    id: r.job__,
    borough: r.borough,
    house_number: r.house__ ?? null,
    street_name: r.street_name ?? null,
    zip_code: r.zip_code ?? null,
    job_type: r.job_type ?? null,
    job_status: r.job_status ?? null,
    job_description: r.job_description?.slice(0, 500) ?? null,
    owner_business: r.owner_s_business_name ?? null,
    initial_cost: r.initial_cost ? parseFloat(r.initial_cost.replace(/[$,]/g, '')) : null,
    proposed_stories: r.proposed_no_of_stories ? parseFloat(r.proposed_no_of_stories) : null,
    proposed_units: r.proposed_dwelling_units ? parseFloat(r.proposed_dwelling_units) : null,
    filing_date: r.pre__filing_date ? new Date(r.pre__filing_date).toISOString().split('T')[0] : null,
    lat,
    lng,
    nta_name: r.gis_nta_name ?? null,
  }
}

async function fetchPage(borough: string, jobType: string, offset: number): Promise<RawPermit[]> {
  let where = `borough='${borough}' AND job_type='${jobType}' AND gis_latitude IS NOT NULL AND pre__filing_date>'01/01/2022'`
  // For A1, only pull high-cost major alterations (skip minor renos)
  if (jobType === 'A1') where += ` AND initial_cost>'${A1_MIN_COST}'`
  const url = `${SOCRATA_URL}?$limit=${PAGE_SIZE}&$offset=${offset}&$where=${encodeURIComponent(where)}&$order=pre__filing_date DESC`

  const res = await fetch(url)
  if (!res.ok) return []
  return res.json()
}

async function ingestBoroughJobType(borough: string, jobType: string) {
  let offset = 0
  let totalInserted = 0
  let page = 0

  while (true) {
    const raw = await fetchPage(borough, jobType, offset)
    if (!raw.length) break

    const permits = raw.map(parsePermit).filter(Boolean) as NonNullable<ReturnType<typeof parsePermit>>[]

    // Deduplicate within the batch — same job__ can appear multiple times in API response
    const seen = new Set<string>()
    const deduped = permits.filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })

    // Batch upsert
    for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
      const batch = deduped.slice(i, i + BATCH_SIZE)
      const { error } = await supabase
        .from('nyc_permits')
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: true }) // ignoreDuplicates avoids the conflict error
      if (error) console.error(`  ✗ Batch error:`, error.message)
      else totalInserted += batch.length
    }

    process.stdout.write(`\r  ${borough} ${jobType}: ${totalInserted} inserted (page ${++page})`)
    offset += PAGE_SIZE
    if (raw.length < PAGE_SIZE) break
    await sleep(300)
  }

  console.log(`\n  ✓ ${borough} ${jobType}: ${totalInserted} total`)
  return totalInserted
}

async function main() {
  console.log('=== NYC Permits Ingestion ===')
  console.log(`Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`Boroughs: ${BOROUGHS.join(', ')}`)
  console.log(`Job types: NB, DM (all), A1 (initial_cost > $${A1_MIN_COST.toLocaleString()}) — A2 excluded\n`)

  let grand = 0
  for (const borough of BOROUGHS) {
    for (const jobType of JOB_TYPES) {
      grand += await ingestBoroughJobType(borough, jobType)
      await sleep(500)
    }
  }

  console.log(`\n=== Done: ${grand} total permits ingested ===`)
}

main().catch(console.error)
