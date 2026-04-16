'use client'

import { useState, useCallback, useMemo, useEffect, useRef, type CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import AgenticNormalizer from '@/components/AgenticNormalizer'
import MarketReportExport from '@/components/MarketReportExport'
import { AgentThinkingPanel } from '@/components/AgentThinkingPanel'
import AgentTerminal, { type AgentTerminalSize } from '@/components/AgentTerminal'
import type { AgentAction, AgentTrace, AnalysisSite } from '@/lib/agent-types'
import type { CycleAnalysis } from '@/lib/cycle/types'
import type { MapLayersSnapshot } from '@/lib/report/types'
import { parseCycleAnalysisField } from '@/lib/report/validate-cycle'
import { useSitesStore } from '@/lib/sites-store'
import { useClientUploadMarkersStore } from '@/lib/client-upload-markers-store'
import { useClientUploadSessionStore } from '@/lib/client-upload-session-store'
import type { NormalizerIngestPayload } from '@/lib/normalize-client-types'
import { aggregateClientUploadSession } from '@/lib/client-upload-session-aggregate'
import SitesBootstrap from '@/components/SitesBootstrap'
import CommandCenterSidebar from '@/components/CommandCenterSidebar'
import { takePendingNav } from '@/lib/pending-navigation'
import { RIGHT_PANEL_WIDTH_PX } from '@/lib/analyst-guide'
import { MetricTooltip } from '@/components/MetricTooltip'
import { MomentumExplainBlock } from '@/components/MomentumExplainBlock'
import { CycleExplainCard } from '@/components/CycleExplainCard'
import type { MetricKey } from '@/lib/metric-definitions'
import { metricKeyFromDataRow, sparklineMetricKey } from '@/lib/metric-definitions'
import { cn } from '@/lib/utils'
import type { LayerState, MapViewportSnapshot } from '@/components/CommandMap'
import {
  denormalizeAgentLayersForContext,
  normalizeAgentLayerKey,
  normalizeAgentLayersRecord,
  patchTurnsEveryLayerOff,
} from '@/lib/agent-map-layers'
import { ALL_LAYERS_OFF } from '@/lib/slash-layer-keys'
import { normalizeHeadingDegrees } from '@/lib/slash-commands'
import { looksLikeCountyQuery, looksLikeMetroQuery } from '@/lib/area-keys'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'
import { MAP_VIEW_SAVE_ZIP } from '@/lib/saved-viewport'
import { isNycBoroughName } from '@/lib/geography'
import { fetchMomentumScores, getMomentumScore, normalizeMomentumZipList } from '@/lib/momentum-client'
import { dedupedFetchJson } from '@/lib/request-cache'

const CommandMap = dynamic(() => import('@/components/CommandMap'), { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────

interface DataRow {
  metric_name: string
  metric_value: number
  data_source: string
  time_period: string | null
  visual_bucket: string
}

interface TransitData {
  error?: string
  zip: string
  stop_count: number
  route_count?: number
  routes?: Array<{
    id: string
    name: string
    long_name?: string
    type: string
    route_type?: number
    color?: [number, number, number]
    paths?: [number, number][][]
    path?: [number, number][]
  }>
  geojson: {
    features: Array<{
      properties: { stop_id: string; stop_name: string; stop_type?: string }
      geometry: { coordinates: [number, number] }
    }>
    routes?: Array<{
      id: string
      name: string
      long_name?: string
      type: string
      color?: [number, number, number]
      paths?: [number, number][][]
      path?: [number, number][]
    }>
  }
}

interface TrendsData {
  is_fallback: boolean
  keyword_scope: string
  latest_score: number | null
  data_points: number
  series: Array<{ date: string; value: number }>
  /** Set when Google Trends failed or returned an HTTP error body */
  error?: string | null
  /** Set when the request succeeded but there are no weekly points */
  empty_message?: string | null
  /** Explains keyword + US-state geo (not neighborhood polygons) */
  geo_note?: string | null
  zip?: string | null
}

interface AreaSearchResponse {
  error?: string
  zips?: CityZip[]
}

interface BoroughSearchResponse extends AreaSearchResponse {
  borough?: string
  state?: string | null
  boundary?: object | null
}

interface CountySearchResponse extends AreaSearchResponse {
  county?: string
  state?: string | null
  area_key?: string | null
  label?: string
}

interface MetroSearchResponse extends AreaSearchResponse {
  metro_name?: string | null
  state?: string | null
  area_key?: string | null
  label?: string
}

interface CitySearchResponse extends AreaSearchResponse {
  city?: string
  state?: string | null
  metro_name?: string | null
  area_key?: string | null
  label?: string
}

interface AggregateData {
  error?: string
  label: string
  area_key?: string | null
  area_kind?: 'county' | 'metro' | null
  uses_direct_area_metrics?: boolean
  area_metrics?: Array<{
    metric_name: string
    metric_value: number
    time_period: string | null
    data_source: string
  }>
  zip_count: number
  total_population: number | null
  zillow: { avg_zori: number | null; avg_zhvi: number | null; zori_growth_12m: number | null; zhvi_growth_12m: number | null }
  housing: {
    total_units: number | null
    vacancy_rate: number | null
    median_income: number | null
    median_rent: number | null
    migration_movers?: number | null
  }
  permits: { total_units: number | null; total_value: number | null; by_year?: { year: string; units: number }[] }
  metro_velocity: { region_name: string; doz_pending_latest: number | null; price_cut_pct_latest: number | null; inventory_latest: number | null } | null
  fred: Array<{ metric_name: string; metric_value: number; time_period: string | null }>
}

interface CityZip {
  zip: string
  city: string
  state: string | null
  metro_name: string | null
  lat: number | null
  lng: number | null
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
}

interface MarketData {
  error?: string
  zip: string
  cached: boolean
  geo?: { lat: number; lng: number; city: string; state: string; stateFips?: string; countyFips?: string }
  data: DataRow[]
  zillow: {
    zori_latest: number | null
    zori_growth_12m: number | null
    zhvi_latest: number | null
    zhvi_growth_12m: number | null
    zhvf_growth_1yr: number | null
    metro_name: string | null
    city: string | null
    as_of_date: string
  } | null
  metro_velocity: {
    region_name: string
    doz_pending_latest: number | null
    price_cut_pct_latest: number | null
    inventory_latest: number | null
    as_of_date: string
  } | null
}

/** Human-facing site name for Saved / PDF (ZIP stays the data key only). */
function defaultHumanSiteLabel(market: MarketData): string {
  const g = market.geo
  if (g?.city?.trim()) {
    const c = g.city.trim()
    const st = g.state?.trim()
    if (st && !c.toLowerCase().includes(st.toLowerCase())) return `${c}, ${st}`
    return c
  }
  if (market.zillow?.city?.trim()) return market.zillow.city.trim()
  const metro = market.zillow?.metro_name?.trim()
  if (metro) {
    const head = metro.split(',')[0]?.trim()
    if (head) return head
  }
  return `ZIP ${market.zip}`
}

/** Map pin anchor for a multi-ZIP area list (first ZIP with coords, else geocode first ZIP). */
async function resolveAggregateAnchorGeo(cityZips: CityZip[]): Promise<{ zip: string; lat: number; lng: number } | null> {
  const withGeo = cityZips.find((z) => z.lat != null && z.lng != null && /^\d{5}$/.test(z.zip))
  const fallback = cityZips.find((z) => /^\d{5}$/.test(z.zip))
  const z = withGeo ?? fallback
  if (!z) return null
  if (z.lat != null && z.lng != null) return { zip: z.zip, lat: z.lat, lng: z.lng }
  try {
    const data = await loadMarketData(z.zip)
    if (data.geo?.lat != null && data.geo?.lng != null) {
      return { zip: z.zip, lat: data.geo.lat, lng: data.geo.lng }
    }
  } catch {
    /* ignore */
  }
  return null
}

async function loadMomentumScore(
  zips: Iterable<string> | null | undefined,
  targetZip: string | null | undefined
): Promise<number | null> {
  const normalizedZips = normalizeMomentumZipList(zips)
  if (!targetZip || normalizedZips.length === 0) return null

  try {
    const response = await fetchMomentumScores(normalizedZips, { limit: normalizedZips.length })
    return getMomentumScore(response, targetZip)
  } catch {
    return null
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '-'
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function hasErrorField(value: unknown): value is { error?: string } {
  return typeof value === 'object' && value !== null && 'error' in value
}

function buildAggregateRequestCacheKey(zips: string[], label: string, areaKey?: string | null): string {
  const normalizedZips = Array.from(new Set(zips)).sort().join(',')
  return `aggregate:${areaKey ?? normalizedZips}:${label.trim()}`
}

function buildAreaRequestUrl(
  route: '/api/city' | '/api/county' | '/api/metro',
  key: 'city' | 'county' | 'metro',
  value: string,
  stateAbbr?: string | null
): string {
  const params = new URLSearchParams({ [key]: value })
  if (stateAbbr) params.set('state', stateAbbr)
  return `${route}?${params.toString()}`
}

async function loadMarketData(zip: string): Promise<MarketData> {
  return dedupedFetchJson<MarketData>(`/api/market?zip=${encodeURIComponent(zip)}`, {
    allowErrorBody: true,
  })
}

async function loadTransitData(zip: string): Promise<TransitData> {
  return dedupedFetchJson<TransitData>(`/api/transit?zip=${encodeURIComponent(zip)}`)
}

async function loadCycleData(zip: string, label?: string): Promise<unknown> {
  const params = new URLSearchParams({ zip })
  if (label) params.set('label', label)
  return dedupedFetchJson(`/api/cycle?${params.toString()}`)
}

async function loadTrendsData(url: string): Promise<Record<string, unknown>> {
  return dedupedFetchJson<Record<string, unknown>>(url, {
    allowErrorBody: true,
    ttlMs: 60 * 1000,
  })
}

async function loadAreaTrendsData(
  cityZips: CityZip[],
  args: { cityForKeyword: string; state: string }
): Promise<Record<string, unknown> | null> {
  const first = cityZips[0]
  if (!first?.zip) return null

  const st = args.state.trim().toUpperCase()
  if (st.length === 2) {
    return loadTrendsData(
      `/api/trends?city=${encodeURIComponent(args.cityForKeyword.trim())}&state=${encodeURIComponent(st)}&anchor_zip=${encodeURIComponent(first.zip)}`
    )
  }

  return loadTrendsData(`/api/trends?zip=${encodeURIComponent(first.zip)}`)
}

async function loadBoroughSearchData(name: string): Promise<BoroughSearchResponse> {
  return dedupedFetchJson<BoroughSearchResponse>(`/api/borough?name=${encodeURIComponent(name)}`, {
    allowErrorBody: true,
  })
}

async function loadCountySearchData(county: string, stateAbbr?: string | null): Promise<CountySearchResponse> {
  return dedupedFetchJson<CountySearchResponse>(
    buildAreaRequestUrl('/api/county', 'county', county, stateAbbr),
    { allowErrorBody: true }
  )
}

async function loadMetroSearchData(metro: string, stateAbbr?: string | null): Promise<MetroSearchResponse> {
  return dedupedFetchJson<MetroSearchResponse>(
    buildAreaRequestUrl('/api/metro', 'metro', metro, stateAbbr),
    { allowErrorBody: true }
  )
}

async function loadCitySearchData(city: string, stateAbbr?: string | null): Promise<CitySearchResponse> {
  return dedupedFetchJson<CitySearchResponse>(
    buildAreaRequestUrl('/api/city', 'city', city, stateAbbr),
    { allowErrorBody: true }
  )
}

async function loadAggregateData(zips: string[], label: string, areaKey?: string | null): Promise<AggregateData> {
  return dedupedFetchJson<AggregateData>('/api/aggregate', {
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zips, label, areaKey }),
    },
    cacheKey: buildAggregateRequestCacheKey(zips, label, areaKey),
  })
}

function fmtNum(n: number | null | undefined, suffix = '') {
  if (n == null) return '-'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) + suffix
}

function fmtGrowth(n: number | null | undefined) {
  if (n == null) return null
  const sign = n > 0 ? '+' : ''
  return `${sign}${Number(n).toFixed(2)}%`
}

/** PDF / payload: fold geo note, empty, and errors into keyword_scope; omit series on hard failure. */
function trendsShapeForReport(t: TrendsData | null): { series: { date: string; value: number }[]; keyword_scope: string } | null {
  if (!t) return null
  if (t.error) {
    return {
      series: [],
      keyword_scope: `Search sentiment unavailable - ${t.error}`,
    }
  }
  const scopeParts = [t.geo_note, t.keyword_scope].filter((s): s is string => Boolean(s && String(s).trim()))
  let keyword_scope = scopeParts.join(' · ')
  if (t.empty_message) {
    keyword_scope = keyword_scope ? `${keyword_scope} - ${t.empty_message}` : t.empty_message
  }
  return { series: t.series, keyword_scope: keyword_scope || t.keyword_scope || 'Google Trends' }
}

const MONEY_METRICS = ['Rent', 'Income', 'FMR', 'Value', 'Price']
const RATE_METRICS = ['Unemployment', 'Rate', 'Pct', 'Ratio']
const CORE_AGGREGATE_AREA_METRICS = new Set([
  'Total_Population',
  'Projected_Total_Population',
  'Total_Housing_Units',
  'Vacancy_Rate',
  'Median_Household_Income',
  'Median_Gross_Rent',
  'Moved_From_Different_State',
  'Permit_Units',
  'Permit_Value_USD',
  'Unemployment_Rate',
  'Employment_Rate',
  'Real_GDP',
])

function formatMetricValue(name: string, value: number) {
  if (MONEY_METRICS.some((k) => name.includes(k))) return fmtMoney(value)
  if (RATE_METRICS.some((k) => name.includes(k))) return fmtNum(value, '%')
  if (name === 'Population_Growth_3yr') return fmtNum(value, '%')
  return fmtNum(value)
}

function formatAggregateScopeLabel(aggregate: AggregateData) {
  const zipLabel = `${aggregate.zip_count} ZIP code${aggregate.zip_count === 1 ? '' : 's'}`
  if (aggregate.area_kind === 'county') return `County view · ${zipLabel}`
  if (aggregate.area_kind === 'metro') return `Metro view · ${zipLabel}`
  return `${zipLabel} · aggregated`
}

// ── Small components ──────────────────────────────────────────────────────────

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 border-b border-border/70 pb-1.5 text-[9px] tracking-widest text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

function ShortlistToggleButton({
  market,
  cycle,
}: {
  market: MarketData
  cycle: CycleAnalysis | null
}) {
  const zipCode = market.zip
  const geo = market.geo!
  const hasZip = useSitesStore((s) => s.hasZip(zipCode))
  const getSiteIdByZip = useSitesStore((s) => s.getSiteIdByZip)
  const removeSite = useSitesStore((s) => s.removeSite)
  const addSite = useSitesStore((s) => s.addSite)
  const [pending, setPending] = useState(false)

  async function toggle() {
    if (hasZip) {
      const id = getSiteIdByZip(zipCode)
      if (id) await removeSite(id)
      return
    }
    setPending(true)
    const momentum = await loadMomentumScore([zipCode], zipCode)
    const human = defaultHumanSiteLabel(market)
    await addSite({
      label: human,
      zip: zipCode,
      lat: geo.lat,
      lng: geo.lng,
      marketLabel: human,
      cyclePosition: cycle?.cyclePosition,
      cycleStage: cycle?.cycleStage,
      momentumScore: momentum,
    })
    setPending(false)
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      className="mt-3 mb-4 w-full py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 bg-white/8 hover:bg-white/12 border-white/15 text-white"
    >
      {pending ? 'Saving…' : hasZip ? '✓ Saved - tap to remove' : 'Save Site'}
    </button>
  )
}

function AggregateShortlistToggle({
  aggregateData,
  cityZips,
  cycle,
  savedSearch,
}: {
  aggregateData: AggregateData
  cityZips: CityZip[]
  cycle: CycleAnalysis | null
  savedSearch: string
}) {
  const q = savedSearch.trim()
  const hasArea = useSitesStore((s) => (q ? s.hasAggregateSaved(q) : false))
  const getAggregateSiteId = useSitesStore((s) => s.getAggregateSiteId)
  const removeSite = useSitesStore((s) => s.removeSite)
  const addSite = useSitesStore((s) => s.addSite)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function toggle() {
    setLocalError(null)
    if (!q) return
    if (hasArea) {
      const id = getAggregateSiteId(q)
      if (id) await removeSite(id)
      return
    }
    setPending(true)
    const pin = await resolveAggregateAnchorGeo(cityZips)
    if (!pin) {
      setLocalError('Could not place pin - no coordinates for this area.')
      setPending(false)
      return
    }
    const momentum = await loadMomentumScore(cityZips.map((z) => z.zip), pin.zip)
    const human = aggregateData.label.trim() || q
    await addSite({
      label: human,
      zip: pin.zip,
      lat: pin.lat,
      lng: pin.lng,
      marketLabel: human,
      isAggregate: true,
      savedSearch: q,
      cyclePosition: cycle?.cyclePosition,
      cycleStage: cycle?.cycleStage,
      momentumScore: momentum,
    })
    setPending(false)
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending || !q}
        className="mt-3 w-full py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 bg-white/8 hover:bg-white/12 border-white/15 text-white"
      >
        {pending ? 'Saving…' : hasArea ? '✓ Area saved - tap to remove' : 'Save'}
      </button>
      {localError && <p className="text-[9px] text-red-400 mt-1.5 px-0.5">{localError}</p>}
    </div>
  )
}

function MetricRow({ label, value, sub, metricKey }: { label: string; value: string; sub?: string; metricKey?: MetricKey }) {
  const labelText = label.replace(/_/g, ' ')
  return (
    <div className="flex justify-between items-start py-1.5 border-b border-white/5 last:border-0">
      <p className="text-zinc-400 text-xs">
        {metricKey ? <MetricTooltip metricKey={metricKey}>{labelText}</MetricTooltip> : labelText}
      </p>
      <div className="text-right ml-4">
        <p className="text-white text-xs font-medium">{value}</p>
        {sub && <p className="text-zinc-600 text-[10px]">{sub}</p>}
      </div>
    </div>
  )
}

function BubbleStat({ label, value, sub, accent }: { label: string; value: string; sub?: string | null; accent?: 'green' | 'red' | null }) {
  return (
    <div className="flex flex-col gap-0 px-3 py-2 min-w-[72px]">
      <p className="text-[9px] uppercase tracking-widest text-zinc-500 whitespace-nowrap">{label}</p>
      <p className="text-white font-semibold text-[13px] leading-tight whitespace-nowrap">{value}</p>
      {sub && <p className={`text-[9px] whitespace-nowrap ${accent === 'green' ? 'text-emerald-400' : accent === 'red' ? 'text-red-400' : 'text-zinc-500'}`}>{sub}</p>}
    </div>
  )
}

function BubbleDivider() {
  return <div className="w-px h-8 bg-white/8 flex-shrink-0" />
}

const DEFAULT_MAP_LAYERS: MapLayersSnapshot = {
  zipBoundary: true,
  transitStops: true,
  rentChoropleth: true,
  blockGroups: false,
  parcels: false,
  tracts: false,
  amenityHeatmap: false,
  floodRisk: false,
  nycPermits: false,
  clientData: false,
  choroplethMetric: 'zori',
}
/** Agent-selected parcel / site - lives in the right panel, not over the map. */
function SiteDetailRightPanel({ site, onBack }: { site: AnalysisSite; onBack: () => void }) {
  return (
    <div className="flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden p-4">
      <div className="mb-4 flex items-start gap-2 border-b border-border/60 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          aria-label="Back to market"
          title="Back to market"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Site detail</p>
          <p className="text-base font-bold leading-tight text-foreground">{site.address}</p>
          <p className="text-[10px] text-muted-foreground">{site.zone}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none text-primary">{site.score.toFixed(0)}</p>
          <p className="text-[9px] text-muted-foreground">score</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Air rights</p>
            <p className="text-sm font-semibold text-foreground">{(site.air_rights_sqft / 1000).toFixed(0)}k sqft</p>
            <p className="text-[9px] text-muted-foreground">unused dev potential</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">FAR used</p>
            <p className="text-sm font-semibold text-foreground">{(site.far_utilization * 100).toFixed(0)}%</p>
            <p className="text-[9px] text-muted-foreground">of {site.max_far.toFixed(1)} max FAR</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Nearby permits</p>
            <p className="text-sm font-semibold text-foreground">{site.momentum ?? 0}</p>
            <p className="text-[9px] text-muted-foreground">NB + A1 · 500m</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">ZORI growth</p>
            <p className="text-sm font-semibold text-foreground">
              {site.zori_growth != null ? `+${site.zori_growth.toFixed(1)}%` : '-'}
            </p>
            <p className="text-[9px] text-muted-foreground">12m YoY</p>
          </div>
        </div>
        <div className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold text-primary">Why this site?</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {site.far_utilization < 0.2
              ? `Severely underbuilt - only ${(site.far_utilization * 100).toFixed(0)}% of allowable FAR developed. `
              : `Underutilized at ${(site.far_utilization * 100).toFixed(0)}% of max FAR. `}
            {(site.momentum ?? 0) >= 10
              ? `Strong development momentum with ${site.momentum} nearby permits signaling active neighborhood investment. `
              : `Emerging area with ${site.momentum ?? 0} nearby permits. `}
            {(site.air_rights_sqft / 1000) > 1000
              ? `${(site.air_rights_sqft / 1000).toFixed(0)}k sqft of air rights represents significant high-density upside in a ${site.zone} zone.`
              : `${(site.air_rights_sqft / 1000).toFixed(0)}k sqft of buildable air rights in ${site.zone} zoning.`}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MarketData | null>(null)
  const [cityZips, setCityZips] = useState<CityZip[] | null>(null)
  const [boroughBoundary, setBoroughBoundary] = useState<object | null>(null)
  const [aggregateData, setAggregateData] = useState<AggregateData | null>(null)
  const uploadedMarkers = useClientUploadMarkersStore((s) => s.markers)
  const clientUploadSession = useClientUploadSessionStore((s) => s.session)
  const clientUploadAgg = useMemo(
    () => aggregateClientUploadSession(clientUploadSession),
    [clientUploadSession]
  )
  const [agentTerminalSize, setAgentTerminalSize] = useState<AgentTerminalSize>('collapsed')
  const [agentTerminalOpenHeightPx, setAgentTerminalOpenHeightPx] = useState<number | null>(null)
  const [agentLayerOverrides, setAgentLayerOverrides] = useState<Record<string, boolean>>({})
  const [agentMetric, setAgentMetric] = useState<'zori' | 'zhvi' | null>(null)
  const [agentTilt, setAgentTilt] = useState<number | null>(null)
  const [mapHeading, setMapHeading] = useState(0)
  /** User 3D pill (45°) when agent has not overridden tilt. */
  const [map3DEnabled, setMap3DEnabled] = useState(false)
  const [analysisSites, setAnalysisSites] = useState<AnalysisSite[]>([])
  const [agentPermitFilter, setAgentPermitFilter] = useState<string[] | null>(null)
  const [selectedSite, setSelectedSite] = useState<AnalysisSite | null>(null)
  const [agentFlyTo, setAgentFlyTo] = useState<{ lat: number; lng: number } | null>(null)
  const [transit, setTransit] = useState<TransitData | null>(null)
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [cycleData, setCycleData] = useState<CycleAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [mapLayersSnapshot, setMapLayersSnapshot] = useState<MapLayersSnapshot>(DEFAULT_MAP_LAYERS)
  const layerStateResyncIdRef = useRef(0)
  const [layerStateResync, setLayerStateResync] = useState<{ id: number; state: LayerState } | null>(null)
  const [marketPanelTab, setMarketPanelTab] = useState<'analysis' | 'data' | 'thinking'>('analysis')
  const [agentSidebarTrace, setAgentSidebarTrace] = useState<AgentTrace | null>(null)
  const [agentThinkingStreaming, setAgentThinkingStreaming] = useState(false)
  const mapViewportRef = useRef<MapViewportSnapshot | null>(null)

  const handleShowAgentThinking = useCallback((trace: AgentTrace) => {
    setSelectedSite(null)
    setAgentSidebarTrace(trace)
    setMarketPanelTab('thinking')
    setPanelOpen(true)
  }, [])

  const handleAgentThinkingUpdate = useCallback(
    (u: { trace: AgentTrace; phase: 'thinking' | 'json' | 'done' }) => {
      setSelectedSite(null)
      setAgentSidebarTrace(u.trace)
      setMarketPanelTab('thinking')
      setPanelOpen(true)
      setAgentThinkingStreaming(u.phase !== 'done')
    },
    []
  )

  const handleAgentThinkingStreamFinished = useCallback(() => {
    setAgentThinkingStreaming(false)
  }, [])

  const clearAgentSidebarTrace = useCallback(() => {
    setAgentSidebarTrace(null)
    setMarketPanelTab('analysis')
    setAgentThinkingStreaming(false)
  }, [])

  const handleNormalizerIngested = useCallback((payload: NormalizerIngestPayload) => {
    const pts = payload.mergedMarkerPoints
    if (pts.length > 0) {
      setAgentLayerOverrides((prev) => ({ ...prev, clientData: true }))
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
      const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
      setAgentFlyTo({ lat, lng })
    } else {
      setAgentLayerOverrides((prev) => ({ ...prev, clientData: false }))
      setMarketPanelTab('data')
      setPanelOpen(true)
    }
  }, [])

  const handleMapLayersChange = useCallback((snapshot: MapLayersSnapshot) => {
    setMapLayersSnapshot(snapshot)
  }, [])

  const sitesForMap = useSitesStore((s) => s.sites)
  const selectedComparisonIds = useSitesStore((s) => s.selectedForComparison)
  const pdfComparisonPins = useMemo(() => {
    const sel = sitesForMap.filter((s) => selectedComparisonIds.includes(s.id))
    if (sel.length < 2) return null
    return sel.map((s) => ({
      lat: s.lat,
      lng: s.lng,
      label: s.label,
      value: s.momentumScore ?? null,
    }))
  }, [sitesForMap, selectedComparisonIds])

  const handleAgentAction = useCallback((action: AgentAction) => {
    switch (action.type) {
      case 'toggle_layer': {
        if (!action.layer) break
        const key = normalizeAgentLayerKey(action.layer)
        setAgentLayerOverrides((prev) => ({ ...prev, [key]: action.value ?? true }))
        break
      }
      case 'toggle_layers': {
        const patch = action.layers
        if (!patch) break
        if (patchTurnsEveryLayerOff(patch)) {
          setAgentLayerOverrides({})
          layerStateResyncIdRef.current += 1
          setLayerStateResync({ id: layerStateResyncIdRef.current, state: { ...ALL_LAYERS_OFF } as LayerState })
        } else {
          setAgentLayerOverrides((prev) => ({ ...prev, ...normalizeAgentLayersRecord(patch) }))
        }
        break
      }
      case 'set_metric':
        if (action.metric) setAgentMetric(action.metric)
        break
      case 'search':
        if (action.query) {
          setSearchInput(action.query)
          setTimeout(() => {
            const form = document.querySelector('form')
            form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          }, 100)
        }
        break
      case 'generate_memo':
        setMarketPanelTab('analysis')
        setPanelOpen(true)
        break
      case 'focus_data_panel':
        setMarketPanelTab('data')
        setPanelOpen(true)
        break
      case 'set_tilt':
        if (action.tilt != null) {
          setAgentTilt(action.tilt)
          setMap3DEnabled(false)
        }
        break
      case 'set_heading':
        if (action.heading != null && Number.isFinite(action.heading)) {
          setMapHeading(normalizeHeadingDegrees(action.heading))
        }
        break
      case 'show_sites':
        if (action.sites) setAnalysisSites(action.sites)
        break
      case 'set_permit_filter':
        if (action.types === undefined) break
        setAgentPermitFilter(action.types.length > 0 ? action.types : null)
        break
      case 'fly_to':
        if (action.lat != null && action.lng != null) {
          setAgentFlyTo({ lat: action.lat, lng: action.lng })
          if (action.site) {
            setSelectedSite(action.site)
            setPanelOpen(true)
          }
        }
        break
    }
  }, [])

  const handleSlashSave = useCallback(
    async (customLabel: string | null) => {
      const labelArg = customLabel?.trim() || null
      const addSite = useSitesStore.getState().addSite
      const getErr = () => useSitesStore.getState().syncError ?? 'Could not save.'

      if (result?.geo && /^\d{5}$/.test(result.zip)) {
        if (useSitesStore.getState().hasZip(result.zip)) {
          return { ok: false, message: 'This ZIP is already in **Saved**.' }
        }
        const zipCode = result.zip
        const geo = result.geo
        const momentum = await loadMomentumScore([zipCode], zipCode)
        const human = labelArg ?? defaultHumanSiteLabel(result)
        const ok = await addSite({
          label: human,
          zip: zipCode,
          lat: geo.lat,
          lng: geo.lng,
          marketLabel: human,
          cyclePosition: cycleData?.cyclePosition,
          cycleStage: cycleData?.cycleStage,
          momentumScore: momentum,
        })
        return ok
          ? { ok: true, message: `Saved **${human}** (${zipCode}) to Saved.` }
          : { ok: false, message: getErr() }
      }

      if (aggregateData && cityZips && cityZips.length > 0) {
        const q = searchInput.trim() || aggregateData.label.trim()
        if (!q) {
          return {
            ok: false,
            message: 'Could not determine the area search text — try searching again, then `/save`.',
          }
        }
        if (useSitesStore.getState().hasAggregateSaved(q)) {
          return { ok: false, message: 'This area is already in **Saved**.' }
        }
        const pin = await resolveAggregateAnchorGeo(cityZips)
        if (!pin) {
          return { ok: false, message: 'Could not place a pin for this area (no coordinates).' }
        }
        const momentum = await loadMomentumScore(cityZips.map((z) => z.zip), pin.zip)
        const human = labelArg ?? (aggregateData.label.trim() || q)
        const ok = await addSite({
          label: human,
          zip: pin.zip,
          lat: pin.lat,
          lng: pin.lng,
          marketLabel: human,
          isAggregate: true,
          savedSearch: q,
          cyclePosition: cycleData?.cyclePosition,
          cycleStage: cycleData?.cycleStage,
          momentumScore: momentum,
        })
        return ok
          ? { ok: true, message: `Saved area **${human}** to Saved.` }
          : { ok: false, message: getErr() }
      }

      const vp = mapViewportRef.current
      if (vp) {
        const defaultLabel = `Map view · ${vp.lat.toFixed(4)}, ${vp.lng.toFixed(4)}`
        const human = labelArg ?? defaultLabel
        const ok = await addSite({
          label: human,
          zip: MAP_VIEW_SAVE_ZIP,
          lat: vp.lat,
          lng: vp.lng,
          marketLabel: human,
        })
        return ok
          ? { ok: true, message: `Saved map position **${human}** to Saved.` }
          : { ok: false, message: getErr() }
      }

      return {
        ok: false,
        message: 'Nothing to save — load a ZIP, county, metro, or city search, or wait for the map to finish loading.',
      }
    },
    [result, aggregateData, cityZips, searchInput, cycleData]
  )

  const mapContext = useMemo(
    () => ({
      label: result ? (result.zillow?.city ?? result.zip) : aggregateData?.label,
      zip: result?.zip ?? null,
      hasRankedSites: analysisSites.length > 0,
      rankedSiteCount: analysisSites.length,
      clientCsv: clientUploadAgg
        ? {
            fileName: clientUploadAgg.fileNameLabel,
            fileCount: clientUploadAgg.sourceCount,
            fileNames: clientUploadAgg.fileNames,
            bucket: clientUploadAgg.triage.bucket,
            visual_bucket: clientUploadAgg.triage.visual_bucket,
            metric_name: clientUploadAgg.triage.metric_name,
            reasoning: clientUploadAgg.reasoning,
            rowsIngested: clientUploadAgg.rowsIngested,
            mapPinCount: clientUploadAgg.markerCount,
            mapEligible: clientUploadAgg.mapEligible,
            ingestedAt: clientUploadAgg.ingestedAt,
          }
        : null,
      layers: denormalizeAgentLayersForContext(agentLayerOverrides),
      activeMetric: agentMetric ?? 'zori',
      zori: result?.zillow?.zori_latest ?? aggregateData?.zillow.avg_zori,
      zhvi: result?.zillow?.zhvi_latest ?? aggregateData?.zillow.avg_zhvi,
      zoriGrowth: result?.zillow?.zori_growth_12m ?? aggregateData?.zillow.zori_growth_12m,
      zhviGrowth: result?.zillow?.zhvi_growth_12m ?? aggregateData?.zillow.zhvi_growth_12m,
      vacancyRate:
        result?.data.find((r) => r.metric_name === 'Vacancy_Rate')?.metric_value ??
        aggregateData?.housing.vacancy_rate,
      dozPending:
        result?.metro_velocity?.doz_pending_latest ??
        aggregateData?.metro_velocity?.doz_pending_latest,
      priceCuts:
        result?.metro_velocity?.price_cut_pct_latest ??
        aggregateData?.metro_velocity?.price_cut_pct_latest,
      inventory:
        result?.metro_velocity?.inventory_latest ??
        aggregateData?.metro_velocity?.inventory_latest,
      transitStops: transit?.stop_count,
      population:
        result?.data.find((r) => r.metric_name === 'Total_Population')?.metric_value ??
        aggregateData?.total_population,
    }),
    [result, aggregateData, analysisSites.length, clientUploadAgg, agentLayerOverrides, agentMetric, transit]
  )

  /** Normalize `/api/trends` JSON into panel + PDF state (always sets `trends` so analysts see errors). */
  const applyTrendsApiBody = useCallback((body: Record<string, unknown> | null, httpOk: boolean) => {
    if (!httpOk || !body || typeof body !== 'object') {
      const msg =
        typeof body?.error === 'string'
          ? body.error
          : 'Search sentiment unavailable (could not reach Google Trends).'
      setTrends({
        is_fallback: false,
        keyword_scope: msg,
        latest_score: null,
        data_points: 0,
        series: [],
        error: msg,
        empty_message: null,
        geo_note: null,
        zip: null,
      })
      return
    }
    const err = typeof body.error === 'string' && body.error ? body.error : null
    const emptyMsg =
      typeof body.empty_message === 'string' && body.empty_message ? body.empty_message : null
    const series = Array.isArray(body.series)
      ? (body.series as Array<{ date: string; value: number }>)
      : []
    const geoNote = typeof body.geo_note === 'string' ? body.geo_note : null
    setTrends({
      is_fallback: Boolean(body.is_fallback),
      keyword_scope: typeof body.keyword_scope === 'string' ? body.keyword_scope : '',
      latest_score: typeof body.latest_score === 'number' ? body.latest_score : null,
      data_points: typeof body.data_points === 'number' ? body.data_points : series.length,
      series,
      error: err,
      empty_message: emptyMsg,
      geo_note: geoNote,
      zip: typeof body.zip === 'string' ? body.zip : null,
    })
  }, [])

  const loadAggregateSurface = useCallback(
    async ({
      zips,
      label,
      areaKey,
      trendsArgs,
      transitZip,
    }: {
      zips: CityZip[]
      label: string
      areaKey?: string | null
      trendsArgs: { cityForKeyword: string; state: string }
      transitZip?: string | null
    }) => {
      const zipList = zips.map((z) => z.zip)
      const anchorZip = zipList.find((candidate) => /^\d{5}$/.test(candidate)) ?? null

      try {
        const [aggregate, cycleJson, transitData, trendsData] = await Promise.all([
          loadAggregateData(zipList, label, areaKey ?? null).catch(() => null),
          anchorZip ? loadCycleData(anchorZip, label).catch(() => null) : Promise.resolve(null),
          transitZip ? loadTransitData(transitZip).catch(() => null) : Promise.resolve(null),
          loadAreaTrendsData(zips, trendsArgs).catch(() => null),
        ])

        if (aggregate && !aggregate.error) {
          setAggregateData(aggregate)
        }

        const parsedCycle =
          cycleJson && !(hasErrorField(cycleJson) && cycleJson.error)
            ? parseCycleAnalysisField(cycleJson)
            : null
        setCycleData(parsedCycle)

        if (transitZip) {
          if (transitData && !(hasErrorField(transitData) && transitData.error)) {
            setTransit({ ...transitData, zip: transitZip })
          } else {
            setTransit(null)
          }
        } else {
          setTransit(null)
        }

        applyTrendsApiBody(trendsData, Boolean(trendsData))
      } catch {
        setCycleData(null)
        setTransit(null)
        applyTrendsApiBody(null, false)
      }
    },
    [applyTrendsApiBody]
  )

  const loadZipMarket = useCallback(
    async (zipInput: string) => {
      setSelectedSite(null)
      setLoading(true)
      setError(null)
      setCityZips(null)
      setBoroughBoundary(null)
      setAggregateData(null)
      setTrends(null)
      setCycleData(null)
      try {
        const [data, transitData, trendsData, cycleJson] = await Promise.all([
          loadMarketData(zipInput),
          loadTransitData(zipInput).catch(() => null),
          loadTrendsData(`/api/trends?zip=${encodeURIComponent(zipInput)}`).catch(() => null),
          loadCycleData(zipInput).catch(() => null),
        ])
        if (data.error) {
          setError(data.error)
          return
        }
        setResult(data)
        if (transitData && !(hasErrorField(transitData) && transitData.error)) setTransit(transitData)
        applyTrendsApiBody(trendsData, Boolean(trendsData))
        const parsedCycle =
          cycleJson && !(hasErrorField(cycleJson) && cycleJson.error) ? parseCycleAnalysisField(cycleJson) : null
        setCycleData(parsedCycle)
        setPanelOpen(true)
      } catch {
        setError('Failed to fetch data')
      } finally {
        setLoading(false)
      }
    },
    [applyTrendsApiBody]
  )

  async function runAggregateSearch(input: string) {
    const trimmed = input.trim()
    if (!trimmed) return
    setSelectedSite(null)
    setLoading(true)
    setError(null)
    setCityZips(null)
    setBoroughBoundary(null)
    setAggregateData(null)
    setTrends(null)
    setCycleData(null)
    setResult(null)
    setTransit(null)
    try {
      const lowerInput = trimmed.toLowerCase().replace(/,.*$/, '').trim()
      if (isNycBoroughName(lowerInput)) {
        try {
          const data = await loadBoroughSearchData(lowerInput)
          if (data.error || !data.zips?.length) {
            setError(`No data found for "${trimmed}"`)
            return
          }
          setCityZips(data.zips)
          setBoroughBoundary(data.boundary ?? null)
          setResult(null)
          setTrends(null)
          setPanelOpen(true)
          const boroughLabel = typeof data.borough === 'string' && data.borough ? data.borough : trimmed
          const centroidZip = data.zips.find((z: CityZip) => z.lat && z.lng)?.zip ?? null
          void loadAggregateSurface({
            zips: data.zips,
            label: boroughLabel,
            trendsArgs: {
              cityForKeyword: boroughLabel,
              state: typeof data.state === 'string' ? data.state : 'NY',
            },
            transitZip: centroidZip,
          })
        } catch {
          setError('Failed to fetch borough data')
        }
      } else {
        const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
        const cityName = parts[0]
        const stateRaw = parts.slice(1).join(', ').trim()
        const stateForApi = stateRaw ? normalizeUsStateToAbbr(stateRaw) : null
        if (stateRaw && !stateForApi) {
          setError(`Could not parse state "${stateRaw}". Try a full name (e.g. New Jersey) or USPS code (NJ).`)
          return
        }
        if (looksLikeCountyQuery(cityName)) {
          try {
            const data = await loadCountySearchData(cityName, stateForApi)
            if (data.error || !data.zips?.length) {
              setError(typeof data.error === 'string' && data.error ? data.error : `No data found for "${trimmed}"`)
              return
            }
            setCityZips(data.zips)
            setBoroughBoundary(null)
            setResult(null)
            setTrends(null)
            setPanelOpen(true)
            const centroidZipCounty = data.zips.find((z: CityZip) => z.lat && z.lng)?.zip ?? null
            void loadAggregateSurface({
              zips: data.zips,
              label: typeof data.label === 'string' && data.label ? data.label : trimmed,
              areaKey: typeof data.area_key === 'string' ? data.area_key : null,
              trendsArgs: {
                cityForKeyword: typeof data.county === 'string' ? data.county : cityName,
                state: (stateForApi || data.state || data.zips[0]?.state || '')
                  .toString()
                  .trim()
                  .toUpperCase()
                  .slice(0, 2),
              },
              transitZip: centroidZipCounty,
            })
            return
          } catch {
            setError('Failed to fetch county data')
            return
          }
        }
        try {
          const tryMetroFirst = looksLikeMetroQuery(cityName)
          const cityPromise = tryMetroFirst ? null : loadCitySearchData(cityName, stateForApi)
          const metroPromise = tryMetroFirst ? loadMetroSearchData(cityName, stateForApi) : null

          const metroData = metroPromise ? await metroPromise : null
          if (metroData && !metroData.error && metroData.zips?.length) {
            setCityZips(metroData.zips)
            setBoroughBoundary(null)
            setResult(null)
            setTrends(null)
            setPanelOpen(true)
            const centroidZipMetro = metroData.zips.find((z: CityZip) => z.lat && z.lng)?.zip ?? null
            void loadAggregateSurface({
              zips: metroData.zips,
              label: typeof metroData.label === 'string' && metroData.label ? metroData.label : cityName,
              areaKey: typeof metroData.area_key === 'string' ? metroData.area_key : null,
              trendsArgs: {
                cityForKeyword: typeof metroData.metro_name === 'string' ? metroData.metro_name : cityName,
                state: (stateForApi || metroData.state || metroData.zips[0]?.state || '')
                  .toString()
                  .trim()
                  .toUpperCase()
                  .slice(0, 2),
              },
              transitZip: centroidZipMetro,
            })
            return
          }

          const data = cityPromise ? await cityPromise : await loadCitySearchData(cityName, stateForApi)
          if (data.error || !data.zips?.length) {
            const metroData = await loadMetroSearchData(cityName, stateForApi)
            if (metroData.error || !metroData.zips?.length) {
              setError(
                typeof metroData.error === 'string' && metroData.error
                  ? metroData.error
                  : typeof data.error === 'string' && data.error
                    ? data.error
                    : `No data found for "${trimmed}". Try "77002", "Harris County, TX", "Dallas-Fort Worth, TX", or "Houston, TX".`
              )
              return
            }
            setCityZips(metroData.zips)
            setBoroughBoundary(null)
            setResult(null)
            setTrends(null)
            setPanelOpen(true)
            const centroidZipMetro = metroData.zips.find((z: CityZip) => z.lat && z.lng)?.zip ?? null
            void loadAggregateSurface({
              zips: metroData.zips,
              label: typeof metroData.label === 'string' && metroData.label ? metroData.label : cityName,
              areaKey: typeof metroData.area_key === 'string' ? metroData.area_key : null,
              trendsArgs: {
                cityForKeyword: typeof metroData.metro_name === 'string' ? metroData.metro_name : cityName,
                state: (stateForApi || metroData.state || metroData.zips[0]?.state || '')
                  .toString()
                  .trim()
                  .toUpperCase()
                  .slice(0, 2),
              },
              transitZip: centroidZipMetro,
            })
            return
          }
          setCityZips(data.zips)
          setBoroughBoundary(null)
          setResult(null)
          setTrends(null)
          setPanelOpen(true)
          const st =
            (stateForApi || data.zips[0]?.state || '')
              .toString()
              .trim()
              .toUpperCase()
              .slice(0, 2) || ''
          const aggregateLabel =
            stateRaw ? `${cityName}, ${stateRaw}` : stateForApi ? `${cityName}, ${stateForApi}` : cityName
          const centroidZipCity = data.zips.find((z: CityZip) => z.lat && z.lng)?.zip ?? null
          void loadAggregateSurface({
            zips: data.zips,
            label: aggregateLabel,
            areaKey: typeof data.area_key === 'string' ? data.area_key : null,
            trendsArgs: { cityForKeyword: cityName, state: st },
            transitZip: centroidZipCity,
          })
        } catch {
          setError('Failed to fetch market data')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  async function fetchMarket(e: React.FormEvent) {
    e.preventDefault()
    const input = searchInput.trim()
    if (!input) return

    if (/^\d{5}$/.test(input)) {
      setSearchInput(input)
      await loadZipMarket(input)
      return
    }

    setSearchInput(input)
    await runAggregateSearch(input)
  }

  useEffect(() => {
    const nav = takePendingNav()
    if (!nav) return
    if (nav.type === 'coords') {
      setAgentFlyTo({ lat: nav.lat, lng: nav.lng })
      return
    }
    if (nav.type === 'zip') {
      setSearchInput(nav.zip)
      void loadZipMarket(nav.zip)
    } else {
      setSearchInput(nav.query)
      void runAggregateSearch(nav.query)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot session handoff from /upload
  }, [])

  const fredSeries: Record<string, Array<{ date: string; value: number }>> = {}
  result?.data
    .filter((r) => (r.data_source === 'FRED' || r.data_source === 'Census BPS') && r.time_period)
    .forEach((r) => {
      if (!fredSeries[r.metric_name]) fredSeries[r.metric_name] = []
      fredSeries[r.metric_name].push({ date: r.time_period!, value: r.metric_value })
    })

  const tabularRows = result?.data.filter((r) => r.data_source !== 'FRED' && r.data_source !== 'Census BPS') ?? []
  const zoriGrowth = fmtGrowth(result?.zillow?.zori_growth_12m)
  const marketStatus = result?.metro_velocity?.doz_pending_latest != null
    ? result.metro_velocity.doz_pending_latest < 30 ? 'Active' : 'Moderate'
    : null

  const hasStatsBar = !!(result || aggregateData)
  const intelligenceContextSubtitle = useMemo(() => {
    if (aggregateData) return `${aggregateData.label} · ${formatAggregateScopeLabel(aggregateData)}`
    if (result && cityZips && cityZips.length > 1) {
      const place = cityZips[0]?.city ?? result.zillow?.city ?? result.zip
      return `${place} · ${cityZips.length} ZIPs`
    }
    if (result) return `${result.zillow?.city ?? result.zip} · ${result.zip}`
    return 'No market loaded'
  }, [aggregateData, result, cityZips])
  const supplementalAreaMetrics = useMemo(
    () =>
      aggregateData?.area_metrics?.filter((row) => !CORE_AGGREGATE_AREA_METRICS.has(row.metric_name)) ?? [],
    [aggregateData]
  )

  const statsBubbleBottomClass = useMemo(() => {
    if (!hasStatsBar) return 'bottom-5'
    if (agentTerminalSize === 'collapsed') return 'bottom-10'
    return ''
  }, [hasStatsBar, agentTerminalSize])

  const statsBubbleBottomStyle = useMemo((): CSSProperties | undefined => {
    if (!hasStatsBar || agentTerminalSize === 'collapsed') return undefined
    const h = agentTerminalOpenHeightPx ?? 200
    return { bottom: `calc(${h}px + 1.5rem)` }
  }, [hasStatsBar, agentTerminalSize, agentTerminalOpenHeightPx])

  const effectiveMapTilt = agentTilt != null ? agentTilt : map3DEnabled ? 45 : 0
  const map3DActive = effectiveMapTilt > 0

  const handleMap3DToggle = useCallback(() => {
    if (map3DActive) {
      setMap3DEnabled(false)
      setAgentTilt(null)
    } else {
      setMap3DEnabled(true)
      setAgentTilt(null)
    }
  }, [map3DActive])

  const handleClearAgentOverride = useCallback((key: string) => {
    setAgentLayerOverrides((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const rightPanelVisible =
    panelOpen &&
    (result != null || aggregateData != null || selectedSite != null || agentSidebarTrace != null)

  const sidebarActiveMarket =
    result != null
      ? {
          kind: 'zip' as const,
          title: result.zillow?.city ?? result.zip,
          subtitle: `${result.zip} · ${result.geo?.state ?? '-'}`,
        }
      : cityZips != null && cityZips.length > 0
        ? {
            kind: 'aggregate' as const,
            title: aggregateData?.label ?? cityZips[0]?.city ?? '',
            subtitle: aggregateData ? formatAggregateScopeLabel(aggregateData) : `${cityZips.length} ZIPs · ${cityZips[0]?.state ?? '-'}`,
          }
        : null

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <SitesBootstrap />

      <CommandCenterSidebar
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        error={error}
        loading={loading}
        onAnalyzeSubmit={fetchMarket}
        activeMarket={sidebarActiveMarket}
        activeMarketExtra={
          cycleData ? (
            <p className="mt-1 text-[9px] font-medium text-primary">
              {cycleData.cycleStage} · {cycleData.cyclePosition}
            </p>
          ) : null
        }
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
      />

      {/* ── Map ── - inset-0 fill gives CommandMap a definite box (flex % height + Google Map can otherwise leave overlays misaligned) */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 min-h-0 min-w-0">
        <CommandMap
          zip={result?.zip ?? null}
          marketData={result}
          aggregateData={aggregateData}
          transitData={transit}
          cityZips={cityZips}
          boroughBoundary={boroughBoundary}
          uploadedMarkers={uploadedMarkers}
          shortlistSites={sitesForMap}
          analysisSites={analysisSites}
          agentPermitFilter={agentPermitFilter}
          agentLayerOverrides={agentLayerOverrides}
          agentMetric={agentMetric}
          mapTilt={effectiveMapTilt}
          mapHeading={mapHeading}
          agentFlyTo={agentFlyTo}
          onLayersChange={handleMapLayersChange}
          onClearAgentOverride={handleClearAgentOverride}
          layerStateResync={layerStateResync}
          map3DActive={map3DActive}
          onToggleMap3D={handleMap3DToggle}
          mapViewportRef={mapViewportRef}
        />
        </div>

        <AgentTerminal
          mapContext={mapContext}
          onAction={handleAgentAction}
          contextSubtitle={intelligenceContextSubtitle}
          onSizeChange={setAgentTerminalSize}
          onOpenHeightPxChange={setAgentTerminalOpenHeightPx}
          onSlashSave={handleSlashSave}
          onShowThinking={handleShowAgentThinking}
          onAgentThinkingUpdate={handleAgentThinkingUpdate}
          onAgentThinkingStreamFinished={handleAgentThinkingStreamFinished}
        />

        {/* Floating stats bubble */}
        {(result || aggregateData) && (
          <div
            className={cn(
              'absolute left-1/2 z-30 flex max-w-[calc(100vw-120px)] -translate-x-1/2 items-center gap-0 overflow-hidden rounded-2xl border border-border/80 bg-background/90 shadow-2xl shadow-black/40 backdrop-blur-xl',
              statsBubbleBottomClass
            )}
            style={statsBubbleBottomStyle}
          >
            <div className="scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto px-1">
              {result ? (
                <>
                  <BubbleStat
                    label="Status"
                    value={marketStatus ?? '-'}
                    sub={marketStatus === 'Active' ? '● Live' : marketStatus === 'Moderate' ? '● Moderate' : null}
                    accent={marketStatus === 'Active' ? 'green' : null}
                  />
                  <BubbleDivider />
                  <BubbleStat
                    label="Rent"
                    value={fmtMoney(result.zillow?.zori_latest)}
                    sub={zoriGrowth ? `${zoriGrowth} YoY` : null}
                    accent={result.zillow?.zori_growth_12m != null && result.zillow.zori_growth_12m > 0 ? 'green' : null}
                  />
                  <BubbleDivider />
                  <BubbleStat label="Home Value" value={fmtMoney(result.zillow?.zhvi_latest)} sub={fmtGrowth(result.zillow?.zhvi_growth_12m) ?? null} />
                  <BubbleDivider />
                  <BubbleStat label="Listings" value={fmtNum(result.metro_velocity?.inventory_latest)} sub={result.metro_velocity?.region_name ?? null} />
                  <BubbleDivider />
                  <BubbleStat label="Days Pending" value={fmtNum(result.metro_velocity?.doz_pending_latest, 'd')} />
                  <BubbleDivider />
                  <BubbleStat label="Price Cuts" value={fmtNum(result.metro_velocity?.price_cut_pct_latest, '%')} />
                  {transit && (
                    <>
                      <BubbleDivider />
                      <BubbleStat label="Transit" value={transit.stop_count.toLocaleString()} sub="stops" />
                    </>
                  )}
                  {trends && (
                    <>
                      <BubbleDivider />
                      <BubbleStat
                        label="Interest"
                        value={trends.latest_score != null ? `${trends.latest_score}/100` : '-'}
                        sub={
                          trends.error
                            ? trends.error
                            : [trends.is_fallback ? 'State keyword' : 'Local keyword', trends.keyword_scope].filter(Boolean).join(' · ') || null
                        }
                        accent={trends.error ? 'red' : null}
                      />
                    </>
                  )}
                </>
              ) : aggregateData ? (
                <>
                  <BubbleStat label="ZIPs" value={aggregateData.zip_count.toString()} sub={aggregateData.label} />
                  <BubbleDivider />
                  <BubbleStat
                    label="Avg Rent"
                    value={fmtMoney(aggregateData.zillow.avg_zori)}
                    sub={aggregateData.zillow.zori_growth_12m != null ? `${fmtGrowth(aggregateData.zillow.zori_growth_12m)} YoY` : null}
                    accent="green"
                  />
                  <BubbleDivider />
                  <BubbleStat label="Home Value" value={fmtMoney(aggregateData.zillow.avg_zhvi)} />
                  <BubbleDivider />
                  <BubbleStat label="Population" value={fmtNum(aggregateData.total_population)} />
                  <BubbleDivider />
                  <BubbleStat label="Vacancy" value={fmtNum(aggregateData.housing.vacancy_rate, '%')} />
                  <BubbleDivider />
                  <BubbleStat label="Days Pending" value={fmtNum(aggregateData.metro_velocity?.doz_pending_latest, 'd')} />
                  {trends && (
                    <>
                      <BubbleDivider />
                      <BubbleStat
                        label="Interest"
                        value={trends.latest_score != null ? `${trends.latest_score}/100` : '-'}
                        sub={
                          trends.error
                            ? trends.error
                            : [
                                aggregateData.metro_velocity?.region_name
                                  ? `Metro: ${aggregateData.metro_velocity.region_name}`
                                  : null,
                                trends.keyword_scope,
                              ]
                                .filter(Boolean)
                                .join(' · ') || undefined
                        }
                        accent={trends.error ? 'red' : null}
                      />
                    </>
                  )}
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(!panelOpen)}
              className="flex-shrink-0 border-l border-border/80 px-3 py-2 text-[11px] font-semibold whitespace-nowrap text-primary transition-colors hover:text-foreground"
            >
              {panelOpen ? '✕' : '↗'}
            </button>
          </div>
        )}

      </div>

      {/* ── Right Data Panel ── */}
      <aside
        data-right-panel
        className={cn(
          'z-20 flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-border/80 bg-card transition-[width] duration-300 ease-out',
          !rightPanelVisible && 'border-l-0'
        )}
        style={{ width: rightPanelVisible ? RIGHT_PANEL_WIDTH_PX : 0 }}
      >
        {panelOpen &&
          agentSidebarTrace != null &&
          !selectedSite &&
          !result &&
          !aggregateData && (
            <div className="flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden">
              <AgentThinkingPanel
                trace={agentSidebarTrace}
                embedded={false}
                streaming={agentThinkingStreaming}
                onDismiss={() => {
                  setAgentSidebarTrace(null)
                  setPanelOpen(false)
                }}
              />
            </div>
          )}

        {panelOpen && selectedSite != null && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SiteDetailRightPanel site={selectedSite} onBack={() => setSelectedSite(null)} />
          </div>
        )}

        {!selectedSite && aggregateData && panelOpen && !result && (
          <div className="flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border/50 p-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-bold leading-tight text-foreground">{aggregateData.label}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatAggregateScopeLabel(aggregateData)}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => setPanelOpen(false)} className="text-xl leading-none text-muted-foreground hover:text-foreground">×</button>
                </div>
              </div>
              <div className="mt-3 flex gap-0 overflow-hidden rounded-lg border border-white/10">
                {(['analysis', 'data', 'thinking'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMarketPanelTab(t)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] font-semibold capitalize transition-colors',
                      marketPanelTab === t ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'analysis' ? 'Analysis' : t === 'data' ? 'Data' : 'Thinking'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {marketPanelTab === 'thinking' && (
              <AgentThinkingPanel
                trace={agentSidebarTrace}
                embedded
                streaming={agentThinkingStreaming}
                onDismiss={clearAgentSidebarTrace}
              />
            )}
            {marketPanelTab === 'analysis' && (
              <>
            <MomentumExplainBlock
              anchorZip={cityZips?.find((z) => /^\d{5}$/.test(z.zip))?.zip ?? null}
              aggregateZips={cityZips?.map((z) => z.zip).filter((z) => /^\d{5}$/.test(z)) ?? null}
            />
            {cycleData && (
              <CycleExplainCard
                marketLabel={aggregateData.label}
                cycle={cycleData}
                subtitle="Cycle geography uses the first ZIP in this area; county-level signals (BPS, FRED) follow that anchor."
              />
            )}

            <PanelSection title="Market Report (PDF)">
              <MarketReportExport
                mapLayersSnapshot={mapLayersSnapshot}
                uploadedMarkers={uploadedMarkers}
                comparisonPins={pdfComparisonPins}
                result={null}
                aggregateData={aggregateData}
                cityZips={cityZips}
                trends={trendsShapeForReport(trends)}
                cycleAnalysis={cycleData}
              />
            </PanelSection>
              </>
            )}

            {marketPanelTab === 'data' && (
              <>
            <PanelSection title="Market Pricing (Zillow)">
              <MetricRow metricKey="zori" label="Avg Median Rent (ZORI)" value={fmtMoney(aggregateData.zillow.avg_zori)} sub={aggregateData.zillow.zori_growth_12m != null ? `${fmtGrowth(aggregateData.zillow.zori_growth_12m)} YoY avg` : undefined} />
              <MetricRow metricKey="zhvi" label="Avg Home Value (ZHVI)" value={fmtMoney(aggregateData.zillow.avg_zhvi)} sub={aggregateData.zillow.zhvi_growth_12m != null ? `${fmtGrowth(aggregateData.zillow.zhvi_growth_12m)} YoY avg` : undefined} />
            </PanelSection>

            <PanelSection title="Housing & Demographics">
              <MetricRow metricKey="population" label="Total Population" value={fmtNum(aggregateData.total_population)} />
              <MetricRow metricKey="housingUnits" label="Total Housing Units" value={fmtNum(aggregateData.housing.total_units)} />
              <MetricRow metricKey="vacancy" label="Vacancy Rate" value={fmtNum(aggregateData.housing.vacancy_rate, '%')} />
              <MetricRow metricKey="income" label="Median Household Income" value={fmtMoney(aggregateData.housing.median_income)} />
              <MetricRow metricKey="medianGrossRent" label="Median Gross Rent" value={fmtMoney(aggregateData.housing.median_rent)} />
              {aggregateData.housing.migration_movers != null && (
                <MetricRow metricKey="migration" label="Migration movers (diff. state)" value={fmtNum(aggregateData.housing.migration_movers)} />
              )}
            </PanelSection>

            {supplementalAreaMetrics.length > 0 && (
              <PanelSection title="Area Source Metrics">
                {supplementalAreaMetrics.map((row) => (
                  <MetricRow
                    key={`${row.metric_name}:${row.data_source}:${row.time_period ?? ''}`}
                    metricKey={metricKeyFromDataRow(row.metric_name) ?? undefined}
                    label={row.metric_name.replace(/_/g, ' ')}
                    value={formatMetricValue(row.metric_name, row.metric_value)}
                    sub={[row.data_source, row.time_period?.slice(0, 7)].filter(Boolean).join(' · ')}
                  />
                ))}
              </PanelSection>
            )}

            {aggregateData.permits.total_units != null && aggregateData.permits.total_units > 0 && (
              <PanelSection title="Building Permits (2021–2023)">
                <MetricRow metricKey="permits" label="Total Units Permitted" value={fmtNum(aggregateData.permits.total_units)} />
                <MetricRow metricKey="permitValue" label="Total Construction Value" value={fmtMoney(aggregateData.permits.total_value)} />
              </PanelSection>
            )}

            {aggregateData.metro_velocity && (
              <PanelSection title="Market Velocity">
                <MetricRow metricKey="dozPending" label="Days to Pending" value={fmtNum(aggregateData.metro_velocity.doz_pending_latest, ' days')} />
                <MetricRow metricKey="priceCuts" label="Price Cuts" value={fmtNum(aggregateData.metro_velocity.price_cut_pct_latest, '%')} sub="of listings" />
                <MetricRow metricKey="inventory" label="Active Inventory" value={fmtNum(aggregateData.metro_velocity.inventory_latest)} />
              </PanelSection>
            )}

            {trends && (
              <PanelSection title="Search sentiment (Google Trends)">
                {trends.error && <p className="text-amber-400 text-[10px] mb-2 leading-snug">{trends.error}</p>}
                {!trends.error && trends.empty_message && (
                  <p className="text-zinc-500 text-[10px] mb-2 leading-snug">{trends.empty_message}</p>
                )}
                {trends.geo_note && (
                  <p className="text-zinc-600 text-[9px] mb-2 leading-snug">{trends.geo_note}</p>
                )}
                <MetricRow
                  metricKey="trends"
                  label="Interest score"
                  value={trends.latest_score != null ? `${trends.latest_score} / 100` : '-'}
                  sub={trends.keyword_scope}
                />
                {trends.data_points > 1 && trends.series.length > 1 && (
                  <div className="flex items-end gap-px h-7 mt-2">
                    {trends.series.map((p, i) => (
                      <div key={i} className="flex-1 bg-white/20 rounded-sm" style={{ height: `${Math.max(p.value, 4)}%` }} />
                    ))}
                  </div>
                )}
              </PanelSection>
            )}

            {aggregateData.fred.length > 0 && (
              <PanelSection title="Economic Indicators (FRED)">
                {Object.entries(
                  aggregateData.fred.reduce((acc, r) => {
                    if (!acc[r.metric_name]) acc[r.metric_name] = []
                    acc[r.metric_name].push(r)
                    return acc
                  }, {} as Record<string, typeof aggregateData.fred>)
                ).map(([metric, points]) => {
                  const sorted = [...points].sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
                  const latest = sorted.at(-1)
                  const max = Math.max(...sorted.map((x) => x.metric_value))
                  const min = Math.min(...sorted.map((x) => x.metric_value))
                  const isRate = metric.includes('Rate')
                  const isMoney = metric.includes('GDP')
                  const latestDisplay = isMoney ? fmtMoney(latest?.metric_value) : isRate ? fmtNum(latest?.metric_value, '%') : fmtNum(latest?.metric_value)
                  const mk = sparklineMetricKey(metric)
                  const labelText = metric.replace(/_/g, ' ')
                  return (
                    <div key={metric} className="mb-3">
                      <div className="flex justify-between mb-1">
                        <p className="text-zinc-400 text-[11px]">
                          {mk ? <MetricTooltip metricKey={mk}>{labelText}</MetricTooltip> : labelText}
                        </p>
                        <p className="text-white text-[11px] font-medium">{latestDisplay}</p>
                      </div>
                      <div className="flex items-end gap-px h-7">
                        {sorted.map((p, i) => {
                          const height = max === min ? 50 : ((p.metric_value - min) / (max - min)) * 100
                          return <div key={i} className="flex-1 rounded-sm bg-primary/45" style={{ height: `${Math.max(height, 6)}%` }} />
                        })}
                      </div>
                    </div>
                  )
                })}
              </PanelSection>
            )}

            {cityZips && cityZips.length > 0 && (
              <AggregateShortlistToggle
                aggregateData={aggregateData}
                cityZips={cityZips}
                cycle={cycleData}
                savedSearch={searchInput}
              />
            )}
              </>
            )}
            </div>
          </div>
        )}

        {!selectedSite && result && panelOpen && (
          <div className="flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border/50 p-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-bold leading-tight text-foreground">{result.zillow?.city ?? result.zip}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{result.zillow?.metro_name ?? ''} · {result.zip}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => setPanelOpen(false)} className="text-xl leading-none text-muted-foreground hover:text-foreground">×</button>
                </div>
              </div>
              <div className="mt-3 flex gap-0 overflow-hidden rounded-lg border border-white/10">
                {(['analysis', 'data', 'thinking'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMarketPanelTab(t)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] font-semibold capitalize transition-colors',
                      marketPanelTab === t ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'analysis' ? 'Analysis' : t === 'data' ? 'Data' : 'Thinking'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {marketPanelTab === 'thinking' && (
              <AgentThinkingPanel
                trace={agentSidebarTrace}
                embedded
                streaming={agentThinkingStreaming}
                onDismiss={clearAgentSidebarTrace}
              />
            )}
            {marketPanelTab === 'analysis' && (
              <>
            <MomentumExplainBlock anchorZip={/^\d{5}$/.test(result.zip) ? result.zip : null} aggregateZips={null} />
            {cycleData && (
              <CycleExplainCard marketLabel={result.zillow?.city ?? result.zip} cycle={cycleData} />
            )}

            <PanelSection title="Market Report (PDF)">
              <MarketReportExport
                mapLayersSnapshot={mapLayersSnapshot}
                uploadedMarkers={uploadedMarkers}
                comparisonPins={pdfComparisonPins}
                result={result}
                aggregateData={null}
                cityZips={null}
                trends={trendsShapeForReport(trends)}
                cycleAnalysis={cycleData}
              />
            </PanelSection>
              </>
            )}

            {marketPanelTab === 'data' && (
              <>
            {/* Zillow pricing */}
            {result.zillow && (
              <PanelSection title="Market Pricing">
                <MetricRow metricKey="zori" label="Median Rent (ZORI)" value={fmtMoney(result.zillow.zori_latest)} sub={zoriGrowth ? `${zoriGrowth} YoY` : undefined} />
                <MetricRow metricKey="zhvi" label="Home Value (ZHVI)" value={fmtMoney(result.zillow.zhvi_latest)} sub={fmtGrowth(result.zillow.zhvi_growth_12m) ?? undefined} />
                <MetricRow
                  metricKey="zhvf"
                  label="1yr Forecast"
                  value={result.zillow.zhvf_growth_1yr != null && Math.abs(result.zillow.zhvf_growth_1yr) < 50
                    ? fmtNum(result.zillow.zhvf_growth_1yr, '%') : '-'}
                />
              </PanelSection>
            )}

            {/* Metro velocity */}
            {result.metro_velocity && (
              <PanelSection title="Market Velocity">
                <MetricRow metricKey="dozPending" label="Days to Pending" value={fmtNum(result.metro_velocity.doz_pending_latest, ' days')} />
                <MetricRow metricKey="priceCuts" label="Price Cuts" value={fmtNum(result.metro_velocity.price_cut_pct_latest, '%')} sub="of listings" />
                <MetricRow metricKey="inventory" label="Active Inventory" value={fmtNum(result.metro_velocity.inventory_latest)} />
              </PanelSection>
            )}

            {/* Demographics */}
            {tabularRows.length > 0 && (
              <PanelSection title="Demographics & Affordability">
                {tabularRows.map((r) => (
                  <MetricRow
                    key={r.metric_name + r.data_source}
                    metricKey={metricKeyFromDataRow(r.metric_name) ?? undefined}
                    label={r.metric_name}
                    value={formatMetricValue(r.metric_name, r.metric_value)}
                    sub={r.data_source}
                  />
                ))}
              </PanelSection>
            )}

            {/* FRED sparklines */}
            {Object.keys(fredSeries).length > 0 && (
              <PanelSection title="Economic Indicators">
                {Object.entries(fredSeries).map(([metric, points]) => {
                  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
                  const latest = sorted.at(-1)
                  const max = Math.max(...sorted.map((x) => x.value))
                  const min = Math.min(...sorted.map((x) => x.value))
                  const isRate = metric.includes('Rate')
                  const isMoney = metric.includes('GDP') || metric.includes('Value') || metric.includes('Permit_Value')
                  const latestDisplay = isMoney ? fmtMoney(latest?.value) : isRate ? fmtNum(latest?.value, '%') : fmtNum(latest?.value)
                  const mk = sparklineMetricKey(metric)
                  const labelText = metric.replace(/_/g, ' ')
                  return (
                    <div key={metric} className="mb-3">
                      <div className="flex justify-between mb-1">
                        <p className="text-zinc-400 text-[11px]">
                          {mk ? <MetricTooltip metricKey={mk}>{labelText}</MetricTooltip> : labelText}
                        </p>
                        <p className="text-white text-[11px] font-medium">{latestDisplay}</p>
                      </div>
                      <div className="flex items-end gap-px h-7">
                        {sorted.map((p, i) => {
                          const height = max === min ? 50 : ((p.value - min) / (max - min)) * 100
                          return <div key={i} className="flex-1 rounded-sm bg-primary/45" style={{ height: `${Math.max(height, 6)}%` }} />
                        })}
                      </div>
                    </div>
                  )
                })}
              </PanelSection>
            )}

            {/* Google Trends */}
            {trends && (
              <PanelSection title="Search sentiment (Google Trends)">
                {trends.error && <p className="text-amber-400 text-[10px] mb-2 leading-snug">{trends.error}</p>}
                {!trends.error && trends.empty_message && (
                  <p className="text-zinc-500 text-[10px] mb-2 leading-snug">{trends.empty_message}</p>
                )}
                {trends.geo_note && (
                  <p className="text-zinc-600 text-[9px] mb-2 leading-snug">{trends.geo_note}</p>
                )}
                <MetricRow
                  metricKey="trends"
                  label="Interest score"
                  value={trends.latest_score != null ? `${trends.latest_score} / 100` : '-'}
                  sub={trends.keyword_scope}
                />
                {trends.data_points > 1 && trends.series.length > 1 && (
                  <div className="flex items-end gap-px h-7 mt-2">
                    {trends.series.map((p, i) => (
                      <div key={i} className="flex-1 bg-white/20 rounded-sm" style={{ height: `${Math.max(p.value, 4)}%` }} />
                    ))}
                  </div>
                )}
              </PanelSection>
            )}

            {/* Transit */}
            {transit && transit.stop_count > 0 && (
              <PanelSection title="Transit Connectivity">
                <MetricRow metricKey="transit" label="Nearby Stops" value={transit.stop_count.toLocaleString()} sub="bus stops within radius" />
              </PanelSection>
            )}

            {result?.geo && /^\d{5}$/.test(result.zip) && (
              <ShortlistToggleButton market={result} cycle={cycleData} />
            )}

            <details className="mb-4 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                All metrics (flat table)
              </summary>
              <div className="mt-3 space-y-0 border-t border-border/40 pt-2">
                {result.zillow && (
                  <>
                    <MetricRow label="Median Rent (ZORI)" value={fmtMoney(result.zillow.zori_latest)} sub={zoriGrowth ?? undefined} />
                    <MetricRow label="Home Value (ZHVI)" value={fmtMoney(result.zillow.zhvi_latest)} sub={fmtGrowth(result.zillow.zhvi_growth_12m) ?? undefined} />
                    <MetricRow
                      label="1yr Forecast"
                      value={
                        result.zillow.zhvf_growth_1yr != null && Math.abs(result.zillow.zhvf_growth_1yr) < 50
                          ? fmtNum(result.zillow.zhvf_growth_1yr, '%')
                          : '-'
                      }
                    />
                  </>
                )}
                {result.metro_velocity && (
                  <>
                    <MetricRow label="Days to Pending" value={fmtNum(result.metro_velocity.doz_pending_latest, ' days')} />
                    <MetricRow label="Price Cuts" value={fmtNum(result.metro_velocity.price_cut_pct_latest, '%')} sub="of listings" />
                    <MetricRow
                      label="Active Inventory"
                      value={fmtNum(result.metro_velocity.inventory_latest)}
                      sub={result.metro_velocity.region_name}
                    />
                  </>
                )}
                {tabularRows.map((r) => (
                  <MetricRow
                    key={r.metric_name}
                    label={r.metric_name}
                    value={formatMetricValue(r.metric_name, r.metric_value)}
                    sub={r.data_source}
                  />
                ))}
                {transit && <MetricRow label="Transit Stops" value={transit.stop_count.toLocaleString()} sub="nearby stops" />}
                {trends?.latest_score != null && (
                  <MetricRow
                    label="Search Interest"
                    value={`${trends.latest_score} / 100`}
                    sub={trends.is_fallback ? 'state-level' : 'local'}
                  />
                )}
              </div>
            </details>

            {clientUploadAgg && (
              <PanelSection title="Client CSV (last upload)">
                <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                  {clientUploadAgg.fileNameLabel && (
                    <span className="font-mono text-foreground/90">{clientUploadAgg.fileNameLabel}</span>
                  )}{' '}
                  {clientUploadAgg.sourceCount > 1 ? (
                    <span className="text-zinc-500">({clientUploadAgg.sourceCount} files)</span>
                  ) : null}{' '}
                  · {clientUploadAgg.triage.bucket} / {clientUploadAgg.triage.visual_bucket} ·{' '}
                  {clientUploadAgg.rowsIngested} rows
                  {clientUploadAgg.mapPinsActive ? (
                    <span className="text-primary"> · {clientUploadAgg.markerCount} map pin(s)</span>
                  ) : null}
                </p>
                <p className="mb-2 text-[10px] italic text-zinc-500">&quot;{clientUploadAgg.reasoning}&quot;</p>
                <div className="max-h-40 overflow-auto rounded border border-border/50 text-[10px]">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/30 text-left text-[9px] uppercase text-muted-foreground">
                        <th className="p-1.5">Geo</th>
                        <th className="p-1.5">Metric</th>
                        <th className="p-1.5">Value</th>
                        <th className="p-1.5">Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientUploadAgg.previewRows.map((r, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td className="p-1.5 font-mono text-foreground/90">{r.submarket_id ?? '—'}</td>
                          <td className="p-1.5 text-muted-foreground">{r.metric_name}</td>
                          <td className="p-1.5">{r.metric_value != null ? r.metric_value.toLocaleString() : '—'}</td>
                          <td className="p-1.5 text-zinc-500">{r.time_period ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!clientUploadAgg.mapPinsActive && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Not on map — you are viewing it here in this <span className="text-foreground">preview table</span>{' '}
                    (first rows returned from normalize). Full series is in Supabase{' '}
                    <span className="text-foreground">projectr_master_data</span> under{' '}
                    <span className="text-foreground">Client Upload</span>. Only rows with a real geography key or
                    metric value are persisted there, so table-only uploads may stay in this preview path instead of
                    appearing in <span className="text-foreground">All metrics (flat table)</span> above.
                  </p>
                )}
              </PanelSection>
            )}

            <PanelSection title="Agentic Normalizer">
              <AgenticNormalizer currentZip={result.zip} onIngested={handleNormalizerIngested} />
            </PanelSection>
              </>
            )}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
