import 'server-only'

import {
  fetchAreaRows,
  fetchLatestRowsForSubmarket,
  fetchLatestRowsForSubmarkets,
  fetchMetricSeriesFromPostgres,
  fetchRowsForSubmarket,
  fetchRowsForSubmarkets,
  upsertOperationalRows,
  type PostgresMetricSeriesOptions,
  type PostgresReadOptions,
  type PostgresWriteOptions,
  type PostgresMasterDataWriteRow,
} from './postgres-master-data'
import {
  fetchMetricSeriesFromBigQuery,
  type BigQueryMetricSeriesOptions,
} from './bigquery-master-data'
import { fetchZoriMonthlyForZip, type ZoriMonthlyPoint } from '../report/fetch-zori-series'
import { normalizeBigQueryDateLike, warmMonthsRetention, type MasterDataRow } from './types'
import { selectSpecializedHistorySource } from './source-registry'
import type { TexasPermitHistorySeries } from './bigquery-eda-history'

export interface MarketDataSeriesArgs {
  submarketId: string
  metricName: string
  startDate: string
  dataSource?: string | readonly string[]
  limit?: number
}

export interface MarketDataRouterDependencies {
  fetchMetricSeriesFromPostgres?: (
    submarketId: string,
    metricName: string,
    options?: PostgresMetricSeriesOptions
  ) => Promise<MasterDataRow[]>
  fetchMetricSeriesFromBigQuery?: (
    submarketId: string,
    metricName: string,
    options?: BigQueryMetricSeriesOptions
  ) => Promise<MasterDataRow[]>
  warmMonths?: number
  now?: Date
}

export type AnalyticalComparisonMode = 'history' | 'peer_market'
export type AnalyticalMetric = 'rent' | 'unemployment_rate' | 'permit_units'
export type AnalyticalSubjectKind = 'zip' | 'county' | 'metro'

export interface AnalyticalSubject {
  kind: AnalyticalSubjectKind
  id: string
  label: string
}

export type AnalyticalTimeWindow =
  | {
      mode: 'relative'
      unit: 'months' | 'years'
      value: number
    }
  | {
      mode: 'since'
      startDate: string
    }

export interface NormalizedAnalyticalTimeWindow {
  mode: AnalyticalTimeWindow['mode']
  startDate: string
  label: string
  monthsBack: number
}

export interface AnalyticalComparisonRequest {
  comparisonMode: AnalyticalComparisonMode
  metric: AnalyticalMetric
  subjectMarket: AnalyticalSubject
  comparisonMarket: AnalyticalSubject | null
  timeWindow: AnalyticalTimeWindow
}

export interface AnalyticalComparisonPoint {
  x: string
  y: number
}

export interface AnalyticalComparisonSeries {
  key: string
  label: string
  subject: AnalyticalSubject
  points: AnalyticalComparisonPoint[]
}

export interface AnalyticalComparisonCitation {
  id: string
  label: string
  sourceType: 'internal_dataset' | 'public_dataset' | 'workspace_upload' | 'derived'
  note?: string | null
  periodLabel?: string | null
}

export interface AnalyticalComparisonDebugEntry {
  subject: AnalyticalSubject
  selectedSourceId: string | null
  selectedSourceLabel: string | null
  specializedRowsFound: number
  fallbackUsed: boolean
  finalSourceId: string
  finalSourceLabel: string
  finalPointCount: number
}

export interface AnalyticalComparisonResult {
  comparisonMode: AnalyticalComparisonMode
  metric: AnalyticalMetric
  metricLabel: string
  timeWindow: NormalizedAnalyticalTimeWindow
  series: AnalyticalComparisonSeries[]
  citations: AnalyticalComparisonCitation[]
  debug?: {
    historySources: AnalyticalComparisonDebugEntry[]
  }
}

export type AnalyticalMetricSeriesFetcher = (
  args: MarketDataSeriesArgs,
  dependencies?: MarketDataRouterDependencies
) => Promise<MasterDataRow[]>

export interface AnalyticalComparisonDependencies {
  now?: Date
  fetchMetricSeries?: AnalyticalMetricSeriesFetcher
  fetchRentSeries?: (zip: string, options: { startDate: string; maxMonths: number }) => Promise<AnalyticalComparisonPoint[]>
  fetchSpecializedHistorySeries?: (
    metric: AnalyticalMetric,
    subject: AnalyticalSubject,
    timeWindow: NormalizedAnalyticalTimeWindow
  ) => Promise<TexasPermitHistorySeries | null>
}

interface AnalyticalMetricConfig {
  metricName?: string
  metricLabel: string
  sourceLabel: string
  sourceType: AnalyticalComparisonCitation['sourceType']
  defaultWindowMonths: number
}

const ANALYTICAL_METRIC_CONFIG: Record<AnalyticalMetric, AnalyticalMetricConfig> = {
  rent: {
    metricLabel: 'Rent',
    sourceLabel: 'Zillow Research',
    sourceType: 'public_dataset',
    defaultWindowMonths: 24,
  },
  unemployment_rate: {
    metricName: 'Unemployment_Rate',
    metricLabel: 'Unemployment rate',
    sourceLabel: 'FRED',
    sourceType: 'public_dataset',
    defaultWindowMonths: 24,
  },
  permit_units: {
    metricName: 'Permit_Units',
    metricLabel: 'Permit units',
    sourceLabel: 'Census BPS / Projectr master data',
    sourceType: 'internal_dataset',
    defaultWindowMonths: 60,
  },
}

function normalizeMetricToken(metric: string): string {
  return metric.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

export function normalizeAnalyticalMetric(metric: string): AnalyticalMetric | null {
  const normalized = normalizeMetricToken(metric)
  if (!normalized) return null

  if (normalized === 'rent' || normalized === 'zori' || normalized.includes('zillow rent') || normalized.includes('zillow zori')) {
    return 'rent'
  }

  if (normalized.includes('unemployment') || normalized.includes('jobless')) {
    return 'unemployment_rate'
  }

  if (normalized.includes('permit')) {
    return 'permit_units'
  }

  return null
}

export function normalizeAnalyticalTimeWindow(
  timeWindow: AnalyticalTimeWindow,
  now = new Date()
): NormalizedAnalyticalTimeWindow {
  if (timeWindow.mode === 'relative') {
    if (!Number.isFinite(timeWindow.value) || timeWindow.value <= 0) {
      throw new Error(`Unsupported analytical time window value: ${timeWindow.value}`)
    }

    const monthsBack = Math.max(1, Math.round(timeWindow.unit === 'years' ? timeWindow.value * 12 : timeWindow.value))
    const startDate = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1)))
    return {
      mode: timeWindow.mode,
      startDate,
      label: `Last ${timeWindow.value} ${timeWindow.unit}`,
      monthsBack,
    }
  }

  const startDate = normalizeBigQueryDateLike(timeWindow.startDate)
  if (!startDate) {
    throw new Error(`Unsupported analytical time window startDate: ${timeWindow.startDate}`)
  }

  return {
    mode: timeWindow.mode,
    startDate,
    label: `Since ${startDate}`,
    monthsBack: Math.max(1, monthsBetween(startDate, now)),
  }
}

function normalizeAnalyticalSubject(subject: AnalyticalSubject): AnalyticalSubject {
  const id = subject.id.trim()
  const label = subject.label.trim() || id
  return {
    kind: subject.kind,
    id,
    label,
  }
}

function normalizeComparisonPoints(points: AnalyticalComparisonPoint[]): AnalyticalComparisonPoint[] {
  return [...points].sort((a, b) => a.x.localeCompare(b.x))
}

function buildComparisonCitation(
  metric: AnalyticalMetric,
  subject: AnalyticalSubject,
  config: AnalyticalMetricConfig,
  points: AnalyticalComparisonPoint[],
  sourceLabelOverride?: string | null,
  citationIdOverride?: string | null
): AnalyticalComparisonCitation {
  const firstPoint = points[0]?.x ?? null
  const lastPoint = points[points.length - 1]?.x ?? null
  return {
    id: citationIdOverride?.trim() || `${metric}:${subject.kind}:${subject.id}`,
    label: sourceLabelOverride?.trim() || config.sourceLabel,
    sourceType: config.sourceType,
    note: `Historical series for ${subject.label}`,
    periodLabel: firstPoint && lastPoint ? `${firstPoint} to ${lastPoint}` : null,
  }
}

function buildSeriesKey(metric: AnalyticalMetric, subject: AnalyticalSubject): string {
  return `${subject.kind}:${subject.id}:${metric}`
}

async function defaultFetchRentSeries(
  zip: string,
  options: { startDate: string; maxMonths: number }
): Promise<AnalyticalComparisonPoint[]> {
  const rows: ZoriMonthlyPoint[] = await fetchZoriMonthlyForZip(zip, options.maxMonths)
  const startMonth = options.startDate.slice(0, 7)
  return rows
    .filter((row) => row.date >= startMonth)
    .map((row) => ({ x: row.date, y: row.value }))
}

async function defaultFetchSpecializedHistorySeries(
  metric: AnalyticalMetric,
  subject: AnalyticalSubject,
  timeWindow: NormalizedAnalyticalTimeWindow
): Promise<TexasPermitHistorySeries | null> {
  const specializedSource = selectSpecializedHistorySource(metric, subject, {
    mode: timeWindow.mode,
    startDate: timeWindow.startDate,
  })
  if (!specializedSource) return null

  if (specializedSource.id === 'texas_permits') {
    const { fetchTexasPermitHistorySeries } = await import('./bigquery-eda-history')
    return fetchTexasPermitHistorySeries({
      subject,
      startDate: timeWindow.startDate,
    })
  }

  return null
}

interface HistoricalSeriesResult {
  points: AnalyticalComparisonPoint[]
  sourceLabelOverride?: string | null
  citationIdOverride?: string | null
  selectedSourceId?: string | null
  selectedSourceLabel?: string | null
  specializedRowsFound?: number
  fallbackUsed?: boolean
}

async function getHistoricalSeriesForMetric(
  metric: AnalyticalMetric,
  subject: AnalyticalSubject,
  timeWindow: NormalizedAnalyticalTimeWindow,
  dependencies: AnalyticalComparisonDependencies = {}
): Promise<HistoricalSeriesResult> {
  const config = ANALYTICAL_METRIC_CONFIG[metric]
  const specializedSource = selectSpecializedHistorySource(metric, subject, {
    mode: timeWindow.mode,
    startDate: timeWindow.startDate,
  })
  if (metric === 'rent') {
    if (subject.kind !== 'zip') {
      throw new Error(`Rent history requires a ZIP subject, received ${subject.kind}`)
    }

    const fetchRentSeries = dependencies.fetchRentSeries ?? defaultFetchRentSeries
    return {
      points: normalizeComparisonPoints(
        await fetchRentSeries(subject.id, {
          startDate: timeWindow.startDate,
          maxMonths: Math.max(timeWindow.monthsBack + 2, config.defaultWindowMonths),
        })
      ),
    }
  }

  const fetchSpecializedHistorySeries =
    dependencies.fetchSpecializedHistorySeries ?? defaultFetchSpecializedHistorySeries
  const specializedSeries = await fetchSpecializedHistorySeries(metric, subject, timeWindow)
  if (specializedSeries && specializedSeries.points.length > 0) {
    return {
      points: normalizeComparisonPoints(specializedSeries.points),
      sourceLabelOverride: specializedSeries.sourceLabel,
      citationIdOverride: specializedSeries.sourceId,
      selectedSourceId: specializedSeries.sourceId,
      selectedSourceLabel: specializedSeries.sourceLabel,
      specializedRowsFound: specializedSeries.points.length,
      fallbackUsed: false,
    }
  }

  const fetchMetricSeries = dependencies.fetchMetricSeries ?? getMetricSeries
  const rows = await fetchMetricSeries({
    submarketId: subject.id,
    metricName: config.metricName ?? metric,
    startDate: timeWindow.startDate,
  })

  return {
    points: normalizeComparisonPoints(
      rows
        .filter((row) => row.time_period != null && row.metric_value != null)
        .map((row) => ({
          x: row.time_period as string,
          y: Number(row.metric_value),
        }))
    ),
    selectedSourceId: specializedSource?.id ?? null,
    selectedSourceLabel: specializedSource?.tableOrEndpoint ?? null,
    specializedRowsFound: 0,
    fallbackUsed: specializedSource != null,
  }
}

export async function getAnalyticalComparison(
  request: AnalyticalComparisonRequest,
  dependencies: AnalyticalComparisonDependencies = {}
): Promise<AnalyticalComparisonResult> {
  if (request.comparisonMode !== 'history' && request.comparisonMode !== 'peer_market') {
    throw new Error(`Unsupported analytical comparison mode: ${request.comparisonMode}`)
  }

  if (request.comparisonMode === 'history' && request.comparisonMarket !== null) {
    throw new Error('comparisonMarket is not supported for history comparisons')
  }

  if (request.comparisonMode === 'peer_market' && request.comparisonMarket === null) {
    throw new Error('comparisonMarket is required for peer-market comparisons')
  }

  const metric = request.metric
  if (!(metric in ANALYTICAL_METRIC_CONFIG)) {
    throw new Error(`Unsupported analytical metric: ${metric}`)
  }

  const subject = normalizeAnalyticalSubject(request.subjectMarket)
  const comparison = request.comparisonMarket ? normalizeAnalyticalSubject(request.comparisonMarket) : null
  if (comparison && subject.kind !== comparison.kind) {
    throw new Error('peer-market comparisons require matching subject kinds')
  }

  const timeWindow = normalizeAnalyticalTimeWindow(request.timeWindow, dependencies.now ?? new Date())
  const config = ANALYTICAL_METRIC_CONFIG[metric]
  const comparisonSubjects = comparison ? [subject, comparison] : [subject]
  const series = await Promise.all(
    comparisonSubjects.map(async (candidate) => {
      const {
        points,
        sourceLabelOverride,
        citationIdOverride,
        selectedSourceId,
        selectedSourceLabel,
        specializedRowsFound,
        fallbackUsed,
      } = await getHistoricalSeriesForMetric(metric, candidate, timeWindow, dependencies)
      if (points.length === 0) {
        throw new Error(`Insufficient historical data for ${candidate.label}`)
      }

      return {
        key: buildSeriesKey(metric, candidate),
        label: candidate.label,
        subject: candidate,
        points,
        sourceLabelOverride,
        citationIdOverride,
        selectedSourceId,
        selectedSourceLabel,
        specializedRowsFound,
        fallbackUsed,
      } satisfies AnalyticalComparisonSeries
        & {
          sourceLabelOverride?: string | null
          citationIdOverride?: string | null
          selectedSourceId?: string | null
          selectedSourceLabel?: string | null
          specializedRowsFound?: number
          fallbackUsed?: boolean
        }
    })
  )

  const citations = series.map((entry) =>
    buildComparisonCitation(metric, entry.subject, config, entry.points, entry.sourceLabelOverride, entry.citationIdOverride)
  )

  return {
    comparisonMode: request.comparisonMode,
    metric,
    metricLabel: config.metricLabel,
    timeWindow,
    series,
    citations,
    debug: {
      historySources: series.map((entry, index) => ({
        subject: entry.subject,
        selectedSourceId: entry.selectedSourceId ?? null,
        selectedSourceLabel: entry.selectedSourceLabel ?? null,
        specializedRowsFound: entry.specializedRowsFound ?? 0,
        fallbackUsed: entry.fallbackUsed ?? false,
        finalSourceId: citations[index]?.id ?? `${metric}:${entry.subject.kind}:${entry.subject.id}`,
        finalSourceLabel: citations[index]?.label ?? config.sourceLabel,
        finalPointCount: entry.points.length,
      })),
    },
  }
}

export const getAnalyticalComparisonForTest = getAnalyticalComparison

function monthsBetween(startDate: string, now = new Date()): number {
  const start = new Date(startDate)
  if (Number.isNaN(start.getTime())) return 0
  return (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth())
}

function startOfMonth(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

function warmWindowStartDate(now: Date, warmMonths: number): string {
  return startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - warmMonths, 1)))
}

export function shouldReadSeriesFromBigQuery(
  startDate: string,
  warmMonths: number,
  now = new Date()
): boolean {
  return monthsBetween(startDate, now) > warmMonths
}

function compareSeriesAscending(a: MasterDataRow, b: MasterDataRow): number {
  const timeCompare = (a.time_period ?? '').localeCompare(b.time_period ?? '')
  if (timeCompare !== 0) return timeCompare
  return a.created_at.localeCompare(b.created_at)
}

function seriesRowKey(row: MasterDataRow): string {
  return [
    row.submarket_id ?? '',
    row.metric_name,
    row.time_period ?? '',
    row.data_source,
    row.created_at,
  ].join('|')
}

export function mergeSeriesRows(coldRows: MasterDataRow[], warmRows: MasterDataRow[]): MasterDataRow[] {
  const merged = new Map<string, MasterDataRow>()
  for (const row of [...coldRows, ...warmRows]) {
    merged.set(seriesRowKey(row), row)
  }
  return Array.from(merged.values()).sort(compareSeriesAscending)
}

export async function getMetricSeries(
  args: MarketDataSeriesArgs,
  dependencies: MarketDataRouterDependencies = {}
): Promise<MasterDataRow[]> {
  const {
    submarketId,
    metricName,
    startDate,
    dataSource,
    limit,
  } = args

  const postgresFetcher = dependencies.fetchMetricSeriesFromPostgres ?? fetchMetricSeriesFromPostgres
  const bigQueryFetcher = dependencies.fetchMetricSeriesFromBigQuery ?? fetchMetricSeriesFromBigQuery
  const warmMonths = dependencies.warmMonths ?? warmMonthsRetention()
  const now = dependencies.now ?? new Date()
  const shouldUseBigQuery = shouldReadSeriesFromBigQuery(startDate, warmMonths, now)

  if (shouldUseBigQuery) {
    const warmStartDate = warmWindowStartDate(now, warmMonths)
    const [coldRows, warmRows] = await Promise.all([
      bigQueryFetcher(submarketId, metricName, {
        dataSource,
        startDate,
        endDate: warmStartDate,
        limit,
      }),
      postgresFetcher(submarketId, metricName, {
        dataSource,
        startDate: warmStartDate,
        limit,
      }),
    ])
    return mergeSeriesRows(coldRows, warmRows)
  }

  return postgresFetcher(submarketId, metricName, { dataSource, startDate, limit })
}

export async function getLatestRowsForSubmarket(
  submarketId: string,
  options?: PostgresReadOptions
): Promise<MasterDataRow[]> {
  return fetchLatestRowsForSubmarket(submarketId, options)
}

export async function getRowsForSubmarket(
  submarketId: string,
  options?: PostgresReadOptions
): Promise<MasterDataRow[]> {
  return fetchRowsForSubmarket(submarketId, options)
}

export async function getRowsForSubmarkets(
  submarketIds: readonly string[],
  options?: PostgresReadOptions
): Promise<MasterDataRow[]> {
  return fetchRowsForSubmarkets(submarketIds, options)
}

export async function getLatestRowsForSubmarkets(
  submarketIds: readonly string[],
  options?: PostgresReadOptions
): Promise<MasterDataRow[]> {
  return fetchLatestRowsForSubmarkets(submarketIds, options)
}

export async function getAreaRows(
  areaKey: string,
  options?: PostgresReadOptions
): Promise<MasterDataRow[]> {
  return fetchAreaRows(areaKey, options)
}

export async function upsertMarketDataRows(
  rows: readonly PostgresMasterDataWriteRow[],
  options?: PostgresWriteOptions
): Promise<number> {
  return upsertOperationalRows(rows, options)
}

export { upsertOperationalRows }
