/**
 * Zillow CSV Ingestion Script
 *
 * Processes all 6 Zillow CSVs from ../zillow-csv's/ and loads them into Supabase.
 *
 * What it does:
 *  - Zip-level (ZORI, ZHVI, ZHVF): computes latest value + 12m growth, upserts into zillow_zip_snapshot
 *  - Metro-level (Inventory, DoZ, Price Cuts): takes latest value, upserts into zillow_metro_snapshot
 *  - Builds zip_metro_lookup from the ZORI file (has City, Metro, CountyName columns)
 *
 * Run: npm run ingest:zillow
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CSV_DIR = path.resolve(__dirname, '../../zillow-csv\'s')
const BATCH_SIZE = 500

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(filePath: string): { headers: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, 'utf-8')
  const lines = text.split('\n').filter(Boolean)
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim().replace(/"/g, '')))
  return { headers, rows }
}

function getDateCols(headers: string[]): { header: string; idx: number }[] {
  return headers
    .map((h, i) => ({ header: h, idx: i }))
    .filter(({ header }) => /^\d{4}-\d{2}-\d{2}$/.test(header))
}

function latestValue(row: string[], dateCols: { idx: number }[]): number | null {
  // Walk backwards to find the most recent non-empty value
  for (let i = dateCols.length - 1; i >= 0; i--) {
    const v = parseFloat(row[dateCols[i].idx])
    if (!isNaN(v)) return v
  }
  return null
}

function latestDate(row: string[], dateCols: { header: string; idx: number }[]): string | null {
  for (let i = dateCols.length - 1; i >= 0; i--) {
    const v = parseFloat(row[dateCols[i].idx])
    if (!isNaN(v)) return dateCols[i].header
  }
  return null
}

function growth12m(row: string[], dateCols: { idx: number }[]): number | null {
  if (dateCols.length < 13) return null
  const recent = parseFloat(row[dateCols[dateCols.length - 1].idx])
  // Find a valid value ~12 months back
  for (let i = dateCols.length - 13; i >= Math.max(0, dateCols.length - 15); i--) {
    const old = parseFloat(row[dateCols[i].idx])
    if (!isNaN(old) && old > 0 && !isNaN(recent)) {
      return parseFloat((((recent - old) / old) * 100).toFixed(2))
    }
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function upsertBatch<T extends object>(table: string, batch: T[], retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.from(table).upsert(batch as never[], { ignoreDuplicates: false })
    if (!error) return
    if (attempt < retries) {
      await sleep(1000 * attempt) // 1s, 2s backoff
    } else {
      console.error(`  ✗ Batch error on ${table} (gave up after ${retries} attempts):`, error.message)
    }
  }
}

// ── ZIP-LEVEL: ZORI ───────────────────────────────────────────────────────────

async function ingestZori() {
  console.log('\n📊 ZORI (Rent Index) — zip level')
  const { headers, rows } = parseCSV(path.join(CSV_DIR, 'Zip_zori_uc_sfrcondomfr_sm_month.csv'))
  const dateCols = getDateCols(headers)
  const zipIdx = headers.indexOf('RegionName')
  const cityIdx = headers.indexOf('City')
  const metroIdx = headers.indexOf('Metro')
  const countyIdx = headers.indexOf('CountyName')
  const stateIdx = headers.indexOf('State')
  const regionIdIdx = headers.indexOf('RegionID')

  const snapshots: object[] = []
  const lookups: object[] = []

  for (const row of rows) {
    const zip = row[zipIdx]
    if (!zip || !/^\d{5}$/.test(zip)) continue

    const latest = latestValue(row, dateCols)
    const asOf = latestDate(row, dateCols)
    const growth = growth12m(row, dateCols)

    snapshots.push({
      zip,
      zori_latest: latest,
      zori_growth_12m: growth,
      as_of_date: asOf,
    })

    // Build lookup entry
    const metro = row[metroIdx] ?? null
    const regionId = row[regionIdIdx] ?? null
    if (metro) {
      lookups.push({
        zip,
        metro_region_id: regionId,
        metro_name: metro,
        state: row[stateIdx] ?? null,
        city: row[cityIdx] ?? null,
        county_name: row[countyIdx] ?? null,
      })
    }

    if (snapshots.length >= BATCH_SIZE) {
      await upsertBatch('zillow_zip_snapshot', snapshots.splice(0))
      await sleep(200)
      process.stdout.write('.')
    }
    if (lookups.length >= BATCH_SIZE) {
      await upsertBatch('zip_metro_lookup', lookups.splice(0))
      await sleep(200)
    }
  }

  if (snapshots.length) await upsertBatch('zillow_zip_snapshot', snapshots)
  if (lookups.length) await upsertBatch('zip_metro_lookup', lookups)
  console.log(`\n  ✓ Done`)
}

// ── ZIP-LEVEL: ZHVI ───────────────────────────────────────────────────────────

async function ingestZhvi() {
  console.log('\n🏠 ZHVI (Home Value Index) — zip level')
  const { headers, rows } = parseCSV(path.join(CSV_DIR, 'Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv'))
  const dateCols = getDateCols(headers)
  const zipIdx = headers.indexOf('RegionName')

  const snapshots: object[] = []

  for (const row of rows) {
    const zip = row[zipIdx]
    if (!zip || !/^\d{5}$/.test(zip)) continue

    snapshots.push({
      zip,
      zhvi_latest: latestValue(row, dateCols),
      zhvi_growth_12m: growth12m(row, dateCols),
      as_of_date: latestDate(row, dateCols),
    })

    if (snapshots.length >= BATCH_SIZE) {
      await upsertBatch('zillow_zip_snapshot', snapshots.splice(0))
      await sleep(200)
      process.stdout.write('.')
    }
  }

  if (snapshots.length) await upsertBatch('zillow_zip_snapshot', snapshots)
  console.log(`\n  ✓ Done`)
}

// ── ZIP-LEVEL: ZHVF (forecast growth) ────────────────────────────────────────

async function ingestZhvf() {
  console.log('\n📈 ZHVF (Home Value Forecast) — zip level')
  const { headers, rows } = parseCSV(path.join(CSV_DIR, 'Zip_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv'))
  const dateCols = getDateCols(headers)
  const zipIdx = headers.indexOf('RegionName')

  const snapshots: object[] = []

  for (const row of rows) {
    const zip = row[zipIdx]
    if (!zip || !/^\d{5}$/.test(zip)) continue

    // ZHVF is already a growth % — take the latest 1yr forecast column
    const latest = latestValue(row, dateCols)

    snapshots.push({
      zip,
      zhvf_growth_1yr: latest !== null ? parseFloat((latest * 100).toFixed(2)) : null,
      as_of_date: latestDate(row, dateCols),
    })

    if (snapshots.length >= BATCH_SIZE) {
      await upsertBatch('zillow_zip_snapshot', snapshots.splice(0))
      await sleep(200)
      process.stdout.write('.')
    }
  }

  if (snapshots.length) await upsertBatch('zillow_zip_snapshot', snapshots)
  console.log(`\n  ✓ Done`)
}

// ── METRO-LEVEL: Days on Market ───────────────────────────────────────────────

async function ingestDoz() {
  console.log('\n⏱  Days on Market — metro level')
  const { headers, rows } = parseCSV(path.join(CSV_DIR, 'Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv'))
  const dateCols = getDateCols(headers)
  const regionIdIdx = headers.indexOf('RegionID')
  const regionNameIdx = headers.indexOf('RegionName')
  const stateIdx = headers.indexOf('StateName')

  const snapshots: object[] = []

  for (const row of rows) {
    const regionId = row[regionIdIdx]
    const regionName = row[regionNameIdx]
    if (!regionId || !regionName) continue

    snapshots.push({
      region_id: regionId,
      region_name: regionName,
      state_name: row[stateIdx] ?? null,
      doz_pending_latest: latestValue(row, dateCols),
      as_of_date: latestDate(row, dateCols),
    })
  }

  if (snapshots.length) await upsertBatch('zillow_metro_snapshot', snapshots)
  console.log(`  ✓ ${snapshots.length} metros`)
}

// ── METRO-LEVEL: Price Cuts ───────────────────────────────────────────────────

async function ingestPriceCuts() {
  console.log('\n✂️  Price Cuts — metro level')
  const { headers, rows } = parseCSV(path.join(CSV_DIR, 'Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv'))
  const dateCols = getDateCols(headers)
  const regionIdIdx = headers.indexOf('RegionID')
  const regionNameIdx = headers.indexOf('RegionName')
  const stateIdx = headers.indexOf('StateName')

  const snapshots: object[] = []

  for (const row of rows) {
    const regionId = row[regionIdIdx]
    const regionName = row[regionNameIdx]
    if (!regionId || !regionName) continue

    const latest = latestValue(row, dateCols)
    snapshots.push({
      region_id: regionId,
      region_name: regionName,
      state_name: row[stateIdx] ?? null,
      price_cut_pct_latest: latest !== null ? parseFloat((latest * 100).toFixed(2)) : null,
      as_of_date: latestDate(row, dateCols),
    })
  }

  if (snapshots.length) await upsertBatch('zillow_metro_snapshot', snapshots)
  console.log(`  ✓ ${snapshots.length} metros`)
}

// ── METRO-LEVEL: Inventory ────────────────────────────────────────────────────

async function ingestInventory() {
  console.log('\n📦 Inventory — metro level')
  const { headers, rows } = parseCSV(path.join(CSV_DIR, 'Metro_invt_fs_uc_sfrcondo_sm_month.csv'))
  const dateCols = getDateCols(headers)
  const regionIdIdx = headers.indexOf('RegionID')
  const regionNameIdx = headers.indexOf('RegionName')
  const stateIdx = headers.indexOf('StateName')

  const snapshots: object[] = []

  for (const row of rows) {
    const regionId = row[regionIdIdx]
    const regionName = row[regionNameIdx]
    if (!regionId || !regionName) continue

    snapshots.push({
      region_id: regionId,
      region_name: regionName,
      state_name: row[stateIdx] ?? null,
      inventory_latest: latestValue(row, dateCols),
      as_of_date: latestDate(row, dateCols),
    })
  }

  if (snapshots.length) await upsertBatch('zillow_metro_snapshot', snapshots)
  console.log(`  ✓ ${snapshots.length} metros`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Zillow CSV Ingestion ===')
  console.log(`Source: ${CSV_DIR}`)
  console.log(`Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  await ingestZori()   // zip snapshots + lookup table
  await ingestZhvi()   // zip snapshots (home values)
  await ingestZhvf()   // zip snapshots (forecast)
  await ingestDoz()    // metro snapshots (days on market)
  await ingestPriceCuts() // metro snapshots (price cuts)
  await ingestInventory() // metro snapshots (inventory)

  console.log('\n=== All done ===')
}

main().catch(console.error)
