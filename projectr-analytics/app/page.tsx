'use client'

import { useState } from 'react'

interface DataRow {
  metric_name: string
  metric_value: number
  data_source: string
  time_period: string | null
  visual_bucket: string
}

interface MarketData {
  zip: string
  cached: boolean
  geo?: { lat: number; lng: number; city: string; state: string }
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

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtNum(n: number | null | undefined, suffix = '') {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) + suffix
}

function fmtGrowth(n: number | null | undefined) {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${Number(n).toFixed(2)}% YoY`
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <p className="text-zinc-500 text-xs uppercase tracking-widest mb-1">{label}</p>
      <p className="text-white text-xl font-semibold">{value}</p>
      {sub && <p className="text-zinc-400 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-zinc-400 text-xs uppercase tracking-widest mb-3 border-b border-zinc-800 pb-2">{title}</h2>
      {children}
    </div>
  )
}

const MONEY_METRICS = ['Rent', 'Income', 'FMR', 'Value', 'Price']
const RATE_METRICS = ['Unemployment', 'Rate']

function formatMetricValue(name: string, value: number) {
  if (MONEY_METRICS.some((k) => name.includes(k))) return fmtMoney(value)
  if (RATE_METRICS.some((k) => name.includes(k))) return fmtNum(value, '%')
  if (name === 'Population_Growth_3yr') return fmtNum(value, '%')
  return fmtNum(value)
}

export default function Home() {
  const [zip, setZip] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MarketData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchMarket(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{5}$/.test(zip)) { setError('Enter a valid 5-digit zip code'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/market?zip=${zip}`)
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch {
      setError('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  // FRED + Census BPS have multiple time_period entries — group by metric
  const fredSeries: Record<string, Array<{ date: string; value: number }>> = {}
  result?.data
    .filter((r) => (r.data_source === 'FRED' || r.data_source === 'Census BPS') && r.time_period)
    .forEach((r) => {
      if (!fredSeries[r.metric_name]) fredSeries[r.metric_name] = []
      fredSeries[r.metric_name].push({ date: r.time_period!, value: r.metric_value })
    })

  // Tabular: HUD + Census (single value per metric, not time series sources)
  const tabularRows = result?.data.filter((r) => r.data_source !== 'FRED' && r.data_source !== 'Census BPS') ?? []

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">

        <div className="mb-10">
          <h1 className="text-2xl font-bold tracking-tight">Projectr Command Center</h1>
          <p className="text-zinc-500 text-sm mt-1">Real estate market intelligence by zip code</p>
        </div>

        <form onSubmit={fetchMarket} className="flex gap-3 mb-10">
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="Enter zip code (e.g. 24060)"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 text-sm"
            maxLength={5}
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-white text-black px-6 py-3 rounded-lg text-sm font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Analyze'}
          </button>
        </form>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        {result && (
          <div>
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-3xl font-bold">
                  {result.zillow?.city ?? result.geo?.city ?? result.zip}
                </h2>
                <span className="text-zinc-500 text-lg">{result.zip}</span>
                {result.cached && (
                  <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">cached</span>
                )}
              </div>
              {result.zillow?.metro_name && (
                <p className="text-zinc-500 text-sm mt-1">
                  {result.zillow.metro_name} metro · {result.geo?.state ?? ''}
                </p>
              )}
            </div>

            {/* Zillow pricing */}
            {result.zillow && (
              <Section title="Market Pricing (Zillow Research)">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard
                    label="Median Rent (ZORI)"
                    value={fmtMoney(result.zillow.zori_latest)}
                    sub={result.zillow.zori_latest ? fmtGrowth(result.zillow.zori_growth_12m) : 'No data for this zip'}
                  />
                  <StatCard
                    label="Home Value (ZHVI)"
                    value={fmtMoney(result.zillow.zhvi_latest)}
                    sub={fmtGrowth(result.zillow.zhvi_growth_12m)}
                  />
                  <StatCard
                    label="1yr Value Forecast"
                    value={result.zillow.zhvf_growth_1yr != null && Math.abs(result.zillow.zhvf_growth_1yr) < 50
                      ? fmtNum(result.zillow.zhvf_growth_1yr, '%')
                      : '—'}
                    sub="ZHVF growth projection"
                  />
                </div>
              </Section>
            )}

            {/* Metro velocity */}
            {result.metro_velocity && (
              <Section title={`Market Velocity — ${result.metro_velocity.region_name} Metro`}>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    label="Days to Pending"
                    value={fmtNum(result.metro_velocity.doz_pending_latest, ' days')}
                    sub="Mean time to go under contract"
                  />
                  <StatCard
                    label="Price Cuts"
                    value={fmtNum(result.metro_velocity.price_cut_pct_latest, '%')}
                    sub="Listings with reduced price"
                  />
                  <StatCard
                    label="Active Inventory"
                    value={fmtNum(result.metro_velocity.inventory_latest)}
                    sub="Active listings this month"
                  />
                </div>
              </Section>
            )}

            {/* Census + HUD */}
            {tabularRows.length > 0 && (
              <Section title="Demographics & Affordability (Census ACS + HUD)">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {tabularRows.map((r) => (
                    <StatCard
                      key={r.metric_name + r.data_source}
                      label={r.metric_name.replace(/_/g, ' ')}
                      value={formatMetricValue(r.metric_name, r.metric_value)}
                      sub={r.metric_name === 'Population_Growth_3yr'
                        ? `${r.data_source} · 2019→2022 (enrollment-sensitive)`
                        : r.data_source}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* FRED + BPS time series sparklines */}
            {Object.keys(fredSeries).length > 0 && (
              <Section title="Economic Indicators (FRED + Census BPS)">
                {Object.entries(fredSeries).map(([metric, points]) => {
                  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
                  const latest = sorted.at(-1)
                  const max = Math.max(...sorted.map((x) => x.value))
                  const min = Math.min(...sorted.map((x) => x.value))
                  const isRate = metric.includes('Rate') || metric.includes('rate')
                  const isMoney = metric.includes('GDP') || metric.includes('Value') || metric.includes('Permit_Value')
                  const latestDisplay = isMoney
                    ? fmtMoney(latest?.value)
                    : isRate
                    ? fmtNum(latest?.value, '%')
                    : fmtNum(latest?.value)
                  return (
                    <div key={metric} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-3">
                      <div className="flex justify-between items-start mb-3">
                        <p className="text-zinc-400 text-xs uppercase tracking-widest">
                          {metric.replace(/_/g, ' ')}
                        </p>
                        <p className="text-white font-semibold">{latestDisplay}</p>
                      </div>
                      <div className="flex items-end gap-0.5 h-10">
                        {sorted.map((p, i) => {
                          const height = max === min ? 50 : ((p.value - min) / (max - min)) * 100
                          return (
                            <div
                              key={i}
                              title={`${p.date.slice(0, 7)}: ${isMoney ? fmtMoney(p.value) : isRate ? p.value + '%' : p.value}`}
                              className="flex-1 bg-zinc-600 rounded-sm"
                              style={{ height: `${Math.max(height, 8)}%` }}
                            />
                          )
                        })}
                      </div>
                      <p className="text-zinc-600 text-xs mt-2">
                        {sorted[0]?.date?.slice(0, 7)} → {sorted.at(-1)?.date?.slice(0, 7)}
                      </p>
                    </div>
                  )
                })}
              </Section>
            )}

            <details className="mt-6">
              <summary className="text-zinc-600 text-xs cursor-pointer hover:text-zinc-400">
                View raw JSON
              </summary>
              <pre className="mt-3 bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-400 overflow-auto max-h-96">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </main>
  )
}
