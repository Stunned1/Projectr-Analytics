import * as dotenv from 'dotenv'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import Papa from 'papaparse'
import { BigQuery } from '@google-cloud/bigquery'
import { createClient } from '@supabase/supabase-js'
import { normalizeTexasCountyName, resolveTexasCountyName } from '../lib/data/texas-zcta-build'
import type { TexasZctaDimRow } from '../lib/data/texas-zcta-dim'

dotenv.config({ path: '.env.local' })

type GazetteerRow = {
  GEOID?: string
  ALAND?: string
  AWATER?: string
  INTPTLAT?: string
  INTPTLONG?: string
}

type CandidateRow = {
  zcta5: string
  lat: number
  lng: number
  landAreaSqM: number | null
  waterAreaSqM: number | null
}

type CountyLookup = {
  stateFips: string
  countyFips: string | null
  countyName: string | null
}

type CityLookup = {
  city: string | null
  stateAbbr: string | null
}

type SupabaseLookupRow = {
  zip: string
  city: string | null
  state: string | null
  county_name: string | null
  metro_name: string | null
  metro_name_short: string | null
}

type SupabaseSnapshotRow = {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
  as_of_date: string | null
}

const CENSUS_GAZETTEER_ZCTA_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip'
const TEXAS_STATE_FIPS = '48'
const TEXAS_STATE_ABBR = 'TX'
const TEXAS_BBOX = {
  minLat: 25,
  maxLat: 37,
  minLng: -107,
  maxLng: -93,
}
const CENSUS_LOOKUP_CONCURRENCY = 8
const CITY_LOOKUP_CONCURRENCY = 8
const DEFAULT_TMP_DIR = path.join(os.tmpdir(), 'scout-texas-zcta')
const TEXAS_ZCTA_DIM_TABLE = 'texas_zcta_dim'

function parseCliFlags(argv: string[]) {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const [key, inlineValue] = token.split('=', 2)
    if (inlineValue != null) {
      flags.set(key, inlineValue)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, 'true')
    }
  }
  return flags
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() || undefined
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function isTexasBboxCandidate(lat: number, lng: number): boolean {
  return (
    lat >= TEXAS_BBOX.minLat &&
    lat <= TEXAS_BBOX.maxLat &&
    lng >= TEXAS_BBOX.minLng &&
    lng <= TEXAS_BBOX.maxLng
  )
}

async function fetchTextFromZip(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'application/zip' },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`)
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer())
  const archive = new AdmZip(zipBuffer)
  const textEntry = archive.getEntries().find((entry) => entry.entryName.endsWith('.txt'))
  if (!textEntry) {
    throw new Error(`No .txt entry found in ${url}`)
  }

  return archive.readAsText(textEntry, 'utf8')
}

function parseGazetteerCandidates(text: string): CandidateRow[] {
  const parsed = Papa.parse<GazetteerRow>(text, {
    header: true,
    delimiter: '\t',
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0]
    throw new Error(`Unable to parse Census gazetteer file: ${firstError.message}`)
  }

  const rows: CandidateRow[] = []
  for (const record of parsed.data) {
    const zcta5 = String(record.GEOID ?? '').trim()
    if (!/^\d{5}$/.test(zcta5)) continue

    const lat = parseNumber(record.INTPTLAT)
    const lng = parseNumber(record.INTPTLONG)
    if (lat == null || lng == null) continue
    if (!isTexasBboxCandidate(lat, lng)) continue

    rows.push({
      zcta5,
      lat,
      lng,
      landAreaSqM: parseNumber(record.ALAND),
      waterAreaSqM: parseNumber(record.AWATER),
    })
  }

  return rows.sort((a, b) => a.zcta5.localeCompare(b.zcta5))
}

async function fetchCountyLookupForPoint(lat: number, lng: number): Promise<CountyLookup | null> {
  try {
    const response = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`,
      {
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      }
    )
    if (!response.ok) return null
    const payload = await response.json()
    const county = payload?.result?.geographies?.Counties?.[0]
    if (!county || county.STATE == null) return null
    return {
      stateFips: String(county.STATE),
      countyFips: county.COUNTY != null ? String(county.COUNTY).padStart(3, '0') : null,
      countyName:
        typeof county.BASENAME === 'string'
          ? normalizeTexasCountyName(county.BASENAME)
          : typeof county.NAME === 'string'
            ? normalizeTexasCountyName(county.NAME)
            : null,
    }
  } catch {
    return null
  }
}

async function fetchCityLookupForZip(zip: string): Promise<CityLookup | null> {
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!response.ok) return null
    const payload = await response.json()
    const place = payload?.places?.[0]
    if (!place) return null

    const stateAbbr =
      typeof place['state abbreviation'] === 'string'
        ? place['state abbreviation'].trim().toUpperCase()
        : null
    if (stateAbbr !== TEXAS_STATE_ABBR) return null

    return {
      city: typeof place['place name'] === 'string' ? place['place name'].trim() : null,
      stateAbbr,
    }
  } catch {
    return null
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0

  async function worker() {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) return
      results[current] = await mapper(items[current], current)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
  return results
}

async function enrichTexasCandidates(candidates: CandidateRow[]): Promise<Array<CandidateRow & CountyLookup>> {
  const countyLookups = await mapWithConcurrency(
    candidates,
    CENSUS_LOOKUP_CONCURRENCY,
    async (candidate) => fetchCountyLookupForPoint(candidate.lat, candidate.lng)
  )

  return candidates
    .map((candidate, index) => {
      const countyLookup = countyLookups[index]
      if (!countyLookup || countyLookup.stateFips !== TEXAS_STATE_FIPS) return null
      return {
        ...candidate,
        ...countyLookup,
      }
    })
    .filter((row): row is CandidateRow & CountyLookup => row !== null)
}

function getSupabaseClient() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key =
    readEnv('SUPABASE_SERVICE_ROLE_KEY') ??
    readEnv('SUPABASE_SERVICE_ROLE') ??
    readEnv('SUPABASE_SERVICE_KEY') ??
    readEnv('SUPABASE_SECRET_KEY') ??
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

async function fetchSupabaseLookupMaps(): Promise<{
  lookupByZip: Map<string, SupabaseLookupRow>
  snapshotByZip: Map<string, SupabaseSnapshotRow>
}> {
  const client = getSupabaseClient()
  if (!client) {
    return {
      lookupByZip: new Map(),
      snapshotByZip: new Map(),
    }
  }

  const [{ data: lookupData, error: lookupError }, { data: snapshotData, error: snapshotError }] = await Promise.all([
    client
      .from('zip_metro_lookup')
      .select('zip, city, state, county_name, metro_name, metro_name_short')
      .eq('state', TEXAS_STATE_ABBR)
      .limit(10_000),
    client
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m, as_of_date')
      .limit(30_000),
  ])

  if (lookupError) {
    throw new Error(`Supabase lookup query failed: ${lookupError.message}`)
  }
  if (snapshotError) {
    throw new Error(`Supabase snapshot query failed: ${snapshotError.message}`)
  }

  return {
    lookupByZip: new Map((lookupData ?? []).map((row) => [row.zip, row as SupabaseLookupRow])),
    snapshotByZip: new Map((snapshotData ?? []).map((row) => [row.zip, row as SupabaseSnapshotRow])),
  }
}

async function enrichMissingCities(zips: readonly string[]): Promise<Map<string, CityLookup>> {
  const rows = await mapWithConcurrency(
    zips,
    CITY_LOOKUP_CONCURRENCY,
    async (zip) => [zip, await fetchCityLookupForZip(zip)] as const
  )

  return new Map(rows.filter((entry): entry is readonly [string, CityLookup] => entry[1] !== null))
}

function toNdjson(rows: readonly TexasZctaDimRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}

async function loadRowsToBigQuery(rows: readonly TexasZctaDimRow[], tempDir: string): Promise<void> {
  const datasetId = readEnv('BIGQUERY_DATASET_ID')
  if (!datasetId) {
    throw new Error('BIGQUERY_DATASET_ID is required to load texas_zcta_dim into BigQuery')
  }

  const projectId = readEnv('BIGQUERY_PROJECT_ID') ?? readEnv('GOOGLE_CLOUD_PROJECT')
  const location = readEnv('BIGQUERY_LOCATION') ?? 'US'
  const client = new BigQuery(projectId ? { projectId } : undefined)

  await mkdir(tempDir, { recursive: true })
  const tempFile = path.join(tempDir, `${TEXAS_ZCTA_DIM_TABLE}.ndjson`)
  await writeFile(tempFile, toNdjson(rows), 'utf8')

  const table = client.dataset(datasetId).table(TEXAS_ZCTA_DIM_TABLE)
  await table.load(tempFile, {
    location,
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    schema: {
      fields: [
        { name: 'zcta5', type: 'STRING', mode: 'REQUIRED' },
        { name: 'city', type: 'STRING' },
        { name: 'state_abbr', type: 'STRING', mode: 'REQUIRED' },
        { name: 'state_fips', type: 'STRING', mode: 'REQUIRED' },
        { name: 'county_fips', type: 'STRING' },
        { name: 'county_name', type: 'STRING' },
        { name: 'metro_name', type: 'STRING' },
        { name: 'metro_name_short', type: 'STRING' },
        { name: 'lat', type: 'FLOAT' },
        { name: 'lng', type: 'FLOAT' },
        { name: 'land_area_sq_m', type: 'INTEGER' },
        { name: 'water_area_sq_m', type: 'INTEGER' },
        { name: 'zillow_covered', type: 'BOOLEAN', mode: 'REQUIRED' },
        { name: 'coverage_tier', type: 'STRING', mode: 'REQUIRED' },
        { name: 'zori_latest', type: 'FLOAT' },
        { name: 'zhvi_latest', type: 'FLOAT' },
        { name: 'zori_growth_12m', type: 'FLOAT' },
        { name: 'zhvi_growth_12m', type: 'FLOAT' },
        { name: 'as_of_date', type: 'DATE' },
        { name: 'source_year', type: 'INTEGER', mode: 'REQUIRED' },
        { name: 'updated_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
      ],
    },
  })
}

async function main(): Promise<void> {
  const flags = parseCliFlags(process.argv.slice(2))
  const limitRaw = flags.get('--limit')
  const outPath = flags.get('--out')
  const skipBigQuery = flags.has('--skip-bigquery') || flags.has('--dry-run')
  const tempDir = flags.get('--tmp-dir') ?? DEFAULT_TMP_DIR
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null

  console.log('=== Texas ZCTA Dim Build ===')
  console.log(`Source: ${CENSUS_GAZETTEER_ZCTA_URL}`)
  if (limit != null) console.log(`Limit: ${limit}`)
  if (skipBigQuery) console.log('Mode: build only (BigQuery load skipped)')

  const gazetteerText = await fetchTextFromZip(CENSUS_GAZETTEER_ZCTA_URL)
  const candidates = parseGazetteerCandidates(gazetteerText)
  console.log(`BBox candidates: ${candidates.length}`)

  const texasCandidates = await enrichTexasCandidates(candidates)
  console.log(`Texas ZCTAs resolved: ${texasCandidates.length}`)

  const cappedCandidates = limit != null && limit > 0 ? texasCandidates.slice(0, limit) : texasCandidates
  const { lookupByZip, snapshotByZip } = await fetchSupabaseLookupMaps()

  const missingCityZips = cappedCandidates
    .map((row) => row.zcta5)
    .filter((zip) => {
      const lookup = lookupByZip.get(zip)
      return !(lookup?.city?.trim())
    })

  const cityFallbacks = await enrichMissingCities(missingCityZips)
  const updatedAt = new Date().toISOString()
  const rows: TexasZctaDimRow[] = cappedCandidates.map((candidate) => {
    const lookup = lookupByZip.get(candidate.zcta5)
    const snapshot = snapshotByZip.get(candidate.zcta5)
    const cityFallback = cityFallbacks.get(candidate.zcta5)
    const zillowCovered = snapshot != null

    return {
      zcta5: candidate.zcta5,
      city: lookup?.city?.trim() || cityFallback?.city?.trim() || null,
      state_abbr: TEXAS_STATE_ABBR,
      state_fips: TEXAS_STATE_FIPS,
      county_fips: candidate.countyFips,
      county_name: resolveTexasCountyName(candidate.countyName, lookup?.county_name ?? null),
      metro_name: lookup?.metro_name?.trim() || null,
      metro_name_short: lookup?.metro_name_short?.trim() || null,
      lat: candidate.lat,
      lng: candidate.lng,
      land_area_sq_m: candidate.landAreaSqM != null ? Math.round(candidate.landAreaSqM) : null,
      water_area_sq_m: candidate.waterAreaSqM != null ? Math.round(candidate.waterAreaSqM) : null,
      zillow_covered: zillowCovered,
      coverage_tier: zillowCovered ? 'zillow_enhanced' : 'public_baseline_only',
      zori_latest: snapshot?.zori_latest ?? null,
      zhvi_latest: snapshot?.zhvi_latest ?? null,
      zori_growth_12m: snapshot?.zori_growth_12m ?? null,
      zhvi_growth_12m: snapshot?.zhvi_growth_12m ?? null,
      as_of_date: snapshot?.as_of_date ?? null,
      source_year: 2024,
      updated_at: updatedAt,
    }
  })

  console.log(`Rows built: ${rows.length}`)
  console.log(`Zillow-enhanced rows: ${rows.filter((row) => row.zillow_covered).length}`)
  console.log(`Public-baseline-only rows: ${rows.filter((row) => !row.zillow_covered).length}`)
  console.log(`Rows with city labels: ${rows.filter((row) => row.city).length}`)

  if (outPath) {
    const resolvedOutPath = path.resolve(outPath)
    await mkdir(path.dirname(resolvedOutPath), { recursive: true })
    await writeFile(resolvedOutPath, toNdjson(rows), 'utf8')
    console.log(`Wrote NDJSON: ${resolvedOutPath}`)
  }

  if (!skipBigQuery) {
    await loadRowsToBigQuery(rows, tempDir)
    console.log(`Loaded BigQuery table: ${TEXAS_ZCTA_DIM_TABLE}`)
  }

  // Leave a clean temp directory behind between runs.
  await rm(tempDir, { recursive: true, force: true })
  console.log('=== Done ===')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
