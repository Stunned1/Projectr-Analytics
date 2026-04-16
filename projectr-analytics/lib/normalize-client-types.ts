/** Shared client shape for `POST /api/normalize` success body. */

import type { ImportGeminiTriage } from '@/lib/upload/import-decision-model'
import type { UploadFileMetadata, UploadRawRow } from '@/lib/upload/types'

export type ClientCsvTriage = ImportGeminiTriage

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
  parse_summary?: {
    file: UploadFileMetadata
    headers: string[]
    sample_rows: UploadRawRow[]
  }
  marker_points?: ClientNormalizeMarkerPoint[]
  map_eligible?: boolean
}

/** After Client CSV normalize (one or more files in one drop). */
export interface NormalizerIngestPayload {
  results: ClientNormalizeApiResult[]
  mergedMarkerPoints: ClientNormalizeMarkerPoint[]
}
