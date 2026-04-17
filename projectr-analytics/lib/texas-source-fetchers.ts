import { buildCountyAreaKey, buildMetroAreaKey } from './area-keys'
import type { MasterDataRow } from './supabase'

type InsertableMasterRow = Omit<MasterDataRow, 'id' | 'created_at'>

type TexasAreaKind = 'county' | 'metro'
type TexasProjectionScenario = 'High' | 'Mid' | 'Low'

export type TexasFetchScope = TexasAreaKind | 'both'

export interface TexasApiFetchOptions {
  scope?: TexasFetchScope
  match?: string[]
  limit?: number | null
}

export interface TexasFetchResult {
  rows: InsertableMasterRow[]
  geographyCount: number
}

type TexasAreaDescriptor = {
  kind: TexasAreaKind
  geoId: string
  geoName: string
  geoTypeId: number
  geoType: string
  hashKey: string
}

type TrecEnvelope = {
  status?: string
  rowData?: Record<string, unknown>[]
  queryRows?: number | string | null
}

type TrecHousingMetadata = {
  area_type_2_select?: Record<string, Record<string, string>>
  area_type_4_select?: Record<string, Record<string, string>>
}

type TrecPermitGeoItem = {
  id?: string
  items?: Record<string, { id?: string }>
}

type TrecPermitMetadata = Record<
  string,
  {
    id?: string
    items?: Record<string, TrecPermitGeoItem>
  }
>

type TdcEstimateRow = {
  Name?: string
  Pop2020?: number
  Pop2021?: number
  Pop2022?: number
  Pop2023?: number
  Pop2024?: number
  Pop2025?: number
}

type TdcProjectionRow = {
  Name?: string
  Pop2020?: number
  Pop2030?: number
  Pop2040?: number
  Pop2050?: number
  Pop2060?: number
}

const TREC_API_BASE = 'https://trerc.tamu.edu/wp-json/trerc-data/v1'
const TDC_API_BASE = 'https://demographics.texas.gov/api/Tpepp'
const TEXAS_STATE_ID = '26'
const DEFAULT_CONCURRENCY = 4

function buildMasterRow(args: {
  submarketId: string
  metricName: string
  metricValue: number
  timePeriod: string
  dataSource: string
}): InsertableMasterRow {
  return {
    submarket_id: args.submarketId,
    geometry: null,
    metric_name: args.metricName,
    metric_value: args.metricValue,
    time_period: args.timePeriod,
    data_source: args.dataSource,
    visual_bucket: 'TIME_SERIES',
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value.replace(/[$,%]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function sumNumbers(values: unknown[]): number | null {
  let total = 0
  let hasValue = false
  for (const value of values) {
    const numeric = toNumber(value)
    if (numeric == null) continue
    total += numeric
    hasValue = true
  }
  return hasValue ? total : null
}

function normalizeMatchTerms(match?: string[] | null): string[] {
  return (match ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeLimit(limit?: number | null): number | null {
  if (limit == null) return null
  if (!Number.isFinite(limit)) return null
  return Math.max(0, Math.floor(limit))
}

function areaMatchesFilters(area: TexasAreaDescriptor, matchTerms: string[]): boolean {
  if (matchTerms.length === 0) return true
  const haystack = area.geoName.toLowerCase()
  return matchTerms.some((term) => haystack.includes(term))
}

function expandScope(scope: TexasFetchScope = 'both'): TexasAreaKind[] {
  if (scope === 'both') return ['county', 'metro']
  return [scope]
}

function selectAreas(
  areas: TexasAreaDescriptor[],
  options: TexasApiFetchOptions | undefined
): TexasAreaDescriptor[] {
  const matchTerms = normalizeMatchTerms(options?.match)
  const limit = normalizeLimit(options?.limit)
  const filtered = areas.filter((area) => areaMatchesFilters(area, matchTerms))
  return limit == null ? filtered : filtered.slice(0, limit)
}

function areaKeyFromDescriptor(area: TexasAreaDescriptor): string {
  return area.kind === 'county'
    ? buildCountyAreaKey(area.geoName, 'TX')
    : buildMetroAreaKey(area.geoName, 'TX')
}

function estimateTimePeriod(year: number): string {
  return year === 2025 ? `${year}-01-01` : `${year}-07-01`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return (await response.json()) as T
}

function parseTrecEnvelope(raw: unknown): TrecEnvelope {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('TREC API returned an invalid payload')
  }
  return parsed as TrecEnvelope
}

async function fetchTrecEnvelope(url: string, body: Record<string, unknown>): Promise<TrecEnvelope> {
  const payload = await fetchJson<unknown>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  return parseTrecEnvelope(payload)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return []

  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await task(values[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), values.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

async function fetchTrecHousingAreas(options?: TexasApiFetchOptions): Promise<TexasAreaDescriptor[]> {
  const payload = await fetchJson<TrecHousingMetadata>(`${TREC_API_BASE}/housing-activity`)
  const scopedKinds = new Set(expandScope(options?.scope))
  const metros = scopedKinds.has('metro')
    ? Object.entries(payload.area_type_2_select?.[TEXAS_STATE_ID] ?? {}).map(([geoId, geoName]) => ({
        kind: 'metro' as const,
        geoId,
        geoName,
        geoTypeId: 2,
        geoType: 'Metropolitan Statistical Area',
        hashKey: 'MSA',
      }))
    : []
  const counties = scopedKinds.has('county')
    ? Object.entries(payload.area_type_4_select?.[TEXAS_STATE_ID] ?? {}).map(([geoId, geoName]) => ({
        kind: 'county' as const,
        geoId,
        geoName,
        geoTypeId: 4,
        geoType: 'County',
        hashKey: 'County',
      }))
    : []

  return selectAreas([...metros, ...counties], options)
}

async function fetchTrecPermitAreas(options?: TexasApiFetchOptions): Promise<TexasAreaDescriptor[]> {
  const payload = await fetchJson<TrecPermitMetadata>(`${TREC_API_BASE}/building-permit`)
  const texas = payload.Texas
  if (!texas?.items) {
    throw new Error('TREC permit geography metadata did not contain Texas')
  }

  const scopedKinds = new Set(expandScope(options?.scope))
  const metrosGroup = texas.items['Metropolitan Statistical Area']
  const countiesGroup = texas.items.County

  const metros = scopedKinds.has('metro') && metrosGroup?.items
    ? Object.entries(metrosGroup.items).map(([geoName, descriptor]) => ({
        kind: 'metro' as const,
        geoId: descriptor.id ?? '',
        geoName,
        geoTypeId: Number.parseInt(metrosGroup.id ?? '2', 10),
        geoType: 'Metropolitan Statistical Area',
        hashKey: 'MSA',
      })).filter((area) => area.geoId.length > 0)
    : []

  const counties = scopedKinds.has('county') && countiesGroup?.items
    ? Object.entries(countiesGroup.items).map(([geoName, descriptor]) => ({
        kind: 'county' as const,
        geoId: descriptor.id ?? '',
        geoName,
        geoTypeId: Number.parseInt(countiesGroup.id ?? '4', 10),
        geoType: 'County',
        hashKey: 'County',
      })).filter((area) => area.geoId.length > 0)
    : []

  return selectAreas([...metros, ...counties], options)
}

function buildHousingRowsForArea(area: TexasAreaDescriptor, records: Record<string, unknown>[]): InsertableMasterRow[] {
  const submarketId = areaKeyFromDescriptor(area)
  const rows: InsertableMasterRow[] = []

  for (const record of records) {
    const timePeriod = typeof record.begin_date === 'string' ? record.begin_date : null
    if (!timePeriod) continue

    const metrics: Array<[string, number | null]> = [
      ['Housing_Activity_Closed_Sales', toNumber(record.closed_listings)],
      ['Housing_Activity_Active_Listings', toNumber(record.active_listings)],
      ['Housing_Activity_Avg_Close_Price', toNumber(record.avg_close_price)],
      ['Housing_Activity_Median_Sales_Price', toNumber(record.median_close_price)],
      ['Housing_Activity_Dollar_Volume_USD', toNumber(record.dollar_volume)],
      ['Housing_Activity_Months_Inventory', toNumber(record.months_inventory)],
    ]

    for (const [metricName, metricValue] of metrics) {
      if (metricValue == null) continue
      rows.push(
        buildMasterRow({
          submarketId,
          metricName,
          metricValue,
          timePeriod,
          dataSource: 'TREC Housing Activity',
        })
      )
    }
  }

  return rows
}

function buildPermitRowsForArea(area: TexasAreaDescriptor, records: Record<string, unknown>[]): InsertableMasterRow[] {
  const submarketId = areaKeyFromDescriptor(area)
  const rows: InsertableMasterRow[] = []

  for (const record of records) {
    const timePeriod = typeof record.begin_date === 'string' ? record.begin_date : null
    if (!timePeriod) continue

    const singleFamilyUnits = toNumber(record.units_1_unit)
    const multiFamilyUnits = sumNumbers([record.units_2_unit, record.units_34_unit, record.units_5_unit])
    const totalUnits = sumNumbers([record.units_1_unit, record.units_2_unit, record.units_34_unit, record.units_5_unit])
    const totalBuildings = sumNumbers([
      record.buildings_1_unit,
      record.buildings_2_unit,
      record.buildings_34_unit,
      record.buildings_5_unit,
    ])
    const totalValue = sumNumbers([
      record.valuation_1_unit,
      record.valuation_2_unit,
      record.valuation_34_unit,
      record.valuation_5_unit,
    ])

    const metrics: Array<[string, number | null]> = [
      ['Permit_Units', totalUnits],
      ['Permit_Buildings', totalBuildings],
      ['Permit_Value_USD', totalValue],
      ['Permit_Single_Family_Units', singleFamilyUnits],
      ['Permit_Multi_Family_Units', multiFamilyUnits],
    ]

    for (const [metricName, metricValue] of metrics) {
      if (metricValue == null) continue
      rows.push(
        buildMasterRow({
          submarketId,
          metricName,
          metricValue,
          timePeriod,
          dataSource: 'TREC Building Permits',
        })
      )
    }
  }

  return rows
}

function buildDemographicEstimateRows(
  kind: TexasAreaKind,
  records: TdcEstimateRow[]
): InsertableMasterRow[] {
  const rows: InsertableMasterRow[] = []
  for (const record of records) {
    const areaName = typeof record.Name === 'string' ? record.Name : null
    if (!areaName) continue
    const submarketId =
      kind === 'county'
        ? buildCountyAreaKey(areaName, 'TX')
        : buildMetroAreaKey(areaName, 'TX')

    for (const year of [2020, 2021, 2022, 2023, 2024, 2025] as const) {
      const metricValue = toNumber(record[`Pop${year}`])
      if (metricValue == null) continue
      rows.push(
        buildMasterRow({
          submarketId,
          metricName: 'Total_Population',
          metricValue,
          timePeriod: estimateTimePeriod(year),
          dataSource: 'Texas Demographic Center Estimates',
        })
      )
    }
  }
  return rows
}

function buildDemographicProjectionRows(
  kind: TexasAreaKind,
  records: TdcProjectionRow[],
  scenario: TexasProjectionScenario
): InsertableMasterRow[] {
  const rows: InsertableMasterRow[] = []
  const dataSource = `Texas Demographic Center Projections (${scenario})`

  for (const record of records) {
    const areaName = typeof record.Name === 'string' ? record.Name : null
    if (!areaName) continue
    const submarketId =
      kind === 'county'
        ? buildCountyAreaKey(areaName, 'TX')
        : buildMetroAreaKey(areaName, 'TX')

    for (const year of [2020, 2030, 2040, 2050, 2060] as const) {
      const metricValue = toNumber(record[`Pop${year}`])
      if (metricValue == null) continue
      rows.push(
        buildMasterRow({
          submarketId,
          metricName: 'Projected_Total_Population',
          metricValue,
          timePeriod: `${year}-01-01`,
          dataSource,
        })
      )
    }
  }

  return rows
}

async function fetchBuildingPermitRecords(area: TexasAreaDescriptor): Promise<Record<string, unknown>[]> {
  const basePayload = {
    geoData: {
      geoId: area.geoId,
      geoName: area.geoName,
      geoTypeId: area.geoTypeId,
      geoType: area.geoType,
      hashKey: area.hashKey,
    },
    tableTypes: { period: 'monthly' },
  }

  const firstPage = await fetchTrecEnvelope(`${TREC_API_BASE}/building-permit-table`, {
    ...basePayload,
    startRow: 0,
    endRow: 500,
  })

  const firstRows = firstPage.rowData ?? []
  const totalRows = Math.max(toNumber(firstPage.queryRows) ?? 0, firstRows.length)
  if (totalRows <= firstRows.length) return firstRows

  const fullPage = await fetchTrecEnvelope(`${TREC_API_BASE}/building-permit-table`, {
    ...basePayload,
    startRow: 0,
    endRow: totalRows,
  })
  return fullPage.rowData ?? firstRows
}

export function parseTexasFetchScope(value?: string | null): TexasFetchScope {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'county' || normalized === 'metro') return normalized
  return 'both'
}

export function parseTexasFetchMatch(value?: string | null): string[] {
  return normalizeMatchTerms(value ? [value] : [])
}

export function parseTexasFetchLimit(value?: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null
}

export function parseTexasProjectionScenario(value?: string | null): TexasProjectionScenario {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'high') return 'High'
  if (normalized === 'low') return 'Low'
  return 'Mid'
}

export async function fetchTexasHousingActivityRows(options?: TexasApiFetchOptions): Promise<TexasFetchResult> {
  const areas = await fetchTrecHousingAreas(options)
  const batches = await mapWithConcurrency(areas, DEFAULT_CONCURRENCY, async (area) => {
    const payload = {
      geoData: {
        geoId: area.geoId,
        geoName: area.geoName,
        geoTypeId: area.geoTypeId,
        geoType: area.geoType,
        hashKey: area.hashKey,
      },
      tableTypes: { period: 'monthly' },
    }
    const envelope = await fetchTrecEnvelope(`${TREC_API_BASE}/housing-activity-table`, payload)
    return buildHousingRowsForArea(area, envelope.rowData ?? [])
  })

  return {
    rows: batches.flat(),
    geographyCount: areas.length,
  }
}

export async function fetchTexasBuildingPermitRows(options?: TexasApiFetchOptions): Promise<TexasFetchResult> {
  const areas = await fetchTrecPermitAreas(options)
  const batches = await mapWithConcurrency(areas, DEFAULT_CONCURRENCY, async (area) => {
    const records = await fetchBuildingPermitRecords(area)
    return buildPermitRowsForArea(area, records)
  })

  return {
    rows: batches.flat(),
    geographyCount: areas.length,
  }
}

export async function fetchTexasDemographicEstimateRows(options?: TexasApiFetchOptions): Promise<TexasFetchResult> {
  const scopedKinds = expandScope(options?.scope)
  const limit = normalizeLimit(options?.limit)
  const matchTerms = normalizeMatchTerms(options?.match)
  const rows: InsertableMasterRow[] = []
  let geographyCount = 0

  for (const kind of scopedKinds) {
    const endpoint = kind === 'county' ? 'county' : 'MSA'
    const records = await fetchJson<TdcEstimateRow[]>(`${TDC_API_BASE}/Estimates/Totals/${endpoint}`)
    const filtered = records.filter((record) => {
      const name = typeof record.Name === 'string' ? record.Name.toLowerCase() : ''
      return matchTerms.length === 0 || matchTerms.some((term) => name.includes(term))
    })
    const limited = limit == null ? filtered : filtered.slice(0, limit)
    geographyCount += limited.length
    rows.push(...buildDemographicEstimateRows(kind, limited))
  }

  return { rows, geographyCount }
}

export async function fetchTexasDemographicProjectionRows(args?: TexasApiFetchOptions & { scenario?: TexasProjectionScenario }): Promise<TexasFetchResult> {
  const scopedKinds = expandScope(args?.scope)
  const limit = normalizeLimit(args?.limit)
  const matchTerms = normalizeMatchTerms(args?.match)
  const scenario = args?.scenario ?? 'Mid'
  const rows: InsertableMasterRow[] = []
  let geographyCount = 0

  for (const kind of scopedKinds) {
    const areaVintageId = kind === 'county' ? '20202201' : '80202307'
    const records = await fetchJson<TdcProjectionRow[]>(
      `${TDC_API_BASE}/Projections/Totals/${scenario}?AreaVintageID=${areaVintageId}`
    )
    const filtered = records.filter((record) => {
      const name = typeof record.Name === 'string' ? record.Name.toLowerCase() : ''
      return matchTerms.length === 0 || matchTerms.some((term) => name.includes(term))
    })
    const limited = limit == null ? filtered : filtered.slice(0, limit)
    geographyCount += limited.length
    rows.push(...buildDemographicProjectionRows(kind, limited, scenario))
  }

  return { rows, geographyCount }
}
