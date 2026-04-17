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
import { warmMonthsRetention, type MasterDataRow } from './types'

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

function monthsBetween(startDate: string, now = new Date()): number {
  const start = new Date(startDate)
  if (Number.isNaN(start.getTime())) return 0
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
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
