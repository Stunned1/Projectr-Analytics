import 'server-only'

import { expandAreaKeyCandidates } from '@/lib/area-keys'
import { supabase } from '@/lib/supabase'
import type { MasterDataRow, VisualBucket } from './types'

const MASTER_DATA_SELECT =
  'submarket_id, metric_name, metric_value, time_period, data_source, visual_bucket, created_at'
const DEFAULT_LATEST_ROW_LIMIT = 800
const DEFAULT_SERIES_LIMIT = 240
const UPSERT_BATCH_SIZE = 500

type PostgresResultLike = {
  data: unknown[] | null
  error: { message: string } | null
}

interface PostgresMasterDataQueryLike {
  select: (columns: string) => PostgresMasterDataQueryLike
  eq: (column: string, value: string) => PostgresMasterDataQueryLike
  in: (column: string, values: readonly string[]) => PostgresMasterDataQueryLike
  gte: (column: string, value: string) => PostgresMasterDataQueryLike
  lt: (column: string, value: string) => PostgresMasterDataQueryLike
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => PostgresMasterDataQueryLike
  limit: (count: number) => Promise<PostgresResultLike>
  then?: PromiseLike<PostgresResultLike>['then']
  upsert: (
    values: Record<string, unknown>[],
    options: { onConflict: string; ignoreDuplicates: boolean }
  ) => Promise<PostgresResultLike>
}

export interface PostgresMasterDataClientLike {
  from: (table: 'projectr_master_data') => PostgresMasterDataQueryLike
}

export interface PostgresReadOptions {
  client?: PostgresMasterDataClientLike
  limit?: number
  dataSource?: string | readonly string[]
  metricName?: string | readonly string[]
  createdSince?: string
}

export interface PostgresMetricSeriesOptions extends PostgresReadOptions {
  dataSource?: string | readonly string[]
  startDate?: string
  endDate?: string
}

export interface PostgresMasterDataWriteRow extends Omit<MasterDataRow, 'created_at'> {
  created_at?: string
  geometry?: string | null
}

export interface PostgresWriteOptions {
  client?: PostgresMasterDataClientLike
  batchSize?: number
  conflictMode?: 'update' | 'ignore'
}

function normalizeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function compareNewestFirst(a: MasterDataRow, b: MasterDataRow): number {
  const timeCompare = (b.time_period ?? '').localeCompare(a.time_period ?? '')
  if (timeCompare !== 0) return timeCompare
  return b.created_at.localeCompare(a.created_at)
}

function compareOldestFirst(a: MasterDataRow, b: MasterDataRow): number {
  const timeCompare = (a.time_period ?? '').localeCompare(b.time_period ?? '')
  if (timeCompare !== 0) return timeCompare
  return a.created_at.localeCompare(b.created_at)
}

function toMasterDataRows(data: unknown[] | null | undefined): MasterDataRow[] {
  return Array.isArray(data) ? (data as MasterDataRow[]) : []
}

function latestRowKey(row: MasterDataRow): string {
  return `${row.submarket_id ?? ''}|${row.metric_name}`
}

function dedupeLatestRows(rows: MasterDataRow[]): MasterDataRow[] {
  const latest = new Map<string, MasterDataRow>()
  for (const row of [...rows].sort(compareNewestFirst)) {
    const key = latestRowKey(row)
    if (!latest.has(key)) latest.set(key, row)
  }

  return Array.from(latest.values()).sort((a, b) => {
    const submarketCompare = (a.submarket_id ?? '').localeCompare(b.submarket_id ?? '')
    if (submarketCompare !== 0) return submarketCompare
    return a.metric_name.localeCompare(b.metric_name)
  })
}

function getClient(client?: PostgresMasterDataClientLike): PostgresMasterDataClientLike {
  return client ?? (supabase as unknown as PostgresMasterDataClientLike)
}

function assertSuccess(result: PostgresResultLike): MasterDataRow[] {
  if (result.error) throw new Error(result.error.message)
  return toMasterDataRows(result.data)
}

function masterDataTable(client?: PostgresMasterDataClientLike) {
  return getClient(client).from('projectr_master_data')
}

function toFilterValues(value?: string | readonly string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean)
  }

  return normalizeKey(value) ? [value.trim()] : []
}

function applyQueryFilters(query: PostgresMasterDataQueryLike, options: PostgresReadOptions): PostgresMasterDataQueryLike {
  const dataSources = toFilterValues(options.dataSource)
  const metricNames = toFilterValues(options.metricName)

  let filtered = query
  if (dataSources.length === 1) {
    filtered = filtered.eq('data_source', dataSources[0])
  } else if (dataSources.length > 1) {
    filtered = filtered.in('data_source', dataSources)
  }

  if (metricNames.length === 1) {
    filtered = filtered.eq('metric_name', metricNames[0])
  } else if (metricNames.length > 1) {
    filtered = filtered.in('metric_name', metricNames)
  }

  if (options.createdSince) {
    filtered = filtered.gte('created_at', options.createdSince)
  }

  return filtered
}

function sanitizeSubmarketIds(submarketIds: readonly string[]): string[] {
  return Array.from(new Set(submarketIds.map((value) => value.trim()).filter(Boolean)))
}

async function readRowsForSubmarket(
  submarketId: string,
  options: PostgresReadOptions = {}
): Promise<MasterDataRow[]> {
  const { limit = DEFAULT_LATEST_ROW_LIMIT } = options
  const query = applyQueryFilters(
    masterDataTable(options.client)
      .select(MASTER_DATA_SELECT)
      .eq('submarket_id', submarketId),
    options
  )
  const result = (await query
    .order('time_period', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)) as PostgresResultLike

  return assertSuccess(result)
}

export async function fetchRowsForSubmarket(
  submarketId: string,
  options: PostgresReadOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedSubmarketId = normalizeKey(submarketId)
  if (!normalizedSubmarketId) return []
  return readRowsForSubmarket(normalizedSubmarketId, options)
}

export async function fetchRowsForSubmarkets(
  submarketIds: readonly string[],
  options: PostgresReadOptions = {}
): Promise<MasterDataRow[]> {
  const cleanSubmarketIds = sanitizeSubmarketIds(submarketIds)
  if (cleanSubmarketIds.length === 0) return []

  let query = masterDataTable(options.client)
    .select(MASTER_DATA_SELECT)
    .in('submarket_id', cleanSubmarketIds)

  query = applyQueryFilters(query, options)

  const orderedQuery = query
    .order('submarket_id', { ascending: true })
    .order('time_period', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  const result = (options.limit != null
    ? await orderedQuery.limit(options.limit)
    : await orderedQuery) as PostgresResultLike

  return assertSuccess(result)
}

export async function fetchLatestRowsForSubmarket(
  submarketId: string,
  options: PostgresReadOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedSubmarketId = normalizeKey(submarketId)
  if (!normalizedSubmarketId) return []
  return dedupeLatestRows(await readRowsForSubmarket(normalizedSubmarketId, options))
}

export async function fetchLatestRowsForSubmarkets(
  submarketIds: readonly string[],
  options: PostgresReadOptions = {}
): Promise<MasterDataRow[]> {
  const cleanSubmarketIds = sanitizeSubmarketIds(submarketIds)
  if (cleanSubmarketIds.length === 0) return []
  const rowsBySubmarket = await Promise.all(
    cleanSubmarketIds.map((submarketId) => fetchLatestRowsForSubmarket(submarketId, options))
  )
  return dedupeLatestRows(rowsBySubmarket.flat())
}

export async function fetchAreaRows(
  areaKey: string,
  options: PostgresReadOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedAreaKey = normalizeKey(areaKey)
  if (!normalizedAreaKey) return []

  const exactRows = await readRowsForSubmarket(normalizedAreaKey, options)
  if (exactRows.length > 0) return exactRows

  const aliasKeys = expandAreaKeyCandidates(normalizedAreaKey).filter((candidate) => candidate !== normalizedAreaKey)
  if (aliasKeys.length === 0) return []

  const result = (await masterDataTable(options.client)
    .select(MASTER_DATA_SELECT)
    .in('submarket_id', aliasKeys)
    .order('submarket_id', { ascending: true })
    .order('time_period', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit((options.limit ?? DEFAULT_LATEST_ROW_LIMIT) * aliasKeys.length)) as PostgresResultLike

  return assertSuccess(result)
}

export async function fetchMetricSeriesFromPostgres(
  submarketId: string,
  metricName: string,
  options: PostgresMetricSeriesOptions = {}
): Promise<MasterDataRow[]> {
  const normalizedSubmarketId = normalizeKey(submarketId)
  const normalizedMetricName = normalizeKey(metricName)
  if (!normalizedSubmarketId || !normalizedMetricName) return []

  const dataSources = Array.isArray(options.dataSource)
    ? options.dataSource.map((value) => value.trim()).filter(Boolean)
    : normalizeKey(options.dataSource)
      ? [options.dataSource.trim()]
      : []

  let query = masterDataTable(options.client)
    .select(MASTER_DATA_SELECT)
    .eq('submarket_id', normalizedSubmarketId)
    .eq('metric_name', normalizedMetricName)

  if (dataSources.length === 1) {
    query = query.eq('data_source', dataSources[0])
  } else if (dataSources.length > 1) {
    query = query.in('data_source', dataSources)
  }

  if (options.startDate) {
    query = query.gte('time_period', options.startDate)
  }

  if (options.endDate) {
    query = query.lt('time_period', options.endDate)
  }

  const result = (await query
    .order('time_period', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(options.limit ?? DEFAULT_SERIES_LIMIT)) as PostgresResultLike

  return assertSuccess(result)
    .filter((row) => row.time_period != null)
    .sort(compareOldestFirst)
}

function toUpsertRow(row: PostgresMasterDataWriteRow): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    submarket_id: row.submarket_id,
    geometry: row.geometry ?? null,
    metric_name: row.metric_name,
    metric_value: row.metric_value,
    time_period: row.time_period,
    data_source: row.data_source,
    visual_bucket: row.visual_bucket,
  }

  if (row.created_at) {
    payload.created_at = row.created_at
  }

  return payload
}

export async function upsertOperationalRows(
  rows: readonly PostgresMasterDataWriteRow[],
  options: PostgresWriteOptions = {}
): Promise<number> {
  const payload = rows
    .filter((row) => row.metric_name.trim().length > 0 && row.data_source.trim().length > 0)
    .map(toUpsertRow)
  if (payload.length === 0) return 0

  const batchSize = Math.max(1, options.batchSize ?? UPSERT_BATCH_SIZE)
  const ignoreDuplicates = options.conflictMode === 'ignore'
  for (let index = 0; index < payload.length; index += batchSize) {
    const batch = payload.slice(index, index + batchSize)
    const result = await masterDataTable(options.client).upsert(batch, {
      onConflict: 'submarket_id,metric_name,time_period,data_source',
      ignoreDuplicates,
    })
    if (result.error) throw new Error(result.error.message)
  }

  return payload.length
}

export const readPostgresLatestRowsForSubmarket = fetchLatestRowsForSubmarket
export const readPostgresLatestRowsForSubmarkets = fetchLatestRowsForSubmarkets
export const readPostgresAreaRows = fetchAreaRows
export const readPostgresMetricSeries = fetchMetricSeriesFromPostgres
export const readPostgresRowsForSubmarket = fetchRowsForSubmarket
export const readPostgresRowsForSubmarkets = fetchRowsForSubmarkets
export const upsertPostgresMasterDataRows = upsertOperationalRows

export type { VisualBucket }
