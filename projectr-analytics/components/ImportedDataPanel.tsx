'use client'

import { useMemo, useState } from 'react'
import type { ClientUploadMarker } from '@/lib/client-upload-markers-store'
import {
  getImportedDatasetView,
  buildImportedChartModel,
  buildImportedSummaryStats,
  formatImportedCell,
  getImportedSourceKey,
  getImportedTableHeaders,
  getImportedTableRows,
} from '@/lib/client-upload-presentation'
import type { ClientUploadSession } from '@/lib/client-upload-session-store'
import { getSessionSources } from '@/lib/client-upload-session-aggregate'

type ImportedPanelView = 'recommended' | 'map' | 'chart' | 'table'

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

function SourceBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-white/6 px-1.5 py-0.5 text-[9px] text-zinc-300">
      {label}
    </span>
  )
}

function SimpleLineChart({
  points,
  stroke = '#D76B3D',
}: {
  points: Array<{ label: string; value: number }>
  stroke?: string
}) {
  const width = 520
  const height = 170
  const padX = 14
  const padY = 16
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0

  const line = points
    .map((point, index) => {
      const x = padX + index * step
      const y = height - padY - ((point.value - min) / span) * (height - padY * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={line}
        />
        {points.map((point, index) => {
          const x = padX + index * step
          const y = height - padY - ((point.value - min) / span) * (height - padY * 2)
          return <circle key={`${point.label}:${index}`} cx={x} cy={y} r="3" fill={stroke} />
        })}
      </svg>
      <div className="mt-2 flex justify-between gap-2 text-[10px] text-zinc-500">
        <span className="truncate">{points[0]?.label ?? ''}</span>
        <span className="truncate text-right">{points.at(-1)?.label ?? ''}</span>
      </div>
    </div>
  )
}

function SimpleBarChart({
  points,
  fill = '#60a5fa',
}: {
  points: Array<{ label: string; value: number }>
  fill?: string
}) {
  const max = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 p-3">
      {points.map((point) => {
        const widthPct = Math.max((point.value / max) * 100, 4)
        return (
          <div key={point.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate text-zinc-300">{point.label}</span>
              <span className="font-medium text-white">{point.value.toLocaleString()}</span>
            </div>
            <div className="h-2 rounded-full bg-white/6">
              <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: fill }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SelectedMarkerDetail({
  marker,
  onClear,
}: {
  marker: ClientUploadMarker
  onClear?: (() => void) | null
}) {
  const fields = Object.entries(marker.row_preview ?? {})
  if (fields.length === 0) return null

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Selected map record</p>
          <p className="text-xs font-medium text-white">{marker.label}</p>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-zinc-400 transition-colors hover:text-white"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {fields.map(([key, value]) => (
          <div key={key} className="rounded bg-white/6 px-2 py-1">
            <p className="text-zinc-500">{key}</p>
            <p className="break-words text-white">{formatImportedCell(value)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ImportedDataPanel({
  session,
  selectedMarker = null,
  onClearSelectedMarker,
}: {
  session: ClientUploadSession | null
  selectedMarker?: ClientUploadMarker | null
  onClearSelectedMarker?: (() => void) | null
}) {
  const sources = useMemo(
    () => (session ? getSessionSources(session) : []),
    [session]
  )
  const [preferredSourceKey, setPreferredSourceKey] = useState<string | null>(null)
  const [viewState, setViewState] = useState<{ sourceKey: string | null; view: ImportedPanelView }>({
    sourceKey: null,
    view: 'recommended',
  })
  let selectedSourceKey: string | null = null
  if (sources.length > 0) {
    if (selectedMarker?.file_name) {
      const markerMatch = sources.findIndex((source) => source.fileName === selectedMarker.file_name)
      if (markerMatch >= 0) {
        selectedSourceKey = getImportedSourceKey(sources[markerMatch], markerMatch)
      }
    }

    if (!selectedSourceKey) {
      const preferredStillExists = sources.some(
        (source, index) => getImportedSourceKey(source, index) === preferredSourceKey
      )
      selectedSourceKey = preferredStillExists ? preferredSourceKey : getImportedSourceKey(sources[0], 0)
    }
  }

  const selectedSource =
    sources.find((source, index) => getImportedSourceKey(source, index) === selectedSourceKey) ?? null

  if (!selectedSource) return null

  const recommendedView = getImportedDatasetView(selectedSource)
  const chartModel = buildImportedChartModel(selectedSource)
  const selectedView = viewState.sourceKey === selectedSourceKey ? viewState.view : 'recommended'
  const activeView =
    selectedView === 'recommended'
      ? recommendedView
      : selectedView === 'chart' && !chartModel
        ? 'table'
        : selectedView === 'map' && !selectedSource.mapPinsActive
          ? recommendedView
          : selectedView
  const summaryStats = buildImportedSummaryStats(selectedSource)
  const tableHeaders = getImportedTableHeaders(selectedSource)
  const tableRows = getImportedTableRows(selectedSource)
  const markerBelongsToSelected =
    selectedMarker != null &&
    selectedMarker.file_name != null &&
    selectedMarker.file_name === selectedSource.fileName

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge
            label={
              MAPABILITY_LABELS[selectedSource.triage.mapability_classification] ??
              selectedSource.triage.mapability_classification
            }
          />
          <SourceBadge
            label={
              FALLBACK_LABELS[selectedSource.triage.fallback_visualization] ??
              selectedSource.triage.fallback_visualization
            }
          />
          <SourceBadge label={`${(selectedSource.triage.confidence * 100).toFixed(0)}% confidence`} />
        </div>
        <p className="mt-2 text-sm font-semibold text-white">
          {selectedSource.fileName ?? selectedSource.triage.metric_name}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {selectedSource.triage.explanation}
        </p>
      </div>

      {sources.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((source, index) => {
            const key = getImportedSourceKey(source, index)
            const active = key === selectedSourceKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPreferredSourceKey(key)
                  setViewState({ sourceKey: key, view: 'recommended' })
                }}
                className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                  active
                    ? 'border-primary/45 bg-primary/10 text-primary'
                    : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
                }`}
              >
                {source.fileName ?? `Import ${index + 1}`}
              </button>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {summaryStats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-zinc-500">{stat.label}</p>
            <p className="text-sm font-semibold text-white">{stat.value}</p>
            {stat.sub ? <p className="text-[10px] text-zinc-500">{stat.sub}</p> : null}
          </div>
        ))}
      </div>

      {selectedSource.triage.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-200">
          {selectedSource.triage.warnings[0]}
        </div>
      )}

      {markerBelongsToSelected && selectedMarker ? (
        <SelectedMarkerDetail marker={selectedMarker} onClear={onClearSelectedMarker} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setViewState({ sourceKey: selectedSourceKey, view: 'recommended' })}
          className={`rounded-md border px-2.5 py-1 text-[10px] ${
            selectedView === 'recommended'
              ? 'border-primary/45 bg-primary/10 text-primary'
              : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
          }`}
        >
          Recommended
        </button>
        {selectedSource.mapPinsActive && (
          <button
            type="button"
            onClick={() => setViewState({ sourceKey: selectedSourceKey, view: 'map' })}
            className={`rounded-md border px-2.5 py-1 text-[10px] ${
              selectedView === 'map'
                ? 'border-primary/45 bg-primary/10 text-primary'
                : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
            }`}
          >
            Map
          </button>
        )}
        {chartModel && (
          <button
            type="button"
            onClick={() => setViewState({ sourceKey: selectedSourceKey, view: 'chart' })}
            className={`rounded-md border px-2.5 py-1 text-[10px] ${
              selectedView === 'chart'
                ? 'border-primary/45 bg-primary/10 text-primary'
                : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
            }`}
          >
            Chart
          </button>
        )}
        <button
          type="button"
          onClick={() => setViewState({ sourceKey: selectedSourceKey, view: 'table' })}
          className={`rounded-md border px-2.5 py-1 text-[10px] ${
            selectedView === 'table'
              ? 'border-primary/45 bg-primary/10 text-primary'
              : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
          }`}
        >
          Table
        </button>
      </div>

      {activeView === 'map' && (
        <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-3 text-[11px] leading-relaxed text-zinc-400">
          <p className="font-medium text-white">
            {selectedSource.markerCount.toLocaleString()} imported pin
            {selectedSource.markerCount === 1 ? '' : 's'} are active on the <span className="text-primary">Client</span> map layer.
          </p>
          <p className="mt-1">
            Click a pin on the map to inspect its imported record here. The imported layer stays isolated from the market
            aggregate state and can be toggled off independently.
          </p>
        </div>
      )}

      {activeView === 'chart' && chartModel && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              {chartModel.kind === 'line' ? 'Trend view' : 'Category view'}
            </p>
            <p className="text-xs text-zinc-300">{chartModel.title}</p>
          </div>
          {chartModel.kind === 'line' ? (
            <SimpleLineChart points={chartModel.points} />
          ) : (
            <SimpleBarChart points={chartModel.points} />
          )}
        </div>
      )}

      {(activeView === 'table' || activeView === 'chart' || activeView === 'map') && tableHeaders.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Raw table</p>
            {selectedSource.rawTable?.truncated ? (
              <p className="text-[10px] text-zinc-500">
                Showing {tableRows.length} of {selectedSource.rawTable.total_rows.toLocaleString()} rows
              </p>
            ) : null}
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-border/50 text-[10px]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-left uppercase text-[9px] text-zinc-500">
                  {tableHeaders.map((header) => (
                    <th key={header} className="p-1.5 font-mono">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, index) => (
                  <tr key={index} className="border-b border-border/40 last:border-b-0">
                    {tableHeaders.map((header) => (
                      <td key={`${index}:${header}`} className="p-1.5 align-top text-zinc-300">
                        {formatImportedCell(row[header])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
