/**
 * City Search API
 * Resolves a city name to all ZIP codes within it, with Zillow snapshot data.
 *
 * Strategy:
 * 1. Search zip_metro_lookup by city name (our Zillow-tracked ZIPs)
 * 2. Fallback: zippopotam city→ZIP lookup for smaller markets
 * 3. Return ZIPs with lat/lng centroids + Zillow data for map rendering
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchTexasZctaRowsByCity } from '@/lib/data/bigquery-texas-zcta'
import {
  MAX_CITY_ZIP_RESULTS,
  mergeTexasCityCoverageRows,
  shouldMergeTexasCityCoverage,
  type CityZipCoverageRow,
} from '@/lib/data/texas-city-coverage'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

interface ZipResult {
  zip: string
  city: string
  state: string | null
  metro_name: string | null
  lat: number | null
  lng: number | null
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
}

type SnapshotRow = {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
}

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get('city')?.trim()
  const stateRaw = request.nextUrl.searchParams.get('state')?.trim()

  if (!city) return NextResponse.json({ error: 'Missing city' }, { status: 400 })

  let stateAbbr: string | undefined
  if (stateRaw) {
    const abbr = normalizeUsStateToAbbr(stateRaw)
    if (!abbr) {
      return NextResponse.json(
        {
          error: `Unrecognized state "${stateRaw}". Use the full state name (e.g. New Jersey) or USPS code (NJ).`,
          zips: [],
        },
        { status: 400 }
      )
    }
    stateAbbr = abbr
  }

  try {
    // Step 1: Search our zip_metro_lookup by city name
    let query = supabase
      .from('zip_metro_lookup')
      .select('zip, city, state, metro_name, lat, lng')
      .ilike('city', city) // exact case-insensitive match, not prefix
      .not('lat', 'is', null)
      .limit(MAX_CITY_ZIP_RESULTS)

    if (stateAbbr) query = query.eq('state', stateAbbr)

    const { data: lookupZips } = await query

    let zips: CityZipCoverageRow[] = (lookupZips ?? []) as CityZipCoverageRow[]

    // Step 2: Texas-first canonical coverage merge so partial Zillow-derived lookup rows do not truncate cities like Houston.
    if (shouldMergeTexasCityCoverage(stateAbbr, zips)) {
      const texasCoverageRows = await fetchTexasZctaRowsByCity(city, 'TX', {
        limit: MAX_CITY_ZIP_RESULTS,
      })
      if (texasCoverageRows.length > 0) {
        zips = mergeTexasCityCoverageRows(zips, texasCoverageRows, city)
        if (!stateAbbr && zips.every((row) => row.state === 'TX')) {
          stateAbbr = 'TX'
        }
      }
    }

    // Step 3: Fallback to zippopotam if no results
    if (zips.length === 0) {
      const stateParam = stateAbbr?.toLowerCase() ?? ''
      const cityParam = city.toLowerCase().replace(/\s+/g, '-')
      const url = stateParam
        ? `https://api.zippopotam.us/us/${stateParam}/${cityParam}`
        : `https://api.zippopotam.us/us/va/${cityParam}` // default to VA for demo

      try {
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          zips = (data.places ?? []).map((p: { 'post code': string; 'place name': string; 'state abbreviation': string; latitude: string; longitude: string }) => ({
            zip: p['post code'],
            city: p['place name'],
            state: p['state abbreviation'],
            metro_name: null,
            lat: parseFloat(p.latitude),
            lng: parseFloat(p.longitude),
          }))
        }
      } catch { /* ignore */ }
    }

    if (zips.length === 0) {
      return NextResponse.json({ error: `No ZIPs found for "${city}"`, zips: [] }, { status: 404 })
    }

    // Step 4: Get Zillow snapshots for all found ZIPs
    const zipList = zips.map((z) => z.zip)
    const { data: snapshots } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m')
      .in('zip', zipList)

    const snapshotMap = new Map(
      ((snapshots ?? []) as SnapshotRow[]).map((snapshot) => [snapshot.zip, snapshot] as const)
    )

    const results: ZipResult[] = zips.map((z) => {
      const snap = snapshotMap.get(z.zip)
      return {
        ...z,
        zori_latest: snap?.zori_latest ?? z.zori_latest ?? null,
        zhvi_latest: snap?.zhvi_latest ?? z.zhvi_latest ?? null,
        zori_growth_12m: snap?.zori_growth_12m ?? z.zori_growth_12m ?? null,
        zhvi_growth_12m: snap?.zhvi_growth_12m ?? z.zhvi_growth_12m ?? null,
      }
    })

    // Compute city-level aggregates
    const withZori = results.filter((r) => r.zori_latest != null)
    const withZhvi = results.filter((r) => r.zhvi_latest != null)
    const avgZori = withZori.length
      ? Math.round(withZori.reduce((s, r) => s + r.zori_latest!, 0) / withZori.length)
      : null
    const avgZhvi = withZhvi.length
      ? Math.round(withZhvi.reduce((s, r) => s + r.zhvi_latest!, 0) / withZhvi.length)
      : null

    return NextResponse.json({
      city,
      state: stateAbbr ?? zips[0]?.state ?? null,
      metro_name: zips[0]?.metro_name ?? null,
      zip_count: results.length,
      aggregates: { avg_zori: avgZori, avg_zhvi: avgZhvi },
      zips: results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
