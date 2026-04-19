import 'server-only'

import { getBigQueryClient } from './bigquery'
import { BIGQUERY_TABLES, getBigQueryTableIdentifier } from './bigquery-tables'
import type { AnalyticalSubject, AnalyticalComparisonPoint } from './market-data-router'

export interface TexasPermitHistorySeries {
  sourceId: string
  sourceLabel: string
  points: AnalyticalComparisonPoint[]
}

interface BigQueryQueryClient {
  query: (options: { query: string; params: Record<string, unknown> }) => Promise<[Array<Record<string, unknown>>]>
}

function buildSubjectLabelAliases(subject: AnalyticalSubject): string[] {
  const aliases = new Set<string>()
  const label = subject.label.trim()
  if (label) aliases.add(label)

  if (subject.kind === 'county') {
    const withoutState = label.replace(/,\s*TX$/i, '').trim()
    if (withoutState) aliases.add(withoutState)
    const base = withoutState.replace(/\s+County$/i, '').trim()
    if (base) aliases.add(base)
  }

  if (subject.kind === 'metro') {
    const withoutState = label.replace(/,\s*TX$/i, '').trim()
    if (withoutState) aliases.add(withoutState)
    const base = withoutState.replace(/\s+metro(?:\s+area)?$/i, '').trim()
    if (base) aliases.add(base)
  }

  return Array.from(aliases)
}

export async function fetchTexasPermitHistorySeries(
  args: {
    subject: AnalyticalSubject
    startDate: string
  },
  dependencies: {
    client?: BigQueryQueryClient
  } = {}
): Promise<TexasPermitHistorySeries | null> {
  const client = dependencies.client ?? ((await getBigQueryClient()) as unknown as BigQueryQueryClient)
  const permitsTable = getBigQueryTableIdentifier(BIGQUERY_TABLES.texasPermits)
  const geographyTable = getBigQueryTableIdentifier(BIGQUERY_TABLES.dimGeography)
  const metricsTable = getBigQueryTableIdentifier(BIGQUERY_TABLES.dimMetrics)

  const [rows] = await client.query({
    query: `
      SELECT
        permits.time_period AS time_period,
        CAST(permits.metric_value AS FLOAT64) AS metric_value,
        COALESCE(metrics.data_source, 'TREC Building Permits') AS source_label
      FROM ${permitsTable} AS permits
      INNER JOIN ${geographyTable} AS geography
        ON permits.geo_id = geography.geo_id
      INNER JOIN ${metricsTable} AS metrics
        ON permits.metric_id = metrics.metric_id
      WHERE LOWER(geography.geo_type) = LOWER(@geoType)
        AND LOWER(geography.display_name) IN UNNEST(@subjectLabels)
        AND permits.time_period >= @startDate
        AND LOWER(metrics.metric_id) = 'permit_units'
      ORDER BY permits.time_period ASC
    `,
    params: {
      geoType: args.subject.kind,
      subjectLabels: buildSubjectLabelAliases(args.subject).map((value) => value.toLowerCase()),
      startDate: args.startDate,
    },
  })

  const points = rows
    .map((row) => {
      const x = typeof row.time_period === 'string'
        ? row.time_period
        : row.time_period instanceof Date
          ? row.time_period.toISOString().slice(0, 10)
          : null
      const y = Number(row.metric_value)
      if (!x || !Number.isFinite(y)) return null
      return { x, y }
    })
    .filter((point): point is AnalyticalComparisonPoint => point !== null)

  if (points.length === 0) return null

  const sourceLabel = rows[0]?.source_label
  return {
    sourceId: 'texas_permits:warehouse',
    sourceLabel: typeof sourceLabel === 'string' && sourceLabel.trim() ? sourceLabel.trim() : 'TREC Building Permits',
    points,
  }
}
