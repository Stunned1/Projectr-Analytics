/**
 * Returns neighboring ZIP codes sorted by geographic proximity.
 * Uses lat/lng centroids in zip_metro_lookup to find the closest ZIPs
 * within the same metro area.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface NeighborSnapshot {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
}

interface NeighborRpcRow {
  zip: string | null
  distance_km?: number | string | null
  zori_latest?: number | string | null
  zhvi_latest?: number | string | null
  zori_growth_12m?: number | string | null
  zhvi_growth_12m?: number | string | null
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function fetchSnapshotsForZips(zipList: string[]): Promise<NeighborSnapshot[]> {
  if (!zipList.length) return []
  const { data: snapshots } = await supabase
    .from('zillow_zip_snapshot')
    .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m')
    .in('zip', zipList)

  return (snapshots ?? []) as NeighborSnapshot[]
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  if (!zip) return NextResponse.json({ error: 'Missing zip' }, { status: 400 })

  try {
    // Get the searched ZIP's centroid + metro
    const { data: origin } = await supabase
      .from('zip_metro_lookup')
      .select('lat, lng, metro_name_short')
      .eq('zip', zip)
      .single()

    if (!origin?.metro_name_short) {
      return NextResponse.json({ zips: [] })
    }

    // Preferred path: use PostGIS RPC for nearest-neighbor ranking in the database.
    if (origin.lat && origin.lng) {
      const { data: rpcRows, error: rpcError } = await supabase.rpc('get_neighbor_zips', {
        p_zip: zip,
        p_limit: 20,
      })

      if (!rpcError && Array.isArray(rpcRows) && rpcRows.length > 0) {
        const parsedRows = (rpcRows as NeighborRpcRow[]).filter((row) => typeof row.zip === 'string')
        const hasSnapshotMetrics = parsedRows.every(
          (row) =>
            Object.prototype.hasOwnProperty.call(row, 'zori_latest') &&
            Object.prototype.hasOwnProperty.call(row, 'zhvi_latest')
        )

        // If RPC returns snapshot metrics, use them directly; otherwise hydrate with a follow-up query.
        if (hasSnapshotMetrics) {
          const zips = parsedRows.map((row) => ({
            zip: row.zip as string,
            zori_latest: toNumber(row.zori_latest),
            zhvi_latest: toNumber(row.zhvi_latest),
            zori_growth_12m: toNumber(row.zori_growth_12m),
            zhvi_growth_12m: toNumber(row.zhvi_growth_12m),
            distance_km: toNumber(row.distance_km),
          }))

          return NextResponse.json({
            metro: origin.metro_name_short,
            origin_coords: { lat: origin.lat, lng: origin.lng },
            zips,
          })
        }

        const zipList = parsedRows.map((row) => row.zip as string)
        const snapshots = await fetchSnapshotsForZips(zipList)
        return NextResponse.json({
          metro: origin.metro_name_short,
          origin_coords: { lat: origin.lat, lng: origin.lng },
          zips: snapshots,
        })
      }

      // Fallback path if RPC is missing or errors: current JS distance sort.
      const { data: metroZips } = await supabase
        .from('zip_metro_lookup')
        .select('zip, lat, lng')
        .eq('metro_name_short', origin.metro_name_short)
        .neq('zip', zip)
        .not('lat', 'is', null)

      if (!metroZips?.length) return NextResponse.json({ zips: [] })

      const sorted = metroZips
        .map((z) => ({
          zip: z.zip,
          dist: Math.sqrt(
            Math.pow((z.lat - origin.lat) * 111, 2) +
            Math.pow((z.lng - origin.lng) * 111 * Math.cos((origin.lat * Math.PI) / 180), 2)
          ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20)

      const snapshots = await fetchSnapshotsForZips(sorted.map((z) => z.zip))
      return NextResponse.json({
        metro: origin.metro_name_short,
        origin_coords: { lat: origin.lat, lng: origin.lng },
        zips: snapshots,
      })
    }

    // Fallback: no coordinates yet, return metro ZIPs without distance sort
    const { data: metroZips } = await supabase
      .from('zip_metro_lookup')
      .select('zip')
      .eq('metro_name_short', origin.metro_name_short)
      .neq('zip', zip)
      .limit(15)

    if (!metroZips?.length) return NextResponse.json({ zips: [] })

    const snapshots = await fetchSnapshotsForZips(metroZips.map((z) => z.zip))

    return NextResponse.json({ metro: origin.metro_name_short, zips: snapshots })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
