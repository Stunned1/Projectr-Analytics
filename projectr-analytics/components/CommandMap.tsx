'use client'

import { memo, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { GeoJsonLayer, ScatterplotLayer, PolygonLayer, ColumnLayer } from '@deck.gl/layers'
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

interface BuildingFeature {
  type: 'Feature'
  geometry: { type: 'Polygon'; coordinates: number[][][] }
  properties: {
    id: number
    building: string
    name: string | null
    levels: number | null
    height: number
  }
}

interface BuildingCollection {
  type: 'FeatureCollection'
  features: BuildingFeature[]
  meta?: { count: number; bbox: string }
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
  buildings: boolean
  parcels: boolean
  tracts: boolean
  amenityHeatmap: boolean
  floodRisk: boolean
}

interface MapViewState {
  lat: number
  lng: number
  zoom: number
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
  { label: 'OSM Buildings', source: 'OpenStreetMap', visualized: true, layerType: 'PolygonLayer extruded (3D building footprints)' },
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
  const deck = useMemo(() => new GoogleMapsOverlay({ interleaved: true }), [])
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

// ── Camera sampler (listener-free) ────────────────────────────────────────────
// Polls map center/zoom periodically to avoid brittle addListener wiring.
function CameraSampler({ enabled, onSample }: { enabled: boolean; onSample: (view: MapViewState) => void }) {
  const map = useMap()
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !map) return

    const sample = () => {
      const center = map.getCenter()
      const zoom = map.getZoom()
      if (!center || typeof zoom !== 'number') return
      const view = { lat: center.lat(), lng: center.lng(), zoom }
      const key = `${view.lat.toFixed(3)}|${view.lng.toFixed(3)}|${Math.round(view.zoom * 10) / 10}`
      if (key === lastKeyRef.current) return
      lastKeyRef.current = key
      onSample(view)
    }

    sample()
    const id = setInterval(sample, 400)
    return () => clearInterval(id)
  }, [enabled, map, onSample])

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

interface CommandMapProps {
  zip: string | null
  marketData: MarketData | null
  transitData: TransitData | null
}

function CommandMap({ zip, marketData, transitData }: CommandMapProps) {
  const perfDebug = process.env.NEXT_PUBLIC_PERF_DEBUG === '1'

  const [primaryBoundary, setPrimaryBoundary] = useState<GeoJSON | null>(null)
  const [neighborBoundaries, setNeighborBoundaries] = useState<ZipBoundary[]>([])
  const [blockGroupData, setBlockGroupData] = useState<BlockGroupCollection | null>(null)
  const [buildingData, setBuildingData] = useState<BuildingCollection | null>(null)
  const [parcelData, setParcelData] = useState<{ parcels: ParcelPayload[]; stats: { p25_per_sqft: number; p75_per_sqft: number } } | null>(null)
  const [tractData, setTractData] = useState<TractCollection | null>(null)
  const [amenityPoints, setAmenityPoints] = useState<AmenityPoint[]>([])
  const [floodData, setFloodData] = useState<FloodCollection | null>(null)
  const [layers, setLayers] = useState<LayerState>({
    zipBoundary: true,
    transitStops: true,
    rentChoropleth: true,
    blockGroups: false,
    buildings: false,
    parcels: false,
    tracts: false,
    amenityHeatmap: false,
    floodRisk: false,
  })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [activeMetric, setActiveMetric] = useState<'zori' | 'zhvi'>('zori')
  const [tilt, setTilt] = useState(0)
  const [heading, setHeading] = useState(0)
  const latestViewRef = useRef<MapViewState | null>(null)
  const buildingsFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBuildingsFetchKeyRef = useRef<string | null>(null)
  const lastSampleHandledAtRef = useRef(0)
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

  // Fetch primary boundary + transit + neighbors when zip changes
  useEffect(() => {
    if (!zip) return

    // Primary boundary
    dedupedFetchJson<GeoJSON>('/api/boundaries?zip=' + zip)
      .then((d) => { if (hasFeatures(d)) setPrimaryBoundary(d) })
      .catch(() => {})
    dedupedFetchJson<{ zips?: NeighborZip[] }>('/api/neighbors?zip=' + zip)
      .then(async (d) => {
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

    // NYC parcels (PLUTO) — only for NYC ZIPs
    if (marketData?.zip) {
      dedupedFetchJson<ParcelResponse>(`/api/parcels?zip=${marketData.zip}`)
        .then((d) => {
          if (Array.isArray(d.parcels) && d.stats) {
            setParcelData({ parcels: d.parcels, stats: d.stats })
          }
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

  const fetchBuildingsForView = useCallback((view: MapViewState) => {
    if (!layers.buildings) return
    if (view.zoom < 14) {
      setBuildingData(null)
      return
    }
    const roundedLat = Number(view.lat.toFixed(3))
    const roundedLng = Number(view.lng.toFixed(3))
    const zoomBucket = Math.floor(view.zoom)
    const radius = view.zoom >= 16 ? 0.01 : 0.02
    const fetchKey = `${roundedLat}|${roundedLng}|${zoomBucket}|${radius}`
    if (fetchKey === lastBuildingsFetchKeyRef.current) return
    lastBuildingsFetchKeyRef.current = fetchKey

    const buildingsUrl = `/api/buildings?lat=${roundedLat}&lng=${roundedLng}&radius=${radius}&zoom=${zoomBucket}`
    const tryBuildings = (attempt = 0) => {
      dedupedFetchJson<BuildingCollection>(buildingsUrl, { ttlMs: 60_000 })
        .then((d) => {
          if (d.features) setBuildingData(d)
          else if (attempt < 1) setTimeout(() => tryBuildings(1), 3000)
        })
        .catch(() => { if (attempt < 1) setTimeout(() => tryBuildings(1), 3000) })
    }
    tryBuildings()
  }, [layers.buildings])

  const handleCameraSample = useCallback((view: MapViewState) => {
    // Hard throttle camera-driven logic to max 10Hz.
    const now = Date.now()
    if (now - lastSampleHandledAtRef.current < 100) return
    lastSampleHandledAtRef.current = now

    latestViewRef.current = view
    if (!layers.buildings) return
    if (buildingsFetchTimerRef.current) clearTimeout(buildingsFetchTimerRef.current)
    buildingsFetchTimerRef.current = setTimeout(() => {
      const latest = latestViewRef.current
      if (!latest) return
      fetchBuildingsForView(latest)
    }, 220)
  }, [layers.buildings, fetchBuildingsForView])

  // Seed buildings using zip-center view.
  useEffect(() => {
    if (!layers.buildings || !marketData?.geo) return
    handleCameraSample({ lat: marketData.geo.lat, lng: marketData.geo.lng, zoom: 15 })
  }, [layers.buildings, marketData, handleCameraSample])

  useEffect(() => {
    if (layers.buildings) return
    if (buildingsFetchTimerRef.current) clearTimeout(buildingsFetchTimerRef.current)
  }, [layers.buildings])

  useEffect(() => {
    return () => {
      if (buildingsFetchTimerRef.current) clearTimeout(buildingsFetchTimerRef.current)
    }
  }, [])

  const transitStops = useMemo(() => {
    if (!zip || !transitData || transitData.zip !== zip) return []
    if (!transitData.geojson?.features) return []
    return transitData.geojson.features.map((f) => ({
      position: f.geometry.coordinates as [number, number],
      name: f.properties.stop_name,
    }))
  }, [zip, transitData])

  // Build color scale across all loaded ZIPs for the selected metric
  const allMetricValues = useMemo(() => {
    const primaryValue = activeMetric === 'zhvi'
      ? marketData?.zillow?.zhvi_latest ?? null
      : marketData?.zillow?.zori_latest ?? null
    const vals: (number | null)[] = [primaryValue]
    neighborBoundaries.forEach((n) => vals.push(activeMetric === 'zhvi' ? n.zhvi : n.zori))
    return vals
  }, [activeMetric, marketData, neighborBoundaries])

  const colorScale = useMemo(() => buildColorScale(allMetricValues), [allMetricValues])

  const primaryMetricValue = activeMetric === 'zhvi'
    ? marketData?.zillow?.zhvi_latest ?? null
    : marketData?.zillow?.zori_latest ?? null

  const deckLayers = useMemo(() => {
    const result: Layer[] = []

    // Neighbor ZIP boundaries (rendered first, behind primary)
    if (layers.zipBoundary && neighborBoundaries.length > 0) {
      neighborBoundaries.forEach((n) => {
        const metricValue = activeMetric === 'zhvi' ? n.zhvi : n.zori
        result.push(
          new GeoJsonLayer({
            id: 'neighbor-' + n.zip,
            data: n.geojson,
            stroked: true,
            filled: true,
            getFillColor: layers.rentChoropleth ? colorScale(metricValue) : [60, 60, 80, 60],
            getLineColor: [180, 180, 200, 120],
            lineWidthMinPixels: 1,
            pickable: true,
            onHover: (info: PickingInfo) => {
              if (info.object) {
                setTooltipStable({
                  x: info.x, y: info.y,
                  text: 'ZIP ' + n.zip + (metricValue ? ` · $${metricValue.toFixed(0)} ${activeMetric.toUpperCase()}` : ''),
                })
              } else setTooltipStable(null)
            },
          })
        )
      })
    }

    // Primary ZIP boundary (on top, brighter outline)
    // When block groups are active, show outline only — block groups provide the color
    if (layers.zipBoundary && primaryBoundary) {
      result.push(
        new GeoJsonLayer({
          id: 'zip-primary',
          data: primaryBoundary,
          stroked: true,
          filled: !layers.blockGroups, // no fill when block groups are showing
          getFillColor: layers.rentChoropleth ? colorScale(primaryMetricValue) : [255, 255, 255, 30],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 3,
          pickable: true,
          onHover: (info: PickingInfo) => {
            if (info.object) {
              setTooltipStable({
                x: info.x, y: info.y,
                text: 'ZIP ' + zip + (primaryMetricValue ? ` · $${primaryMetricValue.toFixed(0)} ${activeMetric.toUpperCase()}` : ''),
              })
            } else setTooltipStable(null)
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
            if (d) setTooltipStable({ x: info.x, y: info.y, text: '\uD83D\uDE8C ' + d.name })
            else setTooltipStable(null)
          },
        })
      )
    }

    // Block groups — sub-ZIP population density choropleth
    if (layers.blockGroups && blockGroupData) {
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

    // OSM Buildings — 3D extruded footprints
    if (layers.buildings && buildingData) {
      const features = buildingData.features ?? []

      result.push(
        new PolygonLayer({
          id: 'osm-buildings',
          data: features,
          extruded: true,
          wireframe: false,
          getPolygon: (f) => f.geometry.coordinates[0] as [number, number][],
          getElevation: (f) => f.properties.height ?? 4,
          getFillColor: (f) => {
            const type = f.properties.building
            if (type === 'commercial' || type === 'retail') return [255, 180, 50, 200]
            if (type === 'industrial') return [150, 150, 180, 200]
            if (type === 'apartments' || type === 'residential') return [100, 180, 255, 200]
            return [180, 160, 120, 200] // default warm
          },
          getLineColor: [255, 255, 255, 30],
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info: PickingInfo) => {
            const f = info.object as { properties: { name: string | null; building: string; height: number } } | undefined
            if (f) {
              const label = f.properties.name ?? f.properties.building
              setTooltipStable({ x: info.x, y: info.y, text: `🏢 ${label} · ${f.properties.height}m` })
            } else setTooltipStable(null)
          },
        })
      )
    }

    // NYC PLUTO parcels — ColumnLayer (3D columns sized by assessed value per sqft)
    if (layers.parcels && parcelData?.parcels?.length) {
      const { p25_per_sqft, p75_per_sqft } = parcelData.stats
      const range = p75_per_sqft - p25_per_sqft || 1

      result.push(
        new ColumnLayer({
          id: 'nyc-parcels',
          data: parcelData.parcels,
          diskResolution: 6, // hexagonal columns
          radius: 12,
          extruded: true,
          getPosition: (d) => [d.lng, d.lat],
          getElevation: (d) => {
            // Height = assessed value per sqft, scaled to visible range (5m - 200m)
            const t = Math.min(Math.max((d.assessed_per_sqft - p25_per_sqft) / range, 0), 1)
            return 5 + t * 195
          },
          getFillColor: (d) => {
            // Color by land use
            const lu = d.land_use ?? '0'
            if (lu === '1' || lu === '2') return [100, 180, 255, 220]  // residential — blue
            if (lu === '3') return [60, 140, 255, 220]                  // multi-family elevator — deeper blue
            if (lu === '4') return [255, 200, 80, 220]                  // mixed use — gold
            if (lu === '5') return [255, 120, 50, 220]                  // commercial — orange
            if (lu === '6') return [160, 160, 180, 220]                 // industrial — grey
            return [180, 160, 120, 220]                                 // other — tan
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
    if (layers.tracts && tractData) {
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
    if (layers.amenityHeatmap && amenityPoints.length > 0) {
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
    if (layers.floodRisk && floodData) {
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

    return result
  }, [primaryBoundary, neighborBoundaries, transitStops, blockGroupData, buildingData, parcelData, tractData, amenityPoints, floodData, layers, colorScale, primaryMetricValue, activeMetric, zip, setTooltipStable])

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
          disableDefaultUI={false}
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          <MapFitter boundary={primaryBoundary} zip={zip} />
          <TiltController tilt={tilt} heading={heading} />
          <CameraSampler enabled={layers.buildings} onSample={handleCameraSample} />
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
          { key: 'blockGroups' as const, label: 'Block Groups' },
          { key: 'buildings' as const, label: '3D Buildings' },
          { key: 'parcels' as const, label: '🏙 NYC Parcels' },
          { key: 'tracts' as const, label: 'Census Tracts' },
          { key: 'amenityHeatmap' as const, label: '🔥 Amenity Heatmap' },
          { key: 'floodRisk' as const, label: '⚠️ Flood Risk' },
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
        <div className="mt-3 border-t border-zinc-700 pt-2">
          <p className="text-zinc-400 text-xs mb-2">Map Tilt</p>
          <input
            type="range" min={0} max={67.5} step={1} value={tilt}
            onChange={(e) => setTilt(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-zinc-600 text-xs mt-0.5">
            <span>0°</span><span>{tilt}°</span><span>67.5°</span>
          </div>
          <p className="text-zinc-400 text-xs mt-2 mb-1">Rotation</p>
          <input
            type="range" min={0} max={360} step={1} value={heading}
            onChange={(e) => setHeading(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-zinc-600 text-xs mt-0.5">
            <span>N</span><span>{heading}°</span>
            <button onClick={() => { setTilt(0); setHeading(0) }} className="text-zinc-500 hover:text-white text-xs">Reset</button>
          </div>
        </div>
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

const MemoizedCommandMap = memo(CommandMap)
MemoizedCommandMap.displayName = 'CommandMap'

export default MemoizedCommandMap
