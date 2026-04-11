/**
 * Borough / city search only hits `/api/aggregate`, which reads `projectr_master_data`.
 * That table is populated by `/api/market` cold starts - without a prior ZIP load, ACS + BPS are empty.
 * This helper mirrors the market cold fetch for ZIPs that lack cache so aggregates and PDFs populate.
 */

import { supabase } from '@/lib/supabase'
import { geocodeZip } from '@/lib/geocoder'
import { fetchFred, fetchHud, fetchCensus, fetchPermits } from '@/lib/fetchers'

async function zipHasAcsOrBps(zip: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('projectr_master_data')
    .select('id')
    .eq('submarket_id', zip)
    .in('data_source', ['Census ACS', 'Census BPS'])
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

/** Fetch + insert ACS, BPS, FRED, HUD for one ZIP when it has no Census rows yet. */
export async function ensureZipMasterDataCached(zip: string): Promise<void> {
  if (!/^\d{5}$/.test(zip)) return
  if (await zipHasAcsOrBps(zip)) return

  const geo = await geocodeZip(zip)
  if (!geo) return

  const [fredRows, hudRows, censusRows, permitRows] = await Promise.all([
    fetchFred(geo, zip),
    fetchHud(geo, zip),
    fetchCensus(zip, geo),
    fetchPermits(geo, zip),
  ])
  const allRows = [...fredRows, ...hudRows, ...censusRows, ...permitRows]
  if (allRows.length > 0) {
    await supabase.from('projectr_master_data').insert(allRows)
  }
}

/**
 * If no ZIP in the list has ACS/BPS yet, cold-fill a batch (parallel) so aggregate + PDF metrics work.
 */
export async function ensureAreaMasterDataCached(zips: string[]): Promise<void> {
  const clean = [...new Set(zips.filter((z) => /^\d{5}$/.test(z)))]
  if (!clean.length) return

  const { data: hit } = await supabase
    .from('projectr_master_data')
    .select('submarket_id')
    .in('submarket_id', clean)
    .in('data_source', ['Census ACS', 'Census BPS'])
    .limit(1)

  if (hit && hit.length > 0) return

  const batch = clean.slice(0, 16)
  const concurrency = 4
  for (let i = 0; i < batch.length; i += concurrency) {
    await Promise.all(batch.slice(i, i + concurrency).map((z) => ensureZipMasterDataCached(z)))
  }
}
