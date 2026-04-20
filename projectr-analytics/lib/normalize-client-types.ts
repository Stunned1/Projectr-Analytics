/** Shared client shape for `POST /api/normalize` success body. */

import type { ImportGeminiTriage } from '@/lib/upload/import-decision-model'
import type { UploadFileMetadata, UploadRawRow } from '@/lib/upload/types'

export type ClientCsvTriage = ImportGeminiTriage

export interface ClientNormalizeMarkerPoint {
  lat: number
  lng: number
  value: number | null
  label: string
  source_key?: string | null
  file_name?: string | null
  metric_name?: string | null
  submarket_id?: string | null
  time_period?: string | null
  row_preview?: UploadRawRow
}

export interface ClientNormalizePreviewRow {
  submarket_id: string | null
  metric_name: string
  metric_value: number | null
  time_period: string | null
  visual_bucket: string
}

export interface ClientNormalizeRawTable {
  headers: string[]
  rows: UploadRawRow[]
  total_rows: number
  truncated: boolean
}

export interface ClientNormalizeApiResult {
  triage: ClientCsvTriage
  review_fingerprint?: string | null
  rows_ingested: number
  preview_rows: ClientNormalizePreviewRow[]
  parse_summary?: {
    file: UploadFileMetadata
    headers: string[]
    sample_rows: UploadRawRow[]
  }
  raw_table?: ClientNormalizeRawTable
  marker_points?: ClientNormalizeMarkerPoint[]
  map_eligible?: boolean
  committed?: boolean
  persistence_warning?: string | null
}

/** After Client CSV normalize (one or more files in one drop). */
export interface NormalizerIngestPayload {
  results: ClientNormalizeApiResult[]
  mergedMarkerPoints: ClientNormalizeMarkerPoint[]
}
