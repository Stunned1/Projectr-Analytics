/**
 * Returns neighboring ZIP codes sorted by geographic proximity.
 * Uses lat/lng centroids in zip_metro_lookup to find the closest ZIPs
 * within the same metro area.
 */
import { type NextRequest, NextResponse } from 'next/server'
import {
  fetchTexasZctaRowByZip,
  fetchTexasZctaRowsByMetro,
} from '@/lib/data/bigquery-texas-zcta'
import { mergeTexasPeerZipLists } from '@/lib/data/texas-metro-coverage'
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

interface LookupMetroZipRow {
  zip: string
  lat: number | null
  lng: number | null
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

function rankZipsByDistance(
  zips: readonly LookupMetroZipRow[],
  originLat: number,
  originLng: number,
  excludeZip: string,
  limit: number
): string[] {
  return zips
    .filter((row) => row.zip !== excludeZip && row.lat != null && row.lng != null)
    .map((row) => ({
      zip: row.zip,
      dist: Math.sqrt(
        Math.pow(((row.lat ?? 0) - originLat) * 111, 2) +
        Math.pow(((row.lng ?? 0) - originLng) * 111 * Math.cos((originLat * Math.PI) / 180), 2)
      ),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map((row) => row.zip)
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  if (!zip) return NextResponse.json({ error: 'Missing zip' }, { status: 400 })

  try {
    // Get the searched ZIP's centroid + metro
    const { data: originLookup } = await supabase
      .from('zip_metro_lookup')
      .select('lat, lng, metro_name, metro_name_short, state')
      .eq('zip', zip)
      .maybeSingle()

    const texasCoverageRow =
      originLookup?.state === 'TX' || !originLookup?.metro_name_short
        ? await fetchTexasZctaRowByZip(zip)
        : null

    const origin = {
      lat: originLookup?.lat ?? texasCoverageRow?.lat ?? null,
      lng: originLookup?.lng ?? texasCoverageRow?.lng ?? null,
      metro_name: originLookup?.metro_name ?? texasCoverageRow?.metro_name ?? null,
      metro_name_short: originLookup?.metro_name_short ?? texasCoverageRow?.metro_name_short ?? null,
      state: originLookup?.state ?? texasCoverageRow?.state_abbr ?? null,
    }

    const metroKey = origin.metro_name_short ?? origin.metro_name
    const isTexasOrigin = origin.state === 'TX' || texasCoverageRow != null

    if (!metroKey) {
      return NextResponse.json({ zips: [] })
    }

    if (isTexasOrigin) {
      let metroQuery = supabase
        .from('zip_metro_lookup')
        .select('zip, lat, lng')
        .eq('metro_name_short', origin.metro_name_short ?? metroKey)

      if (origin.state) {
        metroQuery = metroQuery.eq('state', origin.state)
      }

      const { data: metroZips } = await metroQuery

      const canonicalMetroRows = await fetchTexasZctaRowsByMetro(metroKey, 'TX', { limit: 650 })
      const mergedPeerZips = mergeTexasPeerZipLists(
        (metroZips ?? []).map((row) => row.zip).filter(Boolean),
        canonicalMetroRows,
        { excludeZip: zip }
      )

      if (!mergedPeerZips.length) return NextResponse.json({ zips: [] })

      if (origin.lat != null && origin.lng != null) {
        const rowsByZip = new Map<string, LookupMetroZipRow>()
        for (const row of (metroZips ?? []) as LookupMetroZipRow[]) {
          rowsByZip.set(row.zip, row)
        }
        for (const row of canonicalMetroRows) {
          if (rowsByZip.has(row.zcta5)) continue
          rowsByZip.set(row.zcta5, { zip: row.zcta5, lat: row.lat, lng: row.lng })
        }

        const rankedPeerZips = rankZipsByDistance(
          mergedPeerZips
            .map((peerZip) => rowsByZip.get(peerZip))
            .filter((row): row is LookupMetroZipRow => row != null),
          origin.lat,
          origin.lng,
          zip,
          20
        )

        const snapshots = await fetchSnapshotsForZips(rankedPeerZips)
        return NextResponse.json({
          metro: metroKey,
          origin_coords: { lat: origin.lat, lng: origin.lng },
          zips: snapshots,
        })
      }

      const snapshots = await fetchSnapshotsForZips(mergedPeerZips.slice(0, 15))
      return NextResponse.json({ metro: metroKey, zips: snapshots })
    }

    // Preferred path: use PostGIS RPC for nearest-neighbor ranking in the database.
    if (origin.lat != null && origin.lng != null && origin.metro_name_short) {
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
      let fallbackMetroQuery = supabase
        .from('zip_metro_lookup')
        .select('zip, lat, lng')
        .eq('metro_name_short', origin.metro_name_short)
        .neq('zip', zip)
        .not('lat', 'is', null)

      if (origin.state) {
        fallbackMetroQuery = fallbackMetroQuery.eq('state', origin.state)
      }

      const { data: metroZips } = await fallbackMetroQuery

      if (!metroZips?.length) return NextResponse.json({ zips: [] })

      const sorted = rankZipsByDistance(
        metroZips as LookupMetroZipRow[],
        origin.lat,
        origin.lng,
        zip,
        20
      )

      const snapshots = await fetchSnapshotsForZips(sorted)
      return NextResponse.json({
        metro: origin.metro_name_short,
        origin_coords: { lat: origin.lat, lng: origin.lng },
        zips: snapshots,
      })
    }

    // Fallback: no coordinates yet, return metro ZIPs without distance sort
    let metroZipQuery = supabase
      .from('zip_metro_lookup')
      .select('zip')
      .eq('metro_name_short', origin.metro_name_short)
      .neq('zip', zip)
      .limit(15)

    if (origin.state) {
      metroZipQuery = metroZipQuery.eq('state', origin.state)
    }

    const { data: metroZips } = await metroZipQuery

    if (!metroZips?.length) return NextResponse.json({ zips: [] })

    const snapshots = await fetchSnapshotsForZips(metroZips.map((z) => z.zip))

    return NextResponse.json({ metro: origin.metro_name_short, zips: snapshots })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
