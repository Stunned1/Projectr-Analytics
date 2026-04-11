'use client'

import { memo, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { GeoJsonLayer, ScatterplotLayer, ColumnLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import type { GeoJSON, Feature, FeatureCollection, Geometry } from 'geojson'
import { dedupedFetchJson } from '@/lib/request-cache'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarketData {
  zip: string
  geo?: { lat: number; lng: number; city: string; state: string; stateFips?: string; countyFips?: string }
  zillow: { zori_latest: number | null; zhvi_latest: number | null } | null
}

interface TransitStop {
  position: [number, number]
  name: string
}

interface TransitData {
  zip: string
  geojson: {
    features: Array<{
      geometry: { coordinates: [number, number] }
      properties: { stop_name: string }
    }>
  }
}

interface NeighborZip {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
}

interface ZipBoundary {
  zip: string
  geojson: GeoJSON
  zori: number | null
  zhvi: number | null
}

interface BlockGroupFeature {
  type: 'Feature'
  geometry: object
  properties: {
    GEOID: string
    population: number
    housing_units: number
    owner_occupied: number
  }
}

interface BlockGroupCollection {
  type: 'FeatureCollection'
  features: BlockGroupFeature[]
}

interface AmenityPoint {
  position: [number, number]
  weight: number
}

type TractProps = {
  GEOID?: string
  TRACT?: string
  median_rent?: number | null
  median_income?: number | null
  vacancy_rate?: number | null
  population?: number | null
}
type TractFeature = Feature<Geometry, TractProps>
type TractCollection = FeatureCollection<Geometry, TractProps>

type FloodProps = {
  FLD_ZONE?: string
  label?: string
  risk?: 'high' | 'moderate' | 'low'
}
type FloodFeature = Feature<Geometry, FloodProps>
type FloodCollection = FeatureCollection<Geometry, FloodProps>

interface LayerState {
  zipBoundary: boolean
  transitStops: boolean
  rentChoropleth: boolean
  blockGroups: boolean
  parcels: boolean
  tracts: boolean
  amenityHeatmap: boolean
  floodRisk: boolean
  nycPermits: boolean
  clientData: boolean
}

interface MapViewState {
  lat: number
  lng: number
  zoom: number
}

interface PermitPayload {
  id: string
  lat: number
  lng: number
  job_type: string | null
  job_type_label: string
  job_status: string | null
  job_description: string | null
  address: string
  owner_business: string | null
  initial_cost: number | null
  proposed_stories: number | null
  proposed_units: number | null
  filing_date: string | null
  nta_name: string | null
  zip_code: string | null
}

interface ParcelPayload {
  lat: number
  lng: number
  assessed_per_sqft: number
  floors: number
  land_use: string | null
  land_use_label: string
  address: string
  assessed_value: number
}

interface PermitHeatPoint {
  position: [number, number]
  weight: number
}

interface PermitResponse {
  mode?: string
  permits?: PermitPayload[]
  points?: PermitHeatPoint[]
  count?: number
}

interface ParcelResponse {
  parcels?: ParcelPayload[]
  stats?: { p25_per_sqft: number; p75_per_sqft: number }
}

function hasFeatures(value: unknown): value is { features: unknown[] } {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as { features?: unknown[] }).features)
}

// ── Dev sidebar registry ──────────────────────────────────────────────────────

const DATA_LAYER_REGISTRY = [
  { label: 'ZIP Boundary', source: 'Census TIGER', visualized: true, layerType: 'GeoJsonLayer (outline)' },
  { label: 'ZORI Rent Index', source: 'Zillow Research', visualized: true, layerType: 'GeoJsonLayer (choropleth — multi-ZIP)' },
  { label: 'Transit Stops', source: 'GTFS / OSM', visualized: true, layerType: 'ScatterplotLayer (cyan dots)' },
  { label: 'ZHVI Home Value', source: 'Zillow Research', visualized: true, layerType: 'GeoJsonLayer (choropleth — multi-ZIP)' },
  { label: 'Census Tracts', source: 'Census TIGER + ACS', visualized: true, layerType: 'GeoJsonLayer (rent/income choropleth)' },
  { label: 'Amenity Heatmap', source: 'OpenStreetMap', visualized: true, layerType: 'HeatmapLayer (weighted by amenity type)' },
  { label: 'Flood Risk Zones', source: 'FEMA NFHL', visualized: true, layerType: 'GeoJsonLayer (red = high risk)' },
  { label: 'NYC Parcels (PLUTO)', source: 'NYC Open Data', visualized: true, layerType: 'ColumnLayer (3D columns — height = assessed value/sqft)' },
  { label: 'Block Groups', source: 'Census TIGER + ACS', visualized: true, layerType: 'GeoJsonLayer (population density — replaced by Tracts)' },
  { label: 'Vacancy Rate', source: 'Census ACS', visualized: false, layerType: null, note: 'Now included in Tracts layer' },
  { label: 'PoP Momentum Score', source: 'Computed', visualized: false, layerType: null, note: 'Computed API exists; no map layer yet' },
  { label: 'Unemployment Rate', source: 'FRED', visualized: false, layerType: null, note: 'County aggregate — sidebar chart only' },
  { label: 'Real GDP', source: 'FRED', visualized: false, layerType: null, note: 'County aggregate — sidebar chart only' },
  { label: 'Median Household Income', source: 'Census ACS', visualized: false, layerType: null, note: 'Now included in Tracts layer' },
  { label: 'FMR by Bedroom', source: 'HUD / Census ACS', visualized: false, layerType: null, note: 'No spatial variation within ZIP' },
  { label: 'Days on Market', source: 'Zillow Metro', visualized: false, layerType: null, note: 'Metro-level — stat card only' },
  { label: 'Google Trends Score', source: 'Google Trends', visualized: false, layerType: null, note: 'City/state sentiment — sidebar sparkline only' },
  { label: 'Permit Pin Locations', source: 'ArcGIS REST', visualized: false, layerType: null, note: 'DEFERRED — jurisdiction-specific feeds required' },
]

// Reuse expensive county blockgroup responses across CommandMap remounts.
const BLOCKGROUP_CACHE = new globalThis.Map<string, BlockGroupCollection>()
let commandMapRenderCounter = 0

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

function MapFitter({ boundary, zip }: { boundary: GeoJSON | null; zip: string | null }) {
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
  const deck = useMemo(() => new GoogleMapsOverlay({ interleaved: false }), [])
  const map = useMap()
  const attachedMapRef = useRef<google.maps.Map | null>(null)
  const isAttachedRef = useRef(false)

  useEffect(() => {
    if (!map) return
    if (attachedMapRef.current === map && isAttachedRef.current) return
    // Small delay to ensure map is fully initialized before attaching overlay
    const timer = setTimeout(() => {
      try {
        deck.setMap(map)
        attachedMapRef.current = map
        isAttachedRef.current = true
      } catch { /* map not ready */ }
    }, 100)
    return () => {
      clearTimeout(timer)
      if (attachedMapRef.current === map && isAttachedRef.current) {
        try { deck.setMap(null) } catch { /* ignore */ }
        attachedMapRef.current = null
        isAttachedRef.current = false
      }
    }
  }, [map, deck])

  useEffect(() => {
    if (!map || !isAttachedRef.current) return
    try { deck.setProps({ layers }) } catch { /* ignore */ }
  }, [layers, deck, map])

  return null
}

// ── Zoom + bounds tracker ─────────────────────────────────────────────────────

function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null) => void }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const update = () => {
      const zoom = map.getZoom() ?? 11
      const b = map.getBounds()
      const bounds = b ? {
        minLat: b.getSouthWest().lat(),
        maxLat: b.getNorthEast().lat(),
        minLng: b.getSouthWest().lng(),
        maxLng: b.getNorthEast().lng(),
      } : null
      onZoomChange(zoom, bounds)
    }
    const zoomListener = map.addListener('zoom_changed', update)
    const idleListener = map.addListener('idle', update)
    update()
    return () => {
      google.maps.event.removeListener(zoomListener)
      google.maps.event.removeListener(idleListener)
    }
  }, [map, onZoomChange])
  return null
}

// ── Tilt controller ───────────────────────────────────────────────────────────

function TiltController({ tilt, heading }: { tilt: number; heading: number }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    map.setTilt(tilt)
  }, [map, tilt])
  useEffect(() => {
    if (!map) return
    map.setHeading(heading)
  }, [map, heading])
  return null
}

// ── Main component ────────────────────────────────────────────────────────────

interface CommandMapProps {
  zip: string | null
  marketData: MarketData | null
  transitData: TransitData | null
  cityZips?: Array<{ zip: string; lat: number | null; lng: number | null; zori_latest: number | null; zhvi_latest: number | null; city: string; state: string | null }> | null
  boroughBoundary?: object | null
  uploadedMarkers?: Array<{ lat: number; lng: number; value: number | null; label: string }> | null
  agentLayerOverrides?: Record<string, boolean>
  agentMetric?: 'zori' | 'zhvi' | null
  agentTilt?: number | null
}

function CommandMap({ zip, marketData, transitData, cityZips, boroughBoundary, uploadedMarkers, agentLayerOverrides, agentMetric, agentTilt }: CommandMapProps) {
  const perfDebug = process.env.NEXT_PUBLIC_PERF_DEBUG === '1'

  const [primaryBoundary, setPrimaryBoundary] = useState<GeoJSON | null>(null)
  const [neighborBoundaries, setNeighborBoundaries] = useState<ZipBoundary[]>([])
  const [cityBoundaries, setCityBoundaries] = useState<ZipBoundary[]>([])
  const [blockGroupData, setBlockGroupData] = useState<BlockGroupCollection | null>(null)
  const [parcelData, setParcelData] = useState<{ parcels: ParcelPayload[]; stats: { p25_per_sqft: number; p75_per_sqft: number } } | null>(null)
  const [tractData, setTractData] = useState<TractCollection | null>(null)
  const [amenityPoints, setAmenityPoints] = useState<AmenityPoint[]>([])
  const [floodData, setFloodData] = useState<FloodCollection | null>(null)
  const [nycPermitData, setNycPermitData] = useState<PermitPayload[]>([])
  const [permitHeatPoints, setPermitHeatPoints] = useState<PermitHeatPoint[]>([])
  const [permitMode, setPermitMode] = useState<'heatmap' | 'scatter'>('heatmap')
  const [permitTypeFilter, setPermitTypeFilter] = useState<'all' | 'NB' | 'A1' | 'DM'>('all')
  const [mapZoom, setMapZoom] = useState(11)
  const [mapBounds, setMapBounds] = useState<{ minLat: number; maxLat: number; minLng: number; maxLng: number } | null>(null)
  const permitFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPermitFetchKey = useRef<string>('')
  const [selectedPermit, setSelectedPermit] = useState<PermitPayload | null>(null)
  const [layers, setLayers] = useState<LayerState>({
    zipBoundary: true,
    transitStops: true,
    rentChoropleth: true,
    blockGroups: false,
    parcels: false,
    tracts: false,
    amenityHeatmap: false,
    floodRisk: false,
    nycPermits: false,
    clientData: true,
  })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [activeMetric, setActiveMetric] = useState<'zori' | 'zhvi'>('zori')
  const [tilt, setTilt] = useState(0)
  const [heading, setHeading] = useState(0)
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID ?? undefined

  const setTooltipStable = useCallback((next: { x: number; y: number; text: string } | null) => {
    setTooltip((prev) => {
      if (next === null) return prev === null ? prev : null
      if (!prev) return next
      const sameText = prev.text === next.text
      const sameX = Math.abs(prev.x - next.x) < 2
      const sameY = Math.abs(prev.y - next.y) < 2
      return sameText && sameX && sameY ? prev : next
    })
  }, [])

  useEffect(() => {
    if (!perfDebug) return
    commandMapRenderCounter += 1
    console.log('[perf] CommandMap render #', commandMapRenderCounter)
  })

  // Zoom-based permit refetch — debounced, only when permits layer is on
  const handleZoomChange = useCallback((zoom: number, bounds: typeof mapBounds) => {
    setMapZoom(zoom)
    setMapBounds(bounds)
  }, [])

  useEffect(() => {
    if (!layers.nycPermits && !agentLayerOverrides?.nycPermits) return
    // Determine borough or zip context
    const boroughCtx = (() => {
      if (!cityZips?.length) return null
      if (cityZips.every((z) => z.zip >= '10001' && z.zip <= '10282')) return 'MANHATTAN'
      if (cityZips.every((z) => z.zip >= '10451' && z.zip <= '10475')) return 'BRONX'
      if (cityZips.every((z) => z.zip >= '11200' && z.zip <= '11256')) return 'BROOKLYN'
      if (cityZips.every((z) => z.zip >= '11100' && z.zip <= '11436')) return 'QUEENS'
      if (cityZips.every((z) => z.zip >= '10300' && z.zip <= '10315')) return 'STATEN ISLAND'
      return null
    })()
    const zipCtx = zip ?? null
    if (!boroughCtx && !zipCtx && !mapBounds) return

    const types = permitTypeFilter === 'all' ? 'NB,A1,DM' : permitTypeFilter
    const fetchKey = `${mapZoom}|${boroughCtx}|${zipCtx}|${types}|${mapZoom >= 16 ? JSON.stringify(mapBounds) : ''}`
    if (fetchKey === lastPermitFetchKey.current) return
    lastPermitFetchKey.current = fetchKey

    if (permitFetchRef.current) clearTimeout(permitFetchRef.current)
    permitFetchRef.current = setTimeout(async () => {
      try {
        let url = `/api/permits?zoom=${mapZoom}&types=${types}`
        if (boroughCtx) url += `&borough=${boroughCtx}`
        else if (zipCtx) url += `&zip=${zipCtx}`
        if (mapZoom >= 16 && mapBounds) {
          url += `&minLat=${mapBounds.minLat}&maxLat=${mapBounds.maxLat}&minLng=${mapBounds.minLng}&maxLng=${mapBounds.maxLng}`
        }
        const d = await fetch(url).then((r) => r.json()) as PermitResponse
        if (d.mode === 'heatmap' && d.points) {
          setPermitHeatPoints(d.points)
          setPermitMode('heatmap')
        } else if (d.permits) {
          setNycPermitData(d.permits)
          setPermitMode('scatter')
        }
      } catch { /* non-critical */ }
    }, 400)
  }, [mapZoom, mapBounds, layers, agentLayerOverrides, zip, cityZips, permitTypeFilter])

  // Fetch city ZIP boundaries when city search is performed
  useEffect(() => {
    if (!cityZips?.length) { setCityBoundaries([]); return }
    setCityBoundaries([])
    // Also clear single-ZIP layers when switching to city mode
    setPrimaryBoundary(null)
    setNeighborBoundaries([])

    // Fetch borough parcels if this is an NYC borough search
    // Detect by checking if all ZIPs are in the same NYC borough range
    const firstZip = cityZips[0]?.zip ?? ''
    const nycBoroughMap: Record<string, string> = {
      '10': 'manhattan', '11': 'bronx',
    }
    const manhattanZips = cityZips.every((z) => z.zip >= '10001' && z.zip <= '10282')
    const bronxZips = cityZips.every((z) => z.zip >= '10451' && z.zip <= '10475')
    const brooklynZips = cityZips.every((z) => z.zip >= '11200' && z.zip <= '11256')
    const queensZips = cityZips.every((z) => z.zip >= '11100' && z.zip <= '11436')
    const siZips = cityZips.every((z) => z.zip >= '10300' && z.zip <= '10315')

    const detectedBorough = manhattanZips ? 'manhattan'
      : bronxZips ? 'bronx'
      : brooklynZips ? 'brooklyn'
      : queensZips ? 'queens'
      : siZips ? 'staten island'
      : null

    void nycBoroughMap // suppress unused warning
    void firstZip

    if (detectedBorough) {
      dedupedFetchJson<ParcelResponse>(`/api/parcels?borough=${encodeURIComponent(detectedBorough)}`)
        .then((d) => {
          if (Array.isArray(d.parcels) && d.stats) {
            setParcelData({ parcels: d.parcels, stats: d.stats })
          }
        })
        .catch(() => {})

      // Fetch permits for this borough
      const boroughParam = detectedBorough.charAt(0).toUpperCase() + detectedBorough.slice(1).toLowerCase()
      dedupedFetchJson<PermitResponse>(`/api/permits?borough=${boroughParam.toUpperCase()}&zoom=11`)
        .then((d) => {
          if (d.mode === 'heatmap' && d.points) { setPermitHeatPoints(d.points); setPermitMode('heatmap') }
          else if (d.permits) { setNycPermitData(d.permits); setPermitMode('scatter') }
        })
        .catch(() => {})
    }

    // Pan map to first ZIP centroid
    const first = cityZips.find((z) => z.lat && z.lng)
    if (first?.lat && first?.lng) {
      // Will be handled by MapFitter via primaryBoundary
    }

    // Fetch boundaries for all city ZIPs in parallel (limit 30)
    const sample = cityZips.filter((z) => z.lat && z.lng).slice(0, 30)
    Promise.allSettled(
      sample.map((z) =>
        fetch('/api/boundaries?zip=' + z.zip)
          .then((r) => r.json())
          .then((geojson) => ({ zip: z.zip, geojson, zori: z.zori_latest, zhvi: z.zhvi_latest }))
      )
    ).then((results) => {
      const loaded: ZipBoundary[] = results
        .filter((r): r is PromiseFulfilledResult<ZipBoundary> => r.status === 'fulfilled' && r.value.geojson?.features?.length > 0)
        .map((r) => r.value)
      setCityBoundaries(loaded)
    })
  }, [cityZips])

  // Fetch primary boundary + transit + neighbors when zip changes
  useEffect(() => {
    if (!zip) return
    // Clear city mode layers when switching to ZIP mode
    setCityBoundaries([])
    // Skip neighbor loading when city mode is active — city ZIPs provide the context
    const inCityMode = (cityZips?.length ?? 0) > 0

    // Primary boundary
    dedupedFetchJson<GeoJSON>('/api/boundaries?zip=' + zip)
      .then((d) => { if (hasFeatures(d)) setPrimaryBoundary(d) })
      .catch(() => {})
    dedupedFetchJson<{ zips?: NeighborZip[] }>('/api/neighbors?zip=' + zip)
      .then(async (d) => {
        if (inCityMode) return // city ZIPs already provide context
        const neighbors: NeighborZip[] = d.zips ?? []
        if (!neighbors.length) return

        // Fetch boundaries for all neighbors in parallel (limit for perf/GPU load)
        const sample = neighbors.slice(0, 10)
        const results = await Promise.allSettled(
          sample.map((n) =>
            dedupedFetchJson<GeoJSON>('/api/boundaries?zip=' + n.zip)
              .then((geojson) => ({ zip: n.zip, geojson, zori: n.zori_latest, zhvi: n.zhvi_latest }))
          )
        )
        const loaded: ZipBoundary[] = results.flatMap((r) => {
          if (r.status !== 'fulfilled') return []
          return hasFeatures(r.value.geojson) && r.value.geojson.features.length > 0 ? [r.value] : []
        })
        setNeighborBoundaries(loaded)
      })
      .catch(() => {})
  }, [zip])

  // Fetch block groups + parcels when we have geo data
  useEffect(() => {
    if (!marketData?.geo) return
    const { lat, lng, stateFips, countyFips } = marketData.geo

    // Block groups — need state + county FIPS
    if (stateFips && countyFips && countyFips !== '000') {
      const countyKey = `${stateFips}-${countyFips}`
      const cached = BLOCKGROUP_CACHE.get(countyKey)
      const blockgroupsPromise = cached
        ? Promise.resolve(cached)
        : dedupedFetchJson<BlockGroupCollection>(`/api/blockgroups?state=${stateFips}&county=${countyFips}`, {
          cacheKey: `blockgroups:${countyKey}`,
          ttlMs: 30 * 60 * 1000,
        })

      blockgroupsPromise
        .then((d) => {
          if (d.features?.length) {
            BLOCKGROUP_CACHE.set(countyKey, d)
            setBlockGroupData(d)
          }
        })
        .catch(() => {})
    }

    // NYC parcels (PLUTO) — ZIP mode or borough mode
    if (marketData?.zip) {
      dedupedFetchJson<ParcelResponse>(`/api/parcels?zip=${marketData.zip}`)
        .then((d) => {
          if (Array.isArray(d.parcels) && d.stats) {
            setParcelData({ parcels: d.parcels, stats: d.stats })
          }
        })
        .catch(() => {})

      // Fetch permits for this ZIP
      dedupedFetchJson<PermitResponse>(`/api/permits?zip=${marketData.zip}&zoom=13`)
        .then((d) => {
          if (d.mode === 'heatmap' && d.points) { setPermitHeatPoints(d.points); setPermitMode('heatmap') }
          else if (d.permits) { setNycPermitData(d.permits); setPermitMode('scatter') }
        })
        .catch(() => {})
    }

    // Census Tracts with rent/income data
    if (stateFips && countyFips && countyFips !== '000') {
      dedupedFetchJson<TractCollection>(`/api/tracts?state=${stateFips}&county=${countyFips}`)
        .then((d) => { if (d.features) setTractData(d) })
        .catch(() => {})
    }

    // OSM Amenity heatmap points
    dedupedFetchJson<{ points?: AmenityPoint[] }>(`/api/amenities?lat=${lat}&lng=${lng}&radius=0.06`)
      .then((d) => { if (d.points) setAmenityPoints(d.points) })
      .catch(() => {})

    // FEMA Flood Risk zones
    dedupedFetchJson<FloodCollection>(`/api/floodrisk?lat=${lat}&lng=${lng}&radius=0.05`)
      .then((d) => { if (d.features) setFloodData(d) })
      .catch(() => {})
  }, [marketData])

  const transitStops = useMemo(() => {
    if (!zip || !transitData || transitData.zip !== zip) return []
    if (!transitData.geojson?.features) return []
    return transitData.geojson.features.map((f) => ({
      position: f.geometry.coordinates as [number, number],
      name: f.properties.stop_name,
    }))
  }, [zip, transitData])

  // Merge agent layer overrides into local layer state
  const effectiveLayers = useMemo(() => ({
    ...layers,
    ...agentLayerOverrides,
  }), [layers, agentLayerOverrides])

  // Agent can override the active metric
  const effectiveMetric = agentMetric ?? activeMetric

  // Agent can override tilt
  useEffect(() => {
    if (agentTilt != null) setTilt(agentTilt)
  }, [agentTilt])
  const allMetricValues = useMemo(() => {
    const primaryValue = effectiveMetric === 'zhvi'
      ? marketData?.zillow?.zhvi_latest ?? null
      : marketData?.zillow?.zori_latest ?? null
    const vals: (number | null)[] = [primaryValue]
    neighborBoundaries.forEach((n) => vals.push(effectiveMetric === 'zhvi' ? n.zhvi : n.zori))
    cityBoundaries.forEach((n) => vals.push(effectiveMetric === 'zhvi' ? n.zhvi : n.zori))
    return vals
  }, [effectiveMetric, marketData, neighborBoundaries, cityBoundaries])

  const colorScale = useMemo(() => buildColorScale(allMetricValues), [allMetricValues])

  const primaryMetricValue = effectiveMetric === 'zhvi'
    ? marketData?.zillow?.zhvi_latest ?? null
    : marketData?.zillow?.zori_latest ?? null

  const deckLayers = useMemo(() => {
    const result: Layer[] = []

    // City ZIP boundaries (rendered first when in city mode)
    if (effectiveLayers.zipBoundary && cityBoundaries.length > 0) {
      cityBoundaries.forEach((n) => {
        const metricValue = effectiveMetric === 'zhvi' ? n.zhvi : n.zori
        result.push(
          new GeoJsonLayer({
            id: 'city-zip-' + n.zip,
            data: n.geojson,
            stroked: true,
            filled: true,
            getFillColor: effectiveLayers.rentChoropleth ? colorScale(metricValue) : [60, 60, 80, 60],
            getLineColor: [255, 255, 255, 160],
            lineWidthMinPixels: 1,
            pickable: true,
            onHover: (info: PickingInfo) => {
              if (info.object) {
                setTooltipStable({
                  x: info.x, y: info.y,
                  text: 'ZIP ' + n.zip + (metricValue ? ` · $${metricValue.toFixed(0)} ${effectiveMetric.toUpperCase()}` : ''),
                })
              } else setTooltipStable(null)
            },
          })
        )
      })
    }

    // Borough boundary outline (rendered on top of city ZIPs)
    if (boroughBoundary && cityBoundaries.length > 0) {
      result.push(
        new GeoJsonLayer({
          id: 'borough-boundary',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { type: 'FeatureCollection' as const, features: [boroughBoundary] } as any,
          stroked: true,
          filled: false,
          getLineColor: [215, 107, 61, 255], // #D76B3D orange
          lineWidthMinPixels: 3,
          pickable: false,
        })
      )
    }

    // Neighbor ZIP boundaries (rendered first, behind primary)
    if (effectiveLayers.zipBoundary && neighborBoundaries.length > 0) {
      neighborBoundaries.forEach((n) => {
        const metricValue = effectiveMetric === 'zhvi' ? n.zhvi : n.zori
        result.push(
          new GeoJsonLayer({
            id: 'neighbor-' + n.zip,
            data: n.geojson,
            stroked: true,
            filled: true,
            getFillColor: effectiveLayers.rentChoropleth ? colorScale(metricValue) : [60, 60, 80, 60],
            getLineColor: [180, 180, 200, 120],
            lineWidthMinPixels: 1,
            pickable: true,
            onHover: (info: PickingInfo) => {
              if (info.object) {
                setTooltipStable({
                  x: info.x, y: info.y,
                  text: 'ZIP ' + n.zip + (metricValue ? ` · $${metricValue.toFixed(0)} ${effectiveMetric.toUpperCase()}` : ''),
                })
              } else setTooltipStable(null)
            },
          })
        )
      })
    }

    // Primary ZIP boundary (on top, brighter outline)
    // When block groups are active, show outline only — block groups provide the color
    if (effectiveLayers.zipBoundary && primaryBoundary) {
      result.push(
        new GeoJsonLayer({
          id: 'zip-primary',
          data: primaryBoundary,
          stroked: true,
          filled: !effectiveLayers.blockGroups, // no fill when block groups are showing
          getFillColor: effectiveLayers.rentChoropleth ? colorScale(primaryMetricValue) : [255, 255, 255, 30],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 3,
          pickable: true,
          onHover: (info: PickingInfo) => {
            if (info.object) {
              setTooltipStable({
                x: info.x, y: info.y,
                text: 'ZIP ' + zip + (primaryMetricValue ? ` · $${primaryMetricValue.toFixed(0)} ${effectiveMetric.toUpperCase()}` : ''),
              })
            } else setTooltipStable(null)
          },
        })
      )
    }

    // Transit stops
    if (effectiveLayers.transitStops && transitStops.length > 0) {
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
            if (d) setTooltipStable({ x: info.x, y: info.y, text: '\uD83D\uDE8C ' + d.name })
            else setTooltipStable(null)
          },
        })
      )
    }

    // Block groups — sub-ZIP population density choropleth
    if (effectiveLayers.blockGroups && blockGroupData) {
      const bgFeatures = blockGroupData.features ?? []
      const pops = bgFeatures.map((f) => f.properties.population).filter((p) => p > 0)
      const minPop = pops.length ? Math.min(...pops) : 0
      const maxPop = pops.length ? Math.max(...pops) : 1

      result.push(
        new GeoJsonLayer({
          id: 'block-groups',
          data: blockGroupData as unknown as GeoJSON,
          stroked: true,
          filled: true,
          getFillColor: (f: { properties: { population: number } }) => {
            const pop = f.properties.population ?? 0
            const t = maxPop === minPop ? 0.5 : Math.min(Math.max((pop - minPop) / (maxPop - minPop), 0), 1)
            // Green (low density) → yellow → orange (high density)
            return [Math.round(50 + t * 200), Math.round(200 - t * 100), Math.round(50 * (1 - t)), 140]
          },
          getLineColor: [255, 255, 255, 60],
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info: PickingInfo) => {
            const f = info.object as { properties: { population: number; housing_units: number } } | undefined
            if (f) {
              setTooltipStable({
                x: info.x, y: info.y,
                text: `Pop: ${f.properties.population?.toLocaleString()} · Units: ${f.properties.housing_units?.toLocaleString()}`,
              })
            } else setTooltipStable(null)
          },
        })
      )
    }

    // NYC PLUTO parcels — ColumnLayer (3D columns sized by assessed value per sqft)
    if (effectiveLayers.parcels && parcelData?.parcels?.length) {
      const { p25_per_sqft, p75_per_sqft } = parcelData.stats
      const range = p75_per_sqft - p25_per_sqft || 1

      result.push(
        new ColumnLayer({
          id: 'nyc-parcels',
          data: parcelData.parcels,
          diskResolution: 6,
          radius: 7,
          extruded: true,
          getPosition: (d) => [d.lng, d.lat],
          getElevation: (d) => {
            const v = Math.max(d.assessed_value, 1)
            const logVal = Math.log10(v)
            const t = Math.min(Math.max((logVal - 3) / 7, 0), 1)
            return 5 + t * 400
          },
          getFillColor: (d) => {
            const lu = d.land_use ?? '0'
            if (lu === '1') return [100, 200, 120, 230]
            if (lu === '2') return [60, 160, 100, 230]
            if (lu === '3') return [40, 120, 220, 230]
            if (lu === '4') return [180, 100, 220, 230]
            if (lu === '5') return [255, 160, 30, 230]
            if (lu === '6') return [140, 140, 160, 230]
            if (lu === '8') return [220, 80, 80, 230]
            if (lu === '9') return [80, 200, 160, 230]
            if (lu === '10') return [100, 100, 120, 180]
            if (lu === '11') return [200, 180, 60, 180]
            return [160, 140, 120, 180]
          },
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as typeof parcelData.parcels[0] | undefined
            if (d) {
              setTooltipStable({
                x: info.x, y: info.y,
                text: `${d.address} · $${d.assessed_value.toLocaleString()} · ${d.land_use_label}`,
              })
            } else setTooltipStable(null)
          },
        })
      )
    }

    // Census Tracts — rent/income choropleth (replaces block groups as primary sub-ZIP layer)
    if (effectiveLayers.tracts && tractData) {
      const tractFeatures = tractData.features ?? []
      const rents = tractFeatures.map((f: TractFeature) => f.properties.median_rent ?? 0).filter((v: number) => v > 0)
      const minRent = rents.length ? Math.min(...rents) : 0
      const maxRent = rents.length ? Math.max(...rents) : 1

      result.push(
        new GeoJsonLayer({
          id: 'census-tracts',
          data: tractData,
          stroked: true,
          filled: true,
          getFillColor: (f: TractFeature) => {
            const rent = f.properties.median_rent ?? 0
            if (!rent) return [60, 60, 80, 60]
            const t = maxRent === minRent ? 0.5 : Math.min(Math.max((rent - minRent) / (maxRent - minRent), 0), 1)
            // Deep blue (low rent) → teal → gold (high rent)
            return [
              Math.round(20 + t * 220),
              Math.round(80 + t * 120),
              Math.round(180 - t * 100),
              160,
            ]
          },
          getLineColor: [255, 255, 255, 80],
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info: PickingInfo) => {
            const f = info.object as TractFeature | undefined
            if (f) {
              const rent = f.properties.median_rent
              const income = f.properties.median_income
              const vacancy = f.properties.vacancy_rate
              setTooltip({
                x: info.x, y: info.y,
                text: [
                  rent ? `Rent: $${rent.toLocaleString()}/mo` : null,
                  income ? `Income: $${income.toLocaleString()}` : null,
                  vacancy != null ? `Vacancy: ${vacancy}%` : null,
                ].filter(Boolean).join(' · '),
              })
            } else setTooltip(null)
          },
        })
      )
    }

    // Amenity Heatmap — weighted by amenity type (transit > commercial > retail)
    if (effectiveLayers.amenityHeatmap && amenityPoints.length > 0) {
      result.push(
        new HeatmapLayer({
          id: 'amenity-heatmap',
          data: amenityPoints,
          getPosition: (d: AmenityPoint) => d.position,
          getWeight: (d: AmenityPoint) => d.weight,
          radiusPixels: 40,
          intensity: 1.5,
          threshold: 0.05,
          colorRange: [
            [0, 20, 40, 0],
            [0, 60, 100, 100],
            [0, 150, 180, 160],
            [100, 220, 200, 200],
            [220, 255, 180, 220],
            [255, 255, 120, 240],
          ],
        })
      )
    }

    // FEMA Flood Risk Zones
    if (effectiveLayers.floodRisk && floodData) {
      result.push(
        new GeoJsonLayer({
          id: 'flood-risk',
          data: floodData,
          stroked: true,
          filled: true,
          getFillColor: (f: FloodFeature) => {
            const risk = f.properties.risk
            if (risk === 'high') return [220, 50, 50, 120]
            if (risk === 'moderate') return [220, 140, 50, 100]
            return [50, 50, 220, 60]
          },
          getLineColor: (f: FloodFeature) => {
            const risk = f.properties.risk
            if (risk === 'high') return [255, 80, 80, 200]
            return [255, 180, 80, 180]
          },
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info: PickingInfo) => {
            const f = info.object as FloodFeature | undefined
            if (f) {
              setTooltip({
                x: info.x, y: info.y,
                text: `⚠️ ${f.properties.label ?? f.properties.FLD_ZONE}`,
              })
            } else setTooltip(null)
          },
        })
      )
    }

    // NYC Permits — zoom-adaptive: heatmap at low zoom, scatter at mid, bbox-filtered at street level
    if (effectiveLayers.nycPermits) {
      if (permitMode === 'heatmap' && permitHeatPoints.length > 0) {
        result.push(
          new HeatmapLayer({
            id: 'permit-heatmap',
            data: permitHeatPoints,
            getPosition: (d: PermitHeatPoint) => d.position,
            getWeight: (d: PermitHeatPoint) => d.weight,
            radiusPixels: 35,
            intensity: 2,
            threshold: 0.05,
            colorRange: [
              [20, 10, 5, 0],
              [80, 30, 10, 120],
              [160, 70, 20, 180],
              [215, 107, 61, 210],
              [240, 160, 80, 230],
              [255, 220, 140, 250],
            ],
          })
        )
      } else if (permitMode === 'scatter' && nycPermitData.length > 0) {
        const filtered = permitTypeFilter === 'all'
          ? nycPermitData
          : nycPermitData.filter((p) => p.job_type === permitTypeFilter)

        result.push(
          new ScatterplotLayer({
            id: 'nyc-permits-scatter',
            data: filtered,
            getPosition: (d: PermitPayload) => [d.lng, d.lat],
            getRadius: (d: PermitPayload) => {
              const cost = d.initial_cost ?? 0
              if (cost > 10_000_000) return 18
              if (cost > 1_000_000) return 12
              return 7
            },
            getFillColor: (d: PermitPayload) => {
              switch (d.job_type) {
                case 'NB': return [215, 107, 61, 230]   // orange
                case 'A1': return [100, 180, 255, 210]  // blue
                case 'DM': return [220, 80, 80, 220]    // red
                default:   return [180, 180, 180, 180]
              }
            },
            getLineColor: [0, 0, 0, 60],
            lineWidthMinPixels: 0,
            radiusUnits: 'pixels',
            pickable: true,
            onClick: (info: PickingInfo) => {
              const d = info.object as PermitPayload | undefined
              setSelectedPermit(d ?? null)
            },
            onHover: (info: PickingInfo) => {
              const d = info.object as PermitPayload | undefined
              if (d) setTooltipStable({ x: info.x, y: info.y, text: `${d.job_type_label} · ${d.address}` })
              else setTooltipStable(null)
            },
          })
        )
      }
    }

    // Uploaded client data markers (from Agentic Normalizer) — 3D columns
    if (effectiveLayers.clientData && uploadedMarkers?.length) {
      const values = uploadedMarkers.map((d) => d.value ?? 0).filter((v) => v > 0)
      const maxVal = values.length ? Math.max(...values) : 1
      const minVal = values.length ? Math.min(...values) : 0

      result.push(
        new ColumnLayer({
          id: 'uploaded-markers',
          data: uploadedMarkers,
          diskResolution: 3, // triangle = cone-like appearance
          radius: 25,        // much smaller footprint
          extruded: true,
          getPosition: (d: { lat: number; lng: number }) => [d.lng, d.lat],
          getElevation: (d: { value: number | null }) => {
            const v = d.value ?? 0
            const t = maxVal === minVal ? 0.5 : Math.min(Math.max((v - minVal) / (maxVal - minVal), 0), 1)
            return 30 + t * 120 // 30m–150m — more subtle
          },
          getFillColor: [215, 107, 61, 255],
          getLineColor: [255, 255, 255, 200],
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as { label: string; value: number | null } | undefined
            if (d) setTooltipStable({ x: info.x, y: info.y, text: `📍 ${d.label}${d.value != null ? ': $' + d.value.toLocaleString() : ''}` })
            else setTooltipStable(null)
          },
        })
      )
    }

    return result
  }, [primaryBoundary, neighborBoundaries, cityBoundaries, boroughBoundary, transitStops, blockGroupData, parcelData, tractData, amenityPoints, floodData, nycPermitData, permitHeatPoints, permitMode, permitTypeFilter, effectiveLayers, colorScale, primaryMetricValue, effectiveMetric, zip, setTooltipStable, uploadedMarkers])

  const handleToggle = useCallback((key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <div className="relative w-full h-full">
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
        <Map
          mapId={mapId}
          defaultCenter={{ lat: 37.2563, lng: -80.4347 }}
          defaultZoom={11}
          colorScheme="DARK"
          disableDefaultUI={true}
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          <MapFitter boundary={primaryBoundary ?? (cityBoundaries[0]?.geojson ?? null)} zip={zip ?? cityZips?.[0]?.zip ?? null} />
          <TiltController tilt={tilt} heading={heading} />
          <ZoomTracker onZoomChange={handleZoomChange} />
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

      {/* Permit detail panel */}
      {selectedPermit && (
        <div className="absolute bottom-4 left-4 z-40 w-72 rounded-xl overflow-hidden shadow-2xl"
          style={{ background: 'rgba(6,6,6,0.88)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-start justify-between px-4 pt-3 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
              <p className="text-white text-sm font-semibold leading-tight">{selectedPermit.address}</p>
              <p className="text-zinc-500 text-[10px] mt-0.5">{selectedPermit.zip_code} · {selectedPermit.nta_name}</p>
            </div>
            <button onClick={() => setSelectedPermit(null)} className="text-zinc-600 hover:text-white ml-2 flex-shrink-0">×</button>
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: selectedPermit.job_type === 'NB' ? 'rgba(215,107,61,0.2)' : selectedPermit.job_type === 'DM' ? 'rgba(220,80,80,0.2)' : 'rgba(100,180,255,0.2)',
                  color: selectedPermit.job_type === 'NB' ? '#D76B3D' : selectedPermit.job_type === 'DM' ? '#f87171' : '#60a5fa',
                  border: `1px solid ${selectedPermit.job_type === 'NB' ? 'rgba(215,107,61,0.3)' : selectedPermit.job_type === 'DM' ? 'rgba(220,80,80,0.3)' : 'rgba(100,180,255,0.3)'}`,
                }}>
                {selectedPermit.job_type_label}
              </span>
              <span className="text-zinc-500 text-[10px]">{selectedPermit.job_status}</span>
            </div>
            {selectedPermit.job_description && (
              <p className="text-zinc-300 text-[11px] leading-relaxed">{selectedPermit.job_description.slice(0, 200)}{selectedPermit.job_description.length > 200 ? '...' : ''}</p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {selectedPermit.initial_cost != null && selectedPermit.initial_cost > 0 && (
                <div>
                  <p className="text-zinc-600 text-[9px] uppercase tracking-widest">Est. Cost</p>
                  <p className="text-white text-xs font-medium">${selectedPermit.initial_cost.toLocaleString()}</p>
                </div>
              )}
              {selectedPermit.proposed_stories != null && selectedPermit.proposed_stories > 0 && (
                <div>
                  <p className="text-zinc-600 text-[9px] uppercase tracking-widest">Stories</p>
                  <p className="text-white text-xs font-medium">{selectedPermit.proposed_stories}</p>
                </div>
              )}
              {selectedPermit.proposed_units != null && selectedPermit.proposed_units > 0 && (
                <div>
                  <p className="text-zinc-600 text-[9px] uppercase tracking-widest">Units</p>
                  <p className="text-white text-xs font-medium">{selectedPermit.proposed_units}</p>
                </div>
              )}
              {selectedPermit.filing_date && (
                <div>
                  <p className="text-zinc-600 text-[9px] uppercase tracking-widest">Filed</p>
                  <p className="text-white text-xs font-medium">{selectedPermit.filing_date}</p>
                </div>
              )}
            </div>
            {selectedPermit.owner_business && (
              <p className="text-zinc-500 text-[10px] pt-1">{selectedPermit.owner_business}</p>
            )}
          </div>
        </div>
      )}

      {/* Layer toggles */}
      <div className="absolute top-4 right-4 z-40 w-56 flex flex-col gap-0 bg-black/70 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-xl">

        {/* Layer pills */}
        <div className="px-3 pt-3 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-2">Layers</p>
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: 'zipBoundary' as const, label: 'ZIP', color: '#a1a1aa' },
              { key: 'transitStops' as const, label: 'Transit', color: '#38bdf8' },
              { key: 'rentChoropleth' as const, label: 'Rent', color: '#a78bfa' },
              { key: 'blockGroups' as const, label: 'Blocks', color: '#34d399' },
              { key: 'parcels' as const, label: 'Parcels', color: '#fbbf24', zipOnly: true },
              { key: 'tracts' as const, label: 'Tracts', color: '#2dd4bf' },
              { key: 'amenityHeatmap' as const, label: 'Amenity', color: '#facc15' },
              { key: 'floodRisk' as const, label: 'Flood', color: '#f87171' },
              { key: 'nycPermits' as const, label: 'Permits', color: '#D76B3D' },
              { key: 'clientData' as const, label: 'Client', color: '#D76B3D', showWhen: !!uploadedMarkers?.length },
            ]).filter(({ zipOnly, showWhen }) => {
              if (showWhen === false) return false
              if (zipOnly) return (!cityZips?.length) || parcelData !== null
              return true
            }).map(({ key, label, color }) => {
              const active = effectiveLayers[key] ?? false
              return (
                <button
                  key={key}
                  onClick={() => handleToggle(key)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                  style={{
                    background: active ? `${color}18` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
                    color: active ? '#fff' : '#71717a',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: active ? color : '#52525b' }} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="h-px bg-white/6 mx-3" />

        {/* Permit type filter — only shown when permits layer is on */}
        {effectiveLayers.nycPermits && (
          <>
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-1.5">Permit Type</p>
              <div className="flex flex-wrap gap-1">
                {([
                  { key: 'all' as const, label: 'All', color: '#a1a1aa' },
                  { key: 'NB' as const, label: 'New Bldg', color: '#D76B3D' },
                  { key: 'A1' as const, label: 'Major Reno', color: '#60a5fa' },
                  { key: 'DM' as const, label: 'Demo', color: '#f87171' },
                ]).map(({ key, label, color }) => (
                  <button
                    key={key}
                    onClick={() => setPermitTypeFilter(key)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                    style={{
                      background: permitTypeFilter === key ? `${color}20` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${permitTypeFilter === key ? color : 'rgba(255,255,255,0.07)'}`,
                      color: permitTypeFilter === key ? '#fff' : '#71717a',
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: permitTypeFilter === key ? color : '#52525b' }} />
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-zinc-600 mt-1.5">
                {mapZoom < 13 ? 'Heatmap' : mapZoom >= 16 ? 'Street view' : 'Scatter'} · zoom {Math.round(mapZoom)}
              </p>
            </div>
            <div className="h-px bg-white/6 mx-3" />
          </>
        )}

        {/* Metric */}
        <div className="px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-1.5">Metric</p>
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {(['zori', 'zhvi'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setActiveMetric(m)}
                className={`flex-1 py-1.5 text-[10px] font-medium transition-all ${
                  activeMetric === m ? 'bg-[#D76B3D]/20 text-[#D76B3D]' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {m === 'zori' ? 'Rent' : 'Value'}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-white/6 mx-3" />

        {/* Tilt & Rotation */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Tilt</p>
            <span className="text-[10px] text-zinc-600 font-mono">{tilt}°</span>
          </div>
          <input type="range" min={0} max={67.5} step={1} value={tilt}
            onChange={(e) => setTilt(Number(e.target.value))}
            className="w-full h-1 rounded-full appearance-none bg-white/10 accent-[#D76B3D] cursor-pointer"
          />
          <div className="flex items-center justify-between mt-2 mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Rotation</p>
            <span className="text-[10px] text-zinc-600 font-mono">{heading}°</span>
          </div>
          <input type="range" min={0} max={360} step={1} value={heading}
            onChange={(e) => setHeading(Number(e.target.value))}
            className="w-full h-1 rounded-full appearance-none bg-white/10 accent-[#D76B3D] cursor-pointer"
          />
          <button
            onClick={() => { setTilt(0); setHeading(0) }}
            className="mt-2 w-full text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors py-1 rounded border border-white/6 hover:border-white/12"
          >
            Reset View
          </button>
        </div>

        {neighborBoundaries.length > 0 && (
          <div className="px-3 pb-2">
            <p className="text-[10px] text-zinc-600">{neighborBoundaries.length} nearby ZIPs</p>
          </div>
        )}
      </div>

    </div>
  )
}

const MemoizedCommandMap = memo(CommandMap)
MemoizedCommandMap.displayName = 'CommandMap'

export default MemoizedCommandMap
