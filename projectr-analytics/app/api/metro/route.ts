import { type NextRequest, NextResponse } from 'next/server'
import { hydrateAreaZipResults } from '@/lib/area-search'
import { buildMetroAreaKey, normalizeMetroDisplayName } from '@/lib/area-keys'
import { supabase } from '@/lib/supabase'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

const MAX_METRO_ZIPS = 500

export async function GET(request: NextRequest) {
  const metroRaw = request.nextUrl.searchParams.get('metro')?.trim()
  const stateRaw = request.nextUrl.searchParams.get('state')?.trim()

  if (!metroRaw) {
    return NextResponse.json({ error: 'Missing metro' }, { status: 400 })
  }

  const stateAbbr = stateRaw ? normalizeUsStateToAbbr(stateRaw) : undefined
  if (stateRaw && !stateAbbr) {
    return NextResponse.json({ error: `Unrecognized state "${stateRaw}"` }, { status: 400 })
  }

  const metroName = normalizeMetroDisplayName(metroRaw)

  try {
    let query = supabase
      .from('zip_metro_lookup')
      .select('zip, city, state, metro_name, lat, lng')
      .not('lat', 'is', null)
      .limit(MAX_METRO_ZIPS)

    if (stateAbbr) query = query.eq('state', stateAbbr)

    const { data: exactRows } = await query.ilike('metro_name', metroName)

    let rows = exactRows ?? []
    if (rows.length === 0) {
      let fuzzyQuery = supabase
        .from('zip_metro_lookup')
        .select('zip, city, state, metro_name, lat, lng')
        .not('lat', 'is', null)
        .limit(MAX_METRO_ZIPS)

      if (stateAbbr) fuzzyQuery = fuzzyQuery.eq('state', stateAbbr)
      const { data: fuzzyRows } = await fuzzyQuery.ilike('metro_name', `%${metroName}%`)
      rows = fuzzyRows ?? []
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: `No ZIPs found for "${metroRaw}"`, zips: [] }, { status: 404 })
    }

    const results = await hydrateAreaZipResults(rows)
    const canonicalMetroName = rows[0]?.metro_name ?? metroName

    return NextResponse.json({
      kind: 'metro',
      metro_name: canonicalMetroName,
      state: stateAbbr ?? null,
      area_key: buildMetroAreaKey(canonicalMetroName, stateAbbr ?? null),
      zip_count: results.length,
      zips: results,
      label: canonicalMetroName,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
