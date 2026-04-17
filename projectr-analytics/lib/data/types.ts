export type VisualBucket = 'POLYGON' | 'MARKER' | 'HEATMAP' | 'TIME_SERIES' | 'TABULAR'

// Market-data router reads only need the columns returned by projectr_master_data queries.
export interface MasterDataRow {
  submarket_id: string | null
  metric_name: string
  metric_value: number | null
  time_period: string | null
  data_source: string
  visual_bucket: VisualBucket
  created_at: string
}

const DEFAULT_WARM_RETENTION_MONTHS = 12
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const LEADING_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/
const SHORT_OFFSET_PATTERN = /([+-]\d{2})(?!:)(\s*)$/

export function normalizeBigQueryDateLike(value: unknown): string | null {
  if (value == null) return null

  if (typeof value === 'object' && 'value' in value) {
    return normalizeBigQueryDateLike((value as { value: unknown }).value)
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }

  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    if (ISO_DATE_PATTERN.test(trimmed)) return trimmed
    const leadingDate = trimmed.match(LEADING_DATE_PATTERN)?.[1]
    if (leadingDate) return leadingDate

    const withTimeSeparator = trimmed.includes(' ') && !trimmed.includes('T')
      ? trimmed.replace(' ', 'T')
      : trimmed
    const normalized = withTimeSeparator.replace(SHORT_OFFSET_PATTERN, '$1:00')
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }

  return null
}

export function warmMonthsRetention(
  rawValue: string | undefined = process.env.MARKET_DATA_WARM_RETENTION_MONTHS
): number {
  if (!rawValue?.trim()) {
    return DEFAULT_WARM_RETENTION_MONTHS
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WARM_RETENTION_MONTHS
}
