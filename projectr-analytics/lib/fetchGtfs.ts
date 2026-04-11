/**
 * Transit Fetcher - Overpass API (OSM)
 * Free, no key, global coverage.
 * Fetches: bus stops, rail/subway stations, subway route lines
 *
 * Fix: use --data-urlencode style via URLSearchParams, not manual encodeURIComponent
 */

import type { GeoResult } from './geocoder'

export interface TransitStop {
  stop_id: string
  stop_name: string
  lat: number
  lng: number
  type: 'bus' | 'rail' | 'subway' | 'tram' | 'ferry'
}

export interface TransitRoute {
  id: string
  name: string
  type: 'subway' | 'rail' | 'bus' | 'tram'
  /** Same shape as Transitland `/api/transit` — one or more line segments [lng, lat][]. */
  paths: [number, number][][]
  /**
   * First segment only — mirrors legacy OSM payloads that used singular `path` before PathLayer
   * was wired to `paths`; keeps OSM fallback aligned with Transitland consumers.
   */
  path: [number, number][]
  color: [number, number, number]
}

export interface TransitGeoJSON {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { stop_id: string; stop_name: string; stop_type: string }
  }>
  routes: TransitRoute[]
  stop_count: number
}

/** Match `CommandMap` / Transitland palette so PathLayer `getColor` works on OSM fallback. */
const OSM_ROUTE_COLORS: Record<TransitRoute['type'], [number, number, number]> = {
  subway: [250, 200, 50],
  rail: [160, 220, 255],
  tram: [180, 255, 180],
  bus: [180, 180, 220],
}

const MAX_OSM_ROUTE_WAYS = 100
const MAX_POINTS_PER_WAY = 160

function downsamplePath(ring: [number, number][], maxPts: number): [number, number][] {
  if (ring.length <= maxPts) return ring
  const step = Math.ceil(ring.length / maxPts)
  const out: [number, number][] = []
  for (let i = 0; i < ring.length; i += step) out.push(ring[i])
  const last = ring[ring.length - 1]
  const prev = out[out.length - 1]
  if (!prev || prev[0] !== last[0] || prev[1] !== last[1]) out.push(last)
  return out
}

async function overpassQuery(query: string): Promise<{ elements: unknown[] }> {
  const body = new URLSearchParams({ data: query })
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  const text = await res.text()
  if (!text.startsWith('{')) throw new Error('Overpass rate limited')
  return JSON.parse(text)
}

export async function fetchGtfsGeoJSON(geo: GeoResult, radiusDeg = 0.12): Promise<TransitGeoJSON> {
  const { lat, lng } = geo
  const bbox = `${lat - radiusDeg},${lng - radiusDeg},${lat + radiusDeg},${lng + radiusDeg}`

  // Fetch stops + route ways in one query
  const query = `[out:json][timeout:12];
(
  node["highway"="bus_stop"](${bbox});
  node["railway"~"station|subway_entrance|tram_stop|halt"](${bbox});
  node["amenity"="ferry_terminal"](${bbox});
  way["railway"~"subway|light_rail|tram|rail"](${bbox});
);
out geom;`

  let elements: Array<{
    type: string
    id: number
    lat?: number
    lon?: number
    tags?: Record<string, string>
    geometry?: Array<{ lat: number; lon: number }>
    nodes?: number[]
  }> = []

  try {
    const data = await overpassQuery(query)
    elements = data.elements as typeof elements
  } catch {
    // Retry with smaller radius on failure
    try {
      const smallBbox = `${lat - 0.06},${lng - 0.06},${lat + 0.06},${lng + 0.06}`
      const retryQuery = `[out:json][timeout:10];(node["highway"="bus_stop"](${smallBbox});node["railway"~"station|subway_entrance"](${smallBbox}););out;`
      const data = await overpassQuery(retryQuery)
      elements = data.elements as typeof elements
    } catch {
      return { type: 'FeatureCollection', features: [], routes: [], stop_count: 0 }
    }
  }

  const stops: TransitGeoJSON['features'] = []
  const routes: TransitRoute[] = []

  for (const el of elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      const tags = el.tags ?? {}
      let stopType: TransitStop['type'] = 'bus'
      if (tags.railway === 'station' || tags.railway === 'subway_entrance') stopType = 'subway'
      else if (tags.railway === 'tram_stop') stopType = 'tram'
      else if (tags.amenity === 'ferry_terminal') stopType = 'ferry'
      else if (tags.railway === 'halt') stopType = 'rail'

      stops.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
        properties: {
          stop_id: String(el.id),
          stop_name: tags.name ?? tags['name:en'] ?? 'Transit Stop',
          stop_type: stopType,
        },
      })
    } else if (el.type === 'way' && el.geometry?.length) {
      const tags = el.tags ?? {}
      const railway = tags.railway ?? ''
      let routeType: TransitRoute['type'] = 'rail'
      if (railway === 'subway' || railway === 'light_rail') routeType = 'subway'
      else if (railway === 'tram') routeType = 'tram'

      const ring = el.geometry.map((pt) => [pt.lon, pt.lat] as [number, number])
      if (ring.length < 2) continue

      const path = downsamplePath(ring, MAX_POINTS_PER_WAY)
      routes.push({
        id: String(el.id),
        name: tags.name ?? tags.ref ?? routeType,
        type: routeType,
        paths: [path],
        path,
        color: OSM_ROUTE_COLORS[routeType],
      })
    }
  }

  routes.sort((a, b) => {
    const len = (x: TransitRoute) => x.paths.reduce((s, p) => s + p.length, 0)
    return len(b) - len(a)
  })
  if (routes.length > MAX_OSM_ROUTE_WAYS) routes.length = MAX_OSM_ROUTE_WAYS

  return {
    type: 'FeatureCollection',
    features: stops,
    routes,
    stop_count: stops.length,
  }
}
