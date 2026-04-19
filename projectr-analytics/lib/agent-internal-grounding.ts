import type {
  AgentHistoryMetric,
  AgentHistorySubject,
  AgentInternalProvenanceQuery,
  AgentInternalProvenanceRecord,
  AgentInternalProvenanceSourceType,
} from '@/lib/agent-types'
import type { ScoutChartCitation } from '@/lib/scout-chart-output'
import { retrieveVertexSearchInternalEvidence } from '@/lib/agent-vertex-search-grounding'

export interface AgentInternalEvidenceResult {
  query: AgentInternalProvenanceQuery
  records: AgentInternalProvenanceRecord[]
  citations: ScoutChartCitation[]
}

type InternalEvidenceDependencies = {
  retrieveManagedEvidence?: (query: AgentInternalProvenanceQuery) => Promise<AgentInternalEvidenceResult>
}

type InternalSourceDescriptor = {
  sourceId: string
  label: string
  sourceType: AgentInternalProvenanceSourceType
  metrics: readonly AgentHistoryMetric[]
  subjectKinds: readonly AgentHistorySubject['kind'][]
  note: string
  periodLabel: string
}

const CURATED_INTERNAL_SOURCES: readonly InternalSourceDescriptor[] = [
  {
    sourceId: 'texas_permits:warehouse',
    label: 'TREC Building Permits',
    sourceType: 'internal_dataset',
    metrics: ['permit_units'],
    subjectKinds: ['county', 'metro'],
    note: 'Texas permit history served from the specialized BigQuery texas_permits warehouse.',
    periodLabel: 'Historical Texas permit warehouse',
  },
  {
    sourceId: 'projectr_master_data:texas-permits',
    label: 'Census BPS / Projectr master data',
    sourceType: 'internal_dataset',
    metrics: ['permit_units'],
    subjectKinds: ['county', 'metro'],
    note: 'County and metro permit activity normalized from Texas source adapters.',
    periodLabel: '2021-04-01 to 2025-04-01',
  },
  {
    sourceId: 'projectr_master_data:zillow-zori',
    label: 'Zillow Research',
    sourceType: 'internal_dataset',
    metrics: ['rent'],
    subjectKinds: ['zip'],
    note: 'Monthly ZIP rent series normalized from Zillow Research.',
    periodLabel: 'Monthly ZIP history',
  },
  {
    sourceId: 'projectr_master_data:fred-unemployment',
    label: 'FRED / Projectr master data',
    sourceType: 'internal_dataset',
    metrics: ['unemployment_rate'],
    subjectKinds: ['county', 'metro'],
    note: 'Monthly county and metro unemployment series normalized from FRED.',
    periodLabel: 'Monthly history',
  },
  {
    sourceId: 'projectr_upload:current-session',
    label: 'Client upload session',
    sourceType: 'workspace_upload',
    metrics: ['rent', 'permit_units', 'unemployment_rate'],
    subjectKinds: ['zip', 'county', 'metro'],
    note: 'Current workspace upload provenance from the active session.',
    periodLabel: 'Current upload session',
  },
]

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSubject(subject: AgentInternalProvenanceQuery['subject']): AgentInternalProvenanceQuery['subject'] {
  if (!subject) {
    return null
  }

  const id = trimText(subject.id)
  const label = trimText(subject.label) || id

  return {
    kind: subject.kind,
    id,
    label,
  }
}

function normalizeQuery(query: AgentInternalProvenanceQuery): AgentInternalProvenanceQuery {
  const sourceIds = (query.sourceIds ?? [])
    .map((sourceId) => trimText(sourceId))
    .filter((sourceId) => sourceId.length > 0)

  return {
    taskType: query.taskType,
    metric: query.metric,
    subject: normalizeSubject(query.subject),
    ...(query.sourceIds !== undefined ? { sourceIds: Array.from(new Set(sourceIds)) } : {}),
  }
}

function matchesSourceIdFilter(descriptor: InternalSourceDescriptor, sourceIds: readonly string[]): boolean {
  if (sourceIds.length === 0) {
    return descriptor.sourceType !== 'workspace_upload'
  }

  return sourceIds.some((sourceId) =>
    sourceId === descriptor.sourceId || sourceId.startsWith(`${descriptor.sourceId}:`)
  )
}

function matchesMetricFilter(descriptor: InternalSourceDescriptor, metric: AgentHistoryMetric | null): boolean {
  if (metric == null) {
    return true
  }

  return descriptor.metrics.includes(metric)
}

function matchesSubjectFilter(
  descriptor: InternalSourceDescriptor,
  subject: AgentInternalProvenanceQuery['subject']
): boolean {
  if (!subject) {
    return true
  }

  return descriptor.subjectKinds.includes(subject.kind)
}

function buildRecordId(descriptor: InternalSourceDescriptor, subject: AgentInternalProvenanceQuery['subject']): string {
  if (!subject) {
    return descriptor.sourceId
  }

  return `${descriptor.sourceId}:${subject.kind}:${trimText(subject.id) || 'unknown'}`
}

function buildRecord(
  descriptor: InternalSourceDescriptor,
  subject: AgentInternalProvenanceQuery['subject']
): AgentInternalProvenanceRecord {
  const normalizedSubject = subject ? normalizeSubject(subject) : null
  const scope = normalizedSubject?.label ?? null

  return {
    id: buildRecordId(descriptor, normalizedSubject),
    label: descriptor.label,
    sourceType: descriptor.sourceType,
    scope,
    note: descriptor.note,
    periodLabel: descriptor.periodLabel,
  }
}

function recordToCitation(record: AgentInternalProvenanceRecord): ScoutChartCitation {
  return {
    id: record.id,
    label: record.label,
    sourceType: record.sourceType,
    scope: record.scope ?? null,
    note: record.note ?? null,
    periodLabel: record.periodLabel ?? null,
  }
}

function compareRecords(a: AgentInternalProvenanceRecord, b: AgentInternalProvenanceRecord): number {
  const sourceCompare = a.id.localeCompare(b.id)
  if (sourceCompare !== 0) {
    return sourceCompare
  }

  return (a.periodLabel ?? '').localeCompare(b.periodLabel ?? '')
}

export async function retrieveInternalEvidence(
  query: AgentInternalProvenanceQuery,
  dependencies: InternalEvidenceDependencies = {}
): Promise<AgentInternalEvidenceResult> {
  const normalizedQuery = normalizeQuery(query)
  const sourceIds = normalizedQuery.sourceIds ?? []

  const records = CURATED_INTERNAL_SOURCES
    .filter((descriptor) => matchesSourceIdFilter(descriptor, sourceIds))
    .filter((descriptor) => matchesMetricFilter(descriptor, normalizedQuery.metric))
    .filter((descriptor) => matchesSubjectFilter(descriptor, normalizedQuery.subject))
    .map((descriptor) => buildRecord(descriptor, normalizedQuery.subject))
    .sort(compareRecords)

  const localResult = {
    query: normalizedQuery,
    records,
    citations: records.map(recordToCitation),
  }

  const retrieveManagedEvidence = dependencies.retrieveManagedEvidence ?? retrieveVertexSearchInternalEvidence

  try {
    const managed = await retrieveManagedEvidence(normalizedQuery)
    if (managed.citations.length === 0 && managed.records.length === 0) {
      return localResult
    }

    const deduped = new Map<string, AgentInternalProvenanceRecord>()
    for (const record of [...localResult.records, ...managed.records]) {
      if (!trimText(record.id)) continue
      deduped.set(record.id, record)
    }

    const citations = new Map<string, ScoutChartCitation>()
    for (const citation of [...localResult.citations, ...managed.citations]) {
      if (!trimText(citation.id)) continue
      citations.set(citation.id, citation)
    }

    return {
      query: normalizedQuery,
      records: Array.from(deduped.values()).sort(compareRecords),
      citations: Array.from(citations.values()).sort((a, b) => a.id.localeCompare(b.id)),
    }
  } catch {
    return localResult
  }
}
