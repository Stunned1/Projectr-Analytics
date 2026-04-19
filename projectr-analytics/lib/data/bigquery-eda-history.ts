import 'server-only'

import { getBigQueryClient } from './bigquery'
import { BIGQUERY_TABLES, getBigQueryTableIdentifier } from './bigquery-tables'
import type { AnalyticalSubject, AnalyticalComparisonPoint } from './market-data-router'
import { normalizeBigQueryDateLike } from './types'

export interface TexasPermitHistorySeries {
  sourceId: string
  sourceLabel: string
  points: AnalyticalComparisonPoint[]
}

interface BigQueryQueryClient {
  query: (options: {
    query: string
    params: Record<string, unknown>
    types?: Record<string, unknown>
  }) => Promise<[Array<Record<string, unknown>>]>
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
  const subjectLabels = buildSubjectLabelAliases(args.subject).map((value) => value.toLowerCase())

  const [rows] = await client.query({
    query: `
      SELECT
        permits.time_period AS time_period,
        SUM(CAST(permits.metric_value AS FLOAT64)) AS metric_value,
        'TREC Building Permits' AS source_label
      FROM ${permitsTable} AS permits
      INNER JOIN ${geographyTable} AS geography
        ON (
          (LOWER(@geoType) = 'county' AND SAFE_CAST(geography.fips_code AS INT64) = permits.geo_id)
          OR (LOWER(@geoType) != 'county' AND geography.geo_id = permits.geo_id)
        )
      WHERE LOWER(geography.geo_type) = LOWER(@geoType)
        AND LOWER(geography.display_name) IN UNNEST(@subjectLabels)
        AND permits.time_period >= @startDate
        AND permits.metric_id IN ('Permit_Single_Family_Units', 'Permit_Multi_Family_Units')
      GROUP BY permits.time_period
      ORDER BY permits.time_period ASC
    `,
    params: {
      geoType: args.subject.kind,
      subjectLabels,
      startDate: args.startDate,
    },
    types: {
      subjectLabels: ['STRING'],
    },
  })

  const points = rows
    .map((row) => {
      const x = normalizeBigQueryDateLike(row.time_period)
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
