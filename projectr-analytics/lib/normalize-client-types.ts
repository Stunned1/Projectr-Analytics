/** Shared client shape for `POST /api/normalize` success body. */

export interface ClientCsvTriage {
  bucket: 'GEOSPATIAL' | 'TEMPORAL' | 'TABULAR' | string
  visual_bucket: string
  metric_name: string
  geo_column: string | null
  value_column: string | null
  date_column: string | null
  reasoning: string
}

export interface ClientNormalizeMarkerPoint {
  lat: number
  lng: number
  value: number | null
  label: string
}

export interface ClientNormalizePreviewRow {
  submarket_id: string | null
  metric_name: string
  metric_value: number | null
  time_period: string | null
  visual_bucket: string
}

export interface ClientNormalizeApiResult {
  triage: ClientCsvTriage
  rows_ingested: number
  preview_rows: ClientNormalizePreviewRow[]
  marker_points?: ClientNormalizeMarkerPoint[]
  map_eligible?: boolean
}

/** After Client CSV normalize (one or more files in one drop). */
export interface NormalizerIngestPayload {
  results: ClientNormalizeApiResult[]
  mergedMarkerPoints: ClientNormalizeMarkerPoint[]
}
