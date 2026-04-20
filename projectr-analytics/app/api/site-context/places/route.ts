import { type NextRequest, NextResponse } from 'next/server'
import { fetchGooglePlacesSiteContext } from '@/lib/google-places-site-context'

export const dynamic = 'force-dynamic'

const MAX_RADIUS_METERS = 50000
const DEFAULT_RADIUS_METERS = 500

function parseFiniteNumber(value: string | null): number {
  if (value == null) return Number.NaN
  const trimmed = value.trim()
  if (trimmed === '') return Number.NaN
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90
}

function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180
}

function isValidRadius(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0 && value <= MAX_RADIUS_METERS
}

export async function GET(request: NextRequest) {
  const lat = parseFiniteNumber(request.nextUrl.searchParams.get('lat'))
  const lng = parseFiniteNumber(request.nextUrl.searchParams.get('lng'))
  const rawRadius = request.nextUrl.searchParams.get('radius')
  const radius = rawRadius == null ? DEFAULT_RADIUS_METERS : parseFiniteNumber(rawRadius)

  if (!isValidLatitude(lat) || !isValidLongitude(lng) || !isValidRadius(radius)) {
    return NextResponse.json(
      { error: 'Provide valid lat, lng, and radius query parameters.' },
      { status: 400 }
    )
  }

  try {
    const siteContext = await fetchGooglePlacesSiteContext(lat, lng, radius)
    return NextResponse.json(siteContext)
  } catch (err) {
    const status =
      typeof err === 'object' && err && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500
    return NextResponse.json(
      { error: 'Unable to fetch Google Places site context.' },
      { status: status >= 400 && status < 600 ? status : 500 }
    )
  }
}
