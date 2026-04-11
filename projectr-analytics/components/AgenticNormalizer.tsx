'use client'

import { useState, useRef, useCallback } from 'react'
import { useClientUploadMarkersStore } from '@/lib/client-upload-markers-store'
import { useClientUploadSessionStore } from '@/lib/client-upload-session-store'
import type {
  ClientNormalizeApiResult,
  ClientNormalizeMarkerPoint,
  NormalizerIngestPayload,
} from '@/lib/normalize-client-types'

const MAX_FILES_PER_DROP = 8

const BUCKET_COLORS: Record<string, string> = {
  GEOSPATIAL: '#D76B3D',
  TEMPORAL: '#60a5fa',
  TABULAR: '#a3a3a3',
}

const BUCKET_ICONS: Record<string, string> = {
  GEOSPATIAL: '🗺',
  TEMPORAL: '📈',
  TABULAR: '📋',
}

const VISUAL_LABELS: Record<string, string> = {
  HEATMAP: 'Heatmap Layer',
  MARKER: '3D pins (map)',
  POLYGON: 'Polygon Fill',
  TIME_SERIES: 'Line Chart',
  TABULAR: 'Data Grid',
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
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ClientNormalizeApiResult[]>([])
  const [ingestedNames, setIngestedNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFiles = useCallback(
    async (files: File[]) => {
      const list = filterCsvFiles(files)
      if (list.length === 0) {
        setError('Add at least one .csv or .txt file')
        return
      }

      setLoading(true)
      setError(null)
      setResults([])
      setIngestedNames([])
      setFileLabel(list.length === 1 ? list[0].name : `${list.length} files`)

      const done: ClientNormalizeApiResult[] = []

      try {
        for (const file of list) {
          const formData = new FormData()
          formData.append('file', file)
          if (currentZip) formData.append('zip', currentZip)

          const res = await fetch('/api/normalize', { method: 'POST', body: formData })
          const data = (await res.json()) as ClientNormalizeApiResult & { error?: string }
          if (data.error) {
            setError(`${file.name}: ${data.error}`)
            setLoading(false)
            return
          }
          done.push(data)
        }

        const perFileMarkers = done.map((d) => d.marker_points ?? [])
        const merged = mergeMarkerPoints(perFileMarkers)
        const hasPins = merged.length > 0

        setMarkers(hasPins ? merged : null)

        setSession({
          ingestedAt: new Date().toISOString(),
          sources: done.map((data, i) => {
            const pts = data.marker_points ?? []
            return {
              fileName: list[i]?.name ?? null,
              triage: {
                bucket: data.triage.bucket,
                visual_bucket: data.triage.visual_bucket,
                metric_name: data.triage.metric_name,
                reasoning: data.triage.reasoning,
                geo_column: data.triage.geo_column,
                value_column: data.triage.value_column,
                date_column: data.triage.date_column,
              },
              rowsIngested: data.rows_ingested,
              previewRows: data.preview_rows ?? [],
              markerCount: pts.length,
              mapPinsActive: pts.length > 0,
              mapEligible: data.map_eligible ?? pts.length > 0,
            }
          }),
        })

        setResults(done)
        setIngestedNames(list.map((f) => f.name))
        onIngested?.({ results: done, mergedMarkerPoints: merged })
      } catch {
        setError('Failed to process file(s)')
      } finally {
        setLoading(false)
      }
    },
    [currentZip, onIngested, setMarkers, setSession]
  )

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
            <p className="text-xs text-zinc-400">Gemini triage + normalize…</p>
            <p className="text-[10px] text-zinc-600">{fileLabel}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="text-2xl">📂</span>
            <p className="text-xs font-medium text-white">Drop CSV(s) here or click to upload</p>
            <p className="text-[10px] text-zinc-500">
              Up to {MAX_FILES_PER_DROP} files at once — pins and previews merge. Geospatial → 3D cone pins (ZIP +
              addresses via Google when configured). Temporal / tabular → Data tab + Supabase ingest.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
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
                <span className="text-lg">{BUCKET_ICONS[result.triage.bucket] ?? '📄'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{result.triage.metric_name}</p>
                  <p className="text-[10px]" style={{ color: BUCKET_COLORS[result.triage.bucket] ?? '#888' }}>
                    {result.triage.bucket} → {VISUAL_LABELS[result.triage.visual_bucket] ?? result.triage.visual_bucket}
                  </p>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="text-xs font-semibold text-white">{result.rows_ingested.toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-500">rows</p>
                </div>
              </div>

              {results.length > 1 && (
                <p className="mb-2 truncate font-mono text-[9px] text-zinc-500" title={ingestedNames[idx]}>
                  {ingestedNames[idx] ?? `File ${idx + 1}`}
                </p>
              )}

              <p className="mb-3 text-[11px] italic text-zinc-400">&quot;{result.triage.reasoning}&quot;</p>

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

              {(result.marker_points?.length ?? 0) > 0 && (
                <p className="mt-2 text-[10px] text-primary">
                  ✓ {result.marker_points!.length} pin{result.marker_points!.length === 1 ? '' : 's'} in this file →{' '}
                  <span className="font-semibold">Client</span> layer shows all files combined
                </p>
              )}
              {result.triage.bucket === 'TEMPORAL' && (
                <p className="mt-2 text-[10px] text-blue-400">
                  ✓ <span className="font-semibold">Data</span> tab — time series ingested
                </p>
              )}
              {result.triage.bucket === 'TABULAR' && (
                <p className="mt-2 text-[10px] text-zinc-400">
                  ✓ <span className="font-semibold">Data</span> tab / metrics (Client Upload)
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
