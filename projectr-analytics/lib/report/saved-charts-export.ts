import { isScoutChartOutput, normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'

export interface SavedChartPdfRecord {
  id: string
  prompt: string
  marketLabel?: string | null
  savedAt: string
  chart: ScoutChartOutput
}

export interface SavedChartsPdfPayload {
  title: string
  notes: string
  generatedAt: string
  charts: SavedChartPdfRecord[]
}

const TITLE_MAX = 120
const NOTES_MAX = 4000
const CHART_COUNT_MAX = 12

function clampString(value: string, max: number): string {
  return value.trim().slice(0, max)
}

function normalizeSavedChartPdfRecord(value: unknown): SavedChartPdfRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<SavedChartPdfRecord> & { chart?: unknown }
  if (
    typeof record.id !== 'string' ||
    typeof record.prompt !== 'string' ||
    typeof record.savedAt !== 'string' ||
    !isScoutChartOutput(record.chart)
  ) {
    return null
  }

  return {
    id: record.id,
    prompt: clampString(record.prompt, 240),
    marketLabel: typeof record.marketLabel === 'string' ? clampString(record.marketLabel, 160) : null,
    savedAt: record.savedAt,
    chart: normalizeScoutChartOutput(record.chart),
  }
}

export function normalizeSavedChartsPdfPayload(value: unknown): SavedChartsPdfPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Partial<SavedChartsPdfPayload>
  if (typeof body.title !== 'string' || typeof body.notes !== 'string' || typeof body.generatedAt !== 'string') {
    return null
  }
  if (!Array.isArray(body.charts) || body.charts.length === 0 || body.charts.length > CHART_COUNT_MAX) {
    return null
  }

  const charts = body.charts.flatMap((chart) => {
    const normalized = normalizeSavedChartPdfRecord(chart)
    return normalized ? [normalized] : []
  })
  if (charts.length !== body.charts.length) return null

  const title = clampString(body.title, TITLE_MAX)
  if (!title) return null

  return {
    title,
    notes: clampString(body.notes, NOTES_MAX),
    generatedAt: body.generatedAt,
    charts,
  }
}
