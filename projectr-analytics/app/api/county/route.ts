import { type NextRequest, NextResponse } from 'next/server'
import { hydrateAreaZipResults } from '@/lib/area-search'
import { buildCountyAreaKey, normalizeCountyDisplayName } from '@/lib/area-keys'
import { supabase } from '@/lib/supabase'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

const MAX_COUNTY_ZIPS = 400

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

    let rows = exactRows ?? []
    if (rows.length === 0) {
      const fuzzyPattern = `%${countyName.replace(/\s+county$/i, '').trim()}%`
      let fuzzyQuery = supabase
        .from('zip_metro_lookup')
        .select('zip, city, state, metro_name, lat, lng, county_name')
        .not('lat', 'is', null)
        .limit(MAX_COUNTY_ZIPS)

      if (stateAbbr) fuzzyQuery = fuzzyQuery.eq('state', stateAbbr)
      const { data: fuzzyRows } = await fuzzyQuery.ilike('county_name', fuzzyPattern)
      rows = fuzzyRows ?? []
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
