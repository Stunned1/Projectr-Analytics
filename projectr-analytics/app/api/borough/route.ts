/**
 * Borough Search API (NYC-specific)
 * Returns borough boundary + all ZIPs within that borough with Zillow data
 *
 * Boroughs map to NYC counties:
 * Manhattan = New York County (36061)
 * Brooklyn  = Kings County    (36047)
 * Queens    = Queens County   (36081)
 * Bronx     = Bronx County    (36005)
 * Staten Island = Richmond County (36085)
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type LookupZipRow = {
  zip: string
  city: string | null
  state: string | null
  metro_name: string | null
  lat: number | null
  lng: number | null
}

type ZillowSnapshotRow = {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
}

const BOROUGH_MAP: Record<string, { county: string; state: string; name: string; zipRange: [string, string] }> = {
  manhattan:     { county: '061', state: '36', name: 'Manhattan',     zipRange: ['10001', '10282'] },
  brooklyn:      { county: '047', state: '36', name: 'Brooklyn',      zipRange: ['11200', '11256'] },
  queens:        { county: '081', state: '36', name: 'Queens',        zipRange: ['11100', '11436'] },
  bronx:         { county: '005', state: '36', name: 'Bronx',         zipRange: ['10451', '10475'] },
  'staten island': { county: '085', state: '36', name: 'Staten Island', zipRange: ['10300', '10315'] },
}

const TIGER_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82/query'

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name')?.toLowerCase().trim()
  if (!name) return NextResponse.json({ error: 'Missing borough name' }, { status: 400 })

  const borough = BOROUGH_MAP[name]
  if (!borough) {
    return NextResponse.json({
      error: `Unknown borough "${name}". Valid: manhattan, brooklyn, queens, bronx, staten island`,
    }, { status: 404 })
  }

  try {
    // Fetch borough boundary from Census TIGER
    const boundaryUrl = `${TIGER_URL}?where=STATE%3D'${borough.state}'+AND+COUNTY%3D'${borough.county}'&outFields=NAME,COUNTY,STATE&geometryPrecision=4&f=geojson`
    const boundaryRes = await fetch(boundaryUrl, { next: { revalidate: 86400 * 30 } })
    const boundary = boundaryRes.ok ? await boundaryRes.json() : null

    // Get all ZIPs in this borough's ZIP range from our lookup table
    const { data: lookupZips } = await supabase
      .from('zip_metro_lookup')
      .select('zip, city, state, metro_name, lat, lng')
      .gte('zip', borough.zipRange[0])
      .lte('zip', borough.zipRange[1])
      .not('lat', 'is', null)

    const zips = (lookupZips ?? []) as LookupZipRow[]

    // Get Zillow snapshots
    const zipList = zips.map((z) => z.zip)
    const { data: snapshots } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m')
      .in('zip', zipList)

    const snapshotMap = new Map(((snapshots ?? []) as ZillowSnapshotRow[]).map((s) => [s.zip, s]))

    const results = zips.map((z) => {
      const snap = snapshotMap.get(z.zip)
      return {
        ...z,
        zori_latest: snap?.zori_latest ?? null,
        zhvi_latest: snap?.zhvi_latest ?? null,
        zori_growth_12m: snap?.zori_growth_12m ?? null,
        zhvi_growth_12m: snap?.zhvi_growth_12m ?? null,
      }
    })

    // Aggregates
    const withZori = results.filter((r) => r.zori_latest != null)
    const withZhvi = results.filter((r) => r.zhvi_latest != null)

    return NextResponse.json({
      borough: borough.name,
      state: 'NY',
      county_fips: borough.county,
      state_fips: borough.state,
      zip_count: results.length,
      boundary: boundary?.features?.[0] ?? null,
      aggregates: {
        avg_zori: withZori.length ? Math.round(withZori.reduce((s, r) => s + r.zori_latest!, 0) / withZori.length) : null,
        avg_zhvi: withZhvi.length ? Math.round(withZhvi.reduce((s, r) => s + r.zhvi_latest!, 0) / withZhvi.length) : null,
      },
      zips: results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
