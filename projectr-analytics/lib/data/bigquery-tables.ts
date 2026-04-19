import 'server-only'

import { getBigQueryReadConfig } from './bigquery'

export const BIGQUERY_TABLES = {
  masterData: 'master_data',
  dimGeography: 'dim_geography',
  dimMetrics: 'dim_metrics',
  factHistoricalData: 'fact_historical_data',
  zillow: 'zillow_zori_monthly',
  nycPermits: 'nyc_permits',
  texasZctaDim: 'texas_zcta_dim',
  texasPermits: 'texas_permits',
  trerc: 'trerc',
} as const

export type BigQueryLogicalTableName = keyof typeof BIGQUERY_TABLES

export function getBigQueryTableIdentifier(tableName: BigQueryLogicalTableName | string): string {
  const config = getBigQueryReadConfig()
  if (!config.isConfigured) {
    throw new Error('BigQuery dataset is not configured')
  }

  const resolvedTableName = tableName.trim()
  if (!resolvedTableName) {
    throw new Error('BigQuery table name is required')
  }

  return config.projectId
    ? `\`${config.projectId}.${config.datasetId}.${resolvedTableName}\``
    : `\`${config.datasetId}.${resolvedTableName}\``
}
