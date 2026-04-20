'use client'

import { useState, useRef, useCallback } from 'react'
import {
  ChartLine,
  FileSpreadsheet,
  FolderOpen,
  MapPinned,
  TableProperties,
  type LucideIcon,
} from 'lucide-react'
import { useClientUploadMarkersStore } from '@/lib/client-upload-markers-store'
import { attachImportedMarkerSourceKey, getImportedSourceKey } from '@/lib/client-upload-presentation'
import {
  useClientUploadSessionStore,
  type ClientUploadSourcePart,
  type ClientUploadVisualizationMode,
  type ClientUploadWorkflowStatus,
} from '@/lib/client-upload-session-store'
import {
  buildClientUploadWorkingRowsKey,
  collectClientUploadWorkingRowsKeys,
  deleteClientUploadWorkingRowsMany,
  putClientUploadWorkingRows,
} from '@/lib/client-upload-working-rows'
import type {
  ClientNormalizeApiResult,
  ClientNormalizeMarkerPoint,
  NormalizerIngestPayload,
} from '@/lib/normalize-client-types'
import type { UploadParseResult } from '@/lib/upload/types'

const MAX_FILES_PER_DROP = 8
type NormalizerStage = 'idle' | 'reviewing' | 'reviewed' | 'importing' | 'imported'

const BUCKET_COLORS: Record<string, string> = {
  GEOSPATIAL: '#D76B3D',
  TEMPORAL: '#60a5fa',
  TABULAR: '#a3a3a3',
}

const BUCKET_ICONS: Record<string, LucideIcon> = {
  GEOSPATIAL: MapPinned,
  TEMPORAL: ChartLine,
  TABULAR: TableProperties,
}

const VISUAL_LABELS: Record<string, string> = {
  HEATMAP: 'Heatmap Layer',
  MARKER: '3D pins (map)',
  POLYGON: 'Polygon Fill',
  TIME_SERIES: 'Line Chart',
  TABULAR: 'Data Grid',
}

const MAPABILITY_LABELS: Record<string, string> = {
  map_ready: 'Ready for map',
  map_normalizable: 'Needs map normalization',
  non_map_visualizable: 'Sidebar or chart',
  unusable: 'Unusable',
}

const FALLBACK_LABELS: Record<string, string> = {
  map_layer: 'Map layer',
  raw_table: 'Raw table',
  time_series_chart: 'Time-series chart',
  bar_chart: 'Bar chart',
  summary_cards: 'Summary cards',
  table_then_chart: 'Table first',
  none: 'No safe fallback',
}

function mergeMarkerPoints(lists: ClientNormalizeMarkerPoint[][]): ClientNormalizeMarkerPoint[] {
  const seen = new Set<string>()
  const out: ClientNormalizeMarkerPoint[] = []
  for (const list of lists) {
    for (const m of list) {
      const key = `${m.lat.toFixed(5)}|${m.lng.toFixed(5)}|${m.label}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
  }
  return out
}

function filterCsvFiles(files: FileList | File[]): File[] {
  const arr = Array.from(files)
  return arr
    .filter((f) => f.name.endsWith('.csv') || f.name.endsWith('.txt'))
    .slice(0, MAX_FILES_PER_DROP)
}

interface AgenticNormalizerProps {
  currentZip?: string | null
  /** Called after markers + session stores are updated (map fly / panel are left to the host page). */
  onIngested?: (payload: NormalizerIngestPayload) => void
}

export default function AgenticNormalizer({ currentZip, onIngested }: AgenticNormalizerProps) {
  const setMarkers = useClientUploadMarkersStore((s) => s.setMarkers)
  const setSession = useClientUploadSessionStore((s) => s.setSession)

  const [dragging, setDragging] = useState(false)
  const [stage, setStage] = useState<NormalizerStage>('idle')
  const [results, setResults] = useState<ClientNormalizeApiResult[]>([])
  const [reviewFiles, setReviewFiles] = useState<File[]>([])
  const [reviewParses, setReviewParses] = useState<UploadParseResult[]>([])
  const [resultNames, setResultNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loading = stage === 'reviewing' || stage === 'importing'

  const requestNormalize = useCallback(
    async (
      file: File,
      mode: 'review' | 'import',
      reviewed?: ClientNormalizeApiResult | null
    ): Promise<ClientNormalizeApiResult> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', mode)
      if (currentZip) formData.append('zip', currentZip)
      if (mode === 'import' && reviewed?.review_fingerprint && reviewed?.triage) {
        formData.append('review_fingerprint', reviewed.review_fingerprint)
        formData.append('reviewed_triage', JSON.stringify(reviewed.triage))
      }

      const res = await fetch('/api/normalize', { method: 'POST', body: formData })
      const data = (await res.json()) as ClientNormalizeApiResult & { error?: string }
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Normalize failed for ${file.name}`)
      }
      return data
    },
    [currentZip]
  )

  const persistImportedSession = useCallback(
    async (
      list: File[],
      normalized: ClientNormalizeApiResult[],
      parsedFiles: UploadParseResult[]
    ) => {
      const previousSession = useClientUploadSessionStore.getState().session
      const previousWorkingRowsKeys = collectClientUploadWorkingRowsKeys(previousSession)
      const ingestedAt = new Date().toISOString()

      const sources: ClientUploadSourcePart[] = await Promise.all(
        normalized.map(async (data, i) => {
          const fileName = list[i]?.name ?? null
          const sourceKey = getImportedSourceKey({ fileName } as ClientUploadSourcePart, i)
          const pts = attachImportedMarkerSourceKey(data.marker_points, sourceKey)
          const workingRows = parsedFiles[i]?.rows ?? []
          const workingRowsKey = buildClientUploadWorkingRowsKey(ingestedAt, i, fileName)
          let rowStorageWarning: string | null = null

          try {
            await putClientUploadWorkingRows(workingRowsKey, workingRows)
          } catch {
            rowStorageWarning =
              'Full imported rows are available in this tab, but durable browser storage was unavailable, so reloading may fall back to preview rows only.'
          }

          const workflowStatus: ClientUploadWorkflowStatus =
            pts.length > 0
              ? 'mapped'
              : data.triage.mapability_classification === 'unusable'
                ? 'errored'
                : 'sidebar_only'
          const visualizationMode: ClientUploadVisualizationMode =
            pts.length > 0
              ? 'map'
              : data.triage.fallback_visualization === 'time_series_chart' ||
                  data.triage.fallback_visualization === 'bar_chart'
                ? 'chart'
                : 'table'
          const inferredMapEligible =
            data.triage.mapability_classification === 'map_ready' ||
            data.triage.mapability_classification === 'map_normalizable'
          const persistenceWarning = [data.persistence_warning, rowStorageWarning].filter(Boolean).join(' ') || null

          return {
            fileName,
            triage: data.triage,
            rowsIngested: data.rows_ingested,
            previewRows: data.preview_rows ?? [],
            workingRows,
            workingRowsKey: rowStorageWarning ? null : workingRowsKey,
            parseSummary: data.parse_summary
              ? {
                  file: data.parse_summary.file,
                  headers: data.parse_summary.headers,
                  sampleRows: data.parse_summary.sample_rows,
                }
              : undefined,
            rawTable: data.raw_table,
            markerPoints: pts,
            markerCount: pts.length,
            mapPinsActive: pts.length > 0,
            mapEligible: data.map_eligible === true || inferredMapEligible,
            workflowStatus,
            visualizationMode,
            persistenceWarning,
            normalization: {
              status:
                pts.length > 0 && data.triage.mapability_classification === 'map_normalizable'
                  ? 'resolved'
                  : 'idle',
              attemptedCount: 0,
              resolvedCount: pts.length,
              failedCount: 0,
              lastRunAt: pts.length > 0 ? new Date().toISOString() : null,
              message:
                pts.length > 0 && data.triage.mapability_classification === 'map_normalizable'
                  ? `Resolved ${pts.length.toLocaleString()} row${pts.length === 1 ? '' : 's'} for map rendering during import.`
                  : null,
            },
          }
        })
      )
      const merged = mergeMarkerPoints(sources.map((source) => source.markerPoints ?? []))
      const hasPins = merged.length > 0

      const nextWorkingRowsKeys = sources
        .map((source) => source.workingRowsKey?.trim() ?? '')
        .filter((key): key is string => key.length > 0)
      const staleWorkingRowsKeys = previousWorkingRowsKeys.filter((key) => !nextWorkingRowsKeys.includes(key))
      if (staleWorkingRowsKeys.length > 0) {
        void deleteClientUploadWorkingRowsMany(staleWorkingRowsKeys)
      }

      setMarkers(hasPins ? merged : null)
      setSession({
        ingestedAt,
        sources,
      })
      onIngested?.({ results: normalized, mergedMarkerPoints: merged })
    },
    [onIngested, setMarkers, setSession]
  )

  const processFiles = useCallback(
    async (files: File[]) => {
      const list = filterCsvFiles(files)
      if (list.length === 0) {
        setError('Add at least one .csv or .txt file')
        return
      }

      setStage('reviewing')
      setError(null)
      setResults([])
      setReviewFiles(list)
      setReviewParses([])
      setResultNames(list.map((f) => f.name))
      setFileLabel(list.length === 1 ? list[0].name : `${list.length} files`)

      try {
        const reviewed: ClientNormalizeApiResult[] = []
        const parsed: UploadParseResult[] = []
        const { parseUploadFile } = await import('@/lib/upload')
        for (const file of list) {
          const [reviewedResult, parsedResult] = await Promise.all([
            requestNormalize(file, 'review'),
            parseUploadFile(file),
          ])
          reviewed.push(reviewedResult)
          parsed.push(parsedResult)
        }
        setResults(reviewed)
        setReviewParses(parsed)
        setStage('reviewed')
      } catch (err) {
        setStage('idle')
        setResults([])
        setReviewFiles([])
        setReviewParses([])
        setError(err instanceof Error ? err.message : 'Failed to review file(s)')
      }
    },
    [requestNormalize]
  )

  const importReviewedFiles = useCallback(async () => {
    if (reviewFiles.length === 0) return

    setStage('importing')
    setError(null)
    try {
      const committed: ClientNormalizeApiResult[] = []
      for (const [index, file] of reviewFiles.entries()) {
        committed.push(await requestNormalize(file, 'import', results[index] ?? null))
      }
      await persistImportedSession(reviewFiles, committed, reviewParses)
      setResults(committed)
      setStage('imported')
    } catch (err) {
      setStage('reviewed')
      setError(err instanceof Error ? err.message : 'Failed to import file(s)')
    }
  }, [persistImportedSession, requestNormalize, results, reviewFiles, reviewParses])

  const clearReview = useCallback(() => {
    setStage('idle')
    setError(null)
    setResults([])
    setReviewFiles([])
    setReviewParses([])
    setResultNames([])
    setFileLabel(null)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files?.length) processFiles(Array.from(e.dataTransfer.files))
    },
    [processFiles]
  )

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files
      if (fl?.length) processFiles(Array.from(fl))
      e.target.value = ''
    },
    [processFiles]
  )

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-all ${
          dragging
            ? 'border-primary bg-primary/10'
            : 'border-white/15 hover:border-white/30 hover:bg-white/3'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-xs text-zinc-400">
              {stage === 'reviewing' ? 'Reviewing import…' : 'Importing reviewed file(s)…'}
            </p>
            <p className="text-[10px] text-zinc-600">{fileLabel}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <FolderOpen className="h-8 w-8 text-zinc-300" strokeWidth={1.75} aria-hidden />
            <p className="text-xs font-medium text-white">Drop CSV(s) here or click to review</p>
            <p className="text-[10px] text-zinc-500">
              Up to {MAX_FILES_PER_DROP} files at once. Review happens before import so you can confirm mapability,
              fallback mode, and the chosen rendering path before anything is committed.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-lg border border-white/8 bg-white/4 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                  {stage === 'reviewed' ? 'Import review' : 'Import status'}
                </p>
                <p className="mt-1 text-xs text-zinc-300">
                  {results.length} file{results.length === 1 ? '' : 's'} ·{' '}
                  {results.reduce((sum, result) => sum + result.rows_ingested, 0).toLocaleString()} rows
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {stage === 'reviewed' && (
                  <>
                    <button
                      type="button"
                      onClick={() => void importReviewedFiles()}
                      className="rounded-md border border-primary/35 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      Import reviewed files
                    </button>
                    <button
                      type="button"
                      onClick={clearReview}
                      className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
                    >
                      Clear review
                    </button>
                  </>
                )}
                {stage === 'imported' && (
                  <span className="rounded-md border border-emerald-800/40 bg-emerald-950/30 px-3 py-1.5 text-[11px] font-medium text-emerald-300">
                    Imported
                  </span>
                )}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              {stage === 'reviewed'
                ? 'Nothing has been committed yet. Review the detected structure and chosen rendering path below, then import when it looks right.'
                : 'The reviewed files are now available through the imported-data workflow, with map-ready rows on the Client layer and non-map datasets in the sidebar workspace.'}
            </p>
          </div>

          {results.length > 1 && (
            <p className="text-[10px] font-medium text-zinc-400">
              {results.length} files ·{' '}
              {mergeMarkerPoints(results.map((r) => r.marker_points ?? [])).length} total map pin(s) ·{' '}
              {results.reduce((a, r) => a + r.rows_ingested, 0)} total rows ingested
            </p>
          )}
          {results.map((result, idx) => (
            <div key={idx} className="rounded-lg border border-white/8 bg-white/3 p-3">
              <div className="mb-3 flex items-center gap-2">
                {(() => {
                  const BucketIcon = BUCKET_ICONS[result.triage.bucket] ?? FileSpreadsheet
                  return <BucketIcon className="h-5 w-5 text-zinc-200" strokeWidth={1.75} aria-hidden />
                })()}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{result.triage.metric_name}</p>
                  <p className="text-[10px]" style={{ color: BUCKET_COLORS[result.triage.bucket] ?? '#888' }}>
                    {result.triage.bucket} → {VISUAL_LABELS[result.triage.visual_bucket] ?? result.triage.visual_bucket}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-zinc-300">
                    <span className="rounded bg-white/6 px-1.5 py-0.5">
                      {MAPABILITY_LABELS[result.triage.mapability_classification] ??
                        result.triage.mapability_classification}
                    </span>
                    <span className="rounded bg-white/6 px-1.5 py-0.5">
                      {FALLBACK_LABELS[result.triage.fallback_visualization] ??
                        result.triage.fallback_visualization}
                    </span>
                    <span className="rounded bg-white/6 px-1.5 py-0.5">
                      {(result.triage.confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="text-xs font-semibold text-white">{result.rows_ingested.toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-500">rows</p>
                </div>
              </div>

              {results.length > 1 && (
                <p className="mb-2 truncate font-mono text-[9px] text-zinc-500" title={resultNames[idx]}>
                  {resultNames[idx] ?? `File ${idx + 1}`}
                </p>
              )}

              <p className="mb-3 text-[11px] italic text-zinc-400">&quot;{result.triage.reasoning}&quot;</p>
              <p className="mb-3 text-[11px] leading-relaxed text-zinc-300">{result.triage.explanation}</p>

              {result.parse_summary?.headers?.length ? (
                <div className="mb-3">
                  <p className="mb-1 text-[9px] uppercase tracking-widest text-zinc-500">Detected columns</p>
                  <div className="flex flex-wrap gap-1">
                    {result.parse_summary.headers.slice(0, 8).map((header) => (
                      <span
                        key={header}
                        className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300"
                      >
                        {header}
                      </span>
                    ))}
                    {result.parse_summary.headers.length > 8 && (
                      <span className="rounded bg-white/6 px-1.5 py-0.5 text-[9px] text-zinc-500">
                        +{result.parse_summary.headers.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                {result.triage.geo_column && (
                  <div className="rounded bg-white/5 px-2 py-1">
                    <p className="text-zinc-500">Geography</p>
                    <p className="truncate font-mono text-white">{result.triage.geo_column}</p>
                  </div>
                )}
                {result.triage.value_column && (
                  <div className="rounded bg-white/5 px-2 py-1">
                    <p className="text-zinc-500">Value</p>
                    <p className="truncate font-mono text-white">{result.triage.value_column}</p>
                  </div>
                )}
                {result.triage.date_column && (
                  <div className="rounded bg-white/5 px-2 py-1">
                    <p className="text-zinc-500">Date</p>
                    <p className="truncate font-mono text-white">{result.triage.date_column}</p>
                  </div>
                )}
              </div>

              {(result.persistence_warning || result.triage.warnings.length > 0) && (
                <div className="mt-2 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1.5 text-[10px] text-amber-200">
                  {result.persistence_warning ?? result.triage.warnings[0]}
                </div>
              )}

              {(result.marker_points?.length ?? 0) > 0 && (
                <p className="mt-2 text-[10px] text-primary">
                  {stage === 'reviewed' ? 'Review detected' : 'Imported'} {result.marker_points!.length} pin
                  {result.marker_points!.length === 1 ? '' : 's'} in this file {'->'}{' '}
                  <span className="font-semibold">Client</span> layer
                </p>
              )}
              {result.triage.mapability_classification === 'map_normalizable' &&
                (result.marker_points?.length ?? 0) === 0 && (
                  <p className="mt-2 text-[10px] text-amber-300">
                    {stage === 'reviewed' ? 'Will import' : 'Imported'} with a table-first fallback while map normalization remains unresolved
                  </p>
                )}
              {result.triage.bucket === 'TEMPORAL' && (
                <p className="mt-2 text-[10px] text-blue-400">
                  {stage === 'reviewed' ? 'Will route to' : 'Available in'} the <span className="font-semibold">Imported Data</span>{' '}
                  sidebar chart/table workflow
                </p>
              )}
              {result.triage.bucket === 'TABULAR' && (
                <p className="mt-2 text-[10px] text-zinc-400">
                  {stage === 'reviewed' ? 'Will route to' : 'Available in'} the <span className="font-semibold">Imported Data</span>{' '}
                  sidebar table workflow
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
