import { supabase } from '@/lib/supabase'

export interface AreaZipLookupRow {
  zip: string
  city: string
  state: string | null
  metro_name: string | null
  lat: number | null
  lng: number | null
  zori_latest?: number | null
  zhvi_latest?: number | null
  zori_growth_12m?: number | null
  zhvi_growth_12m?: number | null
}

export interface AreaZipResult extends AreaZipLookupRow {
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
}

export async function hydrateAreaZipResults(rows: AreaZipLookupRow[]): Promise<AreaZipResult[]> {
  const deduped = Array.from(new Map(rows.map((row) => [row.zip, row])).values())
  if (deduped.length === 0) return []

  const { data: snapshots } = await supabase
    .from('zillow_zip_snapshot')
    .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m')
    .in('zip', deduped.map((row) => row.zip))

  const snapshotMap = new Map(
    ((snapshots ?? []) as Array<{
      zip: string
      zori_latest: number | null
      zhvi_latest: number | null
      zori_growth_12m: number | null
      zhvi_growth_12m: number | null
    }>).map((snap) => [snap.zip, snap] as const)
  )

  return deduped.map((row) => {
    const snap = snapshotMap.get(row.zip)
    return {
      ...row,
      zori_latest: snap?.zori_latest ?? row.zori_latest ?? null,
      zhvi_latest: snap?.zhvi_latest ?? row.zhvi_latest ?? null,
      zori_growth_12m: snap?.zori_growth_12m ?? row.zori_growth_12m ?? null,
      zhvi_growth_12m: snap?.zhvi_growth_12m ?? row.zhvi_growth_12m ?? null,
    }
  })
}
