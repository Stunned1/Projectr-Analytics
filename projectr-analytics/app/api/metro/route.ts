import { type NextRequest, NextResponse } from 'next/server'
import { hydrateAreaZipResults } from '@/lib/area-search'
import { buildMetroAreaKey, normalizeMetroDisplayName } from '@/lib/area-keys'
import { supabase } from '@/lib/supabase'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

const MAX_METRO_ZIPS = 500

type MetroLookupRow = {
  zip: string
  city: string
  state: string | null
  metro_name: string | null
  metro_name_short?: string | null
  lat: number | null
  lng: number | null
}

async function queryMetroRows(
  column: 'metro_name' | 'metro_name_short',
  pattern: string,
  stateAbbr?: string | null
): Promise<MetroLookupRow[]> {
  let query = supabase
    .from('zip_metro_lookup')
    .select('zip, city, state, metro_name, metro_name_short, lat, lng')
    .not('lat', 'is', null)
    .limit(MAX_METRO_ZIPS)

  if (stateAbbr) query = query.eq('state', stateAbbr)
  const { data } = await query.ilike(column, pattern)
  return (data ?? []) as MetroLookupRow[]
}

function metroShortAlias(value: string): string | null {
  const primary = normalizeMetroDisplayName(value)
    .split(/[-,/]/)
    .map((part) => part.trim())
    .filter(Boolean)[0]

  return primary && primary !== value ? primary : primary || null
}

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
    let rows = await queryMetroRows('metro_name', metroName, stateAbbr)
    if (rows.length === 0) {
      rows = await queryMetroRows('metro_name_short', metroName, stateAbbr)
    }
    if (rows.length === 0) {
      rows = await queryMetroRows('metro_name', `%${metroName}%`, stateAbbr)
    }
    if (rows.length === 0) {
      rows = await queryMetroRows('metro_name_short', `%${metroName}%`, stateAbbr)
    }
    if (rows.length === 0) {
      const alias = metroShortAlias(metroName)
      if (alias && alias !== metroName) {
        rows = await queryMetroRows('metro_name_short', alias, stateAbbr)
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: `No ZIPs found for "${metroRaw}"`, zips: [] }, { status: 404 })
    }

    const results = await hydrateAreaZipResults(rows)
    const canonicalMetroName = rows[0]?.metro_name ?? metroName
    const labelState = stateAbbr ?? rows[0]?.state ?? null

    return NextResponse.json({
      kind: 'metro',
      metro_name: canonicalMetroName,
      state: labelState,
      area_key: buildMetroAreaKey(canonicalMetroName, labelState),
      zip_count: results.length,
      zips: results,
      label: canonicalMetroName,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
