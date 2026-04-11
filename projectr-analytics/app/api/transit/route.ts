/**
 * Transit API - Transitland REST API (primary) + Overpass OSM (fallback)
 *
 * Fetches subway/rail/tram routes (types 0,1,2) and local bus (type 3) separately.
 * Filters out intercity routes by bounding geometry to a ~50km box around the ZIP.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocoder'
import { fetchGtfsGeoJSON } from '@/lib/fetchGtfs'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/
const TL_BASE = 'https://transit.land/api/v2/rest'
const TL_KEY = process.env.TRANSITLAND_API_KEY!


interface TLRoute {
  id: number
  onestop_id: string
  route_short_name: string | null
  route_long_name: string | null
  route_type: number
  route_color: string | null
  geometry?: {
    type: 'MultiLineString' | 'LineString'
    coordinates: number[][][] | number[][]
  }
}

interface TLStop {
  id: number
  stop_name: string
  geometry: { type: 'Point'; coordinates: [number, number] }
}

function routeTypeLabel(type: number): string {
  switch (type) {
    case 0: return 'tram'
    case 1: return 'subway'
    case 2: return 'rail'
    case 3: return 'bus'
    case 4: return 'ferry'
    default: return 'transit'
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padStart(6, '0')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const TYPE_COLORS: Record<number, [number, number, number]> = {
  0: [180, 255, 180],
  1: [250, 200, 50],
  2: [160, 220, 255],
  3: [180, 180, 220],
  4: [100, 200, 255],
}

/** Filter out pure intercity routes - route must have at least one coord near the ZIP center */
function isLocalRoute(paths: [number, number][][], centerLng: number, centerLat: number): boolean {
  /** ~35mi diagonal — strict 0.3 dropped valid commuter lines at outer ZIPs */
  const NEARBY_DEG = 0.45
  for (const path of paths) {
    for (const [lng, lat] of path) {
      if (Math.abs(lng - centerLng) < NEARBY_DEG && Math.abs(lat - centerLat) < NEARBY_DEG) {
        return true
      }
    }
  }
  return false
}

async function fetchRoutesByType(lat: number, lng: number, radiusM: number, routeType: number, limit = 30): Promise<TLRoute[]> {
  const params = new URLSearchParams({
    lat: lat.toString(), lon: lng.toString(),
    radius: radiusM.toString(),
    route_type: routeType.toString(),
    per_page: limit.toString(),
    include_geometry: 'true',
    apikey: TL_KEY,
  })
  try {
    const res = await fetch(`${TL_BASE}/routes?${params}`, { cache: 'no-store' })
    if (!res.ok) return []
    const d = await res.json()
    return d.routes ?? []
  } catch { return [] }
}

async function fetchStops(lat: number, lng: number, radiusM: number): Promise<TLStop[]> {
  const params = new URLSearchParams({
    lat: lat.toString(), lon: lng.toString(),
    radius: radiusM.toString(),
    per_page: '200',
    apikey: TL_KEY,
  })
  try {
    const res = await fetch(`${TL_BASE}/stops?${params}`, { cache: 'no-store' })
    if (!res.ok) return []
    const d = await res.json()
    return d.stops ?? []
  } catch { return [] }
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip code' }, { status: 400 })
  }

  try {
    const geo = await geocodeZip(zip)
    if (!geo) return NextResponse.json({ error: 'Region not found' }, { status: 404 })

    const { lat, lng } = geo

    // Fetch subway/rail/tram with larger radius, local bus with smaller radius
    const [subwayRoutes, busRoutes, tlStops] = await Promise.all([
      Promise.all([0, 1, 2].map((t) => fetchRoutesByType(lat, lng, 2000, t, 20))).then((r) => r.flat()),
      fetchRoutesByType(lat, lng, 800, 3, 20),
      fetchStops(lat, lng, 1500),
    ])

    const allTlRoutes = [...subwayRoutes, ...busRoutes]

    if (allTlRoutes.length > 0 || tlStops.length > 0) {
      const routes = allTlRoutes
        .filter((r) => r.geometry)
        .map((r) => {
          const color = r.route_color ? hexToRgb(r.route_color) : (TYPE_COLORS[r.route_type] ?? TYPE_COLORS[3])
          const paths: [number, number][][] = r.geometry!.type === 'MultiLineString'
            ? (r.geometry!.coordinates as number[][][]).map((seg) => seg.map(([x, y]) => [x, y] as [number, number]))
            : [(r.geometry!.coordinates as number[][]).map(([x, y]) => [x, y] as [number, number])]

          return {
            id: r.onestop_id,
            name: r.route_short_name ?? r.route_long_name ?? '',
            long_name: r.route_long_name ?? '',
            type: routeTypeLabel(r.route_type),
            route_type: r.route_type,
            color,
            paths,
            /** Singular segment for the same contract as OSM `fetchGtfs` / legacy clients. */
            path: paths[0] ?? [],
          }
        })
        // Filter out intercity routes
        .filter((r) => isLocalRoute(r.paths, lng, lat))

      const stops = tlStops.map((s) => ({
        stop_id: String(s.id),
        stop_name: s.stop_name,
        position: s.geometry.coordinates as [number, number],
        stop_type: 'transit',
      }))

      let features = stops.map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: s.position },
        properties: { stop_id: s.stop_id, stop_name: s.stop_name, stop_type: s.stop_type },
      }))

      let finalRoutes = routes

      // Transitland often returns route rows without geometry, or isLocalRoute drops every segment — we would
      // incorrectly skip OSM and return zero PathLayer data. Merge Overpass lines when TL has no drawable routes.
      if (finalRoutes.length === 0) {
        const osm = await fetchGtfsGeoJSON(geo)
        // OSM routes omit Transitland-only fields; map client accepts optional long_name / route_type
        finalRoutes = osm.routes as typeof routes
        if (features.length === 0 && osm.features.length > 0) {
          features = osm.features
        }
      }

      const geojson = {
        type: 'FeatureCollection' as const,
        features,
        routes: finalRoutes,
        stop_count: features.length,
      }

      return NextResponse.json({
        zip,
        city: geo.city,
        stop_count: geojson.stop_count,
        route_count: finalRoutes.length,
        geojson,
        routes: finalRoutes,
      })
    }

    // Fallback to Overpass/OSM
    const geojson = await fetchGtfsGeoJSON(geo)
    return NextResponse.json({ zip, city: geo.city, stop_count: geojson.stop_count, route_count: geojson.routes.length, geojson, routes: geojson.routes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
