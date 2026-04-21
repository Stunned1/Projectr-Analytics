import { supabase } from '@/lib/supabase'
import { getMetricSeries, getRowsForSubmarket } from '@/lib/data/market-data-router'
import { getBigQueryReadConfig } from '@/lib/data/bigquery'
import type { MasterRow } from './types'

function dedupeMasterRows(rows: MasterRow[]): MasterRow[] {
  const map = new Map<string, MasterRow>()
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const r of sorted) {
    const k = `${r.data_source}|${r.metric_name}|${r.time_period ?? ''}`
    map.set(k, r)
  }
  return [...map.values()]
}

export interface ZoriMonthlyPoint {
  month: string
  zori: number
}

export interface CycleRawInputs {
  masterRows: MasterRow[]
  zoriMonthly: ZoriMonthlyPoint[]
  zoriGrowthYoy: number | null
  zoriLatest: number | null
}

type CycleMetricSeriesArgs = Parameters<typeof getMetricSeries>[0]
type ZillowSnapshot = { zori_growth_12m: number | null; zori_latest: number | null } | null
type ZillowZoriMonthlyRow = { month: string | Date; zori: number | string | null }

export interface LoadCycleRawInputsDependencies {
  now?: Date
  historicalSeriesEnabled?: boolean
  getRowsForSubmarket?: typeof getRowsForSubmarket
  getMetricSeries?: (args: CycleMetricSeriesArgs) => ReturnType<typeof getMetricSeries>
  fetchZoriMonthly?: (zip: string) => Promise<ZoriMonthlyPoint[]>
  fetchZillowSnapshot?: (zip: string) => Promise<ZillowSnapshot>
}

function monthStartMonthsAgo(now: Date, monthsAgo: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)).toISOString().slice(0, 10)
}

function yearStartYearsAgo(now: Date, yearsAgo: number): string {
  return new Date(Date.UTC(now.getUTCFullYear() - yearsAgo, 0, 1)).toISOString().slice(0, 10)
}

async function fetchDefaultZoriMonthly(zip: string): Promise<ZoriMonthlyPoint[]> {
  const { data: monthly, error } = await supabase
    .from('zillow_zori_monthly')
    .select('month, zori')
    .eq('zip', zip)
    .order('month', { ascending: true })

  if (error) throw new Error(error.message)

  return ((monthly ?? []) as ZillowZoriMonthlyRow[])
    .map((r) => ({
      month: typeof r.month === 'string' ? r.month : String(r.month),
      zori: Number(r.zori),
    }))
    .filter((r) => Number.isFinite(r.zori))
}

async function fetchDefaultZillowSnapshot(zip: string): Promise<ZillowSnapshot> {
  const { data: snap, error } = await supabase
    .from('zillow_zip_snapshot')
    .select('zori_growth_12m, zori_latest')
    .eq('zip', zip)
    .maybeSingle()

  if (error) throw new Error(error.message)

  return snap ?? null
}

async function fetchHistoricalCycleSeries(
  zip: string,
  dependencies: Pick<LoadCycleRawInputsDependencies, 'getMetricSeries' | 'now'>
): Promise<MasterRow[]> {
  const fetchMetricSeriesImpl = dependencies.getMetricSeries ?? getMetricSeries
  const now = dependencies.now ?? new Date()

  const results = await Promise.allSettled([
    fetchMetricSeriesImpl({
      submarketId: zip,
      metricName: 'Unemployment_Rate',
      dataSource: 'FRED',
      startDate: monthStartMonthsAgo(now, 36),
      limit: 60,
    }),
    fetchMetricSeriesImpl({
      submarketId: zip,
      metricName: 'Permit_Units',
      dataSource: 'Census BPS',
      startDate: yearStartYearsAgo(now, 6),
      limit: 16,
    }),
  ])

  return results.flatMap((result) => result.status === 'fulfilled' ? result.value as MasterRow[] : [])
}

export async function loadCycleRawInputs(
  zip: string,
  dependencies: LoadCycleRawInputsDependencies = {}
): Promise<CycleRawInputs> {
  const readRowsForSubmarket = dependencies.getRowsForSubmarket ?? getRowsForSubmarket
  const fetchZoriMonthly = dependencies.fetchZoriMonthly ?? fetchDefaultZoriMonthly
  const fetchZillowSnapshot = dependencies.fetchZillowSnapshot ?? fetchDefaultZillowSnapshot
  const historicalSeriesEnabled = dependencies.historicalSeriesEnabled ?? getBigQueryReadConfig().isConfigured

  const [rawMaster, zoriMonthly, snap, historicalRows] =
    await Promise.all([
      readRowsForSubmarket(zip, { limit: 800 }),
      fetchZoriMonthly(zip),
      fetchZillowSnapshot(zip),
      historicalSeriesEnabled
        ? fetchHistoricalCycleSeries(zip, dependencies)
        : Promise.resolve([]),
    ])

  const masterRows = dedupeMasterRows([...(rawMaster as MasterRow[]), ...historicalRows])

  return {
    masterRows,
    zoriMonthly,
    zoriGrowthYoy: snap?.zori_growth_12m != null && Number.isFinite(snap.zori_growth_12m) ? snap.zori_growth_12m : null,
    zoriLatest: snap?.zori_latest != null && Number.isFinite(snap.zori_latest) ? snap.zori_latest : null,
  }
}
