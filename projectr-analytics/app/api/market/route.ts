import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { geocodeZip } from '@/lib/geocoder'
import { fetchFred, fetchHud, fetchCensus } from '@/lib/fetchers'

const ZIP_REGEX = /^\d{5}$/

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')

  // Step 0: Validate zip format
  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code' }, { status: 400 })
  }

  try {
    // Step 1: Check Supabase cache (7-day TTL for live data)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: cached } = await supabase
      .from('projectr_master_data')
      .select('*')
      .eq('submarket_id', zip)
      .in('data_source', ['FRED', 'HUD', 'Census ACS'])
      .gte('created_at', sevenDaysAgo)
      .limit(100)

    if (cached && cached.length > 0) {
      // Also fetch any Zillow CSV data (no TTL — it's pre-ingested)
      const { data: zillowData } = await supabase
        .from('projectr_master_data')
        .select('*')
        .eq('submarket_id', zip)
        .eq('data_source', 'Zillow Research')

      return NextResponse.json({
        zip,
        cached: true,
        data: [...cached, ...(zillowData ?? [])],
      })
    }

    // Step 2: Geocode zip → lat/lng + FIPS
    const geo = await geocodeZip(zip)
    if (!geo) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 })
    }

    // Step 3: Concurrent fetch from all live APIs
    const [fredRows, hudRows, censusRows] = await Promise.all([
      fetchFred(geo, zip),
      fetchHud(geo, zip),
      fetchCensus(zip),
    ])

    const allRows = [...fredRows, ...hudRows, ...censusRows]

    // Step 4: Upsert into Supabase
    if (allRows.length > 0) {
      await supabase.from('projectr_master_data').insert(allRows)
    }

    // Also pull any pre-ingested Zillow data
    const { data: zillowData } = await supabase
      .from('projectr_master_data')
      .select('*')
      .eq('submarket_id', zip)
      .eq('data_source', 'Zillow Research')

    return NextResponse.json({
      zip,
      cached: false,
      geo: { lat: geo.lat, lng: geo.lng, county: geo.county, state: geo.state },
      data: [...allRows, ...(zillowData ?? [])],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
