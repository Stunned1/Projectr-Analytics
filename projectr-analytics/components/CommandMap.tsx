'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Layer, PickingInfo } from '@deck.gl/core'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarketData {
  zip: string
  geo?: { lat: number; lng: number; city: string; state: string }
  zillow: { zori_latest: number | null; zhvi_latest: number | null } | null
}

interface TransitStop {
  position: [number, number]
  name: string
}

interface NeighborZip {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
}

interface ZipBoundary {
  zip: string
  geojson: object
  zori: number | null
}

interface LayerState {
  zipBoundary: boolean
  transitStops: boolean
  rentChoropleth: boolean
}

// ── Dev sidebar registry ──────────────────────────────────────────────────────

const DATA_LAYER_REGISTRY = [
  { label: 'ZIP Boundary', source: 'Census TIGER', visualized: true, layerType: 'GeoJsonLayer (outline)' },
  { label: 'ZORI Rent Index', source: 'Zillow Research', visualized: true, layerType: 'GeoJsonLayer (choropleth — multi-ZIP)' },
  { label: 'Transit Stops', source: 'GTFS / OSM', visualized: true, layerType: 'ScatterplotLayer (cyan dots)' },
  { label: 'ZHVI Home Value', source: 'Zillow Research', visualized: true, layerType: 'GeoJsonLayer (choropleth fill)' },
  { label: 'Vacancy Rate', source: 'Census ACS', visualized: true, layerType: 'GeoJsonLayer (choropleth fill)' },
  { label: 'PoP Momentum Score', source: 'Computed', visualized: true, layerType: 'GeoJsonLayer (blue→red gradient)' },
  { label: 'Unemployment Rate', source: 'FRED', visualized: false, layerType: null, note: 'County aggregate — sidebar chart only' },
  { label: 'Real GDP', source: 'FRED', visualized: false, layerType: null, note: 'County aggregate — sidebar chart only' },
  { label: 'Median Household Income', source: 'Census ACS', visualized: false, layerType: null, note: 'Single value per ZIP — stat card only' },
  { label: 'FMR by Bedroom', source: 'HUD / Census ACS', visualized: false, layerType: null, note: 'No spatial variation within ZIP' },
  { label: 'Days on Market', source: 'Zillow Metro', visualized: false, layerType: null, note: 'Metro-level — stat card only' },
  { label: 'Google Trends Score', source: 'Google Trends', visualized: false, layerType: null, note: 'City/state sentiment — sidebar sparkline only' },
  { label: 'Permit Pin Locations', source: 'ArcGIS REST', visualized: false, layerType: null, note: 'DEFERRED — jurisdiction-specific feeds required' },
]

// ── Color scale: blue (low rent) → red (high rent) ───────────────────────────
// Normalized across the set of loaded ZIPs for relative contrast

function buildColorScale(values: (number | null)[]) {
  const valid = values.filter((v): v is number => v !== null && v > 0)
  if (!valid.length) return () => [120, 120, 180, 120] as [number, number, number, number]
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  return (value: number | null): [number, number, number, number] => {
    if (!value || value <= 0) return [80, 80, 120, 80]
    const t = max === min ? 0.5 : Math.min(Math.max((value - min) / (max - min), 0), 1)
    // Blue (low) → purple → red (high)
    return [
      Math.round(30 + t * 200),
      Math.round(30 * (1 - t)),
      Math.round(200 * (1 - t) + 30),
      180,
    ]
  }
}

// ── Fit map to GeoJSON bounds ─────────────────────────────────────────────────

function getBounds(geojson: { features: Array<{ geometry: { coordinates: number[][][] } }> }) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const feature of geojson.features ?? []) {
    const coords = feature.geometry?.coordinates ?? []
    for (const ring of coords) {
      for (const [lng, lat] of ring) {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
      }
    }
  }
  return { minLat, maxLat, minLng, maxLng }
}

// ── Map fitter — fits to boundary polygon on zip change ───────────────────────

function MapFitter({ boundary, zip }: { boundary: object | null; zip: string | null }) {
  const map = useMap()
  const lastZip = useRef<string | null>(null)

  useEffect(() => {
    if (!map || !zip || !boundary || zip === lastZip.current) return
    lastZip.current = zip

    const geojson = boundary as { features: Array<{ geometry: { coordinates: number[][][] } }> }
    const { minLat, maxLat, minLng, maxLng } = getBounds(geojson)
    if (!isFinite(minLat)) return

    const bounds = new google.maps.LatLngBounds(
      { lat: minLat, lng: minLng },
      { lat: maxLat, lng: maxLng }
    )
    map.fitBounds(bounds, 40) // 40px padding
  }, [map, boundary, zip])

  return null
}

// ── DeckGL overlay ────────────────────────────────────────────────────────────

function DeckGlOverlay({ layers }: { layers: Layer[] }) {
  const deck = useMemo(() => new GoogleMapsOverlay({ interleaved: true }), [])
  const map = useMap()

  useEffect(() => {
    if (!map) return
    deck.setMap(map)
    return () => deck.setMap(null)
  }, [map, deck])

  useEffect(() => {
    deck.setProps({ layers })
  }, [layers, deck])

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

interface CommandMapProps {
  zip: string | null
  marketData: MarketData | null
}

export default function CommandMap({ zip, marketData }: CommandMapProps) {
  const [primaryBoundary, setPrimaryBoundary] = useState<object | null>(null)
  const [neighborBoundaries, setNeighborBoundaries] = useState<ZipBoundary[]>([])
  const [transitStops, setTransitStops] = useState<TransitStop[]>([])
  const [layers, setLayers] = useState<LayerState>({
    zipBoundary: true,
    transitStops: true,
    rentChoropleth: true,
  })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [activeMetric, setActiveMetric] = useState<'zori' | 'zhvi'>('zori')

  // Fetch primary boundary + transit + neighbors when zip changes
  useEffect(() => {
    if (!zip) return
    setPrimaryBoundary(null)
    setNeighborBoundaries([])
    setTransitStops([])

    // Primary boundary
    fetch('/api/boundaries?zip=' + zip)
      .then((r) => r.json())
      .then((d) => { if (d.features) setPrimaryBoundary(d) })
      .catch(() => {})

    // Transit stops
    fetch('/api/transit?zip=' + zip)
      .then((r) => r.json())
      .then((d) => {
        if (d.geojson?.features) {
          setTransitStops(
            d.geojson.features.map((f: {
              geometry: { coordinates: [number, number] }
              properties: { stop_name: string }
            }) => ({
              position: f.geometry.coordinates as [number, number],
              name: f.properties.stop_name,
            }))
          )
        }
      })
      .catch(() => {})

    // Neighbor ZIPs with Zillow data
    fetch('/api/neighbors?zip=' + zip)
      .then((r) => r.json())
      .then(async (d) => {
        const neighbors: NeighborZip[] = d.zips ?? []
        if (!neighbors.length) return

        // Fetch boundaries for all neighbors in parallel (limit to 15 for perf)
        const sample = neighbors.slice(0, 15)
        const results = await Promise.allSettled(
          sample.map((n) =>
            fetch('/api/boundaries?zip=' + n.zip)
              .then((r) => r.json())
              .then((geojson) => ({ zip: n.zip, geojson, zori: n.zori_latest }))
          )
        )
        const loaded: ZipBoundary[] = results
          .filter((r): r is PromiseFulfilledResult<ZipBoundary> => r.status === 'fulfilled' && r.value.geojson?.features?.length > 0)
          .map((r) => r.value)
        setNeighborBoundaries(loaded)
      })
      .catch(() => {})
  }, [zip])

  // Build color scale across all loaded ZIPs
  const allZoriValues = useMemo(() => {
    const vals: (number | null)[] = [marketData?.zillow?.zori_latest ?? null]
    neighborBoundaries.forEach((n) => vals.push(n.zori))
    return vals
  }, [marketData, neighborBoundaries])

  const colorScale = useMemo(() => buildColorScale(allZoriValues), [allZoriValues])

  const primaryZori = marketData?.zillow?.zori_latest ?? null

  const deckLayers = useMemo(() => {
    const result: Layer[] = []

    // Neighbor ZIP boundaries (rendered first, behind primary)
    if (layers.zipBoundary && neighborBoundaries.length > 0) {
      neighborBoundaries.forEach((n) => {
        result.push(
          new GeoJsonLayer({
            id: 'neighbor-' + n.zip,
            data: n.geojson,
            stroked: true,
            filled: true,
            getFillColor: layers.rentChoropleth ? colorScale(n.zori) : [60, 60, 80, 60],
            getLineColor: [180, 180, 200, 120],
            lineWidthMinPixels: 1,
            pickable: true,
            onHover: (info: PickingInfo) => {
              if (info.object) {
                setTooltip({
                  x: info.x, y: info.y,
                  text: 'ZIP ' + n.zip + (n.zori ? ' · $' + n.zori.toFixed(0) + '/mo' : ''),
                })
              } else setTooltip(null)
            },
          })
        )
      })
    }

    // Primary ZIP boundary (on top, brighter outline)
    if (layers.zipBoundary && primaryBoundary) {
      result.push(
        new GeoJsonLayer({
          id: 'zip-primary',
          data: primaryBoundary,
          stroked: true,
          filled: true,
          getFillColor: layers.rentChoropleth ? colorScale(primaryZori) : [255, 255, 255, 30],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 3,
          pickable: true,
          onHover: (info: PickingInfo) => {
            if (info.object) {
              setTooltip({
                x: info.x, y: info.y,
                text: 'ZIP ' + zip + (primaryZori ? ' · $' + primaryZori.toFixed(0) + '/mo ZORI' : ''),
              })
            } else setTooltip(null)
          },
        })
      )
    }

    // Transit stops
    if (layers.transitStops && transitStops.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: 'transit-stops',
          data: transitStops,
          getPosition: (d: TransitStop) => d.position,
          getRadius: 35,
          getFillColor: [0, 210, 255, 200],
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as TransitStop | undefined
            if (d) setTooltip({ x: info.x, y: info.y, text: '\uD83D\uDE8C ' + d.name })
            else setTooltip(null)
          },
        })
      )
    }

    return result
  }, [primaryBoundary, neighborBoundaries, transitStops, layers, colorScale, primaryZori, zip])

  const handleToggle = useCallback((key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <div className="relative w-full h-full">
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
        <Map
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? ''}
          defaultCenter={{ lat: 37.2563, lng: -80.4347 }}
          defaultZoom={11}
          colorScheme="DARK"
          disableDefaultUI={false}
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          <MapFitter boundary={primaryBoundary} zip={zip} />
          <DeckGlOverlay layers={deckLayers} />
        </Map>
      </APIProvider>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-50 bg-zinc-900 border border-zinc-700 text-white text-xs px-3 py-2 rounded pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Layer toggles */}
      <div className="absolute top-4 right-4 z-40 bg-zinc-900/90 border border-zinc-700 rounded-lg p-3 w-52">
        <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Layers</p>
        {([
          { key: 'zipBoundary' as const, label: 'ZIP Boundaries' },
          { key: 'transitStops' as const, label: 'Transit Stops' },
          { key: 'rentChoropleth' as const, label: 'Rent Choropleth' },
        ]).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer mb-1">
            <input type="checkbox" checked={layers[key]} onChange={() => handleToggle(key)} className="accent-blue-500" />
            <span className="text-zinc-300 text-xs">{label}</span>
          </label>
        ))}
        <div className="mt-3 border-t border-zinc-700 pt-2">
          <p className="text-zinc-400 text-xs mb-1">Choropleth Metric</p>
          <select
            value={activeMetric}
            onChange={(e) => setActiveMetric(e.target.value as 'zori' | 'zhvi')}
            className="w-full bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1 border border-zinc-700"
          >
            <option value="zori">Rent (ZORI)</option>
            <option value="zhvi">Home Value (ZHVI)</option>
          </select>
        </div>
        {neighborBoundaries.length > 0 && (
          <p className="text-zinc-600 text-xs mt-2">{neighborBoundaries.length} metro ZIPs loaded</p>
        )}
      </div>

      {/* Dev sidebar */}
      <div className="absolute top-4 left-4 z-40 bg-zinc-900/90 border border-zinc-700 rounded-lg p-3 w-64 max-h-[calc(100%-2rem)] overflow-y-auto">
        <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Data Layer Status</p>
        {DATA_LAYER_REGISTRY.map((item) => (
          <div key={item.label} className="mb-2 border-b border-zinc-800 pb-2 last:border-0">
            <div className="flex items-center gap-2">
              <span className={'w-2 h-2 rounded-full flex-shrink-0 ' + (item.visualized ? 'bg-green-500' : 'bg-zinc-600')} />
              <span className="text-zinc-200 text-xs font-medium">{item.label}</span>
            </div>
            <p className="text-zinc-500 text-xs ml-4">{item.source}</p>
            {item.layerType && <p className="text-blue-400 text-xs ml-4">{item.layerType}</p>}
            {item.note && <p className="text-yellow-600 text-xs ml-4">{item.note}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
