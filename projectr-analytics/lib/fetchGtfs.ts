/**
 * GTFS Transit Stop Fetcher
 *
 * Strategy:
 * 1. Try Overpass API (OSM) — free, no key, global coverage
 *    Queries bus stops within a bounding box around the zip's lat/lng
 * 2. For Blacksburg specifically, fall back to direct BT GTFS zip
 *    (bt4uclassic.org publishes their feed publicly)
 *
 * Returns stops as MARKER rows for the map.
 */

import AdmZip from 'adm-zip'
import type { GeoResult } from './geocoder'
import type { MasterDataRow } from './supabase'

type PartialRow = Omit<MasterDataRow, 'id' | 'created_at'>

// Known direct GTFS feed URLs by city (expand as needed)
const DIRECT_GTFS_FEEDS: Record<string, string> = {
  Blacksburg: 'http://www.bt4uclassic.org/gtfs/google_transit.zip',
}

interface TransitStop {
  stop_id: string
  stop_name: string
  lat: number
  lng: number
}

// ── Parse stops.txt from a GTFS zip buffer ────────────────────────────────────
function parseGtfsStops(zipBuffer: Buffer): TransitStop[] {
  const zip = new AdmZip(zipBuffer)
  const entry = zip.getEntry('stops.txt')
  if (!entry) return []

  const text = zip.readAsText(entry)
  const lines = text.split('\n').filter(Boolean)
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))

  const idIdx = headers.indexOf('stop_id')
  const nameIdx = headers.indexOf('stop_name')
  const latIdx = headers.indexOf('stop_lat')
  const lonIdx = headers.indexOf('stop_lon')

  if (latIdx < 0 || lonIdx < 0) return []

  return lines.slice(1).flatMap((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/"/g, ''))
    const lat = parseFloat(cols[latIdx])
    const lng = parseFloat(cols[lonIdx])
    if (isNaN(lat) || isNaN(lng)) return []
    return [{
      stop_id: cols[idIdx] ?? '',
      stop_name: cols[nameIdx] ?? 'Transit Stop',
      lat,
      lng,
    }]
  })
}

// ── Fetch via Overpass (OSM) ──────────────────────────────────────────────────
async function fetchOverpassStops(geo: GeoResult, radiusDeg = 0.15): Promise<TransitStop[]> {
  const { lat, lng } = geo
  const bbox = `${lat - radiusDeg},${lng - radiusDeg},${lat + radiusDeg},${lng + radiusDeg}`
  const query = `[out:json];node["highway"="bus_stop"](${bbox});out;`

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) return []
  const data = await res.json()
  const elements = data?.elements ?? []

  return elements
    .filter((e: { lat?: number; lon?: number }) => e.lat && e.lon)
    .map((e: { id: number; lat: number; lon: number; tags?: { name?: string } }) => ({
      stop_id: String(e.id),
      stop_name: e.tags?.name ?? 'Bus Stop',
      lat: e.lat,
      lng: e.lon,
    }))
}

// ── Fetch via direct GTFS zip ─────────────────────────────────────────────────
async function fetchDirectGtfsStops(city: string): Promise<TransitStop[]> {
  const url = DIRECT_GTFS_FEEDS[city]
  if (!url) return []

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) return []

  const buffer = Buffer.from(await res.arrayBuffer())
  return parseGtfsStops(buffer)
}

// ── Convert stops to DB rows ──────────────────────────────────────────────────
function stopsToRows(stops: TransitStop[], zip: string): PartialRow[] {
  return stops.map((stop) => ({
    submarket_id: zip,
    geometry: `POINT(${stop.lng} ${stop.lat})`,
    metric_name: 'Transit_Stop',
    metric_value: 1,
    time_period: null,
    data_source: 'GTFS',
    visual_bucket: 'MARKER' as const,
  }))
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchGtfs(geo: GeoResult, zip: string): Promise<PartialRow[]> {
  try {
    // Try Overpass first
    const overpassStops = await fetchOverpassStops(geo)
    if (overpassStops.length > 0) {
      return stopsToRows(overpassStops, zip)
    }
  } catch { /* fall through */ }

  try {
    // Fall back to direct GTFS feed if available for this city
    const directStops = await fetchDirectGtfsStops(geo.city)
    if (directStops.length > 0) {
      return stopsToRows(directStops, zip)
    }
  } catch { /* fall through */ }

  return []
}

// ── Also export a GeoJSON version for the map API ─────────────────────────────
export async function fetchGtfsGeoJSON(geo: GeoResult): Promise<{
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { stop_id: string; stop_name: string }
  }>
}> {
  let stops: TransitStop[] = []

  try {
    stops = await fetchOverpassStops(geo)
  } catch { /* fall through */ }

  if (stops.length === 0) {
    try {
      stops = await fetchDirectGtfsStops(geo.city)
    } catch { /* fall through */ }
  }

  return {
    type: 'FeatureCollection',
    features: stops.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { stop_id: s.stop_id, stop_name: s.stop_name },
    })),
  }
}
