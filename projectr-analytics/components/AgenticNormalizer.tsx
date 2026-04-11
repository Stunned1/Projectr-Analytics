'use client'

import { useState, useRef, useCallback } from 'react'

interface TriageResult {
  bucket: 'GEOSPATIAL' | 'TEMPORAL' | 'TABULAR'
  visual_bucket: 'HEATMAP' | 'MARKER' | 'POLYGON' | 'TIME_SERIES' | 'TABULAR'
  metric_name: string
  geo_column: string | null
  value_column: string | null
  date_column: string | null
  reasoning: string
}

interface NormalizeResult {
  triage: TriageResult
  rows_ingested: number
  preview_rows: Array<{
    submarket_id: string | null
    metric_name: string
    metric_value: number | null
    time_period: string | null
    visual_bucket: string
  }>
}

interface AgenticNormalizerProps {
  currentZip?: string | null
  onIngested?: (result: NormalizeResult) => void
}

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
  MARKER: 'Pin Markers',
  POLYGON: 'Polygon Fill',
  TIME_SERIES: 'Line Chart',
  TABULAR: 'Data Grid',
}

export default function AgenticNormalizer({ currentZip, onIngested }: AgenticNormalizerProps) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<NormalizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      setError('Please upload a CSV file')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setFileName(file.name)

    const formData = new FormData()
    formData.append('file', file)
    if (currentZip) formData.append('zip', currentZip)

    try {
      const res = await fetch('/api/normalize', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
      onIngested?.(data)
    } catch {
      setError('Failed to process file')
    } finally {
      setLoading(false)
    }
  }, [currentZip, onIngested])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }, [processFile])

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-primary bg-primary/10'
            : 'border-white/15 hover:border-white/30 hover:bg-white/3'
        }`}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={onFileChange} />
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-zinc-400 text-xs">Analyzing with Gemini...</p>
            <p className="text-zinc-600 text-[10px]">{fileName}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="text-2xl">📂</span>
            <p className="text-white text-xs font-medium">Drop CSV here or click to upload</p>
            <p className="text-zinc-500 text-[10px]">Ticketing data, logistics routes, property lists...</p>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Triage result */}
      {result && (
        <div className="bg-white/3 border border-white/8 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{BUCKET_ICONS[result.triage.bucket]}</span>
            <div>
              <p className="text-white text-xs font-semibold">{result.triage.metric_name}</p>
              <p className="text-[10px]" style={{ color: BUCKET_COLORS[result.triage.bucket] }}>
                {result.triage.bucket} → {VISUAL_LABELS[result.triage.visual_bucket]}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-white text-xs font-semibold">{result.rows_ingested.toLocaleString()}</p>
              <p className="text-zinc-500 text-[10px]">rows ingested</p>
            </div>
          </div>

          <p className="text-zinc-400 text-[11px] mb-3 italic">"{result.triage.reasoning}"</p>

          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
            {result.triage.geo_column && (
              <div className="bg-white/5 rounded px-2 py-1">
                <p className="text-zinc-500">Geography</p>
                <p className="text-white font-mono truncate">{result.triage.geo_column}</p>
              </div>
            )}
            {result.triage.value_column && (
              <div className="bg-white/5 rounded px-2 py-1">
                <p className="text-zinc-500">Value</p>
                <p className="text-white font-mono truncate">{result.triage.value_column}</p>
              </div>
            )}
            {result.triage.date_column && (
              <div className="bg-white/5 rounded px-2 py-1">
                <p className="text-zinc-500">Date</p>
                <p className="text-white font-mono truncate">{result.triage.date_column}</p>
              </div>
            )}
          </div>

          {result.triage.bucket === 'GEOSPATIAL' && (
            <p className="mt-2 text-[10px] text-primary">✓ Rendered on map as {VISUAL_LABELS[result.triage.visual_bucket]}</p>
          )}
          {result.triage.bucket === 'TEMPORAL' && (
            <p className="text-blue-400 text-[10px] mt-2">✓ Routed to sidebar chart</p>
          )}
          {result.triage.bucket === 'TABULAR' && (
            <p className="text-zinc-400 text-[10px] mt-2">✓ Available in data panel</p>
          )}
        </div>
      )}
    </div>
  )
}
