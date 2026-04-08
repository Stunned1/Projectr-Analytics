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
  zillow: { zori_latest: number | null } | null
}

interface TransitStop {
  position: [number, number]
  name: string
}

interface LayerState {
  zipBoundary: boolean
  transitStops: boolean
  rentChoropleth: boolean
}

interface DataLayerStatus {
  label: string
  source: string
  visualized: boolean
  layerType: string | null
  note?: string
}

// ── Dev sidebar registry ──────────────────────────────────────────────────────

const DATA_LAYER_REGISTRY: DataLayerStatus[] = [
  { label: 'ZIP Boundary', source: 'Census TIGER', visualized: true, layerType: 'GeoJsonLayer (outline)' },
  { label: 'ZORI Rent Index', source: 'Zillow Research', visualized: true, layerType: 'GeoJsonLayer (choropleth fill)' },
  { label: 'ZHVI Home Value', source: 'Zillow Research', visualized: true, layerType: 'GeoJsonLayer (choropleth fill)' },
  { label: 'Transit Stops', source: 'GTFS / OSM', visualized: true, layerType: 'ScatterplotLayer (cyan dots)' },
  { label: 'Permit Count', source: 'Census BPS', visualized: true, layerType: 'ScatterplotLayer (sized pin at county centroid)' },
  { label: 'Vacancy Rate', source: 'Census ACS', visualized: true, layerType: 'GeoJsonLayer (choropleth fill)' },
  { label: 'Population Growth', source: 'Census ACS', visualized: true, layerType: 'GeoJsonLayer (choropleth fill)' },
  { label: 'PoP Momentum Score', source: 'Computed', visualized: true, layerType: 'GeoJsonLayer (blue→red gradient)' },
  { label: 'Unemployment Rate', source: 'FRED', visualized: false, layerType: null, note: 'County aggregate — sidebar chart only' },
  { label: 'Real GDP', source: 'FRED', visualized: false, layerType: null, note: 'County aggregate — sidebar chart only' },
  { label: 'Median Household Income', source: 'Census ACS', visualized: false, layerType: null, note: 'Single value per ZIP — stat card only' },
  { label: 'FMR by Bedroom', source: 'HUD / Census ACS', visualized: false, layerType: null, note: 'No spatial variation within ZIP — stat card only' },
  { label: 'Days on Market', source: 'Zillow Metro', visualized: false, layerType: null, note: 'Metro-level — stat card only' },
  { label: 'Price Cuts %', source: 'Zillow Metro', visualized: false, layerType: null, note: 'Metro-level — stat card only' },
  { label: 'Active Inventory', source: 'Zillow Metro', visualized: false, layerType: null, note: 'Metro-level — stat card only' },
  { label: 'Google Trends Score', source: 'Google Trends', visualized: false, layerType: null, note: 'City/state sentiment — sidebar sparkline only' },
  { label: 'Permit Pin Locations', source: 'ArcGIS REST', visualized: false, layerType: null, note: 'DEFERRED — jurisdiction-specific feeds required' },
]

// ── Color helpers ─────────────────────────────────────────────────────────────

function rentToColor(value: number | null): [number, number, number, number] {
  if (!value) return [100, 100, 150, 80]
  const t = Math.min(Math.max((value - 800) / 1700, 0), 1)
  return [Math.round(t * 220), Math.round((1 - t) * 80), Math.round((1 - t) * 220), 160]
}

// ── Map panner — pans imperatively when zip changes ──────────────────────────
function MapPanner({ center, zoom, zip }: { center: { lat: number; lng: number }; zoom: number; zip: string | null }) {
  const map = useMap()
  const lastZip = useRef<string | null>(null)

  useEffect(() => {
    if (!map || !zip || zip === lastZip.current) return
    lastZip.current = zip
    map.panTo(center)
    map.setZoom(zoom)
  }, [map, center, zoom, zip])

  return null
}

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

// ── DeckGL overlay (must be inside <Map>) ─────────────────────────────────────

// ── Main component ────────────────────────────────────────────────────────────

interface CommandMapProps {
  zip: string | null
  marketData: MarketData | null
}

export default function CommandMap({ zip, marketData }: CommandMapProps) {
  const [boundary, setBoundary] = useState<object | null>(null)
  const [transitStops, setTransitStops] = useState<TransitStop[]>([])
  const [layers, setLayers] = useState<LayerState>({
    zipBoundary: true,
    transitStops: true,
    rentChoropleth: true,
  })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [center, setCenter] = useState({ lat: 37.2563, lng: -80.4347 })
  const [zoom, setZoom] = useState(11)

  useEffect(() => {
    if (!zip) return
    setBoundary(null)
    setTransitStops([])

    fetch(`/api/boundaries?zip=${zip}`)
      .then((r) => r.json())
      .then((d) => { if (d.features) setBoundary(d) })
      .catch(() => {})

    fetch(`/api/transit?zip=${zip}`)
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
  }, [zip])

  useEffect(() => {
    if (marketData?.geo) {
      setCenter({ lat: marketData.geo.lat, lng: marketData.geo.lng })
      setZoom(12)
    }
  }, [marketData])

  const zoriValue = marketData?.zillow?.zori_latest ?? null

  const deckLayers = useMemo(() => {
    const result: Layer[] = []

    if (layers.zipBoundary && boundary) {
      result.push(
        new GeoJsonLayer({
          id: 'zip-boundary',
          data: boundary,
          stroked: true,
          filled: true,
          getFillColor: layers.rentChoropleth ? rentToColor(zoriValue) : [255, 255, 255, 20],
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 2,
          pickable: true,
          onHover: (info: PickingInfo) => {
            if (info.object) {
              setTooltip({
                x: info.x, y: info.y,
                text: `ZIP ${zip} · ZORI: ${zoriValue ? '$' + zoriValue.toFixed(0) + '/mo' : 'N/A'}`,
              })
            } else setTooltip(null)
          },
        })
      )
    }

    if (layers.transitStops && transitStops.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: 'transit-stops',
          data: transitStops,
          getPosition: (d: TransitStop) => d.position,
          getRadius: 40,
          getFillColor: [0, 200, 255, 200],
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as TransitStop | undefined
            if (d) setTooltip({ x: info.x, y: info.y, text: `🚌 ${d.name}` })
            else setTooltip(null)
          },
        })
      )
    }

    return result
  }, [boundary, transitStops, layers, zoriValue, zip])

  const handleToggle = useCallback((key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <div className="relative w-full h-full">
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
        <Map
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? ''}
          defaultCenter={center}
          defaultZoom={zoom}
          colorScheme="DARK"
          disableDefaultUI={false}
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          <MapPanner center={center} zoom={zoom} zip={zip} />
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
      <div className="absolute top-4 right-4 z-40 bg-zinc-900/90 border border-zinc-700 rounded-lg p-3 w-48">
        <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Layers</p>
        {([
          { key: 'zipBoundary' as const, label: 'ZIP Boundary' },
          { key: 'transitStops' as const, label: 'Transit Stops' },
          { key: 'rentChoropleth' as const, label: 'Rent Fill' },
        ]).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer mb-1">
            <input type="checkbox" checked={layers[key]} onChange={() => handleToggle(key)} className="accent-blue-500" />
            <span className="text-zinc-300 text-xs">{label}</span>
          </label>
        ))}
      </div>

      {/* Dev sidebar */}
      <div className="absolute top-4 left-4 z-40 bg-zinc-900/90 border border-zinc-700 rounded-lg p-3 w-72 max-h-[calc(100%-2rem)] overflow-y-auto">
        <p className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Data Layer Status</p>
        {DATA_LAYER_REGISTRY.map((item) => (
          <div key={item.label} className="mb-2 border-b border-zinc-800 pb-2 last:border-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.visualized ? 'bg-green-500' : 'bg-zinc-600'}`} />
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
