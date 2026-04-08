import { type NextRequest, NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocoder'
import { fetchGtfsGeoJSON } from '@/lib/fetchGtfs'

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

    const geojson = await fetchGtfsGeoJSON(geo)

    return NextResponse.json({
      zip,
      city: geo.city,
      stop_count: geojson.features.length,
      geojson,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
