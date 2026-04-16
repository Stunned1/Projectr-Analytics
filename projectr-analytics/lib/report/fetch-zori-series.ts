import { supabase } from '@/lib/supabase'
import type { ClientReportPayload } from './types'
import { buildZoriProxySeries } from './zori-proxy'

export type ZoriMonthlyPoint = { date: string; value: number }

/** Minimum points before we treat the series as credible for the PDF chart. */
export const ZORI_SERIES_MIN_POINTS = 6

/** Last N calendar months of ZORI for one ZIP (from `zillow_zori_monthly`). */
export async function fetchZoriMonthlyForZip(zip: string, maxMonths = 24): Promise<ZoriMonthlyPoint[]> {
  if (!/^\d{5}$/.test(zip)) return []
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - maxMonths - 1)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('zillow_zori_monthly')
    .select('month, zori')
    .eq('zip', zip)
    .gte('month', cutoffStr)
    .order('month', { ascending: true })

  if (error || !data?.length) return []

  return data.map((r) => ({
    date: typeof r.month === 'string' ? r.month.slice(0, 7) : String(r.month).slice(0, 7),
    value: Math.round(Number(r.zori)),
  }))
}

/**
 * Average ZORI by month across many ZIPs (multi-ZIP area PDF mode).
 * Only includes months where at least half the ZIPs have a value.
 */
export async function fetchZoriMonthlyAveraged(zips: string[], maxMonths = 24): Promise<ZoriMonthlyPoint[]> {
  const clean = [...new Set(zips)].filter((z) => /^\d{5}$/.test(z)).slice(0, 50)
  if (!clean.length) return []

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - maxMonths - 1)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('zillow_zori_monthly')
    .select('month, zori, zip')
    .in('zip', clean)
    .gte('month', cutoffStr)
    .order('month', { ascending: true })

  if (error || !data?.length) return []

  const byMonth = new Map<string, { sum: number; n: number }>()
  for (const row of data) {
    const key = typeof row.month === 'string' ? row.month.slice(0, 7) : String(row.month).slice(0, 7)
    const v = Number(row.zori)
    if (!Number.isFinite(v)) continue
    const cur = byMonth.get(key) ?? { sum: 0, n: 0 }
    cur.sum += v
    cur.n += 1
    byMonth.set(key, cur)
  }

  const half = Math.max(1, Math.floor(clean.length / 2))
  const out: ZoriMonthlyPoint[] = []
  const sortedMonths = [...byMonth.keys()].sort()
  for (const ym of sortedMonths) {
    const { sum, n } = byMonth.get(ym)!
    if (n < half) continue
    out.push({ date: ym, value: Math.round(sum / n) })
  }
  return out
}

export type ZoriSeriesSource = 'zillow_monthly' | 'modeled'

/** Prefer persisted monthly ZORI; fall back to modeled series from latest + YoY. */
export async function resolveZoriSeriesForReport(
  payload: ClientReportPayload
): Promise<{ series: ZoriMonthlyPoint[]; source: ZoriSeriesSource }> {
  const fallback = buildZoriProxySeries(payload.zillow.zori, payload.zillow.zori_growth_yoy, 20)

  if (payload.primaryZip && /^\d{5}$/.test(payload.primaryZip)) {
    const fromDb = await fetchZoriMonthlyForZip(payload.primaryZip, 24)
    if (fromDb.length >= ZORI_SERIES_MIN_POINTS) {
      return { series: fromDb, source: 'zillow_monthly' }
    }
  }

  const peers = (payload.zori_peer_zips ?? []).filter((z) => /^\d{5}$/.test(z))
  if (peers.length >= 2) {
    const fromDb = await fetchZoriMonthlyAveraged(peers, 24)
    if (fromDb.length >= ZORI_SERIES_MIN_POINTS) {
      return { series: fromDb, source: 'zillow_monthly' }
    }
  }

  return { series: fallback, source: 'modeled' }
}
