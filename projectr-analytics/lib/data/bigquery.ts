import 'server-only'

import { warmMonthsRetention } from './types'

export interface BigQueryClientLike {
  query?: (...args: unknown[]) => unknown
  dataset?: (...args: unknown[]) => unknown
}

export interface BigQueryModule {
  BigQuery: new (options?: { projectId?: string }) => BigQueryClientLike
}

export interface BigQueryReadConfig {
  projectId: string | null
  datasetId: string
  location: string
  warmRetentionMonths: number
  isConfigured: boolean
}

export interface GetBigQueryClientOptions {
  loadModule?: () => Promise<BigQueryModule>
}

let cachedClientPromise: Promise<BigQueryClientLike> | null = null

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() || undefined
}

function defaultLoadModule(): Promise<BigQueryModule> {
  return import('@google-cloud/bigquery') as Promise<BigQueryModule>
}

function clientOptions() {
  const projectId = getBigQueryReadConfig().projectId ?? undefined
  const options: any = projectId ? { projectId } : {}
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      options.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS)
    } catch {}
  }
  return options
}

export function getBigQueryReadConfig(): BigQueryReadConfig {
  const projectId = readEnv('BIGQUERY_PROJECT_ID') ?? readEnv('GOOGLE_CLOUD_PROJECT') ?? null
  const datasetId = readEnv('BIGQUERY_DATASET_ID') ?? ''
  const location = readEnv('BIGQUERY_LOCATION') ?? 'US'

  return {
    projectId,
    datasetId,
    location,
    warmRetentionMonths: warmMonthsRetention(),
    // ADC-backed environments may not provide an explicit project env up front.
    isConfigured: Boolean(datasetId),
  }
}

export function getBigQueryTablePath(tableId: string): string | null {
  const config = getBigQueryReadConfig()
  if (!config.isConfigured || !config.projectId) return null
  return `${config.projectId}.${config.datasetId}.${tableId}`
}

export async function getBigQueryClient(
  options: GetBigQueryClientOptions = {}
): Promise<BigQueryClientLike> {
  const loadModule = options.loadModule ?? defaultLoadModule

  if (options.loadModule) {
    const { BigQuery } = await loadModule()
    return new BigQuery(clientOptions())
  }

  if (!cachedClientPromise) {
    cachedClientPromise = loadModule().then(({ BigQuery }) => new BigQuery(clientOptions()))
  }

  return cachedClientPromise
}
