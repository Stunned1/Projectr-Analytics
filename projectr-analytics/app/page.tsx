'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import AgenticNormalizer from '@/components/AgenticNormalizer'
import ExecutiveMemo from '@/components/ExecutiveMemo'
import MarketReportExport from '@/components/MarketReportExport'
import AgentChat, { type AgentAction } from '@/components/AgentChat'
import type { MapLayersSnapshot } from '@/lib/report/types'

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
  geojson: {
    features: Array<{
      properties: { stop_id: string; stop_name: string }
      geometry: { coordinates: [number, number] }
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
  housing: { total_units: number | null; vacancy_rate: number | null; median_income: number | null; median_rent: number | null }
  permits: { total_units: number | null; total_value: number | null }
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

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-[#D76B3D]/15 text-[#D76B3D] border-l-2 border-[#D76B3D]'
          : 'text-zinc-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'
      }`}
    >
      <span className="w-4 h-4 flex-shrink-0">{icon}</span>
      <span className="font-medium tracking-wide">{label}</span>
    </button>
  )
}

function BottomStat({ label, value, sub, accent }: {
  label: string; value: string; sub?: string | null; accent?: 'green' | 'red' | null
}) {
  return (
    <div className="flex flex-col gap-0.5 px-5 border-r border-white/5 last:border-0 min-w-[100px]">
      <p className="text-[9px] uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="text-white font-semibold text-sm">{value}</p>
      {sub && (
        <p className={`text-[10px] ${accent === 'green' ? 'text-emerald-400' : accent === 'red' ? 'text-red-400' : 'text-zinc-500'}`}>
          {sub}
        </p>
      )}
    </div>
  )
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="text-[9px] uppercase tracking-widest text-zinc-500 mb-2 pb-1.5 border-b border-white/5">{title}</p>
      {children}
    </div>
  )
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-start py-1.5 border-b border-white/5 last:border-0">
      <p className="text-zinc-400 text-xs">{label.replace(/_/g, ' ')}</p>
      <div className="text-right ml-4">
        <p className="text-white text-xs font-medium">{value}</p>
        {sub && <p className="text-zinc-600 text-[10px]">{sub}</p>}
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const MapIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" y1="3" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="21" /></svg>
const AnalyticsIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
const AgentIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>
const ReportsIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
const ChevronRight = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><polyline points="9 18 15 12 9 6" /></svg>

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
  clientData: true,
  choroplethMetric: 'zori',
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [zip, setZip] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MarketData | null>(null)
  const [cityZips, setCityZips] = useState<CityZip[] | null>(null)
  const [boroughBoundary, setBoroughBoundary] = useState<object | null>(null)
  const [aggregateData, setAggregateData] = useState<AggregateData | null>(null)
  const [uploadedMarkers, setUploadedMarkers] = useState<Array<{ lat: number; lng: number; label: string; value: number | null }> | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentLayerOverrides, setAgentLayerOverrides] = useState<Record<string, boolean>>({})
  const [agentMetric, setAgentMetric] = useState<'zori' | 'zhvi' | null>(null)
  const [agentTilt, setAgentTilt] = useState<number | null>(null)
  const [transit, setTransit] = useState<TransitData | null>(null)
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<'map' | 'analytics' | 'agent' | 'reports'>('map')
  const [panelOpen, setPanelOpen] = useState(false)
  const [mapLayersSnapshot, setMapLayersSnapshot] = useState<MapLayersSnapshot>(DEFAULT_MAP_LAYERS)

  const handleMapLayersChange = useCallback((snapshot: MapLayersSnapshot) => {
    setMapLayersSnapshot(snapshot)
  }, [])

  async function handleNormalizerIngested(result: { triage: { bucket: string }; marker_points?: Array<{ lat: number; lng: number; value: number | null; label: string }> }) {
    if (result.triage.bucket === 'GEOSPATIAL' && result.marker_points?.length) {
      setUploadedMarkers(result.marker_points)
    }
  }

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
        setPanelOpen(true)
        break
      case 'set_tilt':
        if (action.tilt != null) setAgentTilt(action.tilt)
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
      if (!data.error) setAggregateData(data)
    } catch { /* non-critical */ }
  }

  /** Normalize `/api/trends` JSON into panel + PDF state (always sets `trends` so analysts see errors). */
  function applyTrendsApiBody(body: Record<string, unknown> | null, httpOk: boolean) {
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
  }

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

  const BOROUGHS = new Set(['manhattan', 'brooklyn', 'queens', 'bronx', 'staten island'])

  async function fetchMarket(e: React.FormEvent) {
    e.preventDefault()
    const input = searchInput.trim()
    if (!input) return
    setLoading(true)
    setError(null)
    setCityZips(null)
    setBoroughBoundary(null)
    setAggregateData(null)
    setTrends(null)

    if (/^\d{5}$/.test(input)) {
      // ZIP code search — clear city mode state
      setCityZips(null)
      setBoroughBoundary(null)
      setZip(input)
      try {
        const [marketRes, transitRes, trendsRes] = await Promise.all([
          fetch(`/api/market?zip=${input}`),
          fetch(`/api/transit?zip=${input}`),
          fetch(`/api/trends?zip=${input}`),
        ])
        const data = await marketRes.json()
        const transitData = await transitRes.json()
        const trendsData = (await trendsRes.json()) as Record<string, unknown>
        if (data.error) { setError(data.error); return }
        setResult(data)
        if (!transitData.error) setTransit(transitData)
        applyTrendsApiBody(trendsData, trendsRes.ok)
        setPanelOpen(true)
      } catch {
        setError('Failed to fetch data')
      }
    } else {
      // Check if it's a borough name
      const lowerInput = input.toLowerCase().replace(/,.*$/, '').trim()
      if (BOROUGHS.has(lowerInput)) {
        try {
          const res = await fetch(`/api/borough?name=${encodeURIComponent(lowerInput)}`)
          const data = await res.json()
          if (data.error || !data.zips?.length) {
            setError(`No data found for "${input}"`)
            return
          }
          setCityZips(data.zips)
          setBoroughBoundary(data.boundary ?? null)
          setResult(null)
          setZip('')
          setTransit(null)
          setPanelOpen(true)
          fetchAggregate(data.zips.map((z: CityZip) => z.zip), data.borough)
          void fetchTrendsForMultiZipArea(data.zips, {
            cityForKeyword: data.borough,
            state: typeof data.state === 'string' ? data.state : 'NY',
          })
        } catch {
          setError('Failed to fetch borough data')
        }
      } else {
        // City search — parse "City, ST" or just "City"
        const parts = input.split(',').map((s) => s.trim())
        const cityName = parts[0]
        const stateAbbr = parts[1] ?? ''
        try {
          const url = `/api/city?city=${encodeURIComponent(cityName)}${stateAbbr ? `&state=${stateAbbr}` : ''}`
          const res = await fetch(url)
          const data = await res.json()
          if (data.error || !data.zips?.length) {
            setError(`No data found for "${input}". Try "City, ST" format.`)
            return
          }
          setCityZips(data.zips)
          setResult(null)
          setZip('')
          setTransit(null)
          setPanelOpen(true)
          const st =
            (stateAbbr || data.zips[0]?.state || '')
              .toString()
              .trim()
              .toUpperCase()
              .slice(0, 2) || ''
          fetchAggregate(data.zips.map((z: CityZip) => z.zip), `${cityName}${stateAbbr ? ', ' + stateAbbr : ''}`)
          void fetchTrendsForMultiZipArea(data.zips, { cityForKeyword: cityName, state: st })
        } catch {
          setError('Failed to fetch city data')
        }
      }
    }
    setLoading(false)
  }

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black text-white">

      {/* ── Left Sidebar ── */}
      <aside className="w-[200px] flex-shrink-0 flex flex-col bg-[#0a0a0a] border-r border-white/8 z-20">

        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/8">
          <Image src="/Projectr_Logo.png" alt="Projectr" width={120} height={32} loading="eager" style={{ width: 'auto', height: '32px' }} />
        </div>

        {/* Search */}
        <div className="px-3 py-3 border-b border-white/8">
          <form onSubmit={fetchMarket}>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
                <SearchIcon />
              </span>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ZIP, City, ST, or Borough..."
                className="w-full bg-white/5 border border-white/10 rounded-md pl-7 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#D76B3D]/50 transition-colors"
              />
            </div>
            {error && <p className="text-red-400 text-[10px] mt-1 px-0.5">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-[#D76B3D] hover:bg-[#c45e32] text-white text-xs font-semibold py-2 rounded-md transition-colors disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Analyze Market'}
            </button>
          </form>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          <NavItem icon={<MapIcon />} label="Map" active={activeNav === 'map'} onClick={() => setActiveNav('map')} />
          <NavItem icon={<ReportsIcon />} label="Case Studies" active={activeNav === 'reports'} onClick={() => setActiveNav('reports')} />
        </nav>

        {/* Active market badge */}
        {(result || cityZips) && (
          <div className="px-3 py-3 border-t border-white/8">
            <div
              className="bg-white/5 border border-white/8 rounded-lg p-3 cursor-pointer hover:border-[#D76B3D]/30 transition-colors"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Active Market</p>
                <ChevronRight />
              </div>
              {result ? (
                <>
                  <p className="text-white text-sm font-semibold">{result.zillow?.city ?? result.zip}</p>
                  <p className="text-zinc-500 text-[10px]">{result.zip} · {result.geo?.state}</p>
                </>
              ) : cityZips ? (
                <>
                  <p className="text-white text-sm font-semibold">{cityZips[0]?.city}</p>
                  <p className="text-zinc-500 text-[10px]">{cityZips.length} ZIPs · {cityZips[0]?.state}</p>
                </>
              ) : null}
            </div>
          </div>
        )}
      </aside>

      {/* ── Map ── */}
      <div className="flex-1 relative overflow-hidden">
        <CommandMap zip={result?.zip ?? null} marketData={result} transitData={transit} cityZips={cityZips} boroughBoundary={boroughBoundary} uploadedMarkers={uploadedMarkers} agentLayerOverrides={agentLayerOverrides} agentMetric={agentMetric} agentTilt={agentTilt} onLayersChange={handleMapLayersChange} />

        {/* Bottom stats bar */}
        {(result || aggregateData) && (
          <div className="absolute bottom-0 left-0 right-0 z-30 bg-black/85 backdrop-blur-sm border-t border-white/8 flex items-center h-[60px] px-3 overflow-x-auto">
            {result ? (<>
            <BottomStat label="Market Status" value={marketStatus ?? '—'} sub={marketStatus === 'Active' ? '● Live' : marketStatus === 'Moderate' ? '● Moderate' : null} accent={marketStatus === 'Active' ? 'green' : null} />
            <BottomStat label="Median Rent" value={fmtMoney(result.zillow?.zori_latest)} sub={zoriGrowth ? `▲ ${zoriGrowth} YoY` : null} accent={result.zillow?.zori_growth_12m != null && result.zillow.zori_growth_12m > 0 ? 'green' : null} />
            <BottomStat label="Home Value" value={fmtMoney(result.zillow?.zhvi_latest)} sub={fmtGrowth(result.zillow?.zhvi_growth_12m) ?? undefined} />
            <BottomStat label="Active Listings" value={fmtNum(result.metro_velocity?.inventory_latest)} sub={result.metro_velocity?.region_name ?? undefined} />
            <BottomStat label="Days to Pending" value={fmtNum(result.metro_velocity?.doz_pending_latest, ' days')} />
            <BottomStat label="Price Cuts" value={fmtNum(result.metro_velocity?.price_cut_pct_latest, '%')} sub="of listings" />
            {transit && <BottomStat label="Transit Stops" value={transit.stop_count.toLocaleString()} sub="nearby" />}
            {trends && (
              <BottomStat
                label="Search interest"
                value={trends.latest_score != null ? `${trends.latest_score} / 100` : '—'}
                sub={
                  trends.error
                    ? trends.error
                    : [trends.is_fallback ? 'State-level keyword' : 'Local keyword', trends.keyword_scope].filter(Boolean).join(' · ')
                }
              />
            )}
            </>) : aggregateData ? (<>
            <BottomStat label="ZIP Codes" value={aggregateData.zip_count.toString()} sub={aggregateData.label} />
            <BottomStat label="Avg Rent (ZORI)" value={fmtMoney(aggregateData.zillow.avg_zori)} sub={aggregateData.zillow.zori_growth_12m != null ? `▲ ${fmtGrowth(aggregateData.zillow.zori_growth_12m)} YoY` : null} accent="green" />
            <BottomStat label="Avg Home Value" value={fmtMoney(aggregateData.zillow.avg_zhvi)} sub={fmtGrowth(aggregateData.zillow.zhvi_growth_12m) ?? undefined} />
            <BottomStat label="Population" value={fmtNum(aggregateData.total_population)} />
            <BottomStat label="Vacancy Rate" value={fmtNum(aggregateData.housing.vacancy_rate, '%')} />
            <BottomStat label="Active Listings" value={fmtNum(aggregateData.metro_velocity?.inventory_latest)} sub={aggregateData.metro_velocity?.region_name ?? undefined} />
            <BottomStat label="Days to Pending" value={fmtNum(aggregateData.metro_velocity?.doz_pending_latest, ' days')} />
            {trends && (
              <BottomStat
                label="Search interest"
                value={trends.latest_score != null ? `${trends.latest_score} / 100` : '—'}
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
              />
            )}
            </>) : null}
            <div className="ml-auto pl-4 flex-shrink-0">
              <button onClick={() => setPanelOpen(!panelOpen)} className="text-xs text-[#D76B3D] border border-[#D76B3D]/30 bg-[#D76B3D]/10 hover:bg-[#D76B3D]/20 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap">
                {panelOpen ? 'Hide Panel' : 'Show Data'}
              </button>
            </div>
          </div>
        )}

        {/* AI Agent Chat */}
        <AgentChat
          mapContext={mapContext}
          onAction={handleAgentAction}
          isOpen={agentOpen}
          onToggle={() => setAgentOpen(!agentOpen)}
          hasStatsBar={!!(result || aggregateData)}
        />
      </div>

      {/* ── Right Data Panel ── */}
      <aside
        className={`flex-shrink-0 bg-[#0a0a0a] border-l border-white/8 overflow-y-auto transition-all duration-300 z-20 ${
          panelOpen && (result || aggregateData) ? 'w-[300px]' : 'w-0 overflow-hidden'
        }`}
      >
        {aggregateData && panelOpen && !result && (
          <div className="p-4 min-w-[300px]">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-white font-bold text-base leading-tight">{aggregateData.label}</h2>
                <p className="text-zinc-500 text-xs mt-0.5">{aggregateData.zip_count} ZIP codes · aggregated</p>
              </div>
              <button onClick={() => setPanelOpen(false)} className="text-zinc-600 hover:text-white text-xl leading-none mt-0.5">×</button>
            </div>

            <PanelSection title="Market Pricing (Zillow)">
              <MetricRow label="Avg Median Rent (ZORI)" value={fmtMoney(aggregateData.zillow.avg_zori)} sub={aggregateData.zillow.zori_growth_12m != null ? `${fmtGrowth(aggregateData.zillow.zori_growth_12m)} YoY avg` : undefined} />
              <MetricRow label="Avg Home Value (ZHVI)" value={fmtMoney(aggregateData.zillow.avg_zhvi)} sub={aggregateData.zillow.zhvi_growth_12m != null ? `${fmtGrowth(aggregateData.zillow.zhvi_growth_12m)} YoY avg` : undefined} />
            </PanelSection>

            <PanelSection title="Housing & Demographics">
              <MetricRow label="Total Population" value={fmtNum(aggregateData.total_population)} />
              <MetricRow label="Total Housing Units" value={fmtNum(aggregateData.housing.total_units)} />
              <MetricRow label="Vacancy Rate" value={fmtNum(aggregateData.housing.vacancy_rate, '%')} />
              <MetricRow label="Median Household Income" value={fmtMoney(aggregateData.housing.median_income)} />
              <MetricRow label="Median Gross Rent" value={fmtMoney(aggregateData.housing.median_rent)} />
            </PanelSection>

            {aggregateData.permits.total_units != null && aggregateData.permits.total_units > 0 && (
              <PanelSection title="Building Permits (2021–2023)">
                <MetricRow label="Total Units Permitted" value={fmtNum(aggregateData.permits.total_units)} />
                <MetricRow label="Total Construction Value" value={fmtMoney(aggregateData.permits.total_value)} />
              </PanelSection>
            )}

            {aggregateData.metro_velocity && (
              <PanelSection title="Market Velocity">
                <MetricRow label="Days to Pending" value={fmtNum(aggregateData.metro_velocity.doz_pending_latest, ' days')} />
                <MetricRow label="Price Cuts" value={fmtNum(aggregateData.metro_velocity.price_cut_pct_latest, '%')} sub="of listings" />
                <MetricRow label="Active Inventory" value={fmtNum(aggregateData.metro_velocity.inventory_latest)} />
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
                  return (
                    <div key={metric} className="mb-3">
                      <div className="flex justify-between mb-1">
                        <p className="text-zinc-400 text-[11px]">{metric.replace(/_/g, ' ')}</p>
                        <p className="text-white text-[11px] font-medium">{latestDisplay}</p>
                      </div>
                      <div className="flex items-end gap-px h-7">
                        {sorted.map((p, i) => {
                          const height = max === min ? 50 : ((p.metric_value - min) / (max - min)) * 100
                          return <div key={i} className="flex-1 bg-[#D76B3D]/40 rounded-sm" style={{ height: `${Math.max(height, 6)}%` }} />
                        })}
                      </div>
                    </div>
                  )
                })}
              </PanelSection>
            )}
          </div>
        )}

        {/* Aggregate panel memo + normalizer */}
        {aggregateData && panelOpen && !result && (
          <div className="px-4 pb-4 min-w-[300px]">
            <PanelSection title="Market brief (PDF)">
              <MarketReportExport
                mapLayersSnapshot={mapLayersSnapshot}
                uploadedMarkers={uploadedMarkers}
                result={null}
                aggregateData={aggregateData}
                cityZips={cityZips}
                trends={trendsShapeForReport(trends)}
              />
            </PanelSection>
            <PanelSection title="Executive Memo">
              <ExecutiveMemo
                marketLabel={aggregateData.label}
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
            <PanelSection title="Agentic Normalizer">
              <AgenticNormalizer onIngested={handleNormalizerIngested} />
            </PanelSection>
          </div>
        )}

        {result && panelOpen && (
          <div className="p-4 min-w-[300px]">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-white font-bold text-base leading-tight">{result.zillow?.city ?? result.zip}</h2>
                <p className="text-zinc-500 text-xs mt-0.5">{result.zillow?.metro_name ?? ''} · {result.zip}</p>
              </div>
              <button onClick={() => setPanelOpen(false)} className="text-zinc-600 hover:text-white text-xl leading-none mt-0.5">×</button>
            </div>

            {/* Zillow pricing */}
            {result.zillow && (
              <PanelSection title="Market Pricing">
                <MetricRow label="Median Rent (ZORI)" value={fmtMoney(result.zillow.zori_latest)} sub={zoriGrowth ? `${zoriGrowth} YoY` : undefined} />
                <MetricRow label="Home Value (ZHVI)" value={fmtMoney(result.zillow.zhvi_latest)} sub={fmtGrowth(result.zillow.zhvi_growth_12m) ?? undefined} />
                <MetricRow
                  label="1yr Forecast"
                  value={result.zillow.zhvf_growth_1yr != null && Math.abs(result.zillow.zhvf_growth_1yr) < 50
                    ? fmtNum(result.zillow.zhvf_growth_1yr, '%') : '—'}
                />
              </PanelSection>
            )}

            {/* Metro velocity */}
            {result.metro_velocity && (
              <PanelSection title="Market Velocity">
                <MetricRow label="Days to Pending" value={fmtNum(result.metro_velocity.doz_pending_latest, ' days')} />
                <MetricRow label="Price Cuts" value={fmtNum(result.metro_velocity.price_cut_pct_latest, '%')} sub="of listings" />
                <MetricRow label="Active Inventory" value={fmtNum(result.metro_velocity.inventory_latest)} />
              </PanelSection>
            )}

            {/* Demographics */}
            {tabularRows.length > 0 && (
              <PanelSection title="Demographics & Affordability">
                {tabularRows.map((r) => (
                  <MetricRow
                    key={r.metric_name + r.data_source}
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
                  return (
                    <div key={metric} className="mb-3">
                      <div className="flex justify-between mb-1">
                        <p className="text-zinc-400 text-[11px]">{metric.replace(/_/g, ' ')}</p>
                        <p className="text-white text-[11px] font-medium">{latestDisplay}</p>
                      </div>
                      <div className="flex items-end gap-px h-7">
                        {sorted.map((p, i) => {
                          const height = max === min ? 50 : ((p.value - min) / (max - min)) * 100
                          return <div key={i} className="flex-1 bg-[#D76B3D]/40 rounded-sm" style={{ height: `${Math.max(height, 6)}%` }} />
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
                <MetricRow label="Nearby Stops" value={transit.stop_count.toLocaleString()} sub="bus stops within radius" />
              </PanelSection>
            )}

            {/* PDF + Executive Memo */}
            <PanelSection title="Market brief (PDF)">
              <MarketReportExport
                mapLayersSnapshot={mapLayersSnapshot}
                uploadedMarkers={uploadedMarkers}
                result={result}
                aggregateData={null}
                cityZips={null}
                trends={trendsShapeForReport(trends)}
              />
            </PanelSection>
            <PanelSection title="Executive Memo">
              <ExecutiveMemo
                marketLabel={result.zillow?.city ?? result.zip}
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

            {/* Agentic Normalizer */}
            <PanelSection title="Agentic Normalizer">
              <AgenticNormalizer currentZip={result.zip} onIngested={handleNormalizerIngested} />
            </PanelSection>
          </div>
        )}
      </aside>
    </div>
  )
}
