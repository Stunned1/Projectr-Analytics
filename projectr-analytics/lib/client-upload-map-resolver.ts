import type {
  ClientUploadNormalizationState,
  ClientUploadSourcePart,
} from '@/lib/client-upload-session-store'
import type { ClientNormalizeMarkerPoint } from '@/lib/normalize-client-types'
import { buildUploadMarkerCandidateRows } from '@/lib/upload'

export interface ImportedResolvePreview {
  totalRows: number
  candidateRows: number
  directCoordinateRows: number
  requestRows: number
  uniqueRequestRows: number
}

interface GeocodeApiResponse {
  results?: Array<{
    rowId: string
    status: 'ok' | 'failed'
    lat?: number
    lng?: number
    normalized?: {
      zip?: string
      lat?: number
      lng?: number
    }
    error?: string
  }>
}

function dedupeMarkers(markers: ClientNormalizeMarkerPoint[]): ClientNormalizeMarkerPoint[] {
  const seen = new Set<string>()
  const out: ClientNormalizeMarkerPoint[] = []
  for (const marker of markers) {
    const key = `${marker.lat.toFixed(5)}|${marker.lng.toFixed(5)}|${marker.label}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(marker)
  }
  return out
}

function buildCandidates(source: ClientUploadSourcePart, currentZip?: string | null) {
  const headers = source.rawTable?.headers ?? []
  const rows = source.workingRows ?? (source.workingRowsKey ? [] : source.rawTable?.rows ?? [])
  if (headers.length === 0 || rows.length === 0) return []

  return buildUploadMarkerCandidateRows({
    rows,
    headers,
    triage: source.triage,
    currentZip: currentZip ?? null,
  })
}

export function buildImportedResolvePreview(
  source: ClientUploadSourcePart,
  currentZip?: string | null
): ImportedResolvePreview {
  const candidates = buildCandidates(source, currentZip)
  const candidateRows = candidates.filter((candidate) => candidate.submarket_id != null || candidate.lat != null).length
  const directCoordinateRows = candidates.filter((candidate) => candidate.lat != null && candidate.lng != null).length
  const requestKeys = new Set(
    candidates
      .filter((candidate) => candidate.submarket_id != null && (candidate.lat == null || candidate.lng == null))
      .map((candidate) => candidate.submarket_id!.trim().toLowerCase())
      .filter(Boolean)
  )

  return {
    totalRows: source.rowsIngested,
    candidateRows,
    directCoordinateRows,
    requestRows: Math.max(candidateRows - directCoordinateRows, 0),
    uniqueRequestRows: requestKeys.size,
  }
}

export async function resolveImportedSourceToMarkers(args: {
  source: ClientUploadSourcePart
  currentZip?: string | null
  fetchImpl?: typeof fetch
}): Promise<{
  markers: ClientNormalizeMarkerPoint[]
  normalization: ClientUploadNormalizationState
}> {
  const { source, currentZip = null, fetchImpl = fetch } = args
  const candidates = buildCandidates(source, currentZip)
  const attempted = candidates.filter((candidate) => candidate.submarket_id != null || candidate.lat != null)

  if (attempted.length === 0) {
    return {
      markers: [],
      normalization: {
        status: 'failed',
        attemptedCount: 0,
        resolvedCount: 0,
        failedCount: 0,
        lastRunAt: new Date().toISOString(),
        message: 'No rows exposed usable coordinates, ZIPs, or address fields for map normalization.',
      },
    }
  }

  const directMarkers: ClientNormalizeMarkerPoint[] = attempted
    .filter((candidate) => candidate.lat != null && candidate.lng != null)
    .map((candidate) => ({
      lat: candidate.lat!,
      lng: candidate.lng!,
      value: candidate.metric_value,
      label: candidate.label,
      file_name: source.fileName,
      metric_name: source.triage.metric_name,
      submarket_id: candidate.submarket_id,
      time_period: candidate.time_period,
      row_preview: candidate.row_preview,
    }))

  const geocodeCandidates = attempted.filter(
    (candidate) => (candidate.lat == null || candidate.lng == null) && candidate.submarket_id != null
  )

  const uniqueGeocodeRows = Array.from(
    geocodeCandidates.reduce((acc, candidate) => {
      const key = candidate.submarket_id!.trim().toLowerCase()
      if (!acc.has(key)) acc.set(key, candidate)
      return acc
    }, new Map<string, (typeof geocodeCandidates)[number]>()).values()
  )

  let geocodeResults = new Map<
    string,
    { lat: number; lng: number; zip?: string | null }
  >()
  let geocodeError: string | null = null

  if (uniqueGeocodeRows.length > 0) {
    const response = await fetchImpl('/api/upload/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rows: uniqueGeocodeRows.map((candidate) => ({
          rowId: candidate.submarket_id!.trim().toLowerCase(),
          locationText: candidate.submarket_id,
          lat: candidate.lat,
          lng: candidate.lng,
        })),
        maxConcurrency: 8,
      }),
    })

    const data = (await response.json()) as GeocodeApiResponse & { error?: string }
    if (!response.ok || data.error) {
      geocodeError = data.error ?? 'Geography normalization failed.'
    } else {
      geocodeResults = new Map(
        (data.results ?? [])
          .filter(
            (result): result is NonNullable<GeocodeApiResponse['results']>[number] & { lat: number; lng: number } =>
              result.status === 'ok' && typeof result.lat === 'number' && typeof result.lng === 'number'
          )
          .map((result) => [result.rowId, { lat: result.lat, lng: result.lng, zip: result.normalized?.zip ?? null }])
      )
    }
  }

  const geocodedMarkers: ClientNormalizeMarkerPoint[] = []
  for (const candidate of geocodeCandidates) {
    const key = candidate.submarket_id!.trim().toLowerCase()
    const resolved = geocodeResults.get(key)
    if (!resolved) continue
    geocodedMarkers.push({
      lat: resolved.lat,
      lng: resolved.lng,
      value: candidate.metric_value,
      label: candidate.label,
      file_name: source.fileName,
      metric_name: source.triage.metric_name,
      submarket_id: resolved.zip ?? candidate.submarket_id,
      time_period: candidate.time_period,
      row_preview: candidate.row_preview,
    })
  }

  const resolvedRows = directMarkers.length + geocodedMarkers.length
  const attemptedCount = attempted.length
  const failedCount = Math.max(attemptedCount - resolvedRows, 0)
  const markers = dedupeMarkers([...directMarkers, ...geocodedMarkers])

  return {
    markers,
    normalization: {
      status: resolvedRows > 0 ? 'resolved' : 'failed',
      attemptedCount,
      resolvedCount: resolvedRows,
      failedCount,
      lastRunAt: new Date().toISOString(),
      message:
        geocodeError ??
        (resolvedRows > 0
          ? `Resolved ${resolvedRows.toLocaleString()} of ${attemptedCount.toLocaleString()} row${attemptedCount === 1 ? '' : 's'} for map rendering.`
          : 'Projectr could not resolve any rows for map rendering.'),
    },
  }
}
