import type {
  EdaDataQualitySummary,
  EdaDistributionSummary,
  EdaEvidenceStat,
  EdaOutlierSummary,
  EdaTrendSummary,
  MarketMetricEdaProfile,
  MarketSnapshotEdaProfile,
  UploadedDatasetEdaProfile,
  WorkspaceEdaContext,
} from '@/lib/agent-types'
import type { MetricKey } from '@/lib/metric-definitions'
import { METRIC_DEFINITIONS } from '@/lib/metric-definitions'
import type { ClientUploadSourcePart } from '@/lib/client-upload-session-store'
import type { UploadCellValue, UploadRawRow } from '@/lib/upload/types'

type MarketSnapshotInput = {
  label?: string | null
  zori?: number | null
  zoriGrowth?: number | null
  zhvi?: number | null
  zhviGrowth?: number | null
  vacancyRate?: number | null
  dozPending?: number | null
  priceCuts?: number | null
  inventory?: number | null
  transitStops?: number | null
  population?: number | null
}

function parseNumericValue(value: UploadCellValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[$,%]/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDateValue(value: UploadCellValue): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  if (!normalized) return null
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function toSortedNumbers(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null
  const avg = mean(values)
  if (avg == null) return null
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function getSourceRows(source: ClientUploadSourcePart): UploadRawRow[] {
  if ((source.workingRows?.length ?? 0) > 0) return source.workingRows ?? []
  if (source.rawTable?.rows?.length) return source.rawTable.rows
  if (source.parseSummary?.sampleRows?.length) return source.parseSummary.sampleRows
  return []
}

function getSourceHeaders(source: ClientUploadSourcePart, rows: UploadRawRow[]): string[] {
  return (
    source.rawTable?.headers ??
    source.parseSummary?.headers ??
    (rows.length > 0 ? Object.keys(rows[0] ?? {}) : [])
  )
}

function getCandidateCategoryColumn(source: ClientUploadSourcePart, headers: string[]): string | null {
  const mappings = source.triage.recommended_field_mappings
  return mappings.category ?? mappings.status ?? mappings.site_name ?? headers[0] ?? null
}

function getRowLabel(source: ClientUploadSourcePart, row: UploadRawRow): string {
  const mappings = source.triage.recommended_field_mappings
  const candidates = [
    mappings.site_name,
    mappings.address,
    mappings.category,
    mappings.status,
    source.triage.geo_column,
  ]

  for (const key of candidates) {
    if (!key) continue
    const raw = row[key]
    if (raw == null) continue
    const text = String(raw).trim()
    if (text) return text
  }

  const firstFilled = Object.values(row).find((value) => String(value ?? '').trim().length > 0)
  return firstFilled != null ? String(firstFilled).trim() : 'Row'
}

function getPrimaryDistribution(
  source: ClientUploadSourcePart,
  rows: UploadRawRow[],
  headers: string[]
): EdaDistributionSummary | null {
  const valueColumn = source.triage.value_column
  const numericColumn =
    valueColumn ??
    headers.find((header) => rows.filter((row) => parseNumericValue(row[header]) != null).length >= 3) ??
    null

  if (!numericColumn) return null

  const values = rows
    .map((row) => parseNumericValue(row[numericColumn]))
    .filter((value): value is number => value != null)
  if (values.length === 0) return null

  const sorted = toSortedNumbers(values)
  return {
    column: numericColumn,
    count: values.length,
    nullCount: rows.length - values.length,
    mean: mean(values),
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    stddev: stddev(values),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
  }
}

function getOutliers(
  source: ClientUploadSourcePart,
  rows: UploadRawRow[],
  distribution: EdaDistributionSummary | null
): EdaOutlierSummary[] {
  if (!distribution) return []
  const deduped = new Map<string, EdaOutlierSummary>()
  const values = rows
    .map((row) => ({ row, value: parseNumericValue(row[distribution.column]) }))
    .filter((entry): entry is { row: UploadRawRow; value: number } => entry.value != null)

  if (values.length === 0) return []

  const addOutlier = (summary: EdaOutlierSummary) => {
    const key = `${summary.label}|${summary.value}|${summary.reason}`
    if (!deduped.has(key)) deduped.set(key, summary)
  }

  if (distribution.p25 != null && distribution.p75 != null) {
  const iqr = distribution.p75 - distribution.p25
    if (Number.isFinite(iqr) && iqr > 0) {
      const lowerFence = distribution.p25 - iqr * 1.5
      const upperFence = distribution.p75 + iqr * 1.5

      for (const entry of values) {
        if (entry.value < lowerFence) {
          addOutlier({
            label: getRowLabel(source, entry.row),
            value: entry.value,
            reason: `${distribution.column} is below the lower IQR fence (${formatCompactNumber(lowerFence)}).`,
          })
        }
        if (entry.value > upperFence) {
          addOutlier({
            label: getRowLabel(source, entry.row),
            value: entry.value,
            reason: `${distribution.column} is above the upper IQR fence (${formatCompactNumber(upperFence)}).`,
          })
        }
      }
    }
  }

  if (deduped.size === 0 && distribution.median != null) {
    for (const entry of values) {
      if (entry.value >= distribution.median * 1.75) {
        addOutlier({
          label: getRowLabel(source, entry.row),
          value: entry.value,
          reason: `${distribution.column} is materially above the sample median (${formatCompactNumber(distribution.median)}).`,
        })
      } else if (entry.value <= distribution.median * 0.4) {
        addOutlier({
          label: getRowLabel(source, entry.row),
          value: entry.value,
          reason: `${distribution.column} is materially below the sample median (${formatCompactNumber(distribution.median)}).`,
        })
      }
    }
  }

  return [...deduped.values()].slice(0, 5)
}

function getTopCategories(
  source: ClientUploadSourcePart,
  rows: UploadRawRow[]
): EdaEvidenceStat[] {
  const categoryColumn = getCandidateCategoryColumn(
    source,
    source.rawTable?.headers ?? source.parseSummary?.headers ?? []
  )
  if (!categoryColumn) return []

  const grouped = new Map<string, number>()
  const valueColumn = source.triage.value_column

  for (const row of rows) {
    const rawCategory = row[categoryColumn]
    if (rawCategory == null) continue
    const category = String(rawCategory).trim()
    if (!category) continue

    if (valueColumn) {
      const value = parseNumericValue(row[valueColumn])
      if (value != null) {
        grouped.set(category, (grouped.get(category) ?? 0) + value)
        continue
      }
    }

    grouped.set(category, (grouped.get(category) ?? 0) + 1)
  }

  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({
      label,
      value: formatCompactNumber(value),
      note: valueColumn ? `summed ${valueColumn}` : 'row count',
    }))
}

function getTrendSummary(
  source: ClientUploadSourcePart,
  rows: UploadRawRow[],
  distribution: EdaDistributionSummary | null
): EdaTrendSummary | null {
  const dateColumn = source.triage.date_column
  const valueColumn = distribution?.column ?? source.triage.value_column
  if (!dateColumn || !valueColumn) return null

  const series = rows
    .map((row) => {
      const timeValue = parseDateValue(row[dateColumn])
      const numericValue = parseNumericValue(row[valueColumn])
      if (timeValue == null || numericValue == null) return null
      return {
        label: String(row[dateColumn]),
        timeValue,
        numericValue,
      }
    })
    .filter((point): point is { label: string; timeValue: number; numericValue: number } => Boolean(point))
    .sort((a, b) => a.timeValue - b.timeValue)

  if (series.length < 2) return null

  const start = series[0]
  const end = series.at(-1)!
  const deltas = series.slice(1).map((point, index) => point.numericValue - series[index].numericValue)
  const delta = end.numericValue - start.numericValue
  const pctChange = start.numericValue !== 0 ? (delta / start.numericValue) * 100 : null

  return {
    dateColumn,
    valueColumn,
    pointCount: series.length,
    startLabel: start.label,
    endLabel: end.label,
    startValue: start.numericValue,
    endValue: end.numericValue,
    delta,
    pctChange,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    volatility: stddev(deltas),
  }
}

function getSparseColumns(rows: UploadRawRow[], headers: string[]): string[] {
  const sparse: string[] = []
  for (const header of headers) {
    const emptyCount = rows.reduce((count, row) => {
      const value = row[header]
      return String(value ?? '').trim().length === 0 ? count + 1 : count
    }, 0)
    const missingRate = rows.length === 0 ? 0 : emptyCount / rows.length
    if (missingRate >= 0.5) sparse.push(`${header} (${Math.round(missingRate * 100)}% empty)`)
  }
  return sparse.slice(0, 6)
}

function getInconsistentDateColumns(rows: UploadRawRow[], headers: string[]): string[] {
  const out: string[] = []
  for (const header of headers) {
    const sample = rows.map((row) => row[header]).filter((value) => String(value ?? '').trim().length > 0)
    if (sample.length < 3) continue
    const parseable = sample.filter((value) => parseDateValue(value) != null).length
    if (parseable > 0 && parseable < sample.length) out.push(header)
  }
  return out.slice(0, 4)
}

function getInvalidGeographyRows(source: ClientUploadSourcePart, rows: UploadRawRow[]): number {
  const mappings = source.triage.recommended_field_mappings
  return rows.reduce((count, row) => {
    const zip = mappings.zip ? String(row[mappings.zip] ?? '').trim() : ''
    const lat = mappings.latitude ? parseNumericValue(row[mappings.latitude]) : null
    const lng = mappings.longitude ? parseNumericValue(row[mappings.longitude]) : null

    const invalidZip = zip.length > 0 && !/^\d{5}(?:-\d{4})?$/.test(zip)
    const invalidLat = lat != null && Math.abs(lat) > 90
    const invalidLng = lng != null && Math.abs(lng) > 180
    return invalidZip || invalidLat || invalidLng ? count + 1 : count
  }, 0)
}

function getDataQualitySummary(
  source: ClientUploadSourcePart,
  rows: UploadRawRow[],
  headers: string[]
): EdaDataQualitySummary {
  const normalizedRows = rows.map((row) => JSON.stringify(row))
  const uniqueRows = new Set(normalizedRows)
  const duplicateRows = normalizedRows.length - uniqueRows.size
  const inconsistentDateColumns = getInconsistentDateColumns(rows, headers)
  const invalidGeographyRows = getInvalidGeographyRows(source, rows)
  const sparseColumns = getSparseColumns(rows, headers)
  const warnings = [...source.triage.warnings]

  if (duplicateRows > 0) warnings.push(`${duplicateRows} sampled rows appear duplicated.`)
  if (invalidGeographyRows > 0) warnings.push(`${invalidGeographyRows} sampled rows have invalid geography values.`)

  return {
    duplicateRows,
    sparseColumns,
    inconsistentDateColumns,
    invalidGeographyRows,
    warnings: warnings.slice(0, 8),
  }
}

function buildDatasetSummaryStats(
  source: ClientUploadSourcePart,
  headers: string[],
  rows: UploadRawRow[],
  distribution: EdaDistributionSummary | null
): EdaEvidenceStat[] {
  return [
    {
      label: 'Rows',
      value: source.rowsIngested.toLocaleString(),
      note: `${headers.length} columns`,
    },
    {
      label: 'Rendering',
      value: source.visualizationMode ?? (source.mapPinsActive ? 'map' : 'table'),
      note: source.triage.mapability_classification.replace(/_/g, ' '),
    },
    {
      label: 'Mapped rows',
      value: source.markerCount.toLocaleString(),
      note: source.mapPinsActive ? 'active on map' : 'not mapped',
    },
    {
      label: 'Primary metric',
      value: source.triage.metric_name,
      note:
        distribution != null
          ? `median ${formatCompactNumber(distribution.median)}`
          : `${rows.length.toLocaleString()} sampled rows available`,
    },
  ]
}

export function buildUploadedDatasetEdaProfile(source: ClientUploadSourcePart): UploadedDatasetEdaProfile {
  const rows = getSourceRows(source)
  const headers = getSourceHeaders(source, rows)
  const primaryDistribution = getPrimaryDistribution(source, rows, headers)
  const outliers = getOutliers(source, rows, primaryDistribution)
  const trend = getTrendSummary(source, rows, primaryDistribution)
  const topCategories = getTopCategories(source, rows)
  const dataQuality = getDataQualitySummary(source, rows, headers)
  const summaryStats = buildDatasetSummaryStats(source, headers, rows, primaryDistribution)

  return {
    fileName: source.fileName,
    datasetType: source.triage.inferred_dataset_type,
    mapabilityClassification: source.triage.mapability_classification,
    visualizationMode: source.visualizationMode ?? (source.mapPinsActive ? 'map' : 'table'),
    rowCount: source.rowsIngested,
    sampleRowCount: rows.length,
    columnCount: headers.length,
    headers,
    focusMetric: source.triage.value_column ?? source.triage.metric_name ?? null,
    geoField: source.triage.geo_column,
    dateField: source.triage.date_column,
    categoryField: getCandidateCategoryColumn(source, headers),
    summaryStats,
    primaryDistribution,
    outliers,
    topCategories,
    trend,
    dataQuality,
    explanation: source.triage.explanation,
    warnings: source.triage.warnings,
  }
}

function buildMarketMetric(
  key: MetricKey,
  value: number | null | undefined,
  formattedValue: string,
  note?: string | null
): MarketMetricEdaProfile {
  return {
    key,
    label: METRIC_DEFINITIONS[key].label,
    value: value ?? null,
    formattedValue,
    note: note ?? METRIC_DEFINITIONS[key].short,
    source: METRIC_DEFINITIONS[key].source,
  }
}

export function buildMarketSnapshotEdaProfile(input: MarketSnapshotInput): MarketSnapshotEdaProfile | null {
  const metrics: MarketMetricEdaProfile[] = []
  const notableFlags: string[] = []

  if (input.zori != null) {
    const note = input.zoriGrowth != null ? `${formatPercent(input.zoriGrowth)} YoY` : null
    metrics.push(buildMarketMetric('zori', input.zori, `$${formatCompactNumber(input.zori)}`, note))
    if ((input.zoriGrowth ?? 0) > 0) notableFlags.push(`Rent is up ${formatPercent(input.zoriGrowth)} YoY.`)
  }
  if (input.zhvi != null) {
    const note = input.zhviGrowth != null ? `${formatPercent(input.zhviGrowth)} YoY` : null
    metrics.push(buildMarketMetric('zhvi', input.zhvi, `$${formatCompactNumber(input.zhvi)}`, note))
    if ((input.zhviGrowth ?? 0) < 0) notableFlags.push(`Home values are down ${formatPercent(Math.abs(input.zhviGrowth ?? 0))} YoY.`)
  }
  if (input.vacancyRate != null) {
    metrics.push(buildMarketMetric('vacancy', input.vacancyRate, formatPercent(input.vacancyRate)))
  }
  if (input.dozPending != null) {
    metrics.push(buildMarketMetric('dozPending', input.dozPending, `${formatCompactNumber(input.dozPending)} days`))
  }
  if (input.priceCuts != null) {
    metrics.push(buildMarketMetric('priceCuts', input.priceCuts, formatPercent(input.priceCuts)))
  }
  if (input.inventory != null) {
    metrics.push(buildMarketMetric('inventory', input.inventory, formatCompactNumber(input.inventory)))
  }
  if (input.transitStops != null) {
    metrics.push(buildMarketMetric('transit', input.transitStops, formatCompactNumber(input.transitStops)))
  }
  if (input.population != null) {
    metrics.push(buildMarketMetric('population', input.population, formatCompactNumber(input.population)))
  }

  if (metrics.length === 0) return null

  return {
    label: input.label ?? null,
    metrics,
    notableFlags,
  }
}

export function buildWorkspaceEdaContext(params: {
  market: MarketSnapshotEdaProfile | null
  uploadedDatasets: UploadedDatasetEdaProfile[]
}): WorkspaceEdaContext {
  const notes: string[] = []

  for (const dataset of params.uploadedDatasets) {
    if (dataset.rowCount > dataset.sampleRowCount) {
      notes.push(
        `${dataset.fileName ?? 'Imported dataset'} uses ${dataset.sampleRowCount.toLocaleString()} sampled rows for EDA details out of ${dataset.rowCount.toLocaleString()} imported rows.`
      )
    }
  }

  let focus: WorkspaceEdaContext['focus'] = 'empty'
  if (params.market && params.uploadedDatasets.length > 0) focus = 'mixed'
  else if (params.uploadedDatasets.length > 0) focus = 'uploaded_dataset'
  else if (params.market) focus = 'market'

  return {
    focus,
    market: params.market,
    uploadedDatasets: params.uploadedDatasets,
    uploadedDatasetCount: params.uploadedDatasets.length,
    notes,
  }
}
