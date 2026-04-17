import 'server-only'

import { expandAreaKeyCandidates } from '@/lib/area-keys'
import { getBigQueryClient, getBigQueryReadConfig, type BigQueryClientLike } from './bigquery'
import type { MasterDataRow, VisualBucket } from './types'
import { normalizeBigQueryDateLike } from './types'

const DEFAULT_LATEST_ROW_LIMIT = 800
const DEFAULT_SERIES_LIMIT = 240
const EPOCH_CREATED_AT = '1970-01-01T00:00:00.000Z'
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/
const SHORT_OFFSET_PATTERN = /([+-]\d{2})(?!:)(\s*)$/
const VALID_VISUAL_BUCKETS = new Set<VisualBucket>(['POLYGON', 'MARKER', 'HEATMAP', 'TIME_SERIES', 'TABULAR'])

type RawBigQueryRow = Record<string, unknown>
type BigQueryQueryResult = RawBigQueryRow[] | [RawBigQueryRow[], ...unknown[]]

export interface BigQueryMasterDataReadOptions {
  client?: BigQueryClientLike
  limit?: number
}

export interface BigQueryMetricSeriesOptions extends BigQueryMasterDataReadOptions {
  dataSource?: string | readonly string[]
}

function normalizeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function unwrapBigQueryValue(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'object' && 'value' in value) {
    return unwrapBigQueryValue((value as { value: unknown }).value)
  }
  return value
}

function normalizeString(value: unknown): string | null {
  const unwrapped = unwrapBigQueryValue(value)
  if (unwrapped == null) return null
  const normalized = String(unwrapped).trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeNumber(value: unknown): number | null {
  const unwrapped = unwrapBigQueryValue(value)
  if (unwrapped == null || unwrapped === '') return null
  if (typeof unwrapped === 'number') return Number.isFinite(unwrapped) ? unwrapped : null
  const parsed = Number.parseFloat(String(unwrapped).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTimePeriod(value: unknown): string | null {
  const dateLike = normalizeBigQueryDateLike(value)
  if (dateLike) return dateLike

  const normalized = normalizeString(value)
  const monthMatch = normalized?.match(MONTH_PATTERN)
  return monthMatch ? `${monthMatch[1]}-${monthMatch[2]}-01` : null
}

function normalizeTimestamp(value: unknown): string {
  const unwrapped = unwrapBigQueryValue(value)
  if (unwrapped instanceof Date) {
    return Number.isNaN(unwrapped.getTime()) ? EPOCH_CREATED_AT : unwrapped.toISOString()
  }

  if (typeof unwrapped === 'number') {
    const parsed = new Date(unwrapped)
    return Number.isNaN(parsed.getTime()) ? EPOCH_CREATED_AT : parsed.toISOString()
  }

  const normalized = normalizeString(unwrapped)
  if (!normalized) return EPOCH_CREATED_AT

  const monthMatch = normalized.match(MONTH_PATTERN)
  if (monthMatch) {
    return new Date(`${monthMatch[1]}-${monthMatch[2]}-01T00:00:00.000Z`).toISOString()
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T00:00:00.000Z`).toISOString()
  }

  const withTimeSeparator =
    normalized.includes(' ') && !normalized.includes('T')
      ? normalized.replace(' ', 'T')
      : normalized
  const parsed = new Date(withTimeSeparator.replace(SHORT_OFFSET_PATTERN, '$1:00'))
  return Number.isNaN(parsed.getTime()) ? EPOCH_CREATED_AT : parsed.toISOString()
}

function normalizeVisualBucket(value: unknown): VisualBucket {
  const normalized = normalizeString(value)?.toUpperCase() as VisualBucket | undefined
  return normalized && VALID_VISUAL_BUCKETS.has(normalized) ? normalized : 'TABULAR'
}

function bigQueryTableIdentifier(): string {
  const config = getBigQueryReadConfig()
  if (!config.isConfigured) {
    throw new Error('BigQuery master-data table is not configured')
  }

  return config.projectId
    ? `\`${config.projectId}.${config.datasetId}.${config.tableId}\``
    : `\`${config.datasetId}.${config.tableId}\``
}

function queryLocation(): string {
  return getBigQueryReadConfig().location
}

function extractRows(result: unknown): RawBigQueryRow[] {
  if (!Array.isArray(result)) return []
  if (Array.isArray(result[0])) {
    return result[0] as RawBigQueryRow[]
  }
  return result as RawBigQueryRow[]
}

async function runBigQueryQuery(
  query: string,
  params: Record<string, unknown>,
  options: BigQueryMasterDataReadOptions = {}
): Promise<MasterDataRow[]> {
  const client = options.client ?? (await getBigQueryClient())
  if (typeof client.query !== 'function') {
    throw new Error('BigQuery client does not support query()')
  }

  const result = (await client.query({
    query,
    params,
    location: queryLocation(),
    useLegacySql: false,
  })) as BigQueryQueryResult

  return normalizeBigQueryRows(extractRows(result))
}

function latestRowKey(row: MasterDataRow): string {
  return `${row.submarket_id ?? ''}|${row.metric_name}`
}

function compareOldestFirst(a: MasterDataRow, b: MasterDataRow): number {
  const timeCompare = (a.time_period ?? '').localeCompare(b.time_period ?? '')
  if (timeCompare !== 0) return timeCompare
  return a.created_at.localeCompare(b.created_at)
}

export function normalizeBigQueryRows(rows: readonly unknown[]): MasterDataRow[] {
  const normalizedRows: MasterDataRow[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as RawBigQueryRow
    const metricName = normalizeString(record.metric_name)
    if (!metricName) continue

    normalizedRows.push({
      submarket_id: normalizeString(record.submarket_id),
      metric_name: metricName,
      metric_value: normalizeNumber(record.metric_value),
      time_period: normalizeTimePeriod(record.time_period),
      data_source: normalizeString(record.data_source) ?? 'BigQuery',
      visual_bucket: normalizeVisualBucket(record.visual_bucket),
      created_at: normalizeTimestamp(record.created_at),
    })
  }

  return normalizedRows
}

export async function fetchLatestRowsForSubmarket(
  submarketId: string,
  options: BigQueryMasterDataReadOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedSubmarketId = normalizeKey(submarketId)
  if (!normalizedSubmarketId) return []

  const rows = await runBigQueryQuery(
    `
      SELECT submarket_id, metric_name, metric_value, time_period, data_source, visual_bucket, created_at
      FROM ${bigQueryTableIdentifier()}
      WHERE submarket_id = @submarketId
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY submarket_id, metric_name
        ORDER BY time_period DESC, created_at DESC
      ) = 1
      ORDER BY metric_name ASC
      LIMIT @rowLimit
    `,
    {
      submarketId: normalizedSubmarketId,
      rowLimit: options.limit ?? DEFAULT_LATEST_ROW_LIMIT,
    },
    options
  )

  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = latestRowKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function fetchLatestRowsForSubmarkets(
  submarketIds: readonly string[],
  options: BigQueryMasterDataReadOptions = {}
): Promise<MasterDataRow[]> {
  const cleanSubmarketIds = Array.from(new Set(submarketIds.map((value) => value.trim()).filter(Boolean)))
  if (cleanSubmarketIds.length === 0) return []
  const rowsBySubmarket = await Promise.all(
    cleanSubmarketIds.map((submarketId) => fetchLatestRowsForSubmarket(submarketId, options))
  )

  const seen = new Set<string>()
  return rowsBySubmarket.flat().filter((row) => {
    const key = latestRowKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function readBigQueryRowsForSubmarket(
  submarketId: string,
  options: BigQueryMasterDataReadOptions = {}
): Promise<MasterDataRow[]> {
  return runBigQueryQuery(
    `
      SELECT submarket_id, metric_name, metric_value, time_period, data_source, visual_bucket, created_at
      FROM ${bigQueryTableIdentifier()}
      WHERE submarket_id = @submarketId
      ORDER BY time_period DESC, created_at DESC
      LIMIT @rowLimit
    `,
    {
      submarketId,
      rowLimit: options.limit ?? DEFAULT_LATEST_ROW_LIMIT,
    },
    options
  )
}

export async function fetchAreaRows(
  areaKey: string,
  options: BigQueryMasterDataReadOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedAreaKey = normalizeKey(areaKey)
  if (!normalizedAreaKey) return []

  const exactRows = await readBigQueryRowsForSubmarket(normalizedAreaKey, options)
  if (exactRows.length > 0) return exactRows

  const aliasKeys = expandAreaKeyCandidates(normalizedAreaKey).filter((candidate) => candidate !== normalizedAreaKey)
  if (aliasKeys.length === 0) return []

  return runBigQueryQuery(
    `
      SELECT submarket_id, metric_name, metric_value, time_period, data_source, visual_bucket, created_at
      FROM ${bigQueryTableIdentifier()}
      WHERE submarket_id IN UNNEST(@submarketIds)
      ORDER BY submarket_id ASC, time_period DESC, created_at DESC
      LIMIT @rowLimit
    `,
    {
      submarketIds: aliasKeys,
      rowLimit: (options.limit ?? DEFAULT_LATEST_ROW_LIMIT) * aliasKeys.length,
    },
    options
  )
}

export async function fetchMetricSeriesFromBigQuery(
  submarketId: string,
  metricName: string,
  options: BigQueryMetricSeriesOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedSubmarketId = normalizeKey(submarketId)
  const normalizedMetricName = normalizeKey(metricName)
  if (!normalizedSubmarketId || !normalizedMetricName) return []

  const dataSources = Array.isArray(options.dataSource)
    ? options.dataSource.map((value) => value.trim()).filter(Boolean)
    : normalizeKey(options.dataSource)
      ? [options.dataSource.trim()]
      : []

  const dataSourceClause = dataSources.length > 0 ? 'AND data_source IN UNNEST(@dataSources)' : ''
  const rows = await runBigQueryQuery(
    `
      SELECT submarket_id, metric_name, metric_value, time_period, data_source, visual_bucket, created_at
      FROM ${bigQueryTableIdentifier()}
      WHERE submarket_id = @submarketId
        AND metric_name = @metricName
        AND time_period IS NOT NULL
        ${dataSourceClause}
      ORDER BY time_period ASC, created_at ASC
      LIMIT @rowLimit
    `,
    {
      submarketId: normalizedSubmarketId,
      metricName: normalizedMetricName,
      dataSources,
      rowLimit: options.limit ?? DEFAULT_SERIES_LIMIT,
    },
    options
  )

  return rows
    .filter((row) => row.time_period != null)
    .sort(compareOldestFirst)
}

export const readBigQueryLatestRowsForSubmarket = fetchLatestRowsForSubmarket
export const readBigQueryLatestRowsForSubmarkets = fetchLatestRowsForSubmarkets
export const readBigQueryAreaRows = fetchAreaRows
export const readBigQueryMetricSeries = fetchMetricSeriesFromBigQuery
