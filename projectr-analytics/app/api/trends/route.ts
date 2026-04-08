import { type NextRequest, NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocoder'
import { fetchTrends } from '@/lib/fetchTrends'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')

  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code' }, { status: 400 })
  }

  try {
    const geo = await geocodeZip(zip)
    if (!geo) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 })
    }

    const rows = await fetchTrends(geo, zip)

    const series = rows.filter((r) => r.visual_bucket === 'TIME_SERIES')
    const latest = rows.find((r) => r.metric_name === 'Search_Interest_Latest')
    const isFallback = rows.some((r) => r.metric_name === 'Search_Interest_State')

    return NextResponse.json({
      zip,
      city: geo.city,
      state: geo.state,
      is_fallback: isFallback,
      keyword_scope: isFallback ? `apartments ${geo.state} (state-level)` : `apartments in ${geo.city}`,
      latest_score: latest?.metric_value ?? null,
      data_points: series.length,
      series: series.map((r) => ({ date: r.time_period, value: r.metric_value })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
