'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ExecutiveMemo from '@/components/ExecutiveMemo'
import AgenticNormalizer from '@/components/AgenticNormalizer'
import MarketReportExport from '@/components/MarketReportExport'
import AgentChat, { type AgentAction, type AnalysisSite } from '@/components/AgentChat'
import type { CycleAnalysis } from '@/lib/cycle/types'
import type { MapLayersSnapshot } from '@/lib/report/types'
import { parseCycleAnalysisField } from '@/lib/report/validate-cycle'
import { useSitesStore } from '@/lib/sites-store'
import type { Site } from '@/lib/sites-store'
import { useClientUploadMarkersStore } from '@/lib/client-upload-markers-store'
import SitesBootstrap from '@/components/SitesBootstrap'
import ShortlistPanel from '@/components/ShortlistPanel'
import { takePendingNav } from '@/lib/pending-navigation'
import { MetricTooltip } from '@/components/MetricTooltip'
import { MomentumExplainBlock } from '@/components/MomentumExplainBlock'
import { CycleExplainCard } from '@/components/CycleExplainCard'
import type { MetricKey } from '@/lib/metric-definitions'
import { metricKeyFromDataRow, sparklineMetricKey } from '@/lib/metric-definitions'
import { cn } from '@/lib/utils'

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
  zip: string
  stop_count: number
  route_count?: number
  routes?: Array<{
    id: string
    name: string
    long_name?: string
    type: string
    route_type?: number
    color: [number, number, number]
    paths: [number, number][][]
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
      color: [number, number, number]
      paths: [number, number][][]
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

interface AggregateData {
  label: string
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

const NYC_BOROUGHS = new Set(['manhattan', 'brooklyn', 'queens', 'bronx', 'staten island'])

interface MarketData {
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

/** Human-facing site name for shortlist / PDF (ZIP stays the data key only). */
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

/** Map pin anchor for a city/borough ZIP list (first ZIP with coords, else geocode first ZIP). */
async function resolveAggregateAnchorGeo(cityZips: CityZip[]): Promise<{ zip: string; lat: number; lng: number } | null> {
  const withGeo = cityZips.find((z) => z.lat != null && z.lng != null && /^\d{5}$/.test(z.zip))
  const fallback = cityZips.find((z) => /^\d{5}$/.test(z.zip))
  const z = withGeo ?? fallback
  if (!z) return null
  if (z.lat != null && z.lng != null) return { zip: z.zip, lat: z.lat, lng: z.lng }
  try {
    const res = await fetch(`/api/market?zip=${encodeURIComponent(z.zip)}`)
    const data = await res.json()
    if (data.geo?.lat != null && data.geo?.lng != null) {
      return { zip: z.zip, lat: data.geo.lat, lng: data.geo.lng }
    }
  } catch {
    /* ignore */
  }
  return null
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined, suffix = '') {
  if (n == null) return '—'
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
      keyword_scope: `Search sentiment unavailable — ${t.error}`,
    }
  }
  const scopeParts = [t.geo_note, t.keyword_scope].filter((s): s is string => Boolean(s && String(s).trim()))
  let keyword_scope = scopeParts.join(' · ')
  if (t.empty_message) {
    keyword_scope = keyword_scope ? `${keyword_scope} — ${t.empty_message}` : t.empty_message
  }
  return { series: t.series, keyword_scope: keyword_scope || t.keyword_scope || 'Google Trends' }
}

const MONEY_METRICS = ['Rent', 'Income', 'FMR', 'Value', 'Price']
const RATE_METRICS = ['Unemployment', 'Rate']

function formatMetricValue(name: string, value: number) {
  if (MONEY_METRICS.some((k) => name.includes(k))) return fmtMoney(value)
  if (RATE_METRICS.some((k) => name.includes(k))) return fmtNum(value, '%')
  if (name === 'Population_Growth_3yr') return fmtNum(value, '%')
  return fmtNum(value)
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
    let momentum: number | null = null
    try {
      const res = await fetch('/api/momentum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zips: [zipCode] }),
      })
      if (res.ok) {
        const j = (await res.json()) as { scores?: { zip: string; score: number }[] }
        momentum = j.scores?.find((x) => x.zip === zipCode)?.score ?? null
      }
    } catch {
      /* non-fatal */
    }
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
      {pending ? 'Saving…' : hasZip ? '✓ On shortlist — tap to remove' : '+ Add to shortlist'}
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
      setLocalError('Could not place pin — no coordinates for this area.')
      setPending(false)
      return
    }
    let momentum: number | null = null
    try {
      const zipsList = cityZips.map((z) => z.zip).filter((z) => /^\d{5}$/.test(z))
      if (zipsList.length) {
        const res = await fetch('/api/momentum', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zips: zipsList.slice(0, 40) }),
        })
        if (res.ok) {
          const j = (await res.json()) as { scores?: { zip: string; score: number }[] }
          momentum = j.scores?.find((x) => x.zip === pin.zip)?.score ?? null
        }
      }
    } catch {
      /* optional */
    }
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
        {pending ? 'Saving…' : hasArea ? '✓ Area on shortlist — tap to remove' : '+ Add area to shortlist'}
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

function SidebarNavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const pathname = usePathname()
  const active =
    href === '/'
      ? pathname === '/' || pathname === ''
      : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors',
        active
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-white'
      )}
    >
      <span className="h-4 w-4 flex-shrink-0">{icon}</span>
      <span className="font-medium tracking-wide">{label}</span>
    </Link>
  )
}

function SidebarCollapsedLink({ href, icon, title }: { href: string; icon: React.ReactNode; title: string }) {
  const pathname = usePathname()
  const active =
    href === '/'
      ? pathname === '/' || pathname === ''
      : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        'mx-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-zinc-500 hover:text-white'
      )}
    >
      {icon}
    </Link>
  )
}

const DEFAULT_MAP_LAYERS: MapLayersSnapshot = {
  zipBoundary: false,
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
const MapIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" /></svg>
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
const ChevronRight = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><polyline points="9 18 15 12 9 6" /></svg>
const CollapseIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><polyline points="15 18 9 12 15 6" /></svg>
const ExpandIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><polyline points="9 18 15 12 9 6" /></svg>

const SIDEBAR_EXPANDED_PX = 240

/** Agent-selected parcel / site — lives in the right panel, not over the map. */
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
              {site.zori_growth != null ? `+${site.zori_growth.toFixed(1)}%` : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">12m YoY</p>
          </div>
        </div>
        <div className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold text-primary">Why this site?</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {site.far_utilization < 0.2
              ? `Severely underbuilt — only ${(site.far_utilization * 100).toFixed(0)}% of allowable FAR developed. `
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
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentUnread, setAgentUnread] = useState(false)
  const [agentLayerOverrides, setAgentLayerOverrides] = useState<Record<string, boolean>>({})
  const [agentMetric, setAgentMetric] = useState<'zori' | 'zhvi' | null>(null)
  const [agentTilt, setAgentTilt] = useState<number | null>(null)
  /** User 3D pill (45°) when agent has not overridden tilt. */
  const [map3DEnabled, setMap3DEnabled] = useState(false)
  const [analysisSites, setAnalysisSites] = useState<import('@/components/AgentChat').AnalysisSite[]>([])
  const [agentPermitFilter, setAgentPermitFilter] = useState<string[] | null>(null)
  const [selectedSite, setSelectedSite] = useState<AnalysisSite | null>(null)
  const [agentFlyTo, setAgentFlyTo] = useState<{ lat: number; lng: number } | null>(null)
  const [transit, setTransit] = useState<TransitData | null>(null)
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [cycleData, setCycleData] = useState<CycleAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [mapLayersSnapshot, setMapLayersSnapshot] = useState<MapLayersSnapshot>(DEFAULT_MAP_LAYERS)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [marketPanelTab, setMarketPanelTab] = useState<'analysis' | 'data'>('analysis')

  function handleNormalizerIngested(res: { triage: { bucket: string }; marker_points?: Array<{ lat: number; lng: number; value: number | null; label: string }> }) {
    // markers are handled via useClientUploadMarkersStore in AgenticNormalizer
    void res
  }

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

  function handleAgentAction(action: AgentAction) {
    switch (action.type) {
      case 'toggle_layer':
        if (action.layer) setAgentLayerOverrides((prev) => ({ ...prev, [action.layer!]: action.value ?? true }))
        break
      case 'toggle_layers':
        if (action.layers) setAgentLayerOverrides((prev) => ({ ...prev, ...action.layers }))
        break
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
      case 'set_tilt':
        if (action.tilt != null) {
          setAgentTilt(action.tilt)
          setMap3DEnabled(false)
        }
        break
      case 'show_sites':
        if (action.sites) setAnalysisSites(action.sites)
        break
      case 'set_permit_filter':
        if (action.types) setAgentPermitFilter(action.types)
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
  }

  const mapContext = {
    label: result ? (result.zillow?.city ?? result.zip) : aggregateData?.label,
    zip: result?.zip ?? null,
    layers: agentLayerOverrides,
    activeMetric: agentMetric ?? 'zori',
    zori: result?.zillow?.zori_latest ?? aggregateData?.zillow.avg_zori,
    zhvi: result?.zillow?.zhvi_latest ?? aggregateData?.zillow.avg_zhvi,
    zoriGrowth: result?.zillow?.zori_growth_12m ?? aggregateData?.zillow.zori_growth_12m,
    zhviGrowth: result?.zillow?.zhvi_growth_12m ?? aggregateData?.zillow.zhvi_growth_12m,
    vacancyRate: result?.data.find((r) => r.metric_name === 'Vacancy_Rate')?.metric_value ?? aggregateData?.housing.vacancy_rate,
    dozPending: result?.metro_velocity?.doz_pending_latest ?? aggregateData?.metro_velocity?.doz_pending_latest,
    priceCuts: result?.metro_velocity?.price_cut_pct_latest ?? aggregateData?.metro_velocity?.price_cut_pct_latest,
    inventory: result?.metro_velocity?.inventory_latest ?? aggregateData?.metro_velocity?.inventory_latest,
    transitStops: transit?.stop_count,
    population: result?.data.find((r) => r.metric_name === 'Total_Population')?.metric_value ?? aggregateData?.total_population,
  }

  async function fetchAggregate(zips: string[], label: string) {
    try {
      const res = await fetch('/api/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zips, label }),
      })
      const data = await res.json()
      if (!data.error) {
        setAggregateData(data)
        const anchor = zips.find((z) => /^\d{5}$/.test(z))
        if (anchor) {
          void fetch(`/api/cycle?zip=${encodeURIComponent(anchor)}&label=${encodeURIComponent(label)}`)
            .then((r) => r.json())
            .then((j: unknown) => {
              const rec = j as { error?: string }
              if (rec.error) setCycleData(null)
              else setCycleData(parseCycleAnalysisField(j))
            })
            .catch(() => setCycleData(null))
        } else {
          setCycleData(null)
        }
      }
    } catch { /* non-critical */ }
  }

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
        const [marketRes, transitRes, trendsRes, cycleRes] = await Promise.all([
          fetch(`/api/market?zip=${zipInput}`),
          fetch(`/api/transit?zip=${zipInput}`),
          fetch(`/api/trends?zip=${zipInput}`),
          fetch(`/api/cycle?zip=${encodeURIComponent(zipInput)}`),
        ])
        const data = await marketRes.json()
        const transitData = await transitRes.json()
        const trendsData = (await trendsRes.json()) as Record<string, unknown>
        const cycleJson = await cycleRes.json()
        if (data.error) {
          setError(data.error)
          return
        }
        setResult(data)
        if (!transitData.error) setTransit(transitData)
        applyTrendsApiBody(trendsData, trendsRes.ok)
        const parsedCycle =
          cycleRes.ok && !('error' in cycleJson && cycleJson.error) ? parseCycleAnalysisField(cycleJson) : null
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

  async function fetchTrendsForMultiZipArea(
    cityZips: CityZip[],
    args: { cityForKeyword: string; state: string }
  ) {
    const first = cityZips[0]
    if (!first?.zip) {
      setTrends(null)
      return
    }
    const st = args.state.trim().toUpperCase()
    let url: string
    if (st.length === 2) {
      url = `/api/trends?city=${encodeURIComponent(args.cityForKeyword.trim())}&state=${encodeURIComponent(st)}&anchor_zip=${encodeURIComponent(first.zip)}`
    } else {
      url = `/api/trends?zip=${encodeURIComponent(first.zip)}`
    }
    try {
      const trendsRes = await fetch(url)
      const trendsData = (await trendsRes.json()) as Record<string, unknown>
      applyTrendsApiBody(trendsData, trendsRes.ok)
    } catch {
      applyTrendsApiBody(null, false)
    }
  }

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
      if (NYC_BOROUGHS.has(lowerInput)) {
        try {
          const res = await fetch(`/api/borough?name=${encodeURIComponent(lowerInput)}`)
          const data = await res.json()
          if (data.error || !data.zips?.length) {
            setError(`No data found for "${trimmed}"`)
            return
          }
          setCityZips(data.zips)
          setBoroughBoundary(data.boundary ?? null)
          setResult(null)
          setTrends(null)
          setPanelOpen(true)
          fetchAggregate(data.zips.map((z: CityZip) => z.zip), data.borough)
          void fetchTrendsForMultiZipArea(data.zips, {
            cityForKeyword: data.borough,
            state: typeof data.state === 'string' ? data.state : 'NY',
          })
          // Fetch transit for the centroid ZIP
          const centroidZip = data.zips.find((z: CityZip) => z.lat && z.lng)?.zip
          if (centroidZip) {
            fetch(`/api/transit?zip=${centroidZip}`)
              .then((r) => r.json())
              .then((d) => { if (!d.error) setTransit({ ...d, zip: centroidZip }) })
              .catch(() => {})
          } else {
            setTransit(null)
          }
        } catch {
          setError('Failed to fetch borough data')
        }
      } else {
        const parts = trimmed.split(',').map((s) => s.trim())
        const cityName = parts[0]
        const stateAbbr = parts[1] ?? ''
        try {
          const url = `/api/city?city=${encodeURIComponent(cityName)}${stateAbbr ? `&state=${stateAbbr}` : ''}`
          const res = await fetch(url)
          const data = await res.json()
          if (data.error || !data.zips?.length) {
            setError(`No data found for "${trimmed}". Try "City, ST" format.`)
            return
          }
          setCityZips(data.zips)
          setBoroughBoundary(null)
          setResult(null)
          setTrends(null)
          setPanelOpen(true)
          const st =
            (stateAbbr || data.zips[0]?.state || '')
              .toString()
              .trim()
              .toUpperCase()
              .slice(0, 2) || ''
          fetchAggregate(data.zips.map((z: CityZip) => z.zip), `${cityName}${stateAbbr ? ', ' + stateAbbr : ''}`)
          void fetchTrendsForMultiZipArea(data.zips, { cityForKeyword: cityName, state: st })
          // Fetch transit for the centroid ZIP
          const centroidZipCity = data.zips.find((z: CityZip) => z.lat && z.lng)?.zip
          if (centroidZipCity) {
            fetch(`/api/transit?zip=${centroidZipCity}`)
              .then((r) => r.json())
              .then((d) => { if (!d.error) setTransit({ ...d, zip: centroidZipCity }) })
              .catch(() => {})
          } else {
            setTransit(null)
          }
        } catch {
          setError('Failed to fetch city data')
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
  const effectiveMapTilt = agentTilt != null ? agentTilt : map3DEnabled ? 45 : 0
  const map3DActive = effectiveMapTilt > 0

  function handleMap3DToggle() {
    if (map3DActive) {
      setMap3DEnabled(false)
      setAgentTilt(null)
    } else {
      setMap3DEnabled(true)
      setAgentTilt(null)
    }
  }

  const sidebarActiveMarket =
    result != null
      ? {
          kind: 'zip' as const,
          title: result.zillow?.city ?? result.zip,
          subtitle: `${result.zip} · ${result.geo?.state ?? '—'}`,
        }
      : cityZips != null && cityZips.length > 0
        ? {
            kind: 'aggregate' as const,
            title: cityZips[0]?.city ?? '',
            subtitle: `${cityZips.length} ZIPs · ${cityZips[0]?.state ?? '—'}`,
          }
        : null

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <SitesBootstrap />

      {/* ── Left Sidebar — collapsible ── */}
      <aside
        className="flex-shrink-0 flex flex-col bg-[#0a0a0a] border-r border-white/8 z-20 transition-all duration-200"
        style={{ width: sidebarCollapsed ? 48 : SIDEBAR_EXPANDED_PX }}
      >
        {/* Logo + collapse toggle */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-white/8 min-h-[56px]">
          {!sidebarCollapsed && (
            <Image src="/Projectr_Logo.png" alt="Projectr" width={120} height={32} loading="eager" style={{ width: 'auto', height: '28px' }} />
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="text-zinc-500 hover:text-white transition-colors flex-shrink-0 ml-auto"
          >
            {sidebarCollapsed ? <ExpandIcon /> : <CollapseIcon />}
          </button>
        </div>

        {/* Search — hidden when collapsed */}
        {!sidebarCollapsed && (
          <div className="px-3 py-3 border-b border-white/8">
            <form onSubmit={fetchMarket}>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
                  <SearchIcon />
                </span>
                {loading && (
                  <span
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#D76B3D]"
                    aria-label="Loading"
                  >
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-90"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  </span>
                )}
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  disabled={loading}
                  placeholder="ZIP, City, ST, or Borough — Enter"
                  className={cn(
                    'w-full bg-white/5 border border-white/10 rounded-md pl-7 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#D76B3D]/50 transition-colors disabled:opacity-60',
                    loading ? 'pr-9' : 'pr-3'
                  )}
                />
              </div>
              {error && <p className="text-red-400 text-[10px] mt-1 px-0.5">{error}</p>}
            </form>
          </div>
        )}

        {/* Search icon when collapsed */}
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="flex items-center justify-center h-10 text-zinc-500 hover:text-white transition-colors"
            title="Search"
          >
            <SearchIcon />
          </button>
        )}

        {!sidebarCollapsed && (
          <div className="border-b border-white/8 px-2 py-2">
            <SidebarNavLink href="/" icon={<MapIcon />} label="Map" />
            <SidebarNavLink href="/upload" icon={<UploadIcon />} label="Client CSV" />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {sidebarCollapsed ? (
              <div className="flex flex-col gap-1">
                <SidebarCollapsedLink href="/" icon={<MapIcon />} title="Map" />
                <SidebarCollapsedLink href="/upload" icon={<UploadIcon />} title="Client CSV upload" />
              </div>
            ) : (
              <>
                <ShortlistPanel
                  onOpenSite={(site: Site) => {
                    if (site.isAggregate && site.savedSearch?.trim()) {
                      const q = site.savedSearch.trim()
                      setSearchInput(q)
                      void runAggregateSearch(q)
                      return
                    }
                    setSearchInput(site.zip)
                    void loadZipMarket(site.zip)
                  }}
                />
                {(result || cityZips) && (
                  <div className="mt-2 border-t border-white/8 pt-2">
                    <button
                      type="button"
                      className="w-full rounded-lg border border-white/8 bg-white/5 p-2.5 text-left transition-colors hover:border-primary/40"
                      onClick={() => setPanelOpen(!panelOpen)}
                    >
                      <div className="mb-0.5 flex items-center justify-between">
                        <p className="text-[9px] uppercase tracking-widest text-zinc-500">Active market</p>
                        <ChevronRight />
                      </div>
                      {result ? (
                        <>
                          <p className="text-sm font-semibold text-white">{result.zillow?.city ?? result.zip}</p>
                          <p className="text-[10px] text-zinc-500">{result.zip} · {result.geo?.state}</p>
                          {cycleData && (
                            <p className="mt-1 text-[9px] font-medium text-primary">
                              {cycleData.cycleStage} · {cycleData.cyclePosition}
                            </p>
                          )}
                        </>
                      ) : cityZips ? (
                        <>
                          <p className="text-sm font-semibold text-white">{cityZips[0]?.city}</p>
                          <p className="text-[10px] text-zinc-500">
                            {cityZips.length} ZIPs · {cityZips[0]?.state}
                          </p>
                          {cycleData && (
                            <p className="mt-1 text-[9px] font-medium text-primary">
                              {cycleData.cycleStage} · {cycleData.cyclePosition}
                            </p>
                          )}
                        </>
                      ) : null}
                    </button>
                  </div>
                )}
              </>
            )}
          </nav>

          <div
            className={`flex-shrink-0 border-t border-white/8 px-2 py-2 ${sidebarCollapsed ? 'flex justify-center' : 'px-3'}`}
          >
            <button
              type="button"
              onClick={() => {
                setAgentOpen(true)
                setAgentUnread(false)
              }}
              className="relative flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-md transition-transform hover:scale-105"
              style={{ background: '#D76B3D' }}
              title="Open AI agent"
            >
              AI
              {agentUnread && (
                <span
                  className="absolute top-0 right-0 h-2 w-2 rounded-full border-2 border-[#0a0a0a]"
                  style={{ background: '#ef4444' }}
                />
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Map ── — inset-0 fill gives CommandMap a definite box (flex % height + Google Map can otherwise leave overlays misaligned) */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 min-h-0 min-w-0">
        <CommandMap
          zip={result?.zip ?? null}
          marketData={result}
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
          mapHeading={0}
          agentFlyTo={agentFlyTo}
          onLayersChange={handleMapLayersChange}
          onClearAgentOverride={(key) => setAgentLayerOverrides((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          })}
        />
        </div>

        {/* Floating stats bubble */}
        {(result || aggregateData) && (
          <div className="absolute bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-120px)] -translate-x-1/2 items-center gap-0 overflow-hidden rounded-2xl border border-border/80 bg-background/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto px-1">
              {result ? (
                <>
                  <BubbleStat
                    label="Status"
                    value={marketStatus ?? '—'}
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
                        value={trends.latest_score != null ? `${trends.latest_score}/100` : '—'}
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
                        value={trends.latest_score != null ? `${trends.latest_score}/100` : '—'}
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

        {/* AI Agent Chat — docked near sidebar when open */}
        {agentOpen && (
          <div
            className="pointer-events-none fixed z-50 flex max-h-[min(520px,72vh)] w-[min(360px,calc(100vw-1rem))] justify-start"
            style={{
              bottom: hasStatsBar ? '7.25rem' : '2.5rem',
              left: sidebarCollapsed ? '3.5rem' : `${SIDEBAR_EXPANDED_PX / 16}rem`,
            }}
          >
            <div className="pointer-events-auto max-h-full w-full">
              <AgentChat
                mapContext={mapContext}
                onAction={handleAgentAction}
                isOpen
                onToggle={() => setAgentOpen(false)}
                onClose={() => {
                  setAgentOpen(false)
                  setAgentUnread(false)
                }}
                onNotifyWhileClosed={() => setAgentUnread(true)}
                hasStatsBar={hasStatsBar}
                variant="docked"
              />
            </div>
          </div>
        )}

      </div>

      {/* ── Right Data Panel ── */}
      <aside
        className={`z-20 flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-border/80 bg-card transition-all duration-300 ${
          panelOpen && (result || aggregateData || selectedSite) ? 'w-[360px]' : 'w-0 overflow-hidden border-l-0'
        }`}
      >
        {panelOpen && selectedSite && (
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
                  <p className="mt-0.5 text-xs text-muted-foreground">{aggregateData.zip_count} ZIP codes · aggregated</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleMap3DToggle}
                    className="rounded-full border px-3 py-1 text-[10px] font-semibold text-white transition-colors"
                    style={{
                      background: map3DActive ? '#D76B3D' : 'rgba(45,51,66,0.95)',
                      borderColor: map3DActive ? '#D76B3D' : 'rgba(75,85,99,0.9)',
                    }}
                  >
                    3D
                  </button>
                  <button type="button" onClick={() => setPanelOpen(false)} className="text-xl leading-none text-muted-foreground hover:text-foreground">×</button>
                </div>
              </div>
              <div className="mt-3 flex gap-0 overflow-hidden rounded-lg border border-white/10">
                {(['analysis', 'data'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMarketPanelTab(t)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] font-semibold capitalize transition-colors',
                      marketPanelTab === t ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'analysis' ? 'Analysis' : 'Data'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
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

            <PanelSection title="Market brief (PDF)">
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
            <PanelSection title="Executive Memo">
              <ExecutiveMemo
                marketLabel={aggregateData.label}
                cycle={cycleData}
                data={{
                  avg_zori: aggregateData.zillow.avg_zori,
                  avg_zhvi: aggregateData.zillow.avg_zhvi,
                  zori_growth: aggregateData.zillow.zori_growth_12m,
                  zhvi_growth: aggregateData.zillow.zhvi_growth_12m,
                  vacancy_rate: aggregateData.housing.vacancy_rate,
                  median_income: aggregateData.housing.median_income,
                  doz_pending: aggregateData.metro_velocity?.doz_pending_latest,
                  price_cut_pct: aggregateData.metro_velocity?.price_cut_pct_latest,
                  inventory: aggregateData.metro_velocity?.inventory_latest,
                  permit_units: aggregateData.permits.total_units,
                  population: aggregateData.total_population,
                  search_interest: trends?.error ? null : trends?.latest_score,
                }}
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
                  value={trends.latest_score != null ? `${trends.latest_score} / 100` : '—'}
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
                  <button
                    type="button"
                    onClick={handleMap3DToggle}
                    className="rounded-full border px-3 py-1 text-[10px] font-semibold text-white transition-colors"
                    style={{
                      background: map3DActive ? '#D76B3D' : 'rgba(45,51,66,0.95)',
                      borderColor: map3DActive ? '#D76B3D' : 'rgba(75,85,99,0.9)',
                    }}
                  >
                    3D
                  </button>
                  <button type="button" onClick={() => setPanelOpen(false)} className="text-xl leading-none text-muted-foreground hover:text-foreground">×</button>
                </div>
              </div>
              <div className="mt-3 flex gap-0 overflow-hidden rounded-lg border border-white/10">
                {(['analysis', 'data'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMarketPanelTab(t)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] font-semibold capitalize transition-colors',
                      marketPanelTab === t ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'analysis' ? 'Analysis' : 'Data'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {marketPanelTab === 'analysis' && (
              <>
            <MomentumExplainBlock anchorZip={/^\d{5}$/.test(result.zip) ? result.zip : null} aggregateZips={null} />
            {cycleData && (
              <CycleExplainCard marketLabel={result.zillow?.city ?? result.zip} cycle={cycleData} />
            )}

            <PanelSection title="Market brief (PDF)">
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
            <PanelSection title="Executive Memo">
              <ExecutiveMemo
                marketLabel={result.zillow?.city ?? result.zip}
                cycle={cycleData}
                data={{
                  avg_zori: result.zillow?.zori_latest,
                  avg_zhvi: result.zillow?.zhvi_latest,
                  zori_growth: result.zillow?.zori_growth_12m,
                  zhvi_growth: result.zillow?.zhvi_growth_12m,
                  vacancy_rate: result.data.find((r) => r.metric_name === 'Vacancy_Rate')?.metric_value,
                  median_income: result.data.find((r) => r.metric_name === 'Median_Household_Income')?.metric_value,
                  doz_pending: result.metro_velocity?.doz_pending_latest,
                  price_cut_pct: result.metro_velocity?.price_cut_pct_latest,
                  inventory: result.metro_velocity?.inventory_latest,
                  permit_units: result.data.find((r) => r.metric_name === 'Permit_Units')?.metric_value,
                  population: result.data.find((r) => r.metric_name === 'Total_Population')?.metric_value,
                  transit_stops: transit?.stop_count,
                  search_interest: trends?.error ? null : trends?.latest_score,
                }}
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
                    ? fmtNum(result.zillow.zhvf_growth_1yr, '%') : '—'}
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
                  value={trends.latest_score != null ? `${trends.latest_score} / 100` : '—'}
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
                          : '—'
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
