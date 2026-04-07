/**
 * Zillow Research CSV Ingestion Script
 *
 * Downloads ZORI (rent index) and ZHVI (home value index) zip-level CSVs
 * from Zillow Research and streams them into Supabase.
 *
 * Run: npm run ingest:zillow
 *
 * Zillow updates data on the 16th of each month.
 * These CSVs are wide-format: each row = one zip, columns = monthly dates.
 * We pivot them into our long-format universal schema.
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Zillow Research public CSV URLs (zip-level, updated monthly)
const ZILLOW_SOURCES = [
  {
    url: 'https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv',
    metric: 'ZORI_Rent_Index',
    description: 'Zillow Observed Rent Index by ZIP',
  },
  {
    url: 'https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
    metric: 'ZHVI_Home_Value',
    description: 'Zillow Home Value Index by ZIP',
  },
]

const BATCH_SIZE = 500 // Supabase insert batch size

async function ingestSource(source: typeof ZILLOW_SOURCES[0]) {
  console.log(`\nFetching: ${source.description}`)
  console.log(`URL: ${source.url}`)

  const res = await fetch(source.url)
  if (!res.ok) {
    console.error(`Failed to fetch ${source.url}: ${res.status}`)
    return
  }

  const text = await res.text()
  const lines = text.split('\n').filter(Boolean)
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))

  // Zillow CSV columns: RegionID, SizeRank, RegionName (zip), RegionType, StateName, State, City, Metro, CountyName, [date columns...]
  const zipIdx = headers.findIndex((h) => h === 'RegionName')
  const stateIdx = headers.findIndex((h) => h === 'State')
  const cityIdx = headers.findIndex((h) => h === 'City')

  if (zipIdx < 0) {
    console.error('Could not find RegionName column')
    return
  }

  // Date columns start after the metadata columns (anything that looks like YYYY-MM-DD)
  const dateColumns = headers
    .map((h, i) => ({ header: h, idx: i }))
    .filter(({ header }) => /^\d{4}-\d{2}-\d{2}$/.test(header))

  console.log(`Found ${dateColumns.length} date columns, ${lines.length - 1} zip rows`)

  // Only ingest the last 36 months to keep DB lean
  const recentDates = dateColumns.slice(-36)

  let totalInserted = 0
  let batch: object[] = []

  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((c) => c.trim().replace(/"/g, ''))
    const zip = cols[zipIdx]

    // Skip non-zip or invalid rows
    if (!zip || !/^\d{5}$/.test(zip)) continue

    for (const { header: date, idx } of recentDates) {
      const raw = cols[idx]
      if (!raw || raw === '') continue
      const value = parseFloat(raw)
      if (isNaN(value)) continue

      batch.push({
        submarket_id: zip,
        geometry: null,
        metric_name: source.metric,
        metric_value: value,
        time_period: date,
        data_source: 'Zillow Research',
        visual_bucket: 'TIME_SERIES',
      })

      if (batch.length >= BATCH_SIZE) {
        const { error } = await supabase.from('projectr_master_data').upsert(batch as never[], {
          onConflict: 'submarket_id,metric_name,time_period,data_source',
          ignoreDuplicates: false,
        })
        if (error) console.error('Batch insert error:', error.message)
        else totalInserted += batch.length
        process.stdout.write(`\r  Inserted: ${totalInserted} rows...`)
        batch = []
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const { error } = await supabase.from('projectr_master_data').upsert(batch as never[], {
      onConflict: 'submarket_id,metric_name,time_period,data_source',
      ignoreDuplicates: false,
    })
    if (error) console.error('Final batch error:', error.message)
    else totalInserted += batch.length
  }

  console.log(`\n  Done. Total rows inserted: ${totalInserted}`)
}

async function main() {
  console.log('=== Zillow Research Ingestion ===')
  console.log(`Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  for (const source of ZILLOW_SOURCES) {
    await ingestSource(source)
  }

  console.log('\n=== Ingestion complete ===')
}

main().catch(console.error)
