import 'server-only'

import { getBigQueryClient, getBigQueryReadConfig, type BigQueryClientLike } from './bigquery'
import { BIGQUERY_TABLES, getBigQueryTableIdentifier } from './bigquery-tables'
import type { TexasZctaCoverageTier, TexasZctaDimRow } from './texas-zcta-dim'

type RawBigQueryRow = Record<string, unknown>
type BigQueryQueryResult = RawBigQueryRow[] | [RawBigQueryRow[], ...unknown[]]

export interface TexasZctaReadOptions {
  client?: BigQueryClientLike
  limit?: number
}

export interface TexasZctaMetroReadOptions extends TexasZctaReadOptions {
  fuzzy?: boolean
}

const DEFAULT_ROW_LIMIT = 100
const DEFAULT_UPDATED_AT = '1970-01-01T00:00:00.000Z'
const TEXAS_ZCTA_BASE_SELECT = `
  SELECT
    zcta5,
    city,
    state_abbr,
    state_fips,
    county_fips,
    county_name,
    metro_name,
    metro_name_short,
    lat,
    lng,
    land_area_sq_m,
    water_area_sq_m,
    zillow_covered,
    coverage_tier,
    zori_latest,
    zhvi_latest,
    zori_growth_12m,
    zhvi_growth_12m,
    as_of_date,
    source_year,
    updated_at
`

function normalizeString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'object' && 'value' in value) {
    return normalizeString((value as { value: unknown }).value)
  }
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'object' && 'value' in value) {
    return normalizeNumber((value as { value: unknown }).value)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const parsed = Number.parseFloat(String(value).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const normalized = normalizeString(value)?.toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 't' || normalized === 'yes'
}

function normalizeInteger(value: unknown, fallback: number): number {
  const normalized = normalizeNumber(value)
  if (normalized == null) return fallback
  return Math.round(normalized)
}

function normalizeCoverageTier(value: unknown, zillowCovered: boolean): TexasZctaCoverageTier {
  const normalized = normalizeString(value)
  if (normalized === 'zillow_enhanced' || normalized === 'public_baseline_only') {
    return normalized
  }
  return zillowCovered ? 'zillow_enhanced' : 'public_baseline_only'
}

function normalizeTimestamp(value: unknown): string {
  const normalized = normalizeString(value)
  if (!normalized) return DEFAULT_UPDATED_AT
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? DEFAULT_UPDATED_AT : parsed.toISOString()
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
  options: TexasZctaReadOptions = {}
): Promise<TexasZctaDimRow[]> {
  if (!getBigQueryReadConfig().isConfigured) return []

  const client = options.client ?? (await getBigQueryClient())
  if (typeof client.query !== 'function') {
    throw new Error('BigQuery client does not support query()')
  }

  const result = (await client.query({
    query,
    params,
    location: getBigQueryReadConfig().location,
    useLegacySql: false,
  })) as BigQueryQueryResult

  return normalizeTexasZctaRows(extractRows(result))
}

export function normalizeTexasZctaRows(rows: readonly unknown[]): TexasZctaDimRow[] {
  const normalizedRows: TexasZctaDimRow[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as RawBigQueryRow
    const zcta5 = normalizeString(record.zcta5)
    const stateAbbr = normalizeString(record.state_abbr)
    const stateFips = normalizeString(record.state_fips)
    if (!zcta5 || !stateAbbr || !stateFips) continue

    const zillowCovered = normalizeBoolean(record.zillow_covered)
    normalizedRows.push({
      zcta5,
      city: normalizeString(record.city),
      state_abbr: stateAbbr,
      state_fips: stateFips,
      county_fips: normalizeString(record.county_fips),
      county_name: normalizeString(record.county_name),
      metro_name: normalizeString(record.metro_name),
      metro_name_short: normalizeString(record.metro_name_short),
      lat: normalizeNumber(record.lat),
      lng: normalizeNumber(record.lng),
      land_area_sq_m: normalizeNumber(record.land_area_sq_m),
      water_area_sq_m: normalizeNumber(record.water_area_sq_m),
      zillow_covered: zillowCovered,
      coverage_tier: normalizeCoverageTier(record.coverage_tier, zillowCovered),
      zori_latest: normalizeNumber(record.zori_latest),
      zhvi_latest: normalizeNumber(record.zhvi_latest),
      zori_growth_12m: normalizeNumber(record.zori_growth_12m),
      zhvi_growth_12m: normalizeNumber(record.zhvi_growth_12m),
      as_of_date: normalizeString(record.as_of_date),
      source_year: normalizeInteger(record.source_year, 2024),
      updated_at: normalizeTimestamp(record.updated_at),
    })
  }

  return normalizedRows
}

export async function fetchTexasZctaRowByZip(
  zip: string,
  options: TexasZctaReadOptions = {}
): Promise<TexasZctaDimRow | null> {
  const normalizedZip = zip.trim()
  if (!/^\d{5}$/.test(normalizedZip)) return null
  if (!getBigQueryReadConfig().isConfigured) return null
  const tableIdentifier = getBigQueryTableIdentifier(BIGQUERY_TABLES.texasZctaDim)

  const rows = await runBigQueryQuery(
    `
      ${TEXAS_ZCTA_BASE_SELECT}
      FROM ${tableIdentifier}
      WHERE zcta5 = @zip
      LIMIT 1
    `,
    { zip: normalizedZip },
    options
  )

  return rows[0] ?? null
}

export async function fetchTexasZctaRowsByState(
  stateAbbr = 'TX',
  options: TexasZctaReadOptions = {}
): Promise<TexasZctaDimRow[]> {
  const normalizedState = stateAbbr.trim().toUpperCase()
  if (!normalizedState) return []
  if (!getBigQueryReadConfig().isConfigured) return []
  const tableIdentifier = getBigQueryTableIdentifier(BIGQUERY_TABLES.texasZctaDim)

  return runBigQueryQuery(
    `
      ${TEXAS_ZCTA_BASE_SELECT}
      FROM ${tableIdentifier}
      WHERE state_abbr = @stateAbbr
      ORDER BY zillow_covered DESC, zcta5 ASC
      LIMIT @rowLimit
    `,
    {
      stateAbbr: normalizedState,
      rowLimit: options.limit ?? DEFAULT_ROW_LIMIT * 50,
    },
    options
  )
}

export async function fetchTexasZctaRowsByCity(
  city: string,
  stateAbbr = 'TX',
  options: TexasZctaReadOptions = {}
): Promise<TexasZctaDimRow[]> {
  const normalizedCity = city.trim()
  const normalizedState = stateAbbr.trim().toUpperCase()
  if (!normalizedCity || !normalizedState) return []
  if (!getBigQueryReadConfig().isConfigured) return []
  const tableIdentifier = getBigQueryTableIdentifier(BIGQUERY_TABLES.texasZctaDim)

  return runBigQueryQuery(
    `
      ${TEXAS_ZCTA_BASE_SELECT}
      FROM ${tableIdentifier}
      WHERE state_abbr = @stateAbbr
        AND city IS NOT NULL
        AND LOWER(city) = LOWER(@city)
      ORDER BY zillow_covered DESC, zcta5 ASC
      LIMIT @rowLimit
    `,
    {
      city: normalizedCity,
      stateAbbr: normalizedState,
      rowLimit: options.limit ?? DEFAULT_ROW_LIMIT,
    },
    options
  )
}

export async function fetchTexasZctaRowsByCounty(
  countyName: string,
  stateAbbr = 'TX',
  options: TexasZctaReadOptions = {}
): Promise<TexasZctaDimRow[]> {
  const normalizedCounty = countyName.trim()
  const normalizedState = stateAbbr.trim().toUpperCase()
  if (!normalizedCounty || !normalizedState) return []
  if (!getBigQueryReadConfig().isConfigured) return []
  const tableIdentifier = getBigQueryTableIdentifier(BIGQUERY_TABLES.texasZctaDim)

  return runBigQueryQuery(
    `
      ${TEXAS_ZCTA_BASE_SELECT}
      FROM ${tableIdentifier}
      WHERE state_abbr = @stateAbbr
        AND county_name IS NOT NULL
        AND LOWER(county_name) = LOWER(@countyName)
      ORDER BY zillow_covered DESC, zcta5 ASC
      LIMIT @rowLimit
    `,
    {
      countyName: normalizedCounty,
      stateAbbr: normalizedState,
      rowLimit: options.limit ?? DEFAULT_ROW_LIMIT * 5,
    },
    options
  )
}

export async function fetchTexasZctaRowsByMetro(
  metroName: string,
  stateAbbr = 'TX',
  options: TexasZctaMetroReadOptions = {}
): Promise<TexasZctaDimRow[]> {
  const normalizedMetro = metroName.trim()
  const normalizedState = stateAbbr.trim().toUpperCase()
  if (!normalizedMetro || !normalizedState) return []
  if (!getBigQueryReadConfig().isConfigured) return []
  const tableIdentifier = getBigQueryTableIdentifier(BIGQUERY_TABLES.texasZctaDim)
  const rowLimit = options.limit ?? DEFAULT_ROW_LIMIT * 5

  if (options.fuzzy) {
    return runBigQueryQuery(
      `
        ${TEXAS_ZCTA_BASE_SELECT}
        FROM ${tableIdentifier}
        WHERE state_abbr = @stateAbbr
          AND (
            (metro_name IS NOT NULL AND LOWER(metro_name) LIKE LOWER(@metroPattern))
            OR
            (metro_name_short IS NOT NULL AND LOWER(metro_name_short) LIKE LOWER(@metroPattern))
          )
        ORDER BY zillow_covered DESC, zcta5 ASC
        LIMIT @rowLimit
      `,
      {
        metroPattern: `%${normalizedMetro}%`,
        stateAbbr: normalizedState,
        rowLimit,
      },
      options
    )
  }

  return runBigQueryQuery(
    `
      ${TEXAS_ZCTA_BASE_SELECT}
      FROM ${tableIdentifier}
      WHERE state_abbr = @stateAbbr
        AND (
          (metro_name IS NOT NULL AND LOWER(metro_name) = LOWER(@metroName))
          OR
          (metro_name_short IS NOT NULL AND LOWER(metro_name_short) = LOWER(@metroName))
        )
      ORDER BY zillow_covered DESC, zcta5 ASC
      LIMIT @rowLimit
    `,
    {
      metroName: normalizedMetro,
      stateAbbr: normalizedState,
      rowLimit,
    },
    options
  )
}
