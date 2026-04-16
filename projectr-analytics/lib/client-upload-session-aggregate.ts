import type {
  ClientUploadSession,
  ClientUploadSessionLegacy,
  ClientUploadSessionNew,
  ClientUploadVisualizationMode,
  ClientUploadWorkflowStatus,
  ClientUploadSourcePart,
} from '@/lib/client-upload-session-store'
import type { ClientNormalizeMarkerPoint } from '@/lib/normalize-client-types'

export type { ClientUploadSourcePart }

function isSessionNew(s: ClientUploadSession): s is ClientUploadSessionNew {
  return Array.isArray((s as ClientUploadSessionNew).sources)
}

function legacyToSources(s: ClientUploadSessionLegacy): ClientUploadSourcePart[] {
  return [
    {
      fileName: s.fileName,
      triage: s.triage,
      rowsIngested: s.rowsIngested,
      previewRows: s.previewRows,
      parseSummary: s.parseSummary,
      workingRows: s.workingRows,
      workingRowsKey: s.workingRowsKey,
      rawTable: s.rawTable,
      markerPoints: s.markerPoints,
      markerCount: s.markerCount,
      mapPinsActive: s.mapPinsActive,
      mapEligible: s.mapEligible,
      workflowStatus: s.workflowStatus,
      visualizationMode: s.visualizationMode,
      persistenceWarning: s.persistenceWarning,
      normalization: s.normalization,
    },
  ]
}

function inferWorkflowStatus(source: ClientUploadSourcePart): ClientUploadWorkflowStatus {
  if (source.mapPinsActive || (source.markerPoints?.length ?? 0) > 0 || source.markerCount > 0) {
    return 'mapped'
  }
  if (source.triage.mapability_classification === 'unusable') return 'errored'
  if (source.normalization?.status === 'failed' && (source.normalization.resolvedCount ?? 0) === 0) {
    return 'errored'
  }
  return 'sidebar_only'
}

function inferVisualizationMode(source: ClientUploadSourcePart): ClientUploadVisualizationMode {
  if (source.mapPinsActive || (source.markerPoints?.length ?? 0) > 0 || source.markerCount > 0) return 'map'
  if (
    source.triage.fallback_visualization === 'time_series_chart' ||
    source.triage.fallback_visualization === 'bar_chart'
  ) {
    return 'chart'
  }
  return 'table'
}

function normalizeSourcePart(source: ClientUploadSourcePart): ClientUploadSourcePart {
  const markerPoints = source.markerPoints ?? []
  const markerCount = markerPoints.length > 0 ? markerPoints.length : source.markerCount
  const mapPinsActive = source.mapPinsActive || markerPoints.length > 0
  const inferredMapEligible =
    source.triage.mapability_classification === 'map_ready' ||
    source.triage.mapability_classification === 'map_normalizable'
  const mapEligible = source.mapEligible === true || inferredMapEligible

  return {
    ...source,
    markerPoints,
    markerCount,
    mapPinsActive,
    mapEligible,
    workflowStatus:
      source.workflowStatus ??
      inferWorkflowStatus({ ...source, markerPoints, markerCount, mapPinsActive, mapEligible }),
    visualizationMode:
      source.visualizationMode ??
      inferVisualizationMode({ ...source, markerPoints, markerCount, mapPinsActive, mapEligible }),
    persistenceWarning: source.persistenceWarning ?? null,
    normalization:
      source.normalization ?? {
        status: 'idle',
        attemptedCount: 0,
        resolvedCount: 0,
        failedCount: 0,
        lastRunAt: null,
        message: null,
      },
  }
}

export function getSessionSources(session: ClientUploadSession): ClientUploadSourcePart[] {
  const raw = isSessionNew(session) ? session.sources : legacyToSources(session)
  return raw.map((source) => normalizeSourcePart(source))
}

export function getMergedSessionMarkerPoints(session: ClientUploadSession | null): ClientNormalizeMarkerPoint[] {
  if (!session) return []

  const seen = new Set<string>()
  const merged: ClientNormalizeMarkerPoint[] = []

  for (const source of getSessionSources(session)) {
    for (const marker of source.markerPoints ?? []) {
      const key = `${marker.lat.toFixed(5)}|${marker.lng.toFixed(5)}|${marker.label}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(marker)
    }
  }

  return merged
}

export function updateSessionSourceAtIndex(
  session: ClientUploadSession | null,
  index: number,
  updater: (source: ClientUploadSourcePart) => ClientUploadSourcePart
): ClientUploadSession | null {
  if (!session) return null
  const currentSources = getSessionSources(session)
  if (index < 0 || index >= currentSources.length) return session

  const nextSources = currentSources.map((source, sourceIndex) =>
    sourceIndex === index ? normalizeSourcePart(updater(source)) : source
  )

  return {
    ingestedAt: session.ingestedAt,
    sources: nextSources,
  }
}

/** Flattened view for UI, map context, and agent prompt */
export function aggregateClientUploadSession(session: ClientUploadSession | null) {
  if (!session) return null
  const sources = getSessionSources(session)
  if (sources.length === 0) return null

  const fileNames = sources.map((x) => x.fileName).filter((n): n is string => Boolean(n?.trim()))
  const fileNameLabel =
    fileNames.length > 1 ? fileNames.join(' + ') : fileNames[0] ?? sources[0]?.fileName ?? null

  const totalRows = sources.reduce((a, s) => a + s.rowsIngested, 0)
  const totalMarkers = sources.reduce((a, s) => a + s.markerCount, 0)
  const mapPinsActive = sources.some((s) => s.mapPinsActive)
  const mapEligible = sources.some((s) => s.mapEligible ?? s.mapPinsActive)
  const statusCounts = sources.reduce(
    (acc, source) => {
      acc[source.workflowStatus ?? inferWorkflowStatus(source)] += 1
      return acc
    },
    { mapped: 0, sidebar_only: 0, errored: 0 } as Record<ClientUploadWorkflowStatus, number>
  )

  const primary = sources[0]
  const previewRows = sources.flatMap((s) => s.previewRows).slice(0, 16)
  const reasoning =
    sources.length === 1
      ? primary.triage.reasoning
      : sources
          .map((s, i) => `[${s.fileName ?? `file_${i + 1}`}] ${s.triage.bucket}/${s.triage.visual_bucket}: ${s.triage.reasoning}`)
          .join(' ')

  return {
    ingestedAt: session.ingestedAt,
    sources,
    sourceCount: sources.length,
    fileNameLabel,
    fileNames,
    triage: primary.triage,
    rowsIngested: totalRows,
    markerCount: totalMarkers,
    mapPinsActive,
    mapEligible,
    statusCounts,
    previewRows,
    reasoning,
  }
}

export type AggregatedClientUploadSession = NonNullable<ReturnType<typeof aggregateClientUploadSession>>
