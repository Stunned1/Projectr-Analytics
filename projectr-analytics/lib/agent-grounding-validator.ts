import { normalizeAgentEvidence, validateAgentEvidence, type NormalizedAgentEvidence } from '@/lib/agent-evidence'
import type { AgentEvidenceValidationResult, AgentTrace, EdaTaskType } from '@/lib/agent-types'
import type { ScoutChartCitation, ScoutChartOutput } from '@/lib/scout-chart-output'
import { checkGroundingCandidate, isCheckGroundingConfigured, type CheckGroundingResult } from '@/lib/agent-check-grounding'

type AgentGroundingPayload = {
  message: string
  trace: AgentTrace
  chart?: ScoutChartOutput | null
  synthetic: boolean
}

export type AgentGroundingValidation = {
  normalizedEvidence: NormalizedAgentEvidence
  validation: AgentEvidenceValidationResult
  requiresEvidence: boolean
}

type AsyncGroundingDependencies = {
  checkGrounding?: (answerCandidate: string, facts: Array<{ factText: string; attributes?: Record<string, string> }>, citationThreshold?: number) => Promise<CheckGroundingResult>
}

const GROUNDING_SENSITIVE_TASKS = new Set<EdaTaskType>([
  'compare_segments',
  'compare_geographies',
  'compare_periods',
  'spot_trends',
  'explain_metric',
])

const QUANTITATIVE_MESSAGE_PATTERN =
  /\$[\d,]+|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?|mi|miles?)\b|\b-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}\b/

function hasQuantitativeGroundedClaim(message: string): boolean {
  return QUANTITATIVE_MESSAGE_PATTERN.test(message)
}

function shouldRequireEvidence(message: string, trace: AgentTrace, chart: ScoutChartOutput | null | undefined): boolean {
  if (chart) return true
  if (!trace.taskType || !GROUNDING_SENSITIVE_TASKS.has(trace.taskType)) return false
  return hasQuantitativeGroundedClaim(message)
}

export function validateAgentGroundingPayload(payload: AgentGroundingPayload): AgentGroundingValidation {
  const citations: readonly (Partial<ScoutChartCitation> | null | undefined)[] =
    payload.chart?.citations?.length ? payload.chart.citations : (payload.trace.citations ?? [])
  const requiresEvidence = shouldRequireEvidence(payload.message, payload.trace, payload.chart)

  if (!requiresEvidence && citations.length === 0 && !payload.synthetic) {
    return {
      requiresEvidence,
      normalizedEvidence: {
        status: 'grounded',
        citations: [],
      },
      validation: {
        status: 'grounded',
        userMessage: null,
        suppressGroundedChart: false,
      },
    }
  }

  const normalizedEvidence = normalizeAgentEvidence({
    chartCitations: citations,
    traceCitations: [],
    synthetic: payload.synthetic,
  })

  return {
    requiresEvidence,
    normalizedEvidence,
    validation: validateAgentEvidence(normalizedEvidence),
  }
}

function buildFactsFromCitations(citations: readonly ScoutChartCitation[]): Array<{ factText: string; attributes?: Record<string, string> }> {
  return citations
    .filter((citation) => citation.label.trim().length > 0)
    .map((citation) => ({
      factText: [citation.label, citation.scope ?? '', citation.note ?? '', citation.periodLabel ?? '']
        .filter((value) => value.trim().length > 0)
        .join(' | '),
      attributes: {
        source: citation.label,
        ...(citation.scope ? { scope: citation.scope } : {}),
      },
    }))
}

export async function validateAgentGroundingPayloadWithService(
  payload: AgentGroundingPayload,
  dependencies: AsyncGroundingDependencies = {}
): Promise<AgentGroundingValidation> {
  const base = validateAgentGroundingPayload(payload)
  if (base.validation.status !== 'grounded' || !isCheckGroundingConfigured()) {
    return base
  }

  const facts = buildFactsFromCitations(base.normalizedEvidence.citations)
  if (facts.length === 0) {
    return base
  }

  const checkGrounding = dependencies.checkGrounding ?? checkGroundingCandidate

  try {
    const result = await checkGrounding(payload.message, facts, 0.6)
    const unsupportedClaim = result.claims.some(
      (claim) =>
        claim.groundingCheckRequired &&
        ((claim.supportScore ?? result.supportScore) < 0.6 || claim.citationIndices.length === 0)
    )

    if (!unsupportedClaim && result.supportScore >= 0.6) {
      return base
    }

    return {
      ...base,
      validation: {
        status: 'citation_incomplete',
        userMessage: 'Citation coverage is incomplete.',
        suppressGroundedChart: true,
      },
    }
  } catch {
    return base
  }
}
