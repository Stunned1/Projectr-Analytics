import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRowsForSubmarket, upsertMarketDataRows } from '@/lib/data/market-data-router'
import { resolveZipAreaContext } from '@/lib/data/zip-area-context'
import { geocodeZip } from '@/lib/geocoder'
import { fetchFred, fetchHud, fetchCensus, fetchPermits } from '@/lib/fetchers'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/

type ZillowSnapshotRow = {
  zip: string
  zori_latest: number | null
  zori_growth_12m: number | null
  zhvi_latest: number | null
  zhvi_growth_12m: number | null
  zhvf_growth_1yr: number | null
  as_of_date: string | null
}

async function getZillowData(zip: string) {
  const [{ data: snapData }, areaContext] = await Promise.all([
    supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zori_growth_12m, zhvi_latest, zhvi_growth_12m, zhvf_growth_1yr, as_of_date')
      .eq('zip', zip)
      .single(),
    resolveZipAreaContext(zip),
  ])
  const snap = (snapData ?? null) as ZillowSnapshotRow | null

  // Metro velocity via metro_name_short
  let metroVelocity = null
  if (areaContext?.metro_name_short) {
    const { data: mv } = await supabase
      .from('zillow_metro_snapshot')
      .select('region_name, doz_pending_latest, price_cut_pct_latest, inventory_latest, as_of_date')
      .eq('region_name', areaContext.metro_name_short)
      .single()
    metroVelocity = mv
  }

  return {
    zillow:
      snap
        ? {
            ...snap,
            metro_name: areaContext?.metro_name ?? null,
            city: areaContext?.city ?? null,
          }
        : null,
    metro_velocity: metroVelocity,
  }
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')

  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code' }, { status: 400 })
  }

  try {
    // Step 1: Check Supabase cache (7-day TTL for live API data)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const cached = await getRowsForSubmarket(zip, {
      dataSource: ['FRED', 'HUD', 'Census ACS'],
      createdSince: sevenDaysAgo,
      limit: 100,
    })

    if (cached && cached.length > 0) {
      const [{ zillow, metro_velocity }, geo] = await Promise.all([getZillowData(zip), geocodeZip(zip)])
      return NextResponse.json({
        zip, cached: true, data: cached, zillow, metro_velocity,
        geo: geo ? { lat: geo.lat, lng: geo.lng, city: geo.city, state: geo.state, stateFips: geo.stateFips, countyFips: geo.countyFips } : undefined,
      })
    }

    // Step 2: Geocode
    const geo = await geocodeZip(zip)
    if (!geo) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 })
    }

    // Step 3: Concurrent fetch from live APIs
    const zillowPromise = getZillowData(zip)
    const [fredRows, hudRows, censusRows, permitRows, { zillow, metro_velocity }] = await Promise.all([
      fetchFred(geo, zip),
      fetchHud(geo, zip),
      fetchCensus(zip, geo),
      fetchPermits(geo, zip),
      zillowPromise,
    ])

    const allRows = [...fredRows, ...hudRows, ...censusRows, ...permitRows]

    // Step 4: Upsert into Supabase
    if (allRows.length > 0) {
      await upsertMarketDataRows(allRows)
    }

    return NextResponse.json({
      zip,
      cached: false,
      geo: { lat: geo.lat, lng: geo.lng, city: geo.city, state: geo.state, stateFips: geo.stateFips, countyFips: geo.countyFips },
      data: allRows,
      zillow,
      metro_velocity,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
