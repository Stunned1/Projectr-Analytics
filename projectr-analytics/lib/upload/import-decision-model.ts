import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import type { VisualBucket } from '@/lib/supabase'
import {
  isValidLatLng,
  normalizeHeaderKey,
  parseCoordinate,
} from './lat-lng-detect'
import type {
  UploadFileMetadata,
  UploadLocationHints,
  UploadRawRow,
} from './types'

export const IMPORT_MAPABILITY_CLASSIFICATIONS = [
  'map_ready',
  'map_normalizable',
  'non_map_visualizable',
  'unusable',
] as const

export type ImportMapabilityClassification =
  (typeof IMPORT_MAPABILITY_CLASSIFICATIONS)[number]

export const IMPORT_ROW_TYPE_RECOMMENDATIONS = [
  'point_based',
  'geography_based',
  'non_spatial_tabular',
  'ambiguous',
] as const

export type ImportRowTypeRecommendation =
  (typeof IMPORT_ROW_TYPE_RECOMMENDATIONS)[number]

export const IMPORT_FALLBACK_VISUALIZATIONS = [
  'map_layer',
  'raw_table',
  'time_series_chart',
  'bar_chart',
  'summary_cards',
  'table_then_chart',
  'none',
] as const

export type ImportFallbackVisualization =
  (typeof IMPORT_FALLBACK_VISUALIZATIONS)[number]

export const IMPORT_FIELD_MAPPING_KEYS = [
  'site_name',
  'address',
  'city',
  'state',
  'zip',
  'latitude',
  'longitude',
  'rent',
  'units',
  'noi',
  'price',
  'cap_rate',
  'status',
  'date',
  'category',
  'value',
] as const

export type ImportFieldMappingKey = (typeof IMPORT_FIELD_MAPPING_KEYS)[number]

export type ImportFieldMappings = Record<ImportFieldMappingKey, string | null>

export interface ImportDetectedSchema {
  location_columns: string[]
  numeric_columns: string[]
  temporal_columns: string[]
  categorical_columns: string[]
  identifier_columns: string[]
}

export interface ImportGeminiInterpretation {
  inferred_dataset_type: string
  detected_schema: ImportDetectedSchema
  recommended_field_mappings: ImportFieldMappings
  row_type_recommendation: ImportRowTypeRecommendation
  mapability_classification: ImportMapabilityClassification
  confidence: number
  fallback_visualization: ImportFallbackVisualization
  warnings: string[]
  explanation: string
}

export interface ImportGeminiTriage extends ImportGeminiInterpretation {
  bucket: 'GEOSPATIAL' | 'TEMPORAL' | 'TABULAR' | 'UNUSABLE' | string
  visual_bucket: VisualBucket
  metric_name: string
  geo_column: string | null
  value_column: string | null
  date_column: string | null
  reasoning: string
}

export interface ImportInterpretationContext {
  headers: string[]
  sampleRows: UploadRawRow[]
  file?: UploadFileMetadata
  hints?: UploadLocationHints
  fallbackWarning?: string | null
}

const LEGACY_VISUAL_BUCKETS: VisualBucket[] = [
  'HEATMAP',
  'MARKER',
  'POLYGON',
  'TIME_SERIES',
  'TABULAR',
]

const FIELD_MAPPING_PATTERNS: Record<ImportFieldMappingKey, RegExp[]> = {
  site_name: [/\b(site|property|asset|building|project|name)\b/],
  address: [/\b(address|street|addr|location|property_address|site_address)\b/],
  city: [/\b(city|town|municipality|place)\b/],
  state: [/^state$/, /^st$/, /\bstate_code\b/],
  zip: [/\b(zip|zip_code|zipcode|postal|postal_code|zcta)\b/],
  latitude: [/^lat$/, /^latitude$/, /^coord_lat$/, /^y$/],
  longitude: [/^lng$/, /^lon$/, /^long$/, /^longitude$/, /^coord_lng$/, /^coord_long$/, /^x$/],
  rent: [/\b(rent|asking_rent|effective_rent|lease_rate|zori)\b/],
  units: [/\b(unit|units|unit_count|doors)\b/],
  noi: [/\bnoi\b/, /\bnet_operating_income\b/],
  price: [/\b(price|sale_price|purchase_price|cost|valuation|value_usd)\b/],
  cap_rate: [/\b(cap_rate|caprate|yield)\b/],
  status: [/\b(status|stage|phase)\b/],
  date: [/\b(date|month|quarter|year|period|as_of)\b/],
  category: [/\b(category|segment|type|class|bucket|group|market)\b/],
  value: [/\b(value|amount|metric|score|count|total|rate|index)\b/],
}

const STREET_TOKENS = [
  'street',
  'st',
  'avenue',
  'ave',
  'road',
  'rd',
  'drive',
  'dr',
  'lane',
  'ln',
  'boulevard',
  'blvd',
  'way',
  'court',
  'ct',
  'highway',
  'hwy',
  'parkway',
  'pkwy',
  'suite',
  'ste',
]

const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
])

const GENERIC_IMPORT_EXPLANATION = 'Imported dataset interpretation.'
const GENERIC_IMPORT_REASONING = 'Dataset structure is still ambiguous after import analysis.'

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim()

  const start = text.indexOf('{')
  if (start < 0) return text

  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return text.slice(start)
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeToken(value: string): string {
  return normalizeHeaderKey(value)
}

function matchesHeaderPatterns(header: string, patterns: RegExp[]): boolean {
  const normalized = normalizeToken(header)
  const spaced = normalized.replace(/_/g, ' ')
  return patterns.some((pattern) => pattern.test(normalized) || pattern.test(spaced))
}

function normalizeHeaderCandidate(
  value: unknown,
  headers?: string[]
): string | null {
  const normalized = normalizeString(value)
  if (!normalized || !headers?.length) return normalized

  const want = normalized.toLowerCase()
  const exact = headers.find((header) => header.trim().toLowerCase() === want)
  if (exact) return exact

  return headers.find((header) => header.trim().toLowerCase().includes(want)) ?? normalized
}

function normalizeHeaderList(value: unknown, headers?: string[]): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const header = normalizeHeaderCandidate(item, headers)
    if (!header) continue
    if (seen.has(header)) continue
    seen.add(header)
    out.push(header)
  }
  return out
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[$,%]/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function sampleValuesForHeader(rows: UploadRawRow[], header: string | null): string[] {
  if (!header) return []
  return rows
    .map((row) => {
      const value = row[header]
      if (value === null || value === undefined) return null
      const normalized = String(value).trim()
      return normalized.length > 0 ? normalized : null
    })
    .filter((value): value is string => Boolean(value))
}

function countMatches(values: string[], predicate: (value: string) => boolean): number {
  return values.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0)
}

function ratioMatches(values: string[], predicate: (value: string) => boolean): number {
  if (values.length === 0) return 0
  return countMatches(values, predicate) / values.length
}

function isLikelyZipValue(value: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(value.trim())
}

function isLikelyStateValue(value: string): boolean {
  const trimmed = value.trim().toUpperCase()
  if (STATE_CODES.has(trimmed)) return true
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(value.trim()) && value.trim().length >= 4
}

function isLikelyTemporalValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed)
    return year >= 1900 && year <= 2100
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return false
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(trimmed)) return true
  if (/^q[1-4]\s+\d{4}$/i.test(trimmed) || /^\d{4}\s*q[1-4]$/i.test(trimmed)) return true
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s/-]+\d{2,4}$/i.test(trimmed)) {
    return true
  }
  return !Number.isNaN(Date.parse(trimmed))
}

function isLikelyAddressValue(value: string): boolean {
  const lower = value.trim().toLowerCase()
  if (!lower) return false
  const hasStreetNumber = /\d/.test(lower)
  const hasStreetToken = STREET_TOKENS.some((token) => lower.includes(token))
  return hasStreetNumber && hasStreetToken
}

function isLikelyNumericColumn(header: string, rows: UploadRawRow[]): boolean {
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  return ratioMatches(values, (value) => parseNumberish(value) !== null) >= 0.7
}

function isLikelyTemporalColumn(header: string, rows: UploadRawRow[]): boolean {
  if (matchesHeaderPatterns(header, FIELD_MAPPING_PATTERNS.date)) return true
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  return ratioMatches(values, isLikelyTemporalValue) >= 0.6
}

function isLikelyZipColumn(header: string, rows: UploadRawRow[]): boolean {
  if (matchesHeaderPatterns(header, FIELD_MAPPING_PATTERNS.zip)) return true
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  return ratioMatches(values, isLikelyZipValue) >= 0.7
}

function isLikelyAddressColumn(header: string, rows: UploadRawRow[]): boolean {
  if (matchesHeaderPatterns(header, FIELD_MAPPING_PATTERNS.address)) return true
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  return ratioMatches(values, isLikelyAddressValue) >= 0.4
}

function isLikelyStateColumn(header: string, rows: UploadRawRow[]): boolean {
  if (matchesHeaderPatterns(header, FIELD_MAPPING_PATTERNS.state)) return true
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  return ratioMatches(values, isLikelyStateValue) >= 0.6
}

function isLikelyCategoryColumn(header: string, rows: UploadRawRow[]): boolean {
  if (matchesHeaderPatterns(header, FIELD_MAPPING_PATTERNS.category)) return true
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  if (ratioMatches(values, (value) => parseNumberish(value) !== null || isLikelyTemporalValue(value)) >= 0.4) {
    return false
  }
  return true
}

function isLikelyIdentifierColumn(header: string, rows: UploadRawRow[]): boolean {
  if (matchesHeaderPatterns(header, [/\b(id|site|property|asset|name|record|project)\b/])) {
    return true
  }
  const values = sampleValuesForHeader(rows, header)
  if (values.length === 0) return false
  const unique = new Set(values)
  return unique.size >= Math.max(2, Math.ceil(values.length * 0.75))
}

function findHeaderByPattern(
  headers: string[],
  rows: UploadRawRow[],
  patterns: RegExp[],
  predicate?: (header: string, rows: UploadRawRow[]) => boolean
): string | null {
  for (const header of headers) {
    if (!matchesHeaderPatterns(header, patterns)) continue
    if (predicate && !predicate(header, rows)) continue
    return header
  }
  return null
}

function inferFieldCandidate(
  key: ImportFieldMappingKey,
  headers: string[],
  rows: UploadRawRow[],
  hints?: UploadLocationHints
): string | null {
  if (key === 'latitude') return hints?.latColumn ?? findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.latitude)
  if (key === 'longitude') return hints?.lngColumn ?? findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.longitude)
  if (key === 'zip') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.zip, isLikelyZipColumn)
  if (key === 'address') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.address, isLikelyAddressColumn)
  if (key === 'state') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.state, isLikelyStateColumn)
  if (key === 'date') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.date, isLikelyTemporalColumn)
  if (key === 'value') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.value, isLikelyNumericColumn)
  if (key === 'category') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.category, isLikelyCategoryColumn)
  if (key === 'site_name') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.site_name)
  if (key === 'city') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.city)
  if (key === 'rent') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.rent, isLikelyNumericColumn)
  if (key === 'units') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.units, isLikelyNumericColumn)
  if (key === 'noi') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.noi, isLikelyNumericColumn)
  if (key === 'price') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.price, isLikelyNumericColumn)
  if (key === 'cap_rate') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.cap_rate, isLikelyNumericColumn)
  if (key === 'status') return findHeaderByPattern(headers, rows, FIELD_MAPPING_PATTERNS.status)
  return null
}

export function createEmptyImportFieldMappings(): ImportFieldMappings {
  return {
    site_name: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    latitude: null,
    longitude: null,
    rent: null,
    units: null,
    noi: null,
    price: null,
    cap_rate: null,
    status: null,
    date: null,
    category: null,
    value: null,
  }
}

function normalizeFieldMappings(
  value: unknown,
  headers?: string[]
): ImportFieldMappings {
  const out = createEmptyImportFieldMappings()
  if (!value || typeof value !== 'object') return out

  const record = value as Record<string, unknown>
  for (const key of IMPORT_FIELD_MAPPING_KEYS) {
    out[key] = normalizeHeaderCandidate(record[key], headers)
  }
  return out
}

function createEmptyDetectedSchema(): ImportDetectedSchema {
  return {
    location_columns: [],
    numeric_columns: [],
    temporal_columns: [],
    categorical_columns: [],
    identifier_columns: [],
  }
}

function mergeHeaderLists(...lists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    if (!list?.length) continue
    for (const value of list) {
      if (!value || seen.has(value)) continue
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

function normalizeDetectedSchema(
  value: unknown,
  headers?: string[]
): ImportDetectedSchema {
  const out = createEmptyDetectedSchema()
  if (!value || typeof value !== 'object') return out

  const record = value as Record<string, unknown>
  out.location_columns = normalizeHeaderList(record.location_columns, headers)
  out.numeric_columns = normalizeHeaderList(record.numeric_columns, headers)
  out.temporal_columns = normalizeHeaderList(record.temporal_columns, headers)
  out.categorical_columns = normalizeHeaderList(record.categorical_columns, headers)
  out.identifier_columns = normalizeHeaderList(record.identifier_columns, headers)
  return out
}

function buildDeterministicDetectedSchema(
  headers: string[],
  rows: UploadRawRow[],
  mappings: ImportFieldMappings
): ImportDetectedSchema {
  const numericColumns = headers.filter((header) => isLikelyNumericColumn(header, rows))
  const temporalColumns = headers.filter((header) => isLikelyTemporalColumn(header, rows))
  const locationColumns = uniqueStrings([
    mappings.address,
    mappings.city,
    mappings.state,
    mappings.zip,
    mappings.latitude,
    mappings.longitude,
  ])
  const categoricalColumns = headers.filter((header) => {
    if (numericColumns.includes(header) || temporalColumns.includes(header) || locationColumns.includes(header)) {
      return false
    }
    return isLikelyCategoryColumn(header, rows)
  })
  const identifierColumns = uniqueStrings([
    mappings.site_name,
    ...headers.filter((header) => {
      if (numericColumns.includes(header) || temporalColumns.includes(header) || locationColumns.includes(header)) {
        return false
      }
      return isLikelyIdentifierColumn(header, rows)
    }),
  ])

  return {
    location_columns: locationColumns,
    numeric_columns: numericColumns,
    temporal_columns: temporalColumns,
    categorical_columns: categoricalColumns,
    identifier_columns: identifierColumns,
  }
}

function mergeFieldMappings(
  base: ImportFieldMappings,
  deterministic: ImportFieldMappings,
  detectedSchema: ImportDetectedSchema
): ImportFieldMappings {
  const merged = createEmptyImportFieldMappings()
  for (const key of IMPORT_FIELD_MAPPING_KEYS) {
    merged[key] = base[key] ?? deterministic[key] ?? null
  }

  if (!merged.value) {
    merged.value =
      merged.rent ??
      merged.price ??
      merged.noi ??
      merged.cap_rate ??
      merged.units ??
      detectedSchema.numeric_columns[0] ??
      null
  }

  if (!merged.category) {
    merged.category = detectedSchema.categorical_columns[0] ?? null
  }

  if (!merged.site_name) {
    merged.site_name = detectedSchema.identifier_columns[0] ?? null
  }

  if (!merged.date) {
    merged.date = detectedSchema.temporal_columns[0] ?? null
  }

  if (merged.value && !detectedSchema.numeric_columns.includes(merged.value)) {
    merged.value = detectedSchema.numeric_columns[0] ?? merged.value
  }

  if (merged.date && !detectedSchema.temporal_columns.includes(merged.date)) {
    merged.date = detectedSchema.temporal_columns[0] ?? null
  }

  return merged
}

function buildDeterministicFieldMappings(
  headers: string[],
  rows: UploadRawRow[],
  hints?: UploadLocationHints
): ImportFieldMappings {
  const out = createEmptyImportFieldMappings()
  for (const key of IMPORT_FIELD_MAPPING_KEYS) {
    out[key] = inferFieldCandidate(key, headers, rows, hints)
  }
  return out
}

type ImportLocationSignals = {
  hasCoordinates: boolean
  hasZipGeography: boolean
  hasAddressBundle: boolean
  hasGeographyText: boolean
  hasNumericValues: boolean
  hasTemporalValues: boolean
  hasCategoricalValues: boolean
}

function computeLocationSignals(
  mappings: ImportFieldMappings,
  schema: ImportDetectedSchema,
  rows: UploadRawRow[]
): ImportLocationSignals {
  const latValues = sampleValuesForHeader(rows, mappings.latitude)
  const lngValues = sampleValuesForHeader(rows, mappings.longitude)
  const coordinateCount = Math.min(latValues.length, lngValues.length)
  let validCoordinatePairs = 0
  for (let i = 0; i < coordinateCount; i += 1) {
    const lat = parseCoordinate(latValues[i])
    const lng = parseCoordinate(lngValues[i])
    if (lat == null || lng == null) continue
    if (isValidLatLng(lat, lng)) validCoordinatePairs += 1
  }

  const zipValues = sampleValuesForHeader(rows, mappings.zip)
  const addressValues = sampleValuesForHeader(rows, mappings.address)
  const cityValues = sampleValuesForHeader(rows, mappings.city)
  const stateValues = sampleValuesForHeader(rows, mappings.state)
  const geographyTextValues = schema.location_columns
    .filter((header) => ![mappings.latitude, mappings.longitude, mappings.zip, mappings.address].includes(header))
    .flatMap((header) => sampleValuesForHeader(rows, header))

  return {
    hasCoordinates: validCoordinatePairs > 0,
    hasZipGeography: ratioMatches(zipValues, isLikelyZipValue) >= 0.5,
    hasAddressBundle:
      addressValues.some((value) => isLikelyAddressValue(value)) ||
      (cityValues.length > 0 && stateValues.length > 0) ||
      (cityValues.length > 0 && zipValues.length > 0),
    hasGeographyText: geographyTextValues.some((value) => /[a-z]/i.test(value)),
    hasNumericValues: schema.numeric_columns.length > 0,
    hasTemporalValues: schema.temporal_columns.length > 0,
    hasCategoricalValues: schema.categorical_columns.length > 0,
  }
}

function deriveRowType(
  raw: unknown,
  bucket: string | null,
  signals?: ImportLocationSignals
): ImportRowTypeRecommendation {
  if (signals) {
    if (signals.hasCoordinates || signals.hasAddressBundle) return 'point_based'
    if (signals.hasZipGeography || signals.hasGeographyText) return 'geography_based'
    if (signals.hasNumericValues || signals.hasTemporalValues || signals.hasCategoricalValues) {
      return 'non_spatial_tabular'
    }
  }

  if (
    typeof raw === 'string' &&
    (IMPORT_ROW_TYPE_RECOMMENDATIONS as readonly string[]).includes(raw)
  ) {
    return raw as ImportRowTypeRecommendation
  }

  if (bucket === 'GEOSPATIAL') return 'geography_based'
  if (bucket === 'TEMPORAL' || bucket === 'TABULAR') return 'non_spatial_tabular'
  return 'ambiguous'
}

function deriveMapability(
  raw: unknown,
  bucket: string | null,
  rowType: ImportRowTypeRecommendation,
  mappings: ImportFieldMappings,
  signals?: ImportLocationSignals
): ImportMapabilityClassification {
  if (signals) {
    if (signals.hasCoordinates || signals.hasZipGeography) return 'map_ready'
    if (signals.hasAddressBundle || signals.hasGeographyText) return 'map_normalizable'
    if (signals.hasNumericValues || signals.hasTemporalValues || signals.hasCategoricalValues) {
      return 'non_map_visualizable'
    }
  }

  if (
    typeof raw === 'string' &&
    (IMPORT_MAPABILITY_CLASSIFICATIONS as readonly string[]).includes(raw)
  ) {
    return raw as ImportMapabilityClassification
  }

  if (bucket === 'GEOSPATIAL') {
    if (mappings.latitude && mappings.longitude) return 'map_ready'
    return 'map_normalizable'
  }
  if (bucket === 'TEMPORAL' || bucket === 'TABULAR') return 'non_map_visualizable'
  if (rowType === 'point_based' || rowType === 'geography_based') return 'map_normalizable'
  return 'unusable'
}

function deriveFallbackVisualization(
  raw: unknown,
  bucket: string | null,
  rowType: ImportRowTypeRecommendation,
  mapability: ImportMapabilityClassification,
  signals?: ImportLocationSignals
): ImportFallbackVisualization {
  if (mapability === 'map_ready') return 'map_layer'
  if (mapability === 'map_normalizable') return 'table_then_chart'
  if (signals?.hasTemporalValues && signals?.hasNumericValues) return 'time_series_chart'
  if (signals?.hasCategoricalValues && signals?.hasNumericValues) return 'bar_chart'
  if (signals?.hasNumericValues) return 'summary_cards'

  if (
    typeof raw === 'string' &&
    (IMPORT_FALLBACK_VISUALIZATIONS as readonly string[]).includes(raw)
  ) {
    return raw as ImportFallbackVisualization
  }

  if (bucket === 'TEMPORAL') return 'time_series_chart'
  if (rowType === 'non_spatial_tabular') return 'raw_table'
  if (mapability === 'non_map_visualizable') return 'raw_table'
  return 'none'
}

function deriveLegacyBucket(
  raw: unknown,
  mapability: ImportMapabilityClassification,
  fallbackVisualization: ImportFallbackVisualization
): ImportGeminiTriage['bucket'] {
  if (mapability === 'map_ready' || mapability === 'map_normalizable') return 'GEOSPATIAL'
  if (fallbackVisualization === 'time_series_chart') return 'TEMPORAL'
  if (mapability === 'non_map_visualizable') return 'TABULAR'
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return 'UNUSABLE'
}

function deriveLegacyVisualBucket(
  raw: unknown,
  mapability: ImportMapabilityClassification,
  fallbackVisualization: ImportFallbackVisualization,
  mappings: ImportFieldMappings
): VisualBucket {
  if (mapability === 'map_ready') {
    if (mappings.latitude && mappings.longitude) return 'MARKER'
    return 'HEATMAP'
  }
  if (mapability === 'map_normalizable') return 'MARKER'
  if (fallbackVisualization === 'time_series_chart') return 'TIME_SERIES'
  if (
    typeof raw === 'string' &&
    (LEGACY_VISUAL_BUCKETS as readonly string[]).includes(raw)
  ) {
    return raw as VisualBucket
  }
  return 'TABULAR'
}

function pickGeoColumn(mappings: ImportFieldMappings): string | null {
  return (
    mappings.address ??
    mappings.zip ??
    mappings.city ??
    mappings.state ??
    null
  )
}

function pickValueColumn(
  mappings: ImportFieldMappings,
  detectedSchema?: ImportDetectedSchema
): string | null {
  return (
    mappings.value ??
    mappings.rent ??
    mappings.price ??
    mappings.noi ??
    mappings.cap_rate ??
    mappings.units ??
    detectedSchema?.numeric_columns[0] ??
    null
  )
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item))
}

function synthesizeExplanation(
  mapability: ImportMapabilityClassification,
  fallbackVisualization: ImportFallbackVisualization,
  signals: ImportLocationSignals,
  inferredDatasetType: string
): string {
  if (mapability === 'map_ready') {
    if (signals.hasCoordinates) {
      return `${inferredDatasetType} includes usable coordinates, so Projectr can render it on the map immediately.`
    }
    return `${inferredDatasetType} includes resolvable geography fields, so Projectr can place it on the map now.`
  }
  if (mapability === 'map_normalizable') {
    return `${inferredDatasetType} has location clues, but it still needs geography normalization before Projectr can render it confidently on the map.`
  }
  if (mapability === 'non_map_visualizable') {
    if (fallbackVisualization === 'time_series_chart') {
      return `${inferredDatasetType} reads like a time series, so it is better suited to chart and table views than a map layer.`
    }
    if (fallbackVisualization === 'bar_chart') {
      return `${inferredDatasetType} is structured as category/value data, so it is better suited to chart and table views than a map layer.`
    }
    return `${inferredDatasetType} is useful tabular data, but it does not expose reliable spatial fields for a map view.`
  }
  return `${inferredDatasetType} is too sparse or ambiguous to classify confidently.`
}

function synthesizeReasoning(
  mapability: ImportMapabilityClassification,
  fallbackVisualization: ImportFallbackVisualization,
  mappings: ImportFieldMappings
): string {
  if (mapability === 'map_ready' && mappings.latitude && mappings.longitude) {
    return 'Detected explicit latitude and longitude columns.'
  }
  if (mapability === 'map_ready' && mappings.zip) {
    return 'Detected ZIP-level geography that can resolve directly to map points.'
  }
  if (mapability === 'map_normalizable' && mappings.address) {
    return 'Detected address-style location fields that need geocoding before map rendering.'
  }
  if (fallbackVisualization === 'time_series_chart') {
    return 'Detected a temporal dataset with numeric measures.'
  }
  if (fallbackVisualization === 'bar_chart') {
    return 'Detected category/value data that fits a chart better than a map.'
  }
  if (mapability === 'non_map_visualizable') {
    return 'Detected tabular analyst data without reliable map placement fields.'
  }
  return 'Dataset structure is still ambiguous after import analysis.'
}

function mergeWarnings(
  baseWarnings: string[],
  mapability: ImportMapabilityClassification,
  signals: ImportLocationSignals,
  mappings: ImportFieldMappings,
  fallbackWarning?: string | null
): string[] {
  const warnings = [...baseWarnings]
  if (mapability === 'map_normalizable') {
    warnings.push('This dataset needs geography normalization before it can render on the map.')
  }
  if (!mappings.value && signals.hasNumericValues) {
    warnings.push('No primary value column was chosen confidently; preview rows may use the first numeric column.')
  }
  if (mapability === 'non_map_visualizable') {
    warnings.push('This dataset is being treated as sidebar or chart data rather than a map layer.')
  }
  if (fallbackWarning) warnings.push(fallbackWarning)
  return uniqueStrings(warnings)
}

function deriveConfidenceScore(
  base: number,
  mapability: ImportMapabilityClassification,
  signals: ImportLocationSignals
): number {
  let confidence = base > 0 ? base : 0.45

  if (signals.hasCoordinates) confidence = Math.max(confidence, 0.92)
  else if (signals.hasZipGeography) confidence = Math.max(confidence, 0.84)
  else if (signals.hasAddressBundle) confidence = Math.max(confidence, 0.74)
  else if (signals.hasTemporalValues && signals.hasNumericValues) confidence = Math.max(confidence, 0.78)
  else if (signals.hasNumericValues || signals.hasCategoricalValues) confidence = Math.max(confidence, 0.64)

  if (mapability === 'unusable') confidence = Math.min(confidence, 0.35)
  return clampConfidence(confidence)
}

function createDefaultImportTriage(): ImportGeminiTriage {
  return {
    inferred_dataset_type: 'Imported dataset',
    detected_schema: createEmptyDetectedSchema(),
    recommended_field_mappings: createEmptyImportFieldMappings(),
    row_type_recommendation: 'ambiguous',
    mapability_classification: 'unusable',
    confidence: 0.45,
    fallback_visualization: 'none',
    warnings: [],
    explanation: GENERIC_IMPORT_EXPLANATION,
    bucket: 'UNUSABLE',
    visual_bucket: 'TABULAR',
    metric_name: 'Imported dataset',
    geo_column: null,
    value_column: null,
    date_column: null,
    reasoning: GENERIC_IMPORT_REASONING,
  }
}

export function parseImportGeminiTriage(
  raw: string,
  headers?: string[]
): ImportGeminiTriage | null {
  const attempts = [raw.trim(), extractJsonObject(raw)]
  const seen = new Set<string>()

  for (const attempt of attempts) {
    const candidate = attempt.trim()
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)

    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const mappings = normalizeFieldMappings(parsed.recommended_field_mappings, headers)
      const explanation =
        normalizeString(parsed.explanation) ??
        normalizeString(parsed.reasoning) ??
        GENERIC_IMPORT_EXPLANATION
      const bucketSeed = normalizeString(parsed.bucket)
      const rowType = deriveRowType(parsed.row_type_recommendation, bucketSeed)
      const mapability = deriveMapability(
        parsed.mapability_classification,
        bucketSeed,
        rowType,
        mappings
      )
      const fallbackVisualization = deriveFallbackVisualization(
        parsed.fallback_visualization,
        bucketSeed,
        rowType,
        mapability
      )
      const bucket = deriveLegacyBucket(parsed.bucket, mapability, fallbackVisualization)
      const visualBucket = deriveLegacyVisualBucket(
        parsed.visual_bucket,
        mapability,
        fallbackVisualization,
        mappings
      )
      const detectedSchema = normalizeDetectedSchema(parsed.detected_schema, headers)

      return {
        inferred_dataset_type:
          normalizeString(parsed.inferred_dataset_type) ?? 'Imported dataset',
        detected_schema: detectedSchema,
        recommended_field_mappings: mappings,
        row_type_recommendation: rowType,
        mapability_classification: mapability,
        confidence: clampConfidence(parsed.confidence),
        fallback_visualization: fallbackVisualization,
        warnings: normalizeWarnings(parsed.warnings),
        explanation,
        bucket,
        visual_bucket: visualBucket,
        metric_name:
          normalizeString(parsed.metric_name) ??
          normalizeString(parsed.inferred_dataset_type) ??
          'Imported metric',
        geo_column:
          normalizeHeaderCandidate(parsed.geo_column, headers) ?? pickGeoColumn(mappings),
        value_column:
          normalizeHeaderCandidate(parsed.value_column, headers) ?? pickValueColumn(mappings),
        date_column:
          normalizeHeaderCandidate(parsed.date_column, headers) ?? mappings.date ?? null,
        reasoning:
          normalizeString(parsed.reasoning) ??
          explanation,
      }
    } catch {
      // Try the next extraction strategy.
    }
  }

  return null
}

export function finalizeImportGeminiTriage(
  triage: ImportGeminiTriage | null,
  context: ImportInterpretationContext
): ImportGeminiTriage {
  const base = triage ?? createDefaultImportTriage()
  const deterministicMappings = buildDeterministicFieldMappings(
    context.headers,
    context.sampleRows,
    context.hints
  )
  const seedMappings = mergeFieldMappings(
    base.recommended_field_mappings,
    deterministicMappings,
    base.detected_schema
  )
  const deterministicSchema = buildDeterministicDetectedSchema(
    context.headers,
    context.sampleRows,
    seedMappings
  )
  const detectedSchema = {
    location_columns: mergeHeaderLists(
      base.detected_schema.location_columns,
      deterministicSchema.location_columns
    ),
    numeric_columns: mergeHeaderLists(
      base.detected_schema.numeric_columns,
      deterministicSchema.numeric_columns
    ),
    temporal_columns: mergeHeaderLists(
      base.detected_schema.temporal_columns,
      deterministicSchema.temporal_columns
    ),
    categorical_columns: mergeHeaderLists(
      base.detected_schema.categorical_columns,
      deterministicSchema.categorical_columns
    ),
    identifier_columns: mergeHeaderLists(
      base.detected_schema.identifier_columns,
      deterministicSchema.identifier_columns
    ),
  }
  const mappings = mergeFieldMappings(base.recommended_field_mappings, deterministicMappings, detectedSchema)
  const signals = computeLocationSignals(mappings, detectedSchema, context.sampleRows)
  const rowType = deriveRowType(base.row_type_recommendation, base.bucket, signals)
  const mapability = deriveMapability(
    base.mapability_classification,
    base.bucket,
    rowType,
    mappings,
    signals
  )
  const fallbackVisualization = deriveFallbackVisualization(
    base.fallback_visualization,
    base.bucket,
    rowType,
    mapability,
    signals
  )
  const bucket = deriveLegacyBucket(base.bucket, mapability, fallbackVisualization)
  const visualBucket = deriveLegacyVisualBucket(
    base.visual_bucket,
    mapability,
    fallbackVisualization,
    mappings
  )
  const explanation =
    (normalizeString(base.explanation) &&
    base.explanation !== GENERIC_IMPORT_EXPLANATION &&
    base.mapability_classification === mapability &&
    base.fallback_visualization === fallbackVisualization
      ? normalizeString(base.explanation)
      : null) ??
    synthesizeExplanation(
      mapability,
      fallbackVisualization,
      signals,
      base.inferred_dataset_type
    )
  const reasoning =
    (normalizeString(base.reasoning) &&
    base.reasoning !== GENERIC_IMPORT_REASONING &&
    base.mapability_classification === mapability &&
    base.fallback_visualization === fallbackVisualization
      ? normalizeString(base.reasoning)
      : null) ??
    synthesizeReasoning(mapability, fallbackVisualization, mappings)

  return {
    ...base,
    detected_schema: detectedSchema,
    recommended_field_mappings: mappings,
    row_type_recommendation: rowType,
    mapability_classification: mapability,
    confidence: deriveConfidenceScore(base.confidence, mapability, signals),
    fallback_visualization: fallbackVisualization,
    warnings: mergeWarnings(base.warnings, mapability, signals, mappings, context.fallbackWarning),
    explanation,
    bucket,
    visual_bucket: visualBucket,
    metric_name:
      normalizeString(base.metric_name) ??
      normalizeString(base.inferred_dataset_type) ??
      'Imported dataset',
    geo_column: normalizeHeaderCandidate(base.geo_column, context.headers) ?? pickGeoColumn(mappings),
    value_column:
      (normalizeHeaderCandidate(base.value_column, context.headers) &&
      detectedSchema.numeric_columns.includes(
        normalizeHeaderCandidate(base.value_column, context.headers) as string
      )
        ? normalizeHeaderCandidate(base.value_column, context.headers)
        : null) ??
      pickValueColumn(mappings, detectedSchema),
    date_column:
      (normalizeHeaderCandidate(base.date_column, context.headers) &&
      detectedSchema.temporal_columns.includes(
        normalizeHeaderCandidate(base.date_column, context.headers) as string
      )
        ? normalizeHeaderCandidate(base.date_column, context.headers)
        : null) ??
      mappings.date ??
      detectedSchema.temporal_columns[0] ??
      null,
    reasoning,
  }
}

export const IMPORT_TRIAGE_PROMPT = `You are interpreting uploaded analyst CSVs for Scout / Projectr.
Analyze the provided file metadata, canonical headers, and sampled rows and return ONLY valid JSON (no markdown).

Classify the dataset using both the current app's legacy render buckets and the new import decision model.

Decision model:
- map_ready: rows already have usable coordinates or clearly mappable point geographies now
- map_normalizable: rows need geographic normalization, column cleanup, or resolution before map rendering
- non_map_visualizable: rows cannot be reliably placed on a map, but are still useful in a table/chart/sidebar workflow
- unusable: the file is too malformed, sparse, or ambiguous to present confidently

Row type recommendation:
- point_based
- geography_based
- non_spatial_tabular
- ambiguous

Fallback visualization:
- map_layer
- raw_table
- time_series_chart
- bar_chart
- summary_cards
- table_then_chart
- none

Rules:
- Use exact header strings from the CSV whenever you name a column.
- Populate detected_schema arrays with exact header strings when present; otherwise return empty arrays.
- Populate recommended_field_mappings with exact header strings or null.
- explanation must be plain-language text we can show directly to a user.
- reasoning should be one short sentence for the current UI.
- Keep legacy compatibility fields aligned with the interpretation:
  - bucket: GEOSPATIAL | TEMPORAL | TABULAR | UNUSABLE
  - visual_bucket: HEATMAP | MARKER | POLYGON | TIME_SERIES | TABULAR
  - metric_name: best short label for what the file primarily represents
  - geo_column, value_column, date_column: exact header strings or null

Return this exact JSON shape:
{
  "inferred_dataset_type": "string",
  "detected_schema": {
    "location_columns": ["string"],
    "numeric_columns": ["string"],
    "temporal_columns": ["string"],
    "categorical_columns": ["string"],
    "identifier_columns": ["string"]
  },
  "recommended_field_mappings": {
    "site_name": "string|null",
    "address": "string|null",
    "city": "string|null",
    "state": "string|null",
    "zip": "string|null",
    "latitude": "string|null",
    "longitude": "string|null",
    "rent": "string|null",
    "units": "string|null",
    "noi": "string|null",
    "price": "string|null",
    "cap_rate": "string|null",
    "status": "string|null",
    "date": "string|null",
    "category": "string|null",
    "value": "string|null"
  },
  "row_type_recommendation": "point_based|geography_based|non_spatial_tabular|ambiguous",
  "mapability_classification": "map_ready|map_normalizable|non_map_visualizable|unusable",
  "confidence": 0.0,
  "fallback_visualization": "map_layer|raw_table|time_series_chart|bar_chart|summary_cards|table_then_chart|none",
  "warnings": ["string"],
  "explanation": "string",
  "bucket": "GEOSPATIAL|TEMPORAL|TABULAR|UNUSABLE",
  "visual_bucket": "HEATMAP|MARKER|POLYGON|TIME_SERIES|TABULAR",
  "metric_name": "string",
  "geo_column": "string|null",
  "value_column": "string|null",
  "date_column": "string|null",
  "reasoning": "string"
}

${GEMINI_NO_EM_DASH_RULE}`
