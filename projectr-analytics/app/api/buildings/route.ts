/**
 * OSM Building footprints via Overpass API
 * Returns GeoJSON FeatureCollection of building polygons with optional floor count
 * Used for 3D extruded building visualization in deck.gl
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Convert OSM way geometry to GeoJSON polygon
function osmWayToGeoJSON(element: {
  id: number
  geometry: Array<{ lat: number; lon: number }>
  tags?: Record<string, string>
}) {
  const coords = element.geometry.map((pt) => [pt.lon, pt.lat])
  // Close the ring if not already closed
  if (coords.length > 0) {
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first)
  }

  const tags = element.tags ?? {}
  const levels = parseInt(tags['building:levels'] ?? tags['levels'] ?? '0')
  const height = parseFloat(tags['height'] ?? '0')

  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {
      id: element.id,
      building: tags.building ?? 'yes',
      name: tags.name ?? null,
      levels: levels > 0 ? levels : null,
      height: height > 0 ? height : levels > 0 ? levels * 3.5 : 4, // ~3.5m per floor, 4m default
    },
  }
}

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')
  const radius = parseFloat(request.nextUrl.searchParams.get('radius') ?? '0.02') // ~2km default
  const zoom = parseFloat(request.nextUrl.searchParams.get('zoom') ?? '0')

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 })
  }

  const bbox = `${lat - radius},${lng - radius},${lat + radius},${lng + radius}`
  if (!isNaN(zoom) && zoom < 14) {
    return NextResponse.json({
      type: 'FeatureCollection',
      features: [],
      meta: { count: 0, bbox, zoom, mode: 'skipped_low_zoom' },
    })
  }

  const query = `[out:json][timeout:25];way["building"](${bbox});out geom;`

  try {
    let text = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt))
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) continue
      text = await res.text()
      if (text.startsWith('{')) break
      text = ''
    }

    if (!text) {
      return NextResponse.json({ error: 'Overpass unavailable — try again in a moment', features: [] }, { status: 503 })
    }

    const data = JSON.parse(text)
    const elements = (data.elements ?? []).filter(
      (e: { geometry?: unknown }) => e.geometry && Array.isArray(e.geometry)
    )

    const features = elements.slice(0, 2500).map(osmWayToGeoJSON)

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      meta: { count: features.length, bbox, zoom },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
