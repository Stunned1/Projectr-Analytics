import { normalizeCountyDisplayName, normalizeMetroDisplayName, stripTrailingStateSuffix } from '@/lib/area-keys'
import { geocodeAddressForward } from '@/lib/google-forward-geocode'
import { supabase } from '@/lib/supabase'

type TexasPermitScopeKind = 'city' | 'county' | 'metro'

type TexasPermitScope = {
  kind: TexasPermitScopeKind
  name: string
  state?: string | null
}

type TrecPermitPlaceRow = {
  state_name?: string | null
  county_name?: string | null
  metropolitan_statistical_area_name?: string | null
  place_name?: string | null
  place_fips?: string | null
  month_begin_date?: string | null
  buildings_1_unit?: unknown
  buildings_2_unit?: unknown
  buildings_34_unit?: unknown
  buildings_5_unit?: unknown
  units_1_unit?: unknown
  units_2_unit?: unknown
  units_34_unit?: unknown
  units_5_unit?: unknown
  valuation_1_unit?: unknown
  valuation_2_unit?: unknown
  valuation_34_unit?: unknown
  valuation_5_unit?: unknown
}

type TrecEnvelope = {
  queryRows?: number | string | null
  rowData?: TrecPermitPlaceRow[]
}

type TexasLookupRow = {
  city: string | null
  county_name?: string | null
  lat: number | null
  lng: number | null
}

type TexasPlaceCentroid = {
  lat: number
  lng: number
  source: 'zip_lookup' | 'google_geocode'
}

type TexasPermitGroup = {
  id: string
  place_name: string
  county_name: string | null
  metro_name: string | null
  state_name: string
  latest_month: string | null
  total_units: number
  total_buildings: number
  total_value: number
  single_family_units: number
  multi_family_units: number
  activity_score: number
  months_covered: number
}

export interface TexasPermitActivityPoint extends TexasPermitGroup {
  lat: number
  lng: number
  centroid_source: TexasPlaceCentroid['source']
}

export interface TexasPermitActivityResult {
  scope_kind: TexasPermitScopeKind
  scope_name: string
  latest_month: string | null
  raw_row_count: number
  places: TexasPermitActivityPoint[]
  truncated: boolean
  unresolved_places: number
}

const TREC_BUILDING_PERMIT_ADVANCED_ENDPOINT =
  'https://trerc.tamu.edu/wp-json/trerc-data/v1/building-permit-advanced-charting-table'
const TEXAS_SCOPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const TEXAS_LOOKUP_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const TEXAS_GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TEXAS_PERMIT_WINDOW_MONTHS = 12
const MAX_TREC_PLACE_ROWS = 25000
const MAX_GEOCODE_FALLBACKS = 12
const GEOCODE_CONCURRENCY = 4

const scopeCache = new Map<string, { expiresAt: number; value: TexasPermitActivityResult }>()
const scopeInflight = new Map<string, Promise<TexasPermitActivityResult>>()
const centroidCache = new Map<string, { expiresAt: number; value: TexasPlaceCentroid | null }>()

let texasLookupCache:
  | {
      expiresAt: number
      byCity: Map<string, TexasPlaceCentroid>
      byCityCounty: Map<string, TexasPlaceCentroid>
    }
  | null = null

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^city of\s+/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCountyToken(value: string | null | undefined): string {
  if (!value) return ''
  return normalizeText(value.replace(/\s+county$/i, ''))
}

function normalizeCityToken(value: string | null | undefined): string {
  if (!value) return ''
  return normalizeText(stripTrailingStateSuffix(value))
}

function normalizeScopeName(scope: TexasPermitScope): string {
  if (scope.kind === 'county') {
    return normalizeCountyDisplayName(scope.name)
  }
  if (scope.kind === 'metro') {
    return normalizeMetroDisplayName(scope.name)
  }
  return stripTrailingStateSuffix(scope.name).trim()
}

function buildScopeCacheKey(scope: TexasPermitScope): string {
  return `${scope.kind}:${normalizeText(normalizeScopeName(scope))}`
}

function buildPlaceKey(placeName: string, countyName: string | null): string {
  const city = normalizeCityToken(placeName)
  const county = normalizeCountyToken(countyName)
  return county ? `${city}|${county}` : city
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const parsed = Number.parseFloat(value.replace(/[$,%]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function sumValues(...values: unknown[]): number {
  return values.reduce<number>((total, value) => total + toNumber(value), 0)
}

function parseMonth(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function addUtcMonths(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1))
}

function formatMonth(date: Date | null): string | null {
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function parseTrecEnvelope(payload: unknown): TrecEnvelope {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('TREC permit activity returned an invalid payload')
  }
  return parsed as TrecEnvelope
}

async function fetchTrecPermitRows(scope: TexasPermitScope): Promise<{ rows: TrecPermitPlaceRow[]; truncated: boolean }> {
  const scopeName = normalizeScopeName(scope)
  const stateCondition = {
    filterType: 'text',
    colId: 'state_name',
    type: 'equals',
    filter: 'Texas',
  }

  const scopeCondition =
    scope.kind === 'city'
      ? {
          filterType: 'text',
          colId: 'place_name',
          type: 'equals',
          filter: scopeName,
        }
      : scope.kind === 'county'
        ? {
            filterType: 'text',
            colId: 'county_name',
            type: 'equals',
            filter: scopeName.replace(/\s+county$/i, ''),
          }
        : {
            filterType: 'text',
            colId: 'metropolitan_statistical_area_name',
            type: 'equals',
            filter: scopeName,
          }

  const response = await fetch(TREC_BUILDING_PERMIT_ADVANCED_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      startRow: 0,
      endRow: MAX_TREC_PLACE_ROWS,
      filterModel: {
        filterType: 'join',
        type: 'AND',
        conditions: [stateCondition, scopeCondition],
      },
    }),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`TREC permit activity request failed (${response.status})`)
  }

  const envelope = parseTrecEnvelope((await response.json()) as unknown)
  const rows = Array.isArray(envelope.rowData) ? envelope.rowData : []
  const queryRows =
    typeof envelope.queryRows === 'number'
      ? envelope.queryRows
      : typeof envelope.queryRows === 'string'
        ? Number.parseInt(envelope.queryRows, 10)
        : rows.length

  if (rows.length === 0 && scope.kind === 'metro') {
    const metroAlias = scopeName
      .split(/[-/]|(?:\s+and\s+)/i)
      .map((segment) => segment.trim())
      .filter(Boolean)[0]

    if (metroAlias && metroAlias !== scopeName) {
      const fallbackResponse = await fetch(TREC_BUILDING_PERMIT_ADVANCED_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          startRow: 0,
          endRow: MAX_TREC_PLACE_ROWS,
          filterModel: {
            filterType: 'join',
            type: 'AND',
            conditions: [
              stateCondition,
              {
                filterType: 'text',
                colId: 'metropolitan_statistical_area_name',
                type: 'contains',
                filter: metroAlias,
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      })

      if (!fallbackResponse.ok) {
        throw new Error(`TREC permit activity fallback request failed (${fallbackResponse.status})`)
      }

      const fallbackEnvelope = parseTrecEnvelope((await fallbackResponse.json()) as unknown)
      const fallbackRows = Array.isArray(fallbackEnvelope.rowData) ? fallbackEnvelope.rowData : []
      const fallbackQueryRows =
        typeof fallbackEnvelope.queryRows === 'number'
          ? fallbackEnvelope.queryRows
          : typeof fallbackEnvelope.queryRows === 'string'
            ? Number.parseInt(fallbackEnvelope.queryRows, 10)
            : fallbackRows.length

      return {
        rows: fallbackRows,
        truncated: Number.isFinite(fallbackQueryRows) ? fallbackQueryRows > fallbackRows.length : false,
      }
    }
  }

  return {
    rows,
    truncated: Number.isFinite(queryRows) ? queryRows > rows.length : false,
  }
}

function mergeCentroid(existing: TexasPlaceCentroid | undefined, lat: number, lng: number): TexasPlaceCentroid {
  if (!existing) {
    return { lat, lng, source: 'zip_lookup' }
  }
  return {
    lat: (existing.lat + lat) / 2,
    lng: (existing.lng + lng) / 2,
    source: 'zip_lookup',
  }
}

async function loadTexasLookupMaps(): Promise<{
  byCity: Map<string, TexasPlaceCentroid>
  byCityCounty: Map<string, TexasPlaceCentroid>
}> {
  if (texasLookupCache && texasLookupCache.expiresAt > Date.now()) {
    return {
      byCity: texasLookupCache.byCity,
      byCityCounty: texasLookupCache.byCityCounty,
    }
  }

  const { data, error } = await supabase
    .from('zip_metro_lookup')
    .select('city, county_name, lat, lng')
    .eq('state', 'TX')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .limit(5000)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as TexasLookupRow[]
  const byCity = new Map<string, TexasPlaceCentroid>()
  const byCityCounty = new Map<string, TexasPlaceCentroid>()

  for (const row of rows) {
    if (row.lat == null || row.lng == null || !row.city) continue
    const cityKey = normalizeCityToken(row.city)
    if (!cityKey) continue
    byCity.set(cityKey, mergeCentroid(byCity.get(cityKey), row.lat, row.lng))

    const countyKey = normalizeCountyToken(row.county_name)
    if (!countyKey) continue
    const combinedKey = `${cityKey}|${countyKey}`
    byCityCounty.set(combinedKey, mergeCentroid(byCityCounty.get(combinedKey), row.lat, row.lng))
  }

  texasLookupCache = {
    expiresAt: Date.now() + TEXAS_LOOKUP_CACHE_TTL_MS,
    byCity,
    byCityCounty,
  }

  return { byCity, byCityCounty }
}

async function geocodeTexasPlace(
  placeName: string,
  countyName: string | null
): Promise<TexasPlaceCentroid | null> {
  const cacheKey = buildPlaceKey(placeName, countyName)
  const cached = centroidCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const geocodeCandidates = [
    countyName ? `${placeName}, ${countyName} County, Texas` : null,
    `${placeName}, Texas`,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of geocodeCandidates) {
    const resolved = await geocodeAddressForward(candidate)
    if (!resolved) continue

    const centroid = {
      lat: resolved.lat,
      lng: resolved.lng,
      source: 'google_geocode' as const,
    }
    centroidCache.set(cacheKey, {
      expiresAt: Date.now() + TEXAS_GEOCODE_CACHE_TTL_MS,
      value: centroid,
    })
    return centroid
  }

  centroidCache.set(cacheKey, {
    expiresAt: Date.now() + TEXAS_GEOCODE_CACHE_TTL_MS,
    value: null,
  })
  return null
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return []

  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await task(values[currentIndex])
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), values.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

async function resolveCentroids(
  groups: TexasPermitGroup[]
): Promise<{ resolved: TexasPermitActivityPoint[]; unresolvedCount: number }> {
  const { byCity, byCityCounty } = await loadTexasLookupMaps()
  const resolved: TexasPermitActivityPoint[] = []
  const unresolved: TexasPermitGroup[] = []

  for (const group of groups) {
    const placeKey = buildPlaceKey(group.place_name, group.county_name)
    const cityKey = normalizeCityToken(group.place_name)
    const lookupCentroid = byCityCounty.get(placeKey) ?? byCity.get(cityKey) ?? null

    if (lookupCentroid) {
      centroidCache.set(placeKey, {
        expiresAt: Date.now() + TEXAS_GEOCODE_CACHE_TTL_MS,
        value: lookupCentroid,
      })
      resolved.push({
        ...group,
        lat: lookupCentroid.lat,
        lng: lookupCentroid.lng,
        centroid_source: lookupCentroid.source,
      })
      continue
    }

    unresolved.push(group)
  }

  const fallbackCandidates = unresolved.slice(0, MAX_GEOCODE_FALLBACKS)
  const fallbackCentroids = await mapWithConcurrency(
    fallbackCandidates,
    GEOCODE_CONCURRENCY,
    async (group) => geocodeTexasPlace(group.place_name, group.county_name)
  )

  fallbackCandidates.forEach((group, index) => {
    const centroid = fallbackCentroids[index]
    if (!centroid) return
    resolved.push({
      ...group,
      lat: centroid.lat,
      lng: centroid.lng,
      centroid_source: centroid.source,
    })
  })

  return {
    resolved,
    unresolvedCount: unresolved.length - fallbackCentroids.filter(Boolean).length,
  }
}

function buildPermitGroups(rows: TrecPermitPlaceRow[]): { groups: TexasPermitGroup[]; latestMonth: string | null } {
  const datedRows = rows
    .map((row) => ({
      row,
      date: parseMonth(row.month_begin_date),
    }))
    .filter((entry): entry is { row: TrecPermitPlaceRow; date: Date } => entry.date !== null)

  const latestDate = datedRows.reduce<Date | null>(
    (latest, entry) => (!latest || entry.date > latest ? entry.date : latest),
    null
  )
  const windowStart = latestDate ? addUtcMonths(latestDate, -(TEXAS_PERMIT_WINDOW_MONTHS - 1)) : null
  const grouped = new Map<string, TexasPermitGroup>()

  for (const entry of datedRows) {
    if (windowStart && entry.date < windowStart) continue

    const placeName = (entry.row.place_name ?? '').trim()
    if (!placeName) continue
    const countyName = entry.row.county_name?.trim() || null
    const metroName = entry.row.metropolitan_statistical_area_name?.trim() || null
    const stateName = entry.row.state_name?.trim() || 'Texas'
    const id = entry.row.place_fips?.trim() || `${buildPlaceKey(placeName, countyName)}`
    const monthLabel = formatMonth(entry.date)
    const totalBuildings = sumValues(
      entry.row.buildings_1_unit,
      entry.row.buildings_2_unit,
      entry.row.buildings_34_unit,
      entry.row.buildings_5_unit
    )
    const singleFamilyUnits = sumValues(entry.row.units_1_unit)
    const multiFamilyUnits = sumValues(
      entry.row.units_2_unit,
      entry.row.units_34_unit,
      entry.row.units_5_unit
    )
    const totalUnits = singleFamilyUnits + multiFamilyUnits
    const totalValue = sumValues(
      entry.row.valuation_1_unit,
      entry.row.valuation_2_unit,
      entry.row.valuation_34_unit,
      entry.row.valuation_5_unit
    )

    if (totalUnits <= 0 && totalBuildings <= 0 && totalValue <= 0) continue

    const existing = grouped.get(id)
    if (!existing) {
      grouped.set(id, {
        id,
        place_name: placeName,
        county_name: countyName,
        metro_name: metroName,
        state_name: stateName,
        latest_month: monthLabel,
        total_units: totalUnits,
        total_buildings: totalBuildings,
        total_value: totalValue,
        single_family_units: singleFamilyUnits,
        multi_family_units: multiFamilyUnits,
        activity_score: Math.max(totalUnits, totalBuildings, 1),
        months_covered: 1,
      })
      continue
    }

    existing.total_units += totalUnits
    existing.total_buildings += totalBuildings
    existing.total_value += totalValue
    existing.single_family_units += singleFamilyUnits
    existing.multi_family_units += multiFamilyUnits
    existing.activity_score = Math.max(existing.total_units, existing.total_buildings, 1)
    existing.months_covered += 1
    if (monthLabel && (!existing.latest_month || monthLabel > existing.latest_month)) {
      existing.latest_month = monthLabel
    }
  }

  return {
    groups: Array.from(grouped.values()).sort((a, b) => {
      if (b.activity_score !== a.activity_score) return b.activity_score - a.activity_score
      return b.total_value - a.total_value
    }),
    latestMonth: formatMonth(latestDate),
  }
}

async function loadTexasPermitActivity(scope: TexasPermitScope): Promise<TexasPermitActivityResult> {
  const normalizedScopeName = normalizeScopeName(scope)
  const { rows, truncated } = await fetchTrecPermitRows(scope)
  const { groups, latestMonth } = buildPermitGroups(rows)
  const { resolved, unresolvedCount } = await resolveCentroids(groups)

  return {
    scope_kind: scope.kind,
    scope_name: normalizedScopeName,
    latest_month: latestMonth,
    raw_row_count: rows.length,
    places: resolved,
    truncated,
    unresolved_places: unresolvedCount,
  }
}

export async function getTexasPermitActivity(scope: TexasPermitScope): Promise<TexasPermitActivityResult> {
  const cacheKey = buildScopeCacheKey(scope)
  const cached = scopeCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const inflight = scopeInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }

  const request = loadTexasPermitActivity(scope)
    .then((result) => {
      scopeCache.set(cacheKey, {
        expiresAt: Date.now() + TEXAS_SCOPE_CACHE_TTL_MS,
        value: result,
      })
      return result
    })
    .finally(() => {
      scopeInflight.delete(cacheKey)
    })

  scopeInflight.set(cacheKey, request)
  return request
}
