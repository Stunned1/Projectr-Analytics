import type { ClientUploadSourcePart } from '@/lib/client-upload-session-store'
import { normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'
import type { UploadCellValue, UploadRawRow } from '@/lib/upload/types'

export type ImportedDatasetView = 'map' | 'chart' | 'table'

export interface ImportedSummaryStat {
  label: string
  value: string
  sub?: string | null
}

export interface ImportedChartPoint {
  label: string
  value: number
}

export interface ImportedChartModel {
  kind: 'line' | 'bar'
  title: string
  points: ImportedChartPoint[]
}

export function toScoutChartOutputFromImportedChart(model: ImportedChartModel | null): ScoutChartOutput | null {
  if (!model) return null

  return normalizeScoutChartOutput({
    kind: model.kind,
    title: model.title,
    subtitle: 'Imported dataset preview',
    summary: 'Converted from the imported-data fallback chart model.',
    xAxis: { key: 'label', label: model.kind === 'line' ? 'Period' : 'Category' },
    yAxis: { label: 'Value', valueFormat: 'number' },
    series: [
      {
        key: 'primary',
        label: model.title,
        points: model.points.map((point) => ({ x: point.label, y: point.value })),
      },
    ],
    citations: [
      {
        id: 'imported-dataset-session',
        label: 'Imported dataset session',
        sourceType: 'workspace_upload',
        note: 'Derived from the active imported dataset preview in the current browser session.',
      },
    ],
  })
}

export function getImportedSourceKey(source: ClientUploadSourcePart, index: number): string {
  return `${source.fileName ?? 'file'}:${index}`
}

function hasFullImportedWorkingRows(source: ClientUploadSourcePart): boolean {
  return (source.workingRows?.length ?? 0) > 0
}

export function isImportedWorkingRowsHydrating(source: ClientUploadSourcePart): boolean {
  return !hasFullImportedWorkingRows(source) && Boolean(source.workingRowsKey)
}

function getImportedWorkingRows(source: ClientUploadSourcePart): UploadRawRow[] {
  if (hasFullImportedWorkingRows(source)) return source.workingRows ?? []
  if (source.workingRowsKey) return []
  return source.rawTable?.rows ?? source.parseSummary?.sampleRows ?? []
}

export function getImportedDatasetView(source: ClientUploadSourcePart): ImportedDatasetView {
  if (source.mapPinsActive) return 'map'
  if (
    source.triage.fallback_visualization === 'time_series_chart' ||
    source.triage.fallback_visualization === 'bar_chart'
  ) {
    return 'chart'
  }
  return 'table'
}

function parseNumericValue(value: UploadCellValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[$,%]/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

function getPrimaryNumericSeries(source: ClientUploadSourcePart): Array<{ raw: UploadRawRow; value: number }> {
  const rows = getImportedWorkingRows(source)
  const valueKey = source.triage.value_column
  if (!valueKey) return []

  return rows
    .map((raw) => ({ raw, value: parseNumericValue(raw[valueKey]) }))
    .filter((row): row is { raw: UploadRawRow; value: number } => row.value != null)
}

export function buildImportedSummaryStats(source: ClientUploadSourcePart): ImportedSummaryStat[] {
  const columnCount =
    source.rawTable?.headers.length ??
    source.parseSummary?.headers.length ??
    0
  const mappedRows = source.markerCount
  const numericSeries = getPrimaryNumericSeries(source)
  const values = numericSeries.map((row) => row.value)
  const average =
    values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null

  return [
    {
      label: 'Rows',
      value: source.rowsIngested.toLocaleString(),
      sub: columnCount > 0 ? `${columnCount} columns` : null,
    },
    {
      label: 'Rendering',
      value:
        source.visualizationMode === 'map' || source.mapPinsActive
          ? 'Map'
          : source.visualizationMode === 'chart' || source.triage.fallback_visualization === 'time_series_chart'
            ? 'Chart'
            : source.triage.fallback_visualization === 'bar_chart'
              ? 'Bar chart'
              : 'Table',
      sub: source.triage.mapability_classification.replace(/_/g, ' '),
    },
    {
      label: 'Mapped rows',
      value: mappedRows.toLocaleString(),
      sub: source.mapPinsActive ? 'active on map' : 'not mapped',
    },
    {
      label: 'Primary value',
      value:
        average != null
          ? formatCompactNumber(average)
          : source.triage.value_column ?? '—',
      sub: average != null ? `avg ${source.triage.value_column ?? 'value'}` : 'no numeric value',
    },
  ]
}

export function buildImportedChartModel(source: ClientUploadSourcePart): ImportedChartModel | null {
  const rows = getImportedWorkingRows(source)
  if (rows.length === 0) return null

  const valueKey = source.triage.value_column
  if (!valueKey) return null

  if (source.triage.fallback_visualization === 'time_series_chart') {
    const dateKey = source.triage.date_column
    if (!dateKey) return null
    const points = rows
      .map((row) => {
        const label = row[dateKey]
        const value = parseNumericValue(row[valueKey])
        if (label == null || value == null) return null
        return { label: String(label), value, sortValue: Date.parse(String(label)) }
      })
      .filter((row): row is { label: string; value: number; sortValue: number } => Boolean(row))
      .sort((a, b) => {
        const aValid = Number.isFinite(a.sortValue)
        const bValid = Number.isFinite(b.sortValue)
        if (aValid && bValid) return a.sortValue - b.sortValue
        if (aValid) return -1
        if (bValid) return 1
        return a.label.localeCompare(b.label)
      })
      .slice(-24)
      .map(({ label, value }) => ({ label, value }))

    if (points.length < 2) return null
    return {
      kind: 'line',
      title: source.triage.metric_name,
      points,
    }
  }

  if (source.triage.fallback_visualization === 'bar_chart') {
    const categoryKey =
      source.triage.recommended_field_mappings.category ??
      source.rawTable?.headers.find((header) => header !== valueKey) ??
      null
    if (!categoryKey) return null

    const grouped = new Map<string, number>()
    for (const row of rows) {
      const category = row[categoryKey]
      const value = parseNumericValue(row[valueKey])
      if (category == null || value == null) continue
      const key = String(category)
      grouped.set(key, (grouped.get(key) ?? 0) + value)
    }

    const points = [...grouped.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)

    if (points.length === 0) return null
    return {
      kind: 'bar',
      title: source.triage.metric_name,
      points,
    }
  }

  return null
}

export function getImportedTableHeaders(source: ClientUploadSourcePart): string[] {
  return source.rawTable?.headers ?? source.parseSummary?.headers ?? (source.workingRows?.length ? Object.keys(source.workingRows[0] ?? {}) : [])
}

export function getImportedTableRows(source: ClientUploadSourcePart): UploadRawRow[] {
  return getImportedWorkingRows(source)
}

export function formatImportedCell(value: UploadCellValue): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : '—'
  const text = String(value).trim()
  return text.length > 0 ? text : '—'
}
