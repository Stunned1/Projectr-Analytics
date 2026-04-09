/**
 * Populates lat/lng centroids in zip_metro_lookup using zippopotam.us
 * Run: npm run populate:centroids
 *
 * Only updates rows where lat IS NULL to avoid re-fetching.
 * Processes in batches with rate limiting.
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { geocodeZip } from '../lib/geocoder'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    const geo = await geocodeZip(zip)

    if (geo) {
      const { error: updateError } = await supabase
        .from('zip_metro_lookup')
        .update({ lat: geo.lat, lng: geo.lng })
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
