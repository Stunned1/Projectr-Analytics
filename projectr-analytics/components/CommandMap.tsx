'use client'

import type { MutableRefObject } from 'react'
import { memo, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { GeoJsonLayer, ScatterplotLayer, ColumnLayer, PathLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import type { GeoJSON, Feature, FeatureCollection, Geometry } from 'geojson'
import { Layers } from 'lucide-react'
import { dedupedFetchJson } from '@/lib/request-cache'
import type { Site } from '@/lib/sites-store'
import type { AnalysisSite } from '@/lib/agent-types'
import { detectNycBoroughFromZips, isNycZip } from '@/lib/geography'
import { fetchMomentumScores, normalizeMomentumZipList } from '@/lib/momentum-client'
import { cn } from '@/lib/utils'

function shortlistPinColor(stage: string | undefined): [number, number, number, number] {
  if (stage === 'Expansion') return [34, 197, 94, 255]
  if (stage === 'Recovery') return [245, 158, 11, 255]
  return [239, 68, 68, 255]
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarketData {
  zip: string
  geo?: { lat: number; lng: number; city: string; state: string; stateFips?: string; countyFips?: string }
  zillow: { zori_latest: number | null; zhvi_latest: number | null } | null
}

interface TransitStop {
  position: [number, number]
  name: string
  stopType: string
}

interface TransitRoute {
  id: string
  name: string
  long_name?: string
  type: string
  route_type?: number
  color?: [number, number, number]
  paths?: [number, number][][]
  /** Legacy OSM `/api/transit` fallback (singular) — prefer `paths` */
  path?: [number, number][]
}

interface TransitData {
  zip: string
  stop_count?: number
  routes?: TransitRoute[]
  geojson: {
    features: Array<{
      geometry: { coordinates: [number, number] }
      properties: { stop_name: string; stop_type?: string }
    }>
    routes?: TransitRoute[]
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

interface POIPoint {
  id: string
  position: [number, number]
  name: string
  category: string
  group: string
  isAnchor: boolean
  address: string
  color: [number, number, number]
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

export interface LayerState {
  zipBoundary: boolean
  transitStops: boolean
  rentChoropleth: boolean
  blockGroups: boolean  // kept for PDF report compatibility, not shown in UI
  parcels: boolean
  tracts: boolean
  amenityHeatmap: boolean
  floodRisk: boolean
  nycPermits: boolean
  pois: boolean
  momentum: boolean
  clientData: boolean
}

interface KeyedValue<T> {
  key: string | null
  value: T
}

const DEFAULT_LAYER_STATE: LayerState = {
  zipBoundary: true,
  transitStops: true,
  rentChoropleth: true,
  blockGroups: false,
  parcels: false,
  tracts: false,
  amenityHeatmap: false,
  floodRisk: false,
  nycPermits: false,
  pois: false,
  momentum: false,
  clientData: true,
}

/** Pill colors - reused for collapsed layer “active” dot stack (CommandMap chrome). */
const LAYER_DOT_INDICATORS: Array<{
  key: keyof LayerState
  color: string
  label: string
  needsClientMarkers?: boolean
}> = [
  { key: 'zipBoundary', color: '#a1a1aa', label: 'ZIP boundaries' },
  { key: 'transitStops', color: '#38bdf8', label: 'Transit' },
  { key: 'rentChoropleth', color: '#a78bfa', label: 'Rent/value fill' },
  { key: 'parcels', color: '#fbbf24', label: 'Parcels' },
  { key: 'tracts', color: '#2dd4bf', label: 'Tracts' },
  { key: 'amenityHeatmap', color: '#facc15', label: 'Amenity' },
  { key: 'floodRisk', color: '#f87171', label: 'Flood' },
  { key: 'nycPermits', color: '#D76B3D', label: 'Permits' },
  { key: 'pois', color: '#f59e0b', label: 'POIs' },
  { key: 'momentum', color: '#d946ef', label: 'Momentum' },
  { key: 'clientData', color: '#D76B3D', label: 'Client markers', needsClientMarkers: true },
]

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
  lot_area: number
  built_far: number
  max_allowed_far: number
  air_rights_sqft: number
  far_utilization: number | null
  zone_dist: string | null
  bldg_class: string | null
  units_res: number
  units_total: number
  year_built: number | null
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
  stats?: { p25_per_sqft: number; p75_per_sqft: number; p75_air_rights: number; max_air_rights: number; underbuilt_count: number; top_underbuilt: unknown[] }
}

function hasFeatures(value: unknown): value is { features: unknown[] } {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as { features?: unknown[] }).features)
}

const BOROUGH_TRACT_FIPS: Record<string, { state: string; county: string }> = {
  manhattan: { state: '36', county: '061' },
  bronx: { state: '36', county: '005' },
  brooklyn: { state: '36', county: '047' },
  queens: { state: '36', county: '081' },
  'staten island': { state: '36', county: '085' },
}

function buildPermitHeatPoints(permits: PermitPayload[]): PermitHeatPoint[] {
  return permits.map((permit) => ({
    position: [permit.lng, permit.lat] as [number, number],
    weight: permit.job_type === 'NB' ? 3 : permit.job_type === 'A1' ? 2 : 1,
  }))
}

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

// ── Map fitter - fits to boundary polygon on zip change ───────────────────────

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

/** When the user has not loaded a ZIP or city list yet, fit the map to client CSV pins (common: boot → upload → map). */
function UploadedMarkersFitter({
  markers,
  active,
}: {
  markers: Array<{ lat: number; lng: number }> | null | undefined
  active: boolean
}) {
  const map = useMap()
  const lastSig = useRef<string>('')

  useEffect(() => {
    if (!active) {
      lastSig.current = ''
      return
    }
    if (!map || !markers?.length) return

    const sig = markers.map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).join('|')
    if (sig === lastSig.current) return
    lastSig.current = sig

    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng })
      map.setZoom(12)
      return
    }

    let minLat = markers[0].lat
    let maxLat = markers[0].lat
    let minLng = markers[0].lng
    let maxLng = markers[0].lng
    for (let i = 1; i < markers.length; i++) {
      const m = markers[i]
      minLat = Math.min(minLat, m.lat)
      maxLat = Math.max(maxLat, m.lat)
      minLng = Math.min(minLng, m.lng)
      maxLng = Math.max(maxLng, m.lng)
    }
    if (minLat === maxLat && minLng === maxLng) {
      map.setCenter({ lat: minLat, lng: minLng })
      map.setZoom(12)
      return
    }

    const bounds = new google.maps.LatLngBounds(
      { lat: minLat, lng: minLng },
      { lat: maxLat, lng: maxLng }
    )
    map.fitBounds(bounds, 56)
  }, [map, active, markers])

  return null
}

// ── DeckGL overlay ────────────────────────────────────────────────────────────

function DeckGlOverlay({ layers }: { layers: Layer[] }) {
  /** Vector Map ID: interleaved mode avoids `getViewports()[0]` being undefined during Maps’ WebGL draw. */
  const deck = useMemo(() => new GoogleMapsOverlay({ interleaved: true }), [])
  const map = useMap()
  const attachedMapRef = useRef<google.maps.Map | null>(null)

  useEffect(() => {
    if (!map) return
    let cancelled = false
    const attach = () => {
      if (cancelled || attachedMapRef.current === map) return
      try {
        if (attachedMapRef.current && attachedMapRef.current !== map) {
          deck.setMap(null)
        }
        deck.setMap(map)
        attachedMapRef.current = map
      } catch {
        /* map not ready */
      }
    }
    // First `idle` is more reliable than a fixed delay for vector maps + deck interleaved attach
    const once = google.maps.event.addListenerOnce(map, 'idle', attach)
    const fallback = window.setTimeout(attach, 400)
    return () => {
      cancelled = true
      google.maps.event.removeListener(once)
      window.clearTimeout(fallback)
    }
  }, [map, deck])

  useEffect(() => {
    if (!map) return
    try {
      deck.setProps({ layers })
    } catch {
      /* ignore */
    }
  }, [layers, deck, map])

  useEffect(() => {
    return () => {
      try {
        deck.setMap(null)
        attachedMapRef.current = null
      } catch {
        /* ignore */
      }
    }
  }, [deck])

  return null
}

// ── Zoom + bounds tracker ─────────────────────────────────────────────────────

function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const update = () => { onZoomChange(map.getZoom() ?? 11) }
    const zoomListener = map.addListener('zoom_changed', update)
    update()
    return () => { google.maps.event.removeListener(zoomListener) }
  }, [map, onZoomChange])
  return null
}

// ── Tilt controller ───────────────────────────────────────────────────────────

// ── Fly-to controller - eased camera flight when agentFlyTo changes ────────────
// Vector maps: use moveCamera({ center, zoom, tilt, heading }) each frame (Google’s
// recommended pattern). Avoid lastTarget “dedupe” - it breaks React Strict Mode
// (first effect cleanup cancels RAF; second run would bail and never fly).

const FLY_DURATION_MS = 1600

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

type MapWithMoveCamera = google.maps.Map & {
  moveCamera?: (cameraOptions: google.maps.CameraOptions) => void
}

function applyCameraFrame(
  map: google.maps.Map,
  center: google.maps.LatLngLiteral,
  zoom: number,
  tilt: number,
  heading: number
): void {
  const m = map as MapWithMoveCamera
  if (typeof m.moveCamera === 'function') {
    m.moveCamera({ center, zoom, tilt, heading })
  } else {
    map.setCenter(center)
    map.setZoom(zoom)
    map.setTilt(tilt)
    map.setHeading(heading)
  }
}

/** Latest map camera for `/save` map bookmarks (updated on `idle`). */
export type MapViewportSnapshot = { lat: number; lng: number; zoom: number }

function MapViewportSync({ viewportRef }: { viewportRef: MutableRefObject<MapViewportSnapshot | null> }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const sync = () => {
      const c = map.getCenter()
      const z = map.getZoom()
      if (!c || z == null) return
      viewportRef.current = { lat: c.lat(), lng: c.lng(), zoom: z }
    }
    sync()
    const idleListener = map.addListener('idle', sync)
    return () => {
      google.maps.event.removeListener(idleListener)
    }
  }, [map, viewportRef])
  return null
}

function FlyToController({ target }: { target: { lat: number; lng: number } | null | undefined }) {
  const map = useMap()
  const rafRef = useRef<number | null>(null)

  const lat = target?.lat
  const lng = target?.lng

  useEffect(() => {
    if (!map || lat == null || lng == null) return

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const startCenter = map.getCenter()
    const startZoom = map.getZoom() ?? 11
    if (!startCenter) return

    const endLat = lat
    const endLng = lng
    const endZoom = 17
    const startLat = startCenter.lat()
    const startLng = startCenter.lng()
    const tilt = map.getTilt() ?? 0
    const heading = map.getHeading() ?? 0

    const startTime = performance.now()
    let cancelled = false

    const tick = (now: number) => {
      if (cancelled) return
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / FLY_DURATION_MS)
      const e = easeInOutCubic(t)

      const clat = startLat + (endLat - startLat) * e
      const clng = startLng + (endLng - startLng) * e
      const zoom = startZoom + (endZoom - startZoom) * e

      applyCameraFrame(map, { lat: clat, lng: clng }, zoom, tilt, heading)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
        applyCameraFrame(map, { lat: endLat, lng: endLng }, endZoom, tilt, heading)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [map, lat, lng])

  return null
}

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
  /** Saved analyst shortlist - always drawn while browsing other ZIPs. */
  shortlistSites?: Site[]
  /** Analysis result sites from agent spatial model - glowing pins */
  analysisSites?: AnalysisSite[]
  /** Agent-controlled permit type filter */
  agentPermitFilter?: string[] | null
  agentLayerOverrides?: Record<string, boolean>
  agentMetric?: 'zori' | 'zhvi' | null
  agentFlyTo?: { lat: number; lng: number } | null
  /** Fired when toggles or agent overrides change - used for PDF export layer legend. */
  onLayersChange?: (snapshot: LayerState & { choroplethMetric: 'zori' | 'zhvi' }) => void
  /** Fired when user manually toggles a layer - clears agent override for that key */
  onClearAgentOverride?: (key: string) => void
  /** When `id` increments, replaces internal layer toggles (keeps parent overrides in sync after `/clear:layers`). */
  layerStateResync?: { id: number; state: LayerState } | null
  /** Map camera tilt (0–67.5) — controlled from parent / 3D control on the map. */
  mapTilt: number
  /** Map camera heading (degrees). */
  mapHeading?: number
  /** 45° perspective toggle (stacked with layer control, top-left). */
  map3DActive: boolean
  onToggleMap3D: () => void
  /** When set, updated on map idle for `/save` without a loaded market. */
  mapViewportRef?: MutableRefObject<MapViewportSnapshot | null>
}

function CommandMap({
  zip,
  marketData,
  transitData,
  cityZips,
  boroughBoundary,
  uploadedMarkers,
  shortlistSites = [],
  analysisSites = [],
  agentPermitFilter,
  agentLayerOverrides,
  agentMetric,
  agentFlyTo,
  onLayersChange,
  onClearAgentOverride,
  layerStateResync,
  mapTilt,
  mapHeading = 0,
  map3DActive,
  onToggleMap3D,
  mapViewportRef,
}: CommandMapProps) {
  const perfDebug = process.env.NEXT_PUBLIC_PERF_DEBUG === '1'

  const [primaryBoundaryState, setPrimaryBoundaryState] = useState<KeyedValue<GeoJSON | null>>({ key: null, value: null })
  const [neighborBoundariesState, setNeighborBoundariesState] = useState<KeyedValue<ZipBoundary[]>>({ key: null, value: [] })
  const [cityBoundariesState, setCityBoundariesState] = useState<KeyedValue<ZipBoundary[]>>({ key: null, value: [] })
  const [parcelData, setParcelData] = useState<{ parcels: ParcelPayload[]; stats: { p25_per_sqft: number; p75_per_sqft: number; p75_air_rights: number; max_air_rights: number; underbuilt_count: number; top_underbuilt: unknown[] } } | null>(null)
  const [tractData, setTractData] = useState<TractCollection | null>(null)
  const [amenityPoints, setAmenityPoints] = useState<AmenityPoint[]>([])
  const [poiPoints, setPoiPoints] = useState<POIPoint[]>([])
  const [momentumScores, setMomentumScores] = useState<Record<string, number>>({})
  const [floodData, setFloodData] = useState<FloodCollection | null>(null)
  const [nycPermitData, setNycPermitData] = useState<PermitPayload[]>([])
  const [permitHeatPoints, setPermitHeatPoints] = useState<PermitHeatPoint[]>([])
  // Multi-select type filter - Set of active types, empty = all
  const [permitTypeFilter, setPermitTypeFilter] = useState<Set<string>>(new Set())
  const [mapZoom, setMapZoom] = useState(11)
  const handleZoomChange = useCallback((zoom: number) => { setMapZoom(zoom) }, [])
  const fitClientMarkersOnly =
    !zip &&
    !(cityZips && cityZips.length > 0) &&
    (uploadedMarkers?.length ?? 0) > 0
  const [selectedPermit, setSelectedPermit] = useState<PermitPayload | null>(null)
  const [layerStateSnapshot, setLayerStateSnapshot] = useState<KeyedValue<LayerState>>({ key: '0', value: DEFAULT_LAYER_STATE })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [activeMetric, setActiveMetric] = useState<'zori' | 'zhvi'>('zori')
  const [parcelColorMode, setParcelColorMode] = useState<'landuse' | 'airRights'>('landuse')
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)
  const renderCounterRef = useRef(0)
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID ?? undefined
  const detectedNycBorough = useMemo(() => detectNycBoroughFromZips(cityZips), [cityZips])
  const nycFeatureAvailable = detectedNycBorough !== null || isNycZip(marketData?.zip ?? zip ?? null)
  const cityBoundaryKey = useMemo(
    () => (cityZips?.length ? cityZips.map((z) => z.zip).join(',') : null),
    [cityZips]
  )
  const zipBoundaryKey = cityBoundaryKey ? null : zip ?? null
  const visibleCityBoundaries = useMemo(
    () => (cityBoundaryKey && cityBoundariesState.key === cityBoundaryKey ? cityBoundariesState.value : []),
    [cityBoundariesState, cityBoundaryKey]
  )
  const visiblePrimaryBoundary = useMemo(
    () => (zipBoundaryKey && primaryBoundaryState.key === zipBoundaryKey ? primaryBoundaryState.value : null),
    [primaryBoundaryState, zipBoundaryKey]
  )
  const visibleNeighborBoundaries = useMemo(
    () => (zipBoundaryKey && neighborBoundariesState.key === zipBoundaryKey ? neighborBoundariesState.value : []),
    [neighborBoundariesState, zipBoundaryKey]
  )
  const localLayers =
    layerStateResync && layerStateResync.id.toString() !== layerStateSnapshot.key
      ? layerStateResync.state
      : layerStateSnapshot.value
  const effectiveLayers = useMemo((): LayerState => {
    const merged = { ...localLayers, ...agentLayerOverrides } as LayerState & { permits?: boolean }
    if (agentLayerOverrides && Object.prototype.hasOwnProperty.call(agentLayerOverrides, 'permits')) {
      merged.nycPermits = Boolean(agentLayerOverrides.permits)
    }
    if (!nycFeatureAvailable) {
      merged.parcels = false
      merged.nycPermits = false
    }
    delete merged.permits
    return merged as LayerState
  }, [localLayers, agentLayerOverrides, nycFeatureAvailable])
  const momentumEnabled = Boolean(effectiveLayers.momentum)
  const momentumZips = useMemo(
    () =>
      normalizeMomentumZipList([
        ...(visibleCityBoundaries.map((boundary) => boundary.zip) ?? []),
        ...(zip ? [zip] : []),
        ...visibleNeighborBoundaries.map((boundary) => boundary.zip),
      ]),
    [visibleCityBoundaries, zip, visibleNeighborBoundaries]
  )
  const momentumZipKey = momentumZips.length > 0 ? momentumZips.join(',') : null

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

  // Fetch momentum scores when layer is toggled on and we have ZIPs loaded
  useEffect(() => {
    if (!momentumEnabled || !momentumZipKey) return

    let cancelled = false
    const activeMomentumZips = momentumZipKey.split(',')
    fetchMomentumScores(activeMomentumZips, { limit: activeMomentumZips.length })
      .then((response) => {
        const scoreMap: Record<string, number> = {}
        for (const row of response.scores) {
          scoreMap[row.zip] = row.score
        }
        return scoreMap
      })
      .catch(() => ({}))
      .then((scoreMap: Record<string, number>) => {
      if (!cancelled) setMomentumScores(scoreMap)
    })

    return () => {
      cancelled = true
    }
  }, [momentumEnabled, momentumZipKey])

  // Fetch city ZIP boundaries when city search is performed
  useEffect(() => {
    if (!cityZips?.length || !cityBoundaryKey) return
    let cancelled = false

    // Fetch boundaries for all city ZIPs in parallel (limit 30)
    const sample = cityZips.filter((z) => z.lat && z.lng).slice(0, 30)
    Promise.allSettled(
      sample.map((z) =>
        dedupedFetchJson<GeoJSON>('/api/boundaries?zip=' + z.zip)
          .then((geojson) => ({ zip: z.zip, geojson, zori: z.zori_latest, zhvi: z.zhvi_latest }))
      )
    ).then((results) => {
      if (cancelled) return
      const loaded: ZipBoundary[] = results
        .filter((r): r is PromiseFulfilledResult<ZipBoundary> => r.status === 'fulfilled' && hasFeatures(r.value.geojson) && r.value.geojson.features.length > 0)
        .map((r) => r.value)
      setCityBoundariesState({ key: cityBoundaryKey, value: loaded })
    })
    return () => {
      cancelled = true
    }
  }, [cityZips, cityBoundaryKey])

  useEffect(() => {
    if (!cityZips?.length || !detectedNycBorough) return
    let cancelled = false

    if (effectiveLayers.parcels) {
      dedupedFetchJson<ParcelResponse>(`/api/parcels?borough=${encodeURIComponent(detectedNycBorough)}`)
        .then((d) => {
          if (!cancelled && Array.isArray(d.parcels) && d.stats) {
            setParcelData({ parcels: d.parcels, stats: d.stats })
          }
        })
        .catch(() => {})
    }

    if (effectiveLayers.nycPermits) {
      dedupedFetchJson<PermitResponse>(`/api/permits?borough=${encodeURIComponent(detectedNycBorough.toUpperCase())}&zoom=14`)
        .then((d) => {
          if (!cancelled && d.permits) {
            setNycPermitData(d.permits)
            setPermitHeatPoints(buildPermitHeatPoints(d.permits))
          }
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [cityZips, detectedNycBorough, effectiveLayers.nycPermits, effectiveLayers.parcels])

  useEffect(() => {
    if (!cityZips?.length) return
    let cancelled = false

    if (effectiveLayers.tracts && detectedNycBorough && BOROUGH_TRACT_FIPS[detectedNycBorough]) {
      const { state, county } = BOROUGH_TRACT_FIPS[detectedNycBorough]
      dedupedFetchJson<TractCollection>(`/api/tracts?state=${state}&county=${county}`)
        .then((d) => {
          if (!cancelled && d.features) setTractData(d)
        })
        .catch(() => {})
    }

    const first = cityZips.find((z) => z.lat && z.lng)
    if (first?.lat && first?.lng) {
      const { lat: cLat, lng: cLng } = first
      if (effectiveLayers.amenityHeatmap) {
        dedupedFetchJson<{ points?: AmenityPoint[] }>(`/api/amenities?lat=${cLat}&lng=${cLng}&radius=0.12`)
          .then((d) => {
            if (!cancelled && d.points) setAmenityPoints(d.points)
          })
          .catch(() => {})
      }
      if (effectiveLayers.pois) {
        dedupedFetchJson<{ points?: POIPoint[] }>(`/api/pois?lat=${cLat}&lng=${cLng}&radius=3000`)
          .then((d) => {
            if (!cancelled && d.points) setPoiPoints(d.points)
          })
          .catch(() => {})
      }
      if (effectiveLayers.floodRisk) {
        dedupedFetchJson<FloodCollection>(`/api/floodrisk?lat=${cLat}&lng=${cLng}&radius=0.12`)
          .then((d) => {
            if (!cancelled && d.features) setFloodData(d)
          })
          .catch(() => {})
      }
    }

    return () => {
      cancelled = true
    }
  }, [cityZips, detectedNycBorough, effectiveLayers.amenityHeatmap, effectiveLayers.floodRisk, effectiveLayers.pois, effectiveLayers.tracts])

  // Fetch primary boundary + transit + neighbors when zip changes
  useEffect(() => {
    if (!zip || !zipBoundaryKey) return
    let cancelled = false

    // Primary boundary
    dedupedFetchJson<GeoJSON>('/api/boundaries?zip=' + zip)
      .then((d) => {
        if (cancelled) return
        setPrimaryBoundaryState({ key: zipBoundaryKey, value: hasFeatures(d) ? d : null })
      })
      .catch(() => {})
    dedupedFetchJson<{ zips?: NeighborZip[] }>('/api/neighbors?zip=' + zip)
      .then(async (d) => {
        const neighbors: NeighborZip[] = d.zips ?? []
        if (!neighbors.length || cancelled) {
          setNeighborBoundariesState({ key: zipBoundaryKey, value: [] })
          return
        }

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
        if (!cancelled) {
          setNeighborBoundariesState({ key: zipBoundaryKey, value: loaded })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [zip, zipBoundaryKey])

  // Fetch NYC-only parcel + permit layers for single-ZIP NYC workflows.
  useEffect(() => {
    if (!marketData?.geo) return

    const activeZip = marketData?.zip ?? null

    if (activeZip && isNycZip(activeZip)) {
      if (effectiveLayers.parcels) {
        dedupedFetchJson<ParcelResponse>(`/api/parcels?zip=${marketData.zip}`)
          .then((d) => {
            if (Array.isArray(d.parcels) && d.stats) {
              setParcelData({ parcels: d.parcels, stats: d.stats })
            }
          })
          .catch(() => {})
      }

      if (effectiveLayers.nycPermits) {
        dedupedFetchJson<PermitResponse>(`/api/permits?zip=${marketData.zip}&zoom=14`)
          .then((d) => {
            if (d.permits) {
              setNycPermitData(d.permits)
              setPermitHeatPoints(buildPermitHeatPoints(d.permits))
            }
          })
          .catch(() => {})
      }
    }
  }, [marketData, effectiveLayers.nycPermits, effectiveLayers.parcels])

  // Fetch shared tract / amenity / flood / POI context for single-ZIP flows.
  useEffect(() => {
    if (!marketData?.geo) return
    const { lat, lng, stateFips, countyFips } = marketData.geo

    if (effectiveLayers.tracts && stateFips && countyFips && countyFips !== '000') {
      dedupedFetchJson<TractCollection>(`/api/tracts?state=${stateFips}&county=${countyFips}`)
        .then((d: TractCollection) => { if (d.features) setTractData(d) })
        .catch(() => {})
    }

    if (effectiveLayers.amenityHeatmap) {
      dedupedFetchJson<{ points?: AmenityPoint[] }>(`/api/amenities?lat=${lat}&lng=${lng}&radius=0.06`)
        .then((d) => { if (d.points) setAmenityPoints(d.points) })
        .catch(() => {})
    }

    if (effectiveLayers.pois) {
      dedupedFetchJson<{ points?: POIPoint[] }>(`/api/pois?lat=${lat}&lng=${lng}&radius=1500`)
        .then((d) => { if (d.points) setPoiPoints(d.points) })
        .catch(() => {})
    }

    if (effectiveLayers.floodRisk) {
      dedupedFetchJson<FloodCollection>(`/api/floodrisk?lat=${lat}&lng=${lng}&radius=0.05`)
        .then((d) => { if (d.features) setFloodData(d) })
        .catch(() => {})
    }
  }, [marketData, effectiveLayers.amenityHeatmap, effectiveLayers.floodRisk, effectiveLayers.pois, effectiveLayers.tracts])

  const transitStops = useMemo(() => {
    if (!transitData?.geojson?.features) return []
    return transitData.geojson.features.map((f) => ({
      position: f.geometry.coordinates as [number, number],
      name: f.properties.stop_name,
      stopType: f.properties.stop_type ?? 'bus',
    }))
  }, [transitData])

  const transitRoutes = useMemo(() => {
    if (!transitData) return []
    const raw = transitData.routes ?? transitData.geojson?.routes ?? []
    /** Normalize Transitland (`paths`) vs legacy OSM (`path`) so PathLayer always gets segments. */
    return raw.map((r) => {
      const fromPaths = Array.isArray(r.paths)
        ? r.paths.filter((p) => Array.isArray(p) && p.length >= 2)
        : []
      const paths =
        fromPaths.length > 0
          ? fromPaths
          : r.path && r.path.length >= 2
            ? [r.path]
            : []
      return { ...r, paths }
    })
  }, [transitData])

  // Agent can override the active metric
  const effectiveMetric = agentMetric ?? activeMetric

  useEffect(() => {
    if (!onLayersChange) return
    onLayersChange({
      ...effectiveLayers,
      choroplethMetric: effectiveMetric,
    })
  }, [effectiveLayers, effectiveMetric, onLayersChange])

  const allMetricValues = useMemo(() => {
    const primaryValue = effectiveMetric === 'zhvi'
      ? marketData?.zillow?.zhvi_latest ?? null
      : marketData?.zillow?.zori_latest ?? null
    const vals: (number | null)[] = [primaryValue]
    visibleNeighborBoundaries.forEach((n) => vals.push(effectiveMetric === 'zhvi' ? n.zhvi : n.zori))
    visibleCityBoundaries.forEach((n) => vals.push(effectiveMetric === 'zhvi' ? n.zhvi : n.zori))
    return vals
  }, [effectiveMetric, marketData, visibleNeighborBoundaries, visibleCityBoundaries])

  const colorScale = useMemo(() => buildColorScale(allMetricValues), [allMetricValues])

  const primaryMetricValue = effectiveMetric === 'zhvi'
    ? marketData?.zillow?.zhvi_latest ?? null
    : marketData?.zillow?.zori_latest ?? null

  const deckLayers = useMemo(() => {
    const result: Layer[] = []

    // City ZIP boundaries (rendered first when in city mode)
    if (effectiveLayers.zipBoundary && visibleCityBoundaries.length > 0) {
      visibleCityBoundaries.forEach((n) => {
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

    // Borough boundary outline — show as soon as `/api/borough` returns (do not wait on per-ZIP boundary fetches)
    if (boroughBoundary) {
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

    // Momentum choropleth - overlays ZIP boundaries with score-based color
    if (effectiveLayers.momentum && Object.keys(momentumScores).length > 0) {
      const allBoundaries = [
        ...(visiblePrimaryBoundary ? [{ zip: zip ?? '', geojson: visiblePrimaryBoundary }] : []),
        ...visibleNeighborBoundaries.map((n) => ({ zip: n.zip, geojson: n.geojson })),
        ...visibleCityBoundaries.map((n) => ({ zip: n.zip, geojson: n.geojson })),
      ]
      allBoundaries.forEach(({ zip: z, geojson }) => {
        const score = momentumScores[z] ?? null
        if (!geojson) return
        result.push(
          new GeoJsonLayer({
            id: `momentum-${z}`,
            data: geojson,
            stroked: true,
            filled: true,
            getFillColor: () => {
              if (score === null) return [80, 80, 100, 40]
              const t = score / 100
              return [Math.round(80 + t * 135), Math.round(40 + t * 67), Math.round(160 - t * 99), 150]
            },
            getLineColor: () => {
              if (score === null) return [100, 100, 120, 80]
              const t = score / 100
              return [Math.round(80 + t * 135), Math.round(40 + t * 67), Math.round(160 - t * 99), 220]
            },
            lineWidthMinPixels: 2,
            pickable: true,
            onHover: (info: PickingInfo) => {
              if (info.object) {
                const label = score === null ? 'No data'
                  : score >= 65 ? `Strong (${score})`
                  : score >= 35 ? `Moderate (${score})`
                  : `Weak (${score})`
                setTooltipStable({ x: info.x, y: info.y, text: `ZIP ${z} · Momentum: ${label}` })
              } else setTooltipStable(null)
            },
          })
        )
      })
    }

    // Neighbor ZIP boundaries (rendered first, behind primary)
    if (effectiveLayers.zipBoundary && visibleNeighborBoundaries.length > 0) {
      visibleNeighborBoundaries.forEach((n) => {
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
    // When block groups are active, show outline only - block groups provide the color
    if (effectiveLayers.zipBoundary && visiblePrimaryBoundary) {
      result.push(
        new GeoJsonLayer({
          id: 'zip-primary',
          data: visiblePrimaryBoundary,
          stroked: true,
          filled: true,
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

    // Transit routes - PathLayer for subway/rail/bus lines with brand colors
    if (effectiveLayers.transitStops && transitRoutes.length > 0) {
      const segments = transitRoutes.flatMap((r: TransitRoute) =>
        (r.paths ?? []).map((path: [number, number][]) => ({ path, route: r }))
      )

      const MAX_TRANSIT_PATH_SEGMENTS = 400
      if (segments.length > MAX_TRANSIT_PATH_SEGMENTS) {
        segments.sort((a, b) => b.path.length - a.path.length)
        segments.length = MAX_TRANSIT_PATH_SEGMENTS
      }

      if (segments.length > 0) {
        result.push(
          new PathLayer({
            id: 'transit-routes',
            data: segments,
            getPath: (d) => d.path,
            getColor: (d) => {
              const c = d.route.color
              if (c) return [...c, 220] as [number, number, number, number]
              // fallback by type
              switch (d.route.type) {
                case 'subway': return [250, 200, 50, 220]
                case 'rail':   return [160, 220, 255, 200]
                case 'tram':   return [180, 255, 180, 200]
                case 'ferry':  return [100, 200, 255, 200]
                default:       return [180, 180, 220, 140]
              }
            },
            getWidth: (d) => {
              switch (d.route.type) {
                case 'subway': return 5
                case 'rail':   return 4
                case 'bus':    return 2
                default:       return 3
              }
            },
            widthUnits: 'pixels',
            widthMinPixels: 1,
            pickable: true,
            onHover: (info: PickingInfo) => {
              const d = info.object as typeof segments[0] | undefined
              if (d) setTooltipStable({ x: info.x, y: info.y, text: `${d.route.type.charAt(0).toUpperCase() + d.route.type.slice(1)} ${d.route.name}${d.route.long_name ? ' · ' + d.route.long_name : ''}` })
              else setTooltipStable(null)
            },
          })
        )
      }
    }

    // Transit stops - colored by type
    if (effectiveLayers.transitStops && transitStops.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: 'transit-stops',
          data: transitStops as TransitStop[],
          getPosition: (d) => d.position,
          getRadius: (d) => d.stopType === 'subway' || d.stopType === 'rail' ? 6 : 4,
          getFillColor: (d) => {
            switch (d.stopType) {
              case 'subway': return [250, 200, 50, 240]
              case 'rail':   return [160, 220, 255, 230]
              case 'tram':   return [180, 255, 180, 220]
              case 'ferry':  return [100, 200, 255, 220]
              default:       return [200, 200, 220, 200]
            }
          },
          getLineColor: [0, 0, 0, 80],
          lineWidthMinPixels: 1,
          stroked: true,
          radiusUnits: 'pixels',
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as typeof transitStops[0] | undefined
            if (d) setTooltipStable({ x: info.x, y: info.y, text: d.name })
            else setTooltipStable(null)
          },
        })
      )
    }


    // NYC PLUTO parcels - ColumnLayer (3D columns sized by assessed value, color = land use or air rights)
    if (effectiveLayers.parcels && parcelData?.parcels?.length) {
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
            if (parcelColorMode === 'airRights') {
              const maxAR = parcelData.stats.p75_air_rights || parcelData.stats.max_air_rights || 50000
              const t = Math.min(d.air_rights_sqft / maxAR, 1)
              if (d.max_allowed_far === 0) return [100, 100, 120, 160]
              return [Math.round(60 + t * 195), Math.round(200 - t * 160), Math.round(60 * (1 - t)), 220]
            }
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
            const d = info.object as ParcelPayload | undefined
            if (d) {
              const farInfo = d.max_allowed_far > 0
                ? ` · FAR ${d.built_far.toFixed(1)}/${d.max_allowed_far.toFixed(1)}`
                : ''
              setTooltipStable({ x: info.x, y: info.y, text: `${d.address} · ${d.land_use_label}${farInfo}` })
            } else setTooltipStable(null)
          },
        })
      )
    }

    // Census Tracts - rent/income choropleth (replaces block groups as primary sub-ZIP layer)
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

    // Amenity Heatmap - weighted by amenity type (transit > commercial > retail)
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

    // NYC Permits - zoom-adaptive: heatmap below zoom 15, 3D ColumnLayer at zoom ≥ 15
    // All filtering is client-side - no API calls on zoom/pan
    if (effectiveLayers.nycPermits) {
      // Merge agent permit filter with user toggle filter
      const agentFilterSet = agentPermitFilter ? new Set(agentPermitFilter) : null
      const activeTypes = agentFilterSet ?? (permitTypeFilter.size === 0 ? null : permitTypeFilter)

      if (mapZoom < 15) {
        // Heatmap - filter by type client-side
        const heatData = activeTypes
          ? permitHeatPoints.filter((_, i) => {
              const p = nycPermitData[i]
              return p ? activeTypes.has(p.job_type ?? '') : true
            })
          : permitHeatPoints

        if (heatData.length > 0) {
          result.push(
            new HeatmapLayer({
              id: 'permit-heatmap',
              data: heatData,
              getPosition: (d: PermitHeatPoint) => d.position,
              getWeight: (d: PermitHeatPoint) => d.weight,
              radiusPixels: 40,
              intensity: 2.5,
              threshold: 0.04,
              colorRange: [
                [20, 8, 2, 0],
                [90, 35, 10, 100],
                [160, 65, 20, 170],
                [215, 107, 61, 210],
                [240, 155, 70, 230],
                [255, 215, 130, 250],
              ],
            })
          )
        }
      } else {
        // 3D ColumnLayer - filter by active types
        const filtered = activeTypes
          ? nycPermitData.filter((p) => activeTypes.has(p.job_type ?? ''))
          : nycPermitData

        if (filtered.length > 0) {
          result.push(
            new ColumnLayer({
              id: 'nyc-permits-3d',
              data: filtered,
              diskResolution: 6,
              radius: 6,
              extruded: true,
              getPosition: (d: PermitPayload) => [d.lng, d.lat],
              getElevation: (d: PermitPayload) => {
                const cost = Math.max(d.initial_cost ?? 0, 1)
                const logVal = Math.log10(cost)
                // log scale: $100k → ~20m, $1M → ~80m, $50M → ~250m
                const t = Math.min(Math.max((logVal - 5) / 3.5, 0), 1)
                return 15 + t * 280
              },
              getFillColor: (d: PermitPayload) => {
                switch (d.job_type) {
                  case 'NB': return [215, 107, 61, 240]   // orange - new building
                  case 'A1': return [100, 180, 255, 220]  // blue - major alteration
                  case 'DM': return [220, 80, 80, 230]    // red - demolition
                  default:   return [160, 160, 160, 180]
                }
              },
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
    }

    // Overture Maps POIs - ScatterplotLayer colored by category, anchors larger
    if (effectiveLayers.pois && poiPoints.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: 'overture-pois',
          data: poiPoints,
          getPosition: (d: POIPoint) => d.position,
          getRadius: (d: POIPoint) => d.isAnchor ? 10 : 5,
          getFillColor: (d: POIPoint) => [...d.color, d.isAnchor ? 255 : 200] as [number, number, number, number],
          getLineColor: (d: POIPoint) => d.isAnchor ? [255, 255, 255, 180] as [number,number,number,number] : [0, 0, 0, 0] as [number,number,number,number],
          lineWidthMinPixels: 1,
          stroked: true,
          radiusUnits: 'pixels',
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as POIPoint | undefined
            if (d) setTooltipStable({
              x: info.x, y: info.y,
              text: `${d.isAnchor ? '★ ' : ''}${d.name}${d.address ? ' · ' + d.address : ''}`,
            })
            else setTooltipStable(null)
          },
        })
      )
    }

    // Shortlist sites (from case study workflow)
    if (shortlistSites.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: 'shortlist-sites',
          data: shortlistSites,
          getPosition: (d: Site) => [d.lng, d.lat],
          getRadius: 14,
          getFillColor: (d: Site) => shortlistPinColor(d.cycleStage),
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 2,
          stroked: true,
          radiusUnits: 'pixels',
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as Site | undefined
            if (d) {
              setTooltipStable({
                x: info.x,
                y: info.y,
                text: `Saved · ${d.label || d.marketLabel}`,
              })
            } else setTooltipStable(null)
          },
        })
      )
    }

    // Analysis result sites - glowing neon ColumnLayer pins from agent spatial model
    if (analysisSites.length > 0) {
      result.push(
        new ColumnLayer({
          id: 'analysis-sites',
          data: analysisSites,
          diskResolution: 6,
          radius: 12,
          extruded: true,
          getPosition: (d: AnalysisSite) => [d.lng, d.lat],
          getElevation: (d: AnalysisSite) => {
            const t = d.score / 100
            return 80 + t * 320
          },
          getFillColor: (d: AnalysisSite) => {
            // Neon orange gradient - brighter = higher score
            const t = d.score / 100
            return [215, Math.round(107 + t * 80), 61, 255] as [number, number, number, number]
          },
          getLineColor: [255, 220, 180, 255],
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          onHover: (info: PickingInfo) => {
            const d = info.object as AnalysisSite | undefined
            if (d) setTooltipStable({
              x: info.x, y: info.y,
              text: `★ ${d.address} · Score ${d.score.toFixed(0)} · ${(d.air_rights_sqft/1000).toFixed(0)}k sqft air rights`,
            })
            else setTooltipStable(null)
          },
        })
      )
    }

    // Uploaded client data — extruded column with few sides reads as a cone / pyramid from the map
    if (effectiveLayers.clientData && uploadedMarkers?.length) {
      const values = uploadedMarkers.map((d) => d.value ?? 0).filter((v) => v > 0)
      const maxVal = values.length ? Math.max(...values) : 1
      const minVal = values.length ? Math.min(...values) : 0

      result.push(
        new ColumnLayer({
          id: 'uploaded-markers',
          data: uploadedMarkers,
          diskResolution: 4, // square pyramid frustum (cone-like silhouette when tilted)
          radius: 22,
          extruded: true,
          getPosition: (d: { lat: number; lng: number }) => [d.lng, d.lat],
          getElevation: (d: { value: number | null }) => {
            const v = d.value ?? 0
            const t = maxVal === minVal ? 0.5 : Math.min(Math.max((v - minVal) / (maxVal - minVal), 0), 1)
            return 30 + t * 120 // 30m–150m - more subtle
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
  }, [visiblePrimaryBoundary, visibleNeighborBoundaries, visibleCityBoundaries, boroughBoundary, transitStops, transitRoutes, parcelData, parcelColorMode, tractData, amenityPoints, poiPoints, floodData, nycPermitData, permitHeatPoints, permitTypeFilter, agentPermitFilter, mapZoom, momentumScores, effectiveLayers, colorScale, primaryMetricValue, effectiveMetric, zip, setTooltipStable, uploadedMarkers, shortlistSites, analysisSites])

  const handleToggle = useCallback((key: keyof LayerState) => {
    const nextKey =
      layerStateResync && layerStateResync.id.toString() !== layerStateSnapshot.key
        ? layerStateResync.id.toString()
        : layerStateSnapshot.key
    const nextBase =
      layerStateResync && layerStateResync.id.toString() !== layerStateSnapshot.key
        ? layerStateResync.state
        : layerStateSnapshot.value
    setLayerStateSnapshot({
      key: nextKey,
      value: { ...nextBase, [key]: !effectiveLayers[key] },
    })
    onClearAgentOverride?.(key)
  }, [effectiveLayers, layerStateResync, layerStateSnapshot, onClearAgentOverride])

  useEffect(() => {
    if (typeof window === 'undefined' || !perfDebug) return
    renderCounterRef.current += 1
    console.log('[perf] CommandMap render #', renderCounterRef.current)
  })

  return (
    <div className="relative isolate h-full min-h-0 min-w-0 w-full">
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
          <MapFitter boundary={visiblePrimaryBoundary ?? (visibleCityBoundaries[0]?.geojson ?? null)} zip={zip ?? cityZips?.[0]?.zip ?? null} />
          <UploadedMarkersFitter markers={uploadedMarkers ?? null} active={fitClientMarkersOnly} />
          <TiltController tilt={mapTilt} heading={mapHeading} />
          <ZoomTracker onZoomChange={handleZoomChange} />
          <FlyToController target={agentFlyTo} />
          {mapViewportRef ? <MapViewportSync viewportRef={mapViewportRef} /> : null}
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
      {nycFeatureAvailable && effectiveLayers.nycPermits && selectedPermit && (
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

      {/* Map controls: top-left of map (adjacent to sidebar). [dots + Layers][sheet] opens toward map center. */}
      <div
        dir="ltr"
        className={cn(
          'absolute left-4 top-4 z-[60] box-border flex max-w-[calc(100%-2rem)] flex-row flex-nowrap items-start',
          layerPanelOpen ? 'gap-1' : 'gap-0'
        )}
        style={{ width: 'max-content', margin: 0 }}
      >
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="flex max-h-[min(40vh,200px)] min-h-10 min-w-[2.25rem] flex-col items-center justify-start gap-2 overflow-y-auto rounded-lg border border-border/80 bg-card/90 p-2 shadow-lg shadow-black/40 backdrop-blur-xl">
            {(() => {
              const activeDots = LAYER_DOT_INDICATORS.filter(({ key, needsClientMarkers }) => {
                if (!(effectiveLayers[key] ?? false)) return false
                if (needsClientMarkers && !uploadedMarkers?.length) return false
                return true
              })
              const shown = activeDots.slice(0, 5)
              const more = activeDots.length - shown.length
              return (
                <>
                  {shown.map(({ key, color, label }) => (
                    <button
                      key={key}
                      type="button"
                      title={`Turn off ${label}`}
                      aria-label={`Turn off ${label} layer`}
                      onClick={() => handleToggle(key)}
                      className="h-3 w-3 shrink-0 cursor-pointer rounded-full transition-transform hover:scale-125 active:scale-95"
                      style={{ background: color }}
                    />
                  ))}
                  {more > 0 && (
                    <span className="text-[8px] font-medium leading-none text-muted-foreground" title={`${more} more layer(s) on`}>
                      +{more}
                    </span>
                  )}
                </>
              )
            })()}
          </div>

          <button
            type="button"
            aria-expanded={layerPanelOpen}
            aria-label={layerPanelOpen ? 'Close layers panel' : 'Open layers panel'}
            onClick={() => setLayerPanelOpen((o) => !o)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card/90 text-muted-foreground shadow-lg shadow-black/40 backdrop-blur-xl transition-colors hover:text-foreground"
          >
            <Layers className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            aria-pressed={map3DActive}
            aria-label={map3DActive ? 'Turn off 3D tilt' : 'Turn on 3D tilt'}
            onClick={onToggleMap3D}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-lg shadow-black/40 backdrop-blur-xl text-[10px] font-bold tracking-wide transition-colors',
              map3DActive
                ? 'border-primary/60 bg-primary/20 text-primary'
                : 'border-border/80 bg-card/90 text-muted-foreground hover:text-foreground'
            )}
          >
            3D
          </button>
        </div>

        <div
          className={cn(
            'min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-out motion-reduce:transition-none',
            layerPanelOpen ? 'max-w-56 shrink-0 opacity-100' : 'max-w-0 opacity-0 pointer-events-none'
          )}
        >
          <div className="flex max-h-[min(70vh,calc(100vh-7rem))] w-56 flex-col gap-0 overflow-y-auto overflow-x-hidden rounded-xl border border-border/90 bg-card/95 shadow-2xl shadow-black/40 backdrop-blur-xl">

        {/* Layer pills */}
        <div className="px-3 pt-3 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-2">Layers</p>
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: 'zipBoundary' as const, label: 'ZIP', color: '#a1a1aa' },
              { key: 'transitStops' as const, label: 'Transit', color: '#38bdf8' },
              {
                key: 'rentChoropleth' as const,
                label: 'Rent/value fill',
                color: '#a78bfa',
                title: 'Color ZIP polygons by rent (ZORI) or home value (ZHVI) from Zillow. Turn on, then choose Fill metric below.',
              },
              { key: 'parcels' as const, label: 'Parcels (NYC)', color: '#fbbf24', nycOnly: true },
              { key: 'tracts' as const, label: 'Tracts', color: '#2dd4bf' },
              { key: 'amenityHeatmap' as const, label: 'Amenity', color: '#facc15' },
              { key: 'floodRisk' as const, label: 'Flood', color: '#f87171' },
              { key: 'nycPermits' as const, label: 'Permits (NYC)', color: '#D76B3D', nycOnly: true },
              { key: 'pois' as const, label: 'POIs', color: '#f59e0b' },
              { key: 'momentum' as const, label: 'Momentum', color: '#a78bfa' },
              { key: 'clientData' as const, label: 'Client', color: '#D76B3D', showWhen: !!uploadedMarkers?.length },
            ]).filter(({ nycOnly, showWhen }) => {
              if (showWhen === false) return false
              if (nycOnly) return nycFeatureAvailable
              return true
            }).map(({ key, label, color, title }) => {
              const active = effectiveLayers[key] ?? false
              return (
                <button
                  key={key}
                  type="button"
                  title={title}
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

        <div className="mx-3 h-px bg-border/70" />

        {/* Parcel color mode - only shown when parcels layer is on */}
        {effectiveLayers.parcels && nycFeatureAvailable && parcelData && (
          <>
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-1.5">Parcel Color</p>
              <div className="flex rounded-lg overflow-hidden border border-white/8">
                {([
                  { key: 'landuse' as const, label: 'Land Use' },
                  { key: 'airRights' as const, label: 'Air Rights' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setParcelColorMode(key)}
                    className={`flex-1 py-1.5 text-[10px] font-medium transition-all ${
                      parcelColorMode === key ? 'bg-[#D76B3D]/20 text-[#D76B3D]' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {parcelColorMode === 'airRights' && parcelData.stats.underbuilt_count > 0 && (
                <p className="text-[9px] text-zinc-600 mt-1.5">
                  {parcelData.stats.underbuilt_count} underbuilt lots · green=low, red=high potential
                </p>
              )}
            </div>
            <div className="h-px bg-white/6 mx-3" />
          </>
        )}

        {/* Permit type filter - only shown when permits layer is on */}
        {effectiveLayers.nycPermits && nycFeatureAvailable && (
          <>
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-1.5">Permit Type</p>
              <div className="flex flex-wrap gap-1">
                {([
                  { key: 'NB', label: 'New Bldg', color: '#D76B3D' },
                  { key: 'A1', label: 'Major Reno', color: '#60a5fa' },
                  { key: 'DM', label: 'Demo', color: '#f87171' },
                ] as const).map(({ key, label, color }) => {
                  const active = permitTypeFilter.size === 0 || permitTypeFilter.has(key)
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setPermitTypeFilter((prev) => {
                          const next = new Set(prev)
                          if (next.size === 0) {
                            // currently "all" - activate only this one
                            next.add('NB'); next.add('A1'); next.add('DM')
                            next.delete(key)
                          } else if (next.has(key)) {
                            next.delete(key)
                            if (next.size === 0) return new Set() // back to all
                          } else {
                            next.add(key)
                            if (next.size === 3) return new Set() // all selected = all
                          }
                          return next
                        })
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                      style={{
                        background: active ? `${color}20` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${active ? color : 'rgba(255,255,255,0.07)'}`,
                        color: active ? '#fff' : '#52525b',
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: active ? color : '#3f3f46' }} />
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[9px] text-zinc-600 mt-1.5">
                {mapZoom < 15 ? `Heatmap · zoom ${Math.round(mapZoom)}` : `3D · zoom ${Math.round(mapZoom)}`}
                {mapZoom < 15 && <span className="text-zinc-700"> (zoom in for 3D)</span>}
              </p>
            </div>
            <div className="mx-3 h-px bg-border/70" />
          </>
        )}

        {/* ZORI vs ZHVI - only applies when rent/value fill choropleth is on */}
        {effectiveLayers.rentChoropleth && (
          <>
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-0.5">Fill metric</p>
              <p className="text-[9px] text-zinc-600 mb-1.5 leading-snug">Zillow index used for ZIP polygon colors</p>
              <div className="flex overflow-hidden rounded-lg border border-border/80 bg-muted/25">
                {(['zori', 'zhvi'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    title={m === 'zori' ? 'Zillow Observed Rent Index' : 'Zillow Home Value Index'}
                    onClick={() => setActiveMetric(m)}
                    className={`flex-1 py-1.5 text-[10px] font-medium transition-all ${
                      activeMetric === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'zori' ? 'ZORI' : 'ZHVI'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mx-3 h-px bg-border/70" />
          </>
        )}

        {visibleNeighborBoundaries.length > 0 && (
          <div className="px-3 pb-2">
            <p className="text-[10px] text-zinc-600">{visibleNeighborBoundaries.length} nearby ZIPs</p>
          </div>
        )}
          </div>
        </div>
      </div>

    </div>
  )
}

const MemoizedCommandMap = memo(CommandMap)
MemoizedCommandMap.displayName = 'CommandMap'

export default MemoizedCommandMap
