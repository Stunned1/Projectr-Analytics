import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { buildCountyAreaKey, buildMetroAreaKey, normalizeCountyDisplayName, normalizeMetroDisplayName } from './area-keys'
import type { MasterDataRow, VisualBucket } from './supabase'

dotenv.config({ path: '.env.local' })

type InsertableMasterRow = Omit<MasterDataRow, 'id' | 'created_at'>
type NormalizedRecord = Record<string, unknown>
type DatasetKind = 'housing' | 'building-permits' | 'demographics-estimates' | 'demographics-projections'

const BATCH_SIZE = 500

function createSupabaseAdminLikeClient() {
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SECRET_KEY

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[%/$]/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeRows(rows: Record<string, unknown>[]): NormalizedRecord[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]))
  )
}

export function readTexasSourceRows(filePath: string, sheetName?: string): NormalizedRecord[] {
  const workbook = XLSX.readFile(path.resolve(filePath), { cellDates: true })
  const targetSheet = sheetName ?? workbook.SheetNames[0]
  const sheet = workbook.Sheets[targetSheet]
  if (!sheet) {
    throw new Error(`Sheet "${targetSheet}" was not found in ${filePath}`)
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  })
  return normalizeRows(rows)
}

function pickValue(row: NormalizedRecord, aliases: string[]): unknown {
  for (const alias of aliases) {
    const key = normalizeHeader(alias)
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
  }
  return null
}

function pickString(row: NormalizedRecord, aliases: string[]): string | null {
  const value = pickValue(row, aliases)
  if (value == null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

function pickNumber(row: NormalizedRecord, aliases: string[]): number | null {
  const value = pickValue(row, aliases)
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const stripped = String(value)
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .trim()
  const parsed = Number.parseFloat(stripped)
  return Number.isFinite(parsed) ? parsed : null
}

function monthNumber(value: string): number | null {
  const cleaned = value.trim().toLowerCase()
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ]
  const index = months.findIndex((month) => month.startsWith(cleaned) || cleaned.startsWith(month.slice(0, 3)))
  return index >= 0 ? index + 1 : null
}

function toIsoTimePeriod(row: NormalizedRecord): string | null {
  const rawDate = pickString(row, ['time_period', 'period', 'date', 'report_date', 'month_end', 'month'])
  if (rawDate) {
    const compactMonth = rawDate.match(/^(\d{4})[-/](\d{1,2})$/)
    if (compactMonth) {
      return `${compactMonth[1]}-${compactMonth[2].padStart(2, '0')}-01`
    }
    const parsed = new Date(rawDate)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }

  const year = pickString(row, ['year', 'report_year', 'vintage_year'])
  if (!year) return null
  const month = pickString(row, ['month_name', 'month_label', 'month'])
  const monthIdx = month ? monthNumber(month) : null
  return `${year}-${String(monthIdx ?? 1).padStart(2, '0')}-01`
}

function resolveArea(row: NormalizedRecord, defaultState = 'TX') {
  const state = (pickString(row, ['state', 'state_abbr', 'state_code']) ?? defaultState).toUpperCase()
  const geographyLevel = pickString(row, ['geography_level', 'geography_type', 'level'])
  const countyName = pickString(row, ['county_name', 'county', 'county_or_parish'])
  const metroName = pickString(row, ['metro_name', 'metro', 'msa_name', 'msa', 'cbsa_name', 'cbsa_title'])

  if (countyName && (!metroName || /county/i.test(geographyLevel ?? ''))) {
    const display = normalizeCountyDisplayName(countyName)
    return {
      kind: 'county' as const,
      label: display,
      submarket_id: buildCountyAreaKey(display, state),
    }
  }

  if (metroName) {
    const display = normalizeMetroDisplayName(metroName)
    return {
      kind: 'metro' as const,
      label: display,
      submarket_id: buildMetroAreaKey(display, state),
    }
  }

  return null
}

function buildRowsFromMetricAliases(args: {
  row: NormalizedRecord
  dataSource: string
  metricAliases: Record<string, string[]>
  timePeriod: string | null
  defaultState?: string
}): InsertableMasterRow[] {
  const area = resolveArea(args.row, args.defaultState)
  if (!area || !args.timePeriod) return []

  const rows: InsertableMasterRow[] = []
  for (const [metricName, aliases] of Object.entries(args.metricAliases)) {
    const metricValue = pickNumber(args.row, aliases)
    if (metricValue == null) continue
    rows.push({
      submarket_id: area.submarket_id,
      geometry: null,
      metric_name: metricName,
      metric_value: metricValue,
      time_period: args.timePeriod,
      data_source: args.dataSource,
      visual_bucket: 'TIME_SERIES' as VisualBucket,
    })
  }
  return rows
}

export function buildTexasHousingActivityRows(rows: NormalizedRecord[]): InsertableMasterRow[] {
  const metricAliases: Record<string, string[]> = {
    Housing_Activity_Closed_Sales: ['closed_sales', 'sales', 'total_sales', 'sales_count'],
    Housing_Activity_Active_Listings: ['active_listings', 'listings', 'inventory', 'active_inventory'],
    Housing_Activity_Median_Sales_Price: ['median_sales_price', 'median_price', 'median_sales_value'],
    Housing_Activity_Days_On_Market: ['days_on_market', 'average_days_on_market'],
    Housing_Activity_Months_Inventory: ['months_inventory', 'months_of_inventory'],
    Housing_Activity_Sales_to_List_Pct: ['close_to_list_price_ratio', 'sales_to_list_price_ratio', 'sale_to_list_ratio'],
  }

  return rows.flatMap((row) =>
    buildRowsFromMetricAliases({
      row,
      dataSource: 'TREC Housing Activity',
      metricAliases,
      timePeriod: toIsoTimePeriod(row),
      defaultState: 'TX',
    })
  )
}

export function buildTexasBuildingPermitRows(rows: NormalizedRecord[]): InsertableMasterRow[] {
  const metricAliases: Record<string, string[]> = {
    Permit_Units: ['permit_units', 'housing_units', 'units', 'total_units'],
    Permit_Buildings: ['permit_buildings', 'buildings', 'total_buildings'],
    Permit_Value_USD: ['permit_value', 'construction_value', 'value', 'total_value'],
    Permit_Single_Family_Units: ['single_family_units', 'sf_units'],
    Permit_Multi_Family_Units: ['multifamily_units', 'multi_family_units', 'mf_units'],
  }

  return rows.flatMap((row) =>
    buildRowsFromMetricAliases({
      row,
      dataSource: 'TREC Building Permits',
      metricAliases,
      timePeriod: toIsoTimePeriod(row),
      defaultState: 'TX',
    })
  )
}

export function buildTexasDemographicRows(rows: NormalizedRecord[], kind: Extract<DatasetKind, 'demographics-estimates' | 'demographics-projections'>): InsertableMasterRow[] {
  const metricAliases: Record<string, string[]> =
    kind === 'demographics-projections'
      ? {
          Projected_Total_Population: ['projected_population', 'population_projection', 'population', 'total_population'],
        }
      : {
          Total_Population: ['population_estimate', 'total_population', 'population'],
        }

  const dataSource =
    kind === 'demographics-projections'
      ? 'Texas Demographic Center Projections'
      : 'Texas Demographic Center Estimates'

  return rows.flatMap((row) =>
    buildRowsFromMetricAliases({
      row,
      dataSource,
      metricAliases,
      timePeriod: toIsoTimePeriod(row),
      defaultState: 'TX',
    })
  )
}

export async function upsertTexasMasterData(rows: InsertableMasterRow[]) {
  if (rows.length === 0) {
    console.log('No normalized rows were produced; nothing to upsert.')
    return
  }

  const supabase = createSupabaseAdminLikeClient()
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE)
    const { error } = await supabase.from('projectr_master_data').upsert(batch as never[], {
      onConflict: 'submarket_id,metric_name,time_period,data_source',
      ignoreDuplicates: false,
    })
    if (error) {
      throw new Error(error.message)
    }
  }
}

export function parseCliFlags(argv: string[]) {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const [key, inlineValue] = token.split('=', 2)
    if (inlineValue != null) {
      flags.set(key, inlineValue)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, 'true')
    }
  }
  return flags
}

export function requireFileFlag(flags: Map<string, string>): string {
  const file = flags.get('--file')
  if (!file) {
    throw new Error('Missing required --file argument')
  }
  return file
}
