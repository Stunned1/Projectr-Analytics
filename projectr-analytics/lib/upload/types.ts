export type UploadCellValue = string | number | boolean | null

export type UploadRawRow = Record<string, UploadCellValue>

export type UploadFileFormat = 'csv' | 'txt' | 'xlsx'

export interface UploadFileMetadata {
  fileName: string
  format: UploadFileFormat
  byteSize: number
  columnCount: number
  rowCount: number
  sampleRowCount: number
  emptyRowCount: number
}

export interface UploadParseSummary {
  file: UploadFileMetadata
  headers: string[]
  sampleRows: UploadRawRow[]
}

export type ProcessingStatus = 'pending' | 'ok' | 'failed'

export interface NormalizedLocation {
  address?: string
  zip?: string
  lat?: number
  lng?: number
}

export interface GeocodeState {
  status: ProcessingStatus
  lat?: number
  lng?: number
  formattedAddress?: string
  error?: string
}

/** Slim Zillow fields attached after upload context step (for tooltips / export). */
export interface UploadMarketSnippet {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  /** From `/api/market` metro velocity when available. */
  doz_pending_latest?: number | null
}

export interface ContextState {
  status: ProcessingStatus
  momentumScore?: number
  cyclePosition?: string
  market?: UploadMarketSnippet | null
  error?: string
}

export interface UploadedLocationRow {
  rowId: string
  raw: UploadRawRow
  detectedLocationText: string | null
  normalized: NormalizedLocation
  geocode: GeocodeState
  context: ContextState
}

export interface LocationColumnSuggestion {
  suggestedLocationColumn: string | null
  confidence: number
  reasoning?: string
}

export interface UploadGeocodeRequestRow {
  rowId: string
  /** Used when row is not resolved from lat/lng columns. */
  locationText: string | null
  /** If both present and valid, server uses coordinates and skips external geocoders. */
  lat?: number | null
  lng?: number | null
}

export interface UploadGeocodeResultRow {
  rowId: string
  status: ProcessingStatus
  lat?: number
  lng?: number
  formattedAddress?: string
  normalized?: NormalizedLocation
  error?: string
}

export interface UploadLocationHints {
  latColumn: string | null
  lngColumn: string | null
}

export interface UploadParseResult {
  columns: string[]
  rows: UploadRawRow[]
  hints: UploadLocationHints
  file: UploadFileMetadata
  sampleRows: UploadRawRow[]
}

export interface UploadWorkflowState {
  status: 'idle' | 'parsing' | 'detecting' | 'geocoding' | 'contextualizing' | 'done' | 'failed'
  rows: UploadedLocationRow[]
  columns: string[]
  locationSuggestion?: LocationColumnSuggestion
  error?: string
}
