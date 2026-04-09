/**
 * Populates lat/lng centroids in zip_metro_lookup using zippopotam.us
 * Run: npm run populate:centroids
 *
 * Only updates rows where lat IS NULL to avoid re-fetching.
 * Processes in batches with rate limiting.
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function geocodeZip(zip: string): Promise<{ lat: number; lng: number } | null> {
  // Try zippopotam first
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`)
    if (res.status === 404) {
      // Don't retry 404s — fall through to Census fallback
    } else if (res.ok) {
      const data = await res.json()
      const place = data.places?.[0]
      if (place) {
        return { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude) }
      }
    } else if (res.status === 429) {
      await sleep(3000)
    }
  } catch { /* fall through */ }

  // Fallback: Census geocoder (handles ZIPs zippopotam misses)
  try {
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/address?street=1+Main+St&zip=${zip}&benchmark=Public_AR_Current&format=json`
    )
    if (!res.ok) return null
    const data = await res.json()
    const match = data?.result?.addressMatches?.[0]
    if (match?.coordinates) {
      return { lat: match.coordinates.y, lng: match.coordinates.x }
    }
  } catch { /* fall through */ }

  return null
}

async function main() {
  console.log('=== Populating ZIP centroids ===')

  // Get all rows missing lat/lng
  const { data: rows, error } = await supabase
    .from('zip_metro_lookup')
    .select('zip')
    .is('lat', null)
    .limit(10000)

  if (error) { console.error(error.message); process.exit(1) }
  if (!rows?.length) { console.log('All centroids already populated.'); return }

  console.log(`Found ${rows.length} ZIPs missing centroids`)

  let updated = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const { zip } = rows[i]
    const coords = await geocodeZip(zip)

    if (coords) {
      const { error: updateError } = await supabase
        .from('zip_metro_lookup')
        .update({ lat: coords.lat, lng: coords.lng })
        .eq('zip', zip)

      if (updateError) {
        failed++
      } else {
        updated++
      }
    } else {
      failed++
    }

    // Progress + rate limiting
    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\r  ${i + 1}/${rows.length} (${updated} updated, ${failed} failed)`)
      await sleep(500)
    } else {
      await sleep(80)
    }
  }

  console.log(`\n=== Done: ${updated} updated, ${failed} failed ===`)
}

main().catch(console.error)
