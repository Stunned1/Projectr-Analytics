import type {
  AgentHistorySubject,
  AgentPublicMacroEvidenceResult,
  AgentPublicMacroMetric,
  AgentPublicMacroQuery,
  AgentPublicMacroRecord,
  AgentPublicMacroValue,
} from '@/lib/agent-types'
import type { ScoutChartCitation } from '@/lib/scout-chart-output'
import type { MasterDataRow } from '@/lib/data/types'
import { retrievePublicMacroSearchEvidence } from '@/lib/agent-public-search-grounding'

type PublicMacroFetcher = (subject: AgentHistorySubject) => Promise<MasterDataRow[]>

type PublicMacroDependencies = {
  fetchRowsForSubject?: PublicMacroFetcher
  retrieveSearchGrounding?: (query: AgentPublicMacroQuery) => Promise<AgentPublicMacroEvidenceResult>
}

type SupportedSubjectKind = AgentHistorySubject['kind']

type MetricDescriptor = {
  metric: AgentPublicMacroMetric
  label: string
  sourceLabel: string
  note: string
  resolveValue: (rows: MasterDataRow[]) => number | null
  resolvePeriodLabel: (rows: MasterDataRow[]) => string | null
  formatValue: (value: number) => string
}

const ACS_SOURCE_LABEL = 'U.S. Census Bureau ACS 5-year estimate'

const METRIC_DESCRIPTORS: Record<AgentPublicMacroMetric, MetricDescriptor> = {
  population: {
    metric: 'population',
    label: 'Population',
    sourceLabel: ACS_SOURCE_LABEL,
    note: 'Pulled from cached ACS public-data rows in Scout.',
    resolveValue: (rows) => latestMetricValue(rows, ['Total_Population', 'Projected_Total_Population']),
    resolvePeriodLabel: (rows) => latestPeriodLabel(rows, ['Total_Population', 'Projected_Total_Population']),
    formatValue: (value) =>
      new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0,
      }).format(value),
  },
  'median household income': {
    metric: 'median household income',
    label: 'Median household income',
    sourceLabel: ACS_SOURCE_LABEL,
    note: 'Pulled from cached ACS public-data rows in Scout.',
    resolveValue: (rows) => latestMetricValue(rows, ['Median_Household_Income']),
    resolvePeriodLabel: (rows) => latestPeriodLabel(rows, ['Median_Household_Income']),
    formatValue: (value) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value),
  },
  'housing cost burden': {
    metric: 'housing cost burden',
    label: 'Housing cost burden',
    sourceLabel: ACS_SOURCE_LABEL,
    note: 'Derived from cached ACS public-data rows in Scout using median gross rent times 12 divided by median household income.',
    resolveValue: (rows) => {
      const annualRent = latestCommonMetricValue(rows, 'Median_Gross_Rent', 'Median_Household_Income', 'left')
      const income = latestCommonMetricValue(rows, 'Median_Gross_Rent', 'Median_Household_Income', 'right')
      if (annualRent == null || income == null || income <= 0) return null
      return Number((((annualRent * 12) / income) * 100).toFixed(1))
    },
    resolvePeriodLabel: (rows) => latestSharedPeriodLabel(rows, 'Median_Gross_Rent', 'Median_Household_Income'),
    formatValue: (value) => `${value.toFixed(1)}%`,
  },
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeMetric(metric: AgentPublicMacroQuery['metric']): AgentPublicMacroMetric {
  const normalized = trimText(metric).replace(/\s+/g, ' ').toLowerCase() as AgentPublicMacroMetric
  if (!(normalized in METRIC_DESCRIPTORS)) {
    throw new Error(`Unsupported public macro metric: ${trimText(metric) || String(metric)}`)
  }
  return normalized
}

function isSupportedSubjectKind(value: unknown): value is SupportedSubjectKind {
  return value === 'zip' || value === 'county' || value === 'metro'
}

function isTexasZipId(id: string): boolean {
  const digits = id.replace(/^zip:/i, '').trim()
  if (!/^\d{5}$/.test(digits)) return false
  const prefix = Number.parseInt(digits.slice(0, 2), 10)
  return prefix >= 75 && prefix <= 79
}

function looksTexasScoped(subject: AgentHistorySubject): boolean {
  const id = subject.id.trim()

  if (subject.kind === 'zip') {
    return isTexasZipId(id)
  }

  return /(^|:)TX(:|$)/i.test(id)
}

function normalizeSubject(subject: AgentPublicMacroQuery['subject']): AgentHistorySubject {
  if (!subject) {
    throw new Error('Public macro grounding requires a resolved subject.')
  }

  if (!isSupportedSubjectKind(subject.kind)) {
    throw new Error(`Unsupported public macro subject kind: ${String(subject.kind)}`)
  }

  const id = trimText(subject.id)
  const label = trimText(subject.label) || id
  if (!id || !label) {
    throw new Error('Public macro grounding requires a resolved subject.')
  }

  const normalized = {
    kind: subject.kind,
    id,
    label,
  } satisfies AgentHistorySubject

  if (!looksTexasScoped(normalized)) {
    throw new Error('Public macro grounding is currently limited to Texas ZIP, county, and metro subjects.')
  }

  return normalized
}

function normalizeTimeHint(timeHint: AgentPublicMacroQuery['timeHint']): string | null {
  const normalized = trimText(timeHint)
  return normalized.length > 0 ? normalized : null
}

async function defaultFetchRowsForSubject(subject: AgentHistorySubject): Promise<MasterDataRow[]> {
  const { fetchAreaRows, fetchLatestRowsForSubmarket } = await import('@/lib/data/postgres-master-data')

  if (subject.kind === 'zip') {
    return fetchLatestRowsForSubmarket(subject.id, {
      dataSource: 'Census ACS',
      metricName: ['Total_Population', 'Projected_Total_Population', 'Median_Household_Income', 'Median_Gross_Rent'],
    })
  }

  return fetchAreaRows(subject.id, {
    dataSource: 'Census ACS',
    metricName: ['Total_Population', 'Projected_Total_Population', 'Median_Household_Income', 'Median_Gross_Rent'],
  })
}

function latestMetricValue(rows: MasterDataRow[], metricNames: readonly string[]): number | null {
  const relevant = rows
    .filter((row) => metricNames.includes(row.metric_name) && row.metric_value != null)
    .sort((a, b) => {
      const timeCompare = (b.time_period ?? '').localeCompare(a.time_period ?? '')
      if (timeCompare !== 0) return timeCompare
      return b.created_at.localeCompare(a.created_at)
    })

  return relevant[0]?.metric_value ?? null
}

function latestPeriodLabel(rows: MasterDataRow[], metricNames: readonly string[]): string {
  const relevant = rows
    .filter((row) => metricNames.includes(row.metric_name))
    .sort((a, b) => {
      const timeCompare = (b.time_period ?? '').localeCompare(a.time_period ?? '')
      if (timeCompare !== 0) return timeCompare
      return b.created_at.localeCompare(a.created_at)
    })

  return relevant[0]?.time_period ?? 'Latest available ACS estimate'
}

function latestSharedPeriodLabel(rows: MasterDataRow[], leftMetric: string, rightMetric: string): string | null {
  const leftPeriods = new Set(
    rows.filter((row) => row.metric_name === leftMetric && row.metric_value != null).map((row) => row.time_period).filter(Boolean)
  )
  const sharedRows = rows
    .filter((row) => row.metric_name === rightMetric && row.metric_value != null && row.time_period && leftPeriods.has(row.time_period))
    .sort((a, b) => {
      const timeCompare = (b.time_period ?? '').localeCompare(a.time_period ?? '')
      if (timeCompare !== 0) return timeCompare
      return b.created_at.localeCompare(a.created_at)
    })

  return sharedRows[0]?.time_period ?? null
}

function latestCommonMetricValue(
  rows: MasterDataRow[],
  leftMetric: string,
  rightMetric: string,
  side: 'left' | 'right'
): number | null {
  const periodLabel = latestSharedPeriodLabel(rows, leftMetric, rightMetric)
  if (!periodLabel) return null

  const metricName = side === 'left' ? leftMetric : rightMetric
  const row = rows
    .filter((entry) => entry.metric_name === metricName && entry.time_period === periodLabel && entry.metric_value != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  return row?.metric_value ?? null
}

function buildRecord(
  descriptor: MetricDescriptor,
  subject: AgentHistorySubject,
  value: number,
  displayValue: string,
  periodLabel: string,
  note: string
): AgentPublicMacroRecord {
  return {
    id: `public_macro:${descriptor.metric}:${subject.kind}:${subject.id}`,
    metric: descriptor.metric,
    label: descriptor.sourceLabel,
    value,
    displayValue,
    sourceType: 'public_dataset',
    scope: subject.label,
    note,
    periodLabel,
  }
}

function recordToCitation(record: AgentPublicMacroRecord): ScoutChartCitation {
  return {
    id: record.id,
    label: record.label,
    sourceType: record.sourceType,
    scope: record.scope ?? null,
    note: record.note ?? null,
    periodLabel: record.periodLabel ?? null,
  }
}

export async function retrievePublicMacroEvidence(
  query: AgentPublicMacroQuery,
  dependencies: PublicMacroDependencies = {}
): Promise<AgentPublicMacroEvidenceResult> {
  const retrieveSearchGrounding = dependencies.retrieveSearchGrounding ?? retrievePublicMacroSearchEvidence
  try {
    return await retrieveSearchGrounding(query)
  } catch {
    // Fall back to the cached Scout public-data path when managed Google Search grounding
    // is unavailable or returns no usable result.
  }

  const metric = normalizeMetric(query.metric)
  const subject = normalizeSubject(query.subject)
  const timeHint = normalizeTimeHint(query.timeHint)
  const descriptor = METRIC_DESCRIPTORS[metric]
  const fetchRowsForSubject = dependencies.fetchRowsForSubject ?? defaultFetchRowsForSubject
  const rows = await fetchRowsForSubject(subject)
  const periodLabel = descriptor.resolvePeriodLabel(rows)
  if (!periodLabel) {
    throw new Error(`No aligned public macro period found for ${descriptor.label.toLowerCase()} in ${subject.label}.`)
  }
  const value = descriptor.resolveValue(rows)

  if (value == null) {
    throw new Error(`No public macro data found for ${descriptor.label.toLowerCase()} in ${subject.label}.`)
  }
  const displayValue = descriptor.formatValue(value)
  const note = timeHint ? `${descriptor.note} Requested time hint: ${timeHint}.` : descriptor.note
  const valuePayload: AgentPublicMacroValue = {
    metric,
    label: descriptor.label,
    value,
    displayValue,
    scope: subject.label,
    periodLabel,
    note,
    sourceType: 'public_dataset',
  }
  const records = [buildRecord(descriptor, subject, value, displayValue, periodLabel, note)]

  return {
    query: {
      metric,
      subject,
      ...(timeHint ? { timeHint } : {}),
    },
    value: valuePayload,
    records,
    citations: records.map(recordToCitation),
  }
}
