import type {
  AgentEvidenceStatus,
  AgentEvidenceValidationResult,
} from '@/lib/agent-types'
import type { ScoutCitationSourceType, ScoutChartCitation } from '@/lib/scout-chart-output'

export interface NormalizedAgentEvidence {
  status: AgentEvidenceStatus
  citations: ScoutChartCitation[]
}

type NormalizeAgentEvidenceArgs = {
  chartCitations: readonly (Partial<ScoutChartCitation> | null | undefined)[]
  traceCitations: readonly (Partial<ScoutChartCitation> | null | undefined)[]
  synthetic: boolean
}

function trimValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const allowedSourceTypes = new Set<ScoutCitationSourceType>([
  'internal_dataset',
  'public_dataset',
  'workspace_upload',
  'derived',
  'placeholder',
])

function isAllowedSourceType(value: string): value is ScoutCitationSourceType {
  return allowedSourceTypes.has(value as ScoutCitationSourceType)
}

function normalizeCitation(
  citation: Partial<ScoutChartCitation>
): ScoutChartCitation {
  const sourceType = trimValue(citation.sourceType)

  return {
    id: trimValue(citation.id),
    label: trimValue(citation.label),
    sourceType: isAllowedSourceType(sourceType) ? sourceType : 'placeholder',
    scope: trimValue(citation.scope) || null,
    note: trimValue(citation.note) || null,
    periodLabel: trimValue(citation.periodLabel) || null,
    placeholder: citation.placeholder === true,
  }
}

function isCitationIncomplete(
  citation: Partial<ScoutChartCitation> | null | undefined
): boolean {
  return (
    trimValue(citation?.id).length === 0 ||
    !isAllowedSourceType(trimValue(citation?.sourceType)) ||
    trimValue(citation?.label).length === 0 ||
    trimValue(citation?.periodLabel).length === 0
  )
}

export function normalizeAgentEvidence(
  args: NormalizeAgentEvidenceArgs
): NormalizedAgentEvidence {
  const rawCitations = [...args.chartCitations, ...args.traceCitations]
  const citations = rawCitations
    .filter((citation): citation is Partial<ScoutChartCitation> => Boolean(citation))
    .map(normalizeCitation)

  if (args.synthetic) {
    return { status: 'synthetic', citations }
  }

  if (citations.length === 0) {
    return { status: 'citation_missing', citations }
  }

  if (rawCitations.some(isCitationIncomplete)) {
    return { status: 'citation_incomplete', citations }
  }

  return { status: 'grounded', citations }
}

export function validateAgentEvidence(
  evidence: NormalizedAgentEvidence
): AgentEvidenceValidationResult {
  switch (evidence.status) {
    case 'grounded':
      return {
        status: 'grounded',
        userMessage: null,
        suppressGroundedChart: false,
      }
    case 'citation_incomplete':
      return {
        status: 'citation_incomplete',
        userMessage: 'Citation coverage is incomplete for this chart.',
        suppressGroundedChart: true,
      }
    case 'citation_missing':
      return {
        status: 'citation_missing',
        userMessage: 'No citation found for this result.',
        suppressGroundedChart: true,
      }
    case 'synthetic':
      return {
        status: 'synthetic',
        userMessage:
          'This result uses synthetic or sample data and is not being presented as grounded historical evidence.',
        suppressGroundedChart: true,
      }
  }
}
