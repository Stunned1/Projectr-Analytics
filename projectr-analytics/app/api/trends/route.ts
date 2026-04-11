import { type NextRequest, NextResponse } from 'next/server'
import { geocodeZip, geoTrendsStub, type GeoResult } from '@/lib/geocoder'
import { fetchTrends } from '@/lib/fetchTrends'
import type { MasterDataRow } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/

type TrendRow = Omit<MasterDataRow, 'id' | 'created_at'>

const GEO_NOTE =
  'Google Trends uses keyword + US state subregion (e.g. US-NY), not neighborhood or city polygons. Series is relative interest within that region.'

function normalizeState(state: string): string | null {
  const s = state.trim().toUpperCase()
  if (s.length === 2) return s
  return null
}

function jsonFromRows(
  rows: TrendRow[],
  geo: GeoResult,
  responseZip: string | null,
  hardError: string | null,
  emptyMessage: string | null
) {
  if (hardError) {
    return {
      zip: responseZip,
      city: geo.city,
      state: geo.state,
      is_fallback: false,
      keyword_scope: hardError,
      latest_score: null,
      data_points: 0,
      series: [] as { date: string; value: number }[],
      error: hardError,
      empty_message: null as string | null,
      geo_note: GEO_NOTE,
    }
  }

  const seriesRows = rows.filter((r) => r.visual_bucket === 'TIME_SERIES')
  const latest = rows.find((r) => r.metric_name === 'Search_Interest_Latest')
  const isFallback = rows.some((r) => r.metric_name === 'Search_Interest_State')

  return {
    zip: responseZip,
    city: geo.city,
    state: geo.state,
    is_fallback: isFallback,
    keyword_scope: isFallback ? `apartments ${geo.state} (state-level)` : `apartments in ${geo.city}`,
    latest_score: latest?.metric_value ?? null,
    data_points: seriesRows.length,
    series: seriesRows.map((r) => ({ date: r.time_period!, value: r.metric_value })),
    error: null as string | null,
    empty_message: seriesRows.length === 0 ? emptyMessage : null,
    geo_note: GEO_NOTE,
  }
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  const city = request.nextUrl.searchParams.get('city')?.trim()
  const stateParam = request.nextUrl.searchParams.get('state')?.trim()
  const anchorZip = request.nextUrl.searchParams.get('anchor_zip')

  const emptySeriesMsg =
    'No weekly search-interest series returned for this keyword and region (try again later or check keyword ambiguity).'

  try {
    let geo: GeoResult | null = null
    let submarketId: string
    let responseZip: string | null

    if (city && stateParam) {
      const st = normalizeState(stateParam)
      if (!st) {
        return NextResponse.json(
          { error: 'Invalid state: use a 2-letter USPS code (e.g. NY, TX).' },
          { status: 400 }
        )
      }
      geo = geoTrendsStub(city, st)
      const anchor = anchorZip && ZIP_REGEX.test(anchorZip) ? anchorZip : null
      submarketId = anchor ?? `city:${city}:${st}`
      responseZip = anchor
    } else if (zip && ZIP_REGEX.test(zip)) {
      geo = await geocodeZip(zip)
      if (!geo) {
        return NextResponse.json({ error: 'Region not found' }, { status: 404 })
      }
      submarketId = zip
      responseZip = zip
    } else {
      return NextResponse.json(
        {
          error: 'Provide zip=##### or both city=... and state=XX (optional anchor_zip=##### for labeling).',
        },
        { status: 400 }
      )
    }

    const outcome = await fetchTrends(geo, submarketId)
    if (!outcome.ok) {
      return NextResponse.json(
        jsonFromRows([], geo, responseZip, outcome.error, null),
        { status: 200 }
      )
    }

    const body = jsonFromRows(outcome.rows, geo, responseZip, null, emptySeriesMsg)
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
