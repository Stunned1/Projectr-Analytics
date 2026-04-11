/**
 * OSM Amenity Points — for HeatmapLayer visualization
 * Returns lat/lng points for restaurants, shops, schools, transit, parks etc.
 * Each point has a weight based on amenity type (higher = more significant)
 * Used to show activity/walkability density within a ZIP
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Amenity weights — higher = more significant for real estate
const AMENITY_WEIGHTS: Record<string, number> = {
  // Transit (highest — directly impacts property value)
  subway_entrance: 10, train_station: 10, bus_station: 8,
  // Commercial activity
  supermarket: 7, marketplace: 7,
  restaurant: 4, cafe: 4, bar: 3, fast_food: 2,
  bank: 5, pharmacy: 5,
  // Education / community
  school: 6, university: 8, college: 7, library: 5,
  hospital: 6, clinic: 5,
  // Retail
  shop: 3,
  // Leisure
  park: 4, playground: 3, gym: 4, sports_centre: 4,
}

function getWeight(tags: Record<string, string>): number {
  const amenity = tags.amenity ?? ''
  const shop = tags.shop ?? ''
  const leisure = tags.leisure ?? ''
  const railway = tags.railway ?? ''
  if (railway === 'subway_entrance') return 10
  return AMENITY_WEIGHTS[amenity] ?? AMENITY_WEIGHTS[shop] ?? AMENITY_WEIGHTS[leisure] ?? 2
}

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')
  const radius = parseFloat(request.nextUrl.searchParams.get('radius') ?? '0.06') // ~6km

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 })
  }

  const bbox = `${lat - radius},${lng - radius},${lat + radius},${lng + radius}`
  const query = `[out:json][timeout:20];(
    node["amenity"](${bbox});
    node["shop"](${bbox});
    node["leisure"~"park|playground|sports_centre|fitness_centre"](${bbox});
    node["railway"~"subway_entrance|station"](${bbox});
  );out;`

  try {
    let text = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt))
      const body = new URLSearchParams({ data: query })
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        cache: 'no-store',
      })
      if (!res.ok) continue
      text = await res.text()
      if (text.startsWith('{')) break
      text = ''
    }

    if (!text) return NextResponse.json({ points: [], count: 0 }, { status: 200 })

    const data = JSON.parse(text)
    const points = (data.elements ?? [])
      .filter((e: { lat?: number; lon?: number }) => e.lat && e.lon)
      .map((e: { lat: number; lon: number; tags?: Record<string, string> }) => ({
        position: [e.lon, e.lat] as [number, number],
        weight: getWeight(e.tags ?? {}),
      }))

    return NextResponse.json({ count: points.length, points })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
