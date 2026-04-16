import { type NextRequest, NextResponse } from 'next/server'
import { hydrateAreaZipResults } from '@/lib/area-search'
import { buildCountyAreaKey, normalizeCountyDisplayName } from '@/lib/area-keys'
import { geoTrendsStub } from '@/lib/geocoder'
import { supabase } from '@/lib/supabase'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

const MAX_COUNTY_ZIPS = 400
type CountyLookupRow = {
  zip: string
  city: string
  state: string | null
  metro_name: string | null
  lat: number | null
  lng: number | null
  county_name?: string | null
}

async function resolveCountyFips(countyName: string, stateAbbr: string): Promise<string | null> {
  const stateFips = geoTrendsStub(countyName, stateAbbr).stateFips
  if (!stateFips) return null

  try {
    const params = new URLSearchParams({
      get: 'NAME',
      for: 'county:*',
      in: `state:${stateFips}`,
    })
    if (process.env.CENSUS_API_KEY) {
      params.set('key', process.env.CENSUS_API_KEY)
    }

    const res = await fetch(`https://api.census.gov/data/2020/dec/pl?${params.toString()}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null

    const rows = (await res.json()) as string[][]
    const countyBase = countyName.replace(/\s+county$/i, '').trim().toLowerCase()
    for (const row of rows.slice(1)) {
      const [name, , countyFips] = row
      const base = String(name ?? '')
        .replace(/\s+County,.*$/i, '')
        .trim()
        .toLowerCase()
      if (base === countyBase && countyFips) return countyFips
    }
    return null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const countyRaw = request.nextUrl.searchParams.get('county')?.trim()
  const stateRaw = request.nextUrl.searchParams.get('state')?.trim()

  if (!countyRaw) {
    return NextResponse.json({ error: 'Missing county' }, { status: 400 })
  }

  const stateAbbr = stateRaw ? normalizeUsStateToAbbr(stateRaw) : undefined
  if (stateRaw && !stateAbbr) {
    return NextResponse.json({ error: `Unrecognized state "${stateRaw}"` }, { status: 400 })
  }

  const countyName = normalizeCountyDisplayName(countyRaw)

  try {
    let query = supabase
      .from('zip_metro_lookup')
      .select('zip, city, state, metro_name, lat, lng, county_name')
      .not('lat', 'is', null)
      .limit(MAX_COUNTY_ZIPS)

    if (stateAbbr) query = query.eq('state', stateAbbr)

    const { data: exactRows } = await query.ilike('county_name', countyName)

    let rows: CountyLookupRow[] = (exactRows ?? []) as CountyLookupRow[]
    if (rows.length === 0) {
      const fuzzyPattern = `%${countyName.replace(/\s+county$/i, '').trim()}%`
      let fuzzyQuery = supabase
        .from('zip_metro_lookup')
        .select('zip, city, state, metro_name, lat, lng, county_name')
        .not('lat', 'is', null)
        .limit(MAX_COUNTY_ZIPS)

      if (stateAbbr) fuzzyQuery = fuzzyQuery.eq('state', stateAbbr)
      const { data: fuzzyRows } = await fuzzyQuery.ilike('county_name', fuzzyPattern)
      rows = (fuzzyRows ?? []) as CountyLookupRow[]
    }

    // Some environments have `zip_metro_lookup.county_name` populated incorrectly (e.g. "TX").
    // Fall back to `zip_geocode_cache` county FIPS so Texas county search still resolves.
    if (rows.length === 0 && stateAbbr) {
      const countyFips = await resolveCountyFips(countyName, stateAbbr)
      if (countyFips) {
        const { data: cachedCountyZips } = await supabase
          .from('zip_geocode_cache')
          .select('zip')
          .eq('state', stateAbbr)
          .eq('county_fips', countyFips)
          .limit(MAX_COUNTY_ZIPS)

        const zipList = Array.from(new Set((cachedCountyZips ?? []).map((row) => row.zip).filter(Boolean)))
        if (zipList.length > 0) {
          const { data: lookupRows } = await supabase
            .from('zip_metro_lookup')
            .select('zip, city, state, metro_name, lat, lng')
            .in('zip', zipList)
            .not('lat', 'is', null)
            .limit(MAX_COUNTY_ZIPS)

          rows = (lookupRows ?? []) as CountyLookupRow[]
        }
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: `No ZIPs found for "${countyRaw}"`, zips: [] }, { status: 404 })
    }

    const results = await hydrateAreaZipResults(
      rows.map((row) => ({
        zip: row.zip,
        city: row.city,
        state: row.state,
        metro_name: row.metro_name,
        lat: row.lat,
        lng: row.lng,
      }))
    )

    const labelState = stateAbbr ?? rows[0]?.state ?? null
    const label = labelState ? `${countyName}, ${labelState}` : countyName

    return NextResponse.json({
      kind: 'county',
      county: countyName,
      state: labelState,
      area_key: labelState ? buildCountyAreaKey(countyName, labelState) : null,
      zip_count: results.length,
      zips: results,
      label,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
