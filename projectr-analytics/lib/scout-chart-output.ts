export type ScoutCitationSourceType =
  | 'internal_dataset'
  | 'public_dataset'
  | 'workspace_upload'
  | 'derived'
  | 'placeholder'

export interface ScoutChartCitation {
  id: string
  label: string
  sourceType: ScoutCitationSourceType
  scope?: string | null
  note?: string | null
  periodLabel?: string | null
  placeholder?: boolean
}

export interface ScoutChartPoint {
  x: string
  y: number
}

export interface ScoutChartSeries {
  key: string
  label: string
  color?: string | null
  points: ScoutChartPoint[]
}

export interface ScoutChartOutput {
  kind: 'line' | 'bar'
  title: string
  subtitle?: string | null
  summary?: string | null
  placeholder?: boolean
  confidenceLabel?: string | null
  xAxis: { key: string; label: string }
  yAxis: { label: string; valueFormat?: 'number' | 'currency' | 'percent' | 'index' }
  series: ScoutChartSeries[]
  citations: ScoutChartCitation[]
}

function isChartPoint(value: unknown): value is ScoutChartPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const point = value as Partial<ScoutChartPoint>
  return typeof point.x === 'string' && typeof point.y === 'number' && Number.isFinite(point.y)
}

function isChartSeries(value: unknown): value is ScoutChartSeries {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const series = value as Partial<ScoutChartSeries>
  return typeof series.key === 'string' && typeof series.label === 'string' && Array.isArray(series.points) && series.points.every(isChartPoint)
}

function isChartCitation(value: unknown): value is ScoutChartCitation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const citation = value as Partial<ScoutChartCitation>
  return (
    typeof citation.id === 'string' &&
    typeof citation.label === 'string' &&
    (
      citation.sourceType === 'internal_dataset' ||
      citation.sourceType === 'public_dataset' ||
      citation.sourceType === 'workspace_upload' ||
      citation.sourceType === 'derived' ||
      citation.sourceType === 'placeholder'
    )
  )
}

export function isScoutChartOutput(value: unknown): value is ScoutChartOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const chart = value as Partial<ScoutChartOutput>

  return (
    (chart.kind === 'line' || chart.kind === 'bar') &&
    typeof chart.title === 'string' &&
    Boolean(chart.xAxis && typeof chart.xAxis.key === 'string' && typeof chart.xAxis.label === 'string') &&
    Boolean(chart.yAxis && typeof chart.yAxis.label === 'string') &&
    Array.isArray(chart.series) &&
    chart.series.every(isChartSeries) &&
    Array.isArray(chart.citations) &&
    chart.citations.every(isChartCitation)
  )
}

export function normalizeScoutChartOutput(input: ScoutChartOutput): ScoutChartOutput {
  return {
    ...input,
    subtitle: input.subtitle ?? null,
    summary: input.summary ?? null,
    placeholder: input.placeholder === true,
    confidenceLabel: input.confidenceLabel ?? null,
    yAxis: {
      ...input.yAxis,
      valueFormat: input.yAxis.valueFormat ?? 'number',
    },
    series: input.series.map((series) => ({
      ...series,
      color: series.color ?? null,
    })),
    citations: input.citations.map((citation) => ({
      ...citation,
      scope: citation.scope ?? null,
      note: citation.note ?? null,
      periodLabel: citation.periodLabel ?? null,
      placeholder: citation.placeholder === true,
    })),
  }
}
