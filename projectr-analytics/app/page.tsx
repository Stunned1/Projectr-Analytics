'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'

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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [zip, setZip] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MarketData | null>(null)
  const [transit, setTransit] = useState<TransitData | null>(null)
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<'map' | 'analytics' | 'agent' | 'reports'>('map')
  const [panelOpen, setPanelOpen] = useState(false)

  async function fetchMarket(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{5}$/.test(zip)) { setError('Enter a valid 5-digit zip'); return }
    setLoading(true)
    setError(null)
    try {
      const [marketRes, transitRes, trendsRes] = await Promise.all([
        fetch(`/api/market?zip=${zip}`),
        fetch(`/api/transit?zip=${zip}`),
        fetch(`/api/trends?zip=${zip}`),
      ])
      const data = await marketRes.json()
      const transitData = await transitRes.json()
      const trendsData = await trendsRes.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
      if (!transitData.error) setTransit(transitData)
      if (!trendsData.error) setTrends(trendsData)
      setPanelOpen(true)
    } catch {
      setError('Failed to fetch data')
    } finally {
      setLoading(false)
    }
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
          <Image src="/Projectr_Logo.png" alt="Projectr" width={120} height={32} className="h-8 w-auto object-contain" />
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
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="ZIP code..."
                maxLength={5}
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
          <NavItem icon={<AnalyticsIcon />} label="Analytics" active={activeNav === 'analytics'} onClick={() => { setActiveNav('analytics'); setPanelOpen(true) }} />
          <NavItem icon={<AgentIcon />} label="AI Agent" active={activeNav === 'agent'} onClick={() => setActiveNav('agent')} />
          <NavItem icon={<ReportsIcon />} label="Reports" active={activeNav === 'reports'} onClick={() => setActiveNav('reports')} />
        </nav>

        {/* Active market badge */}
        {result && (
          <div className="px-3 py-3 border-t border-white/8">
            <div
              className="bg-white/5 border border-white/8 rounded-lg p-3 cursor-pointer hover:border-[#D76B3D]/30 transition-colors"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Active Market</p>
                <ChevronRight />
              </div>
              <p className="text-white text-sm font-semibold">{result.zillow?.city ?? result.zip}</p>
              <p className="text-zinc-500 text-[10px]">{result.zip} · {result.geo?.state}</p>
            </div>
          </div>
        )}
      </aside>

      {/* ── Map ── */}
      <div className="flex-1 relative overflow-hidden">
        <CommandMap zip={result?.zip ?? null} marketData={result} transitData={transit} />

        {/* Bottom stats bar */}
        {result && (
          <div className="absolute bottom-0 left-0 right-0 z-30 bg-black/85 backdrop-blur-sm border-t border-white/8 flex items-center h-[60px] px-3 overflow-x-auto">
            <BottomStat
              label="Market Status"
              value={marketStatus ?? '—'}
              sub={marketStatus === 'Active' ? '● Live' : marketStatus === 'Moderate' ? '● Moderate' : null}
              accent={marketStatus === 'Active' ? 'green' : null}
            />
            <BottomStat
              label="Median Rent"
              value={fmtMoney(result.zillow?.zori_latest)}
              sub={zoriGrowth ? `▲ ${zoriGrowth} YoY` : null}
              accent={result.zillow?.zori_growth_12m != null && result.zillow.zori_growth_12m > 0 ? 'green' : null}
            />
            <BottomStat
              label="Home Value"
              value={fmtMoney(result.zillow?.zhvi_latest)}
              sub={fmtGrowth(result.zillow?.zhvi_growth_12m) ?? undefined}
            />
            <BottomStat
              label="Active Listings"
              value={fmtNum(result.metro_velocity?.inventory_latest)}
              sub={result.metro_velocity?.region_name ?? undefined}
            />
            <BottomStat
              label="Days to Pending"
              value={fmtNum(result.metro_velocity?.doz_pending_latest, ' days')}
            />
            <BottomStat
              label="Price Cuts"
              value={fmtNum(result.metro_velocity?.price_cut_pct_latest, '%')}
              sub="of listings"
            />
            {transit && (
              <BottomStat label="Transit Stops" value={transit.stop_count.toLocaleString()} sub="nearby" />
            )}
            {trends?.latest_score != null && (
              <BottomStat
                label="Search Interest"
                value={`${trends.latest_score} / 100`}
                sub={trends.is_fallback ? 'state-level' : 'local'}
              />
            )}
            <div className="ml-auto pl-4 flex-shrink-0">
              <button
                onClick={() => setPanelOpen(!panelOpen)}
                className="text-xs text-[#D76B3D] border border-[#D76B3D]/30 bg-[#D76B3D]/10 hover:bg-[#D76B3D]/20 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
              >
                {panelOpen ? 'Hide Panel' : 'Show Data'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right Data Panel ── */}
      <aside
        className={`flex-shrink-0 bg-[#0a0a0a] border-l border-white/8 overflow-y-auto transition-all duration-300 z-20 ${
          panelOpen && result ? 'w-[300px]' : 'w-0 overflow-hidden'
        }`}
      >
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
            {trends && trends.data_points > 0 && (
              <PanelSection title="Search Sentiment">
                <MetricRow
                  label="Interest Score"
                  value={trends.latest_score != null ? `${trends.latest_score} / 100` : '—'}
                  sub={trends.keyword_scope}
                />
                {trends.series.length > 1 && (
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
          </div>
        )}
      </aside>
    </div>
  )
}
