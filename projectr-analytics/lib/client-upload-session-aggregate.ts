import type {
  ClientUploadSession,
  ClientUploadSessionLegacy,
  ClientUploadSessionNew,
  ClientUploadSourcePart,
} from '@/lib/client-upload-session-store'

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
      markerCount: s.markerCount,
      mapPinsActive: s.mapPinsActive,
      mapEligible: s.mapEligible,
    },
  ]
}

export function getSessionSources(session: ClientUploadSession): ClientUploadSourcePart[] {
  if (isSessionNew(session)) return session.sources
  return legacyToSources(session)
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
    previewRows,
    reasoning,
  }
}

export type AggregatedClientUploadSession = NonNullable<ReturnType<typeof aggregateClientUploadSession>>
