import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/
const TIGER_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query'

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')

  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code' }, { status: 400 })
  }

  try {
    const url = `${TIGER_URL}?where=ZCTA5%3D'${zip}'&outFields=ZCTA5,GEOID&f=geojson`
    const res = await fetch(url, { next: { revalidate: 86400 * 30 } }) // cache 30 days
    if (!res.ok) return NextResponse.json({ error: 'Boundary not found' }, { status: 404 })

    const geojson = await res.json()
    if (!geojson.features?.length) {
      return NextResponse.json({ error: 'No boundary found for this zip' }, { status: 404 })
    }

    return NextResponse.json(geojson)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
