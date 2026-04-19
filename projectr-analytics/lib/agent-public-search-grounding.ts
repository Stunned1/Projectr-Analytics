import type {
  AgentPublicMacroEvidenceResult,
  AgentPublicMacroMetric,
  AgentPublicMacroQuery,
  AgentPublicMacroRecord,
  AgentPublicMacroValue,
} from '@/lib/agent-types'
import type { ScoutChartCitation } from '@/lib/scout-chart-output'
import {
  callVertexAiGenerateContent,
  extractVertexAiText,
  isVertexAiConfigured,
  type VertexAiGenerateContentResponse,
} from '@/lib/vertex-ai-client'

type PublicSearchDependencies = {
  callGenerateContent?: (body: Record<string, unknown>) => Promise<VertexAiGenerateContentResponse>
}

type PublicSearchJson = {
  label?: unknown
  value?: unknown
  displayValue?: unknown
  periodLabel?: unknown
  note?: unknown
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeMetric(metric: AgentPublicMacroMetric): string {
  return metric.replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildPublicMacroPrompt(query: AgentPublicMacroQuery): string {
  const subjectLabel = trimText(query.subject?.label) || 'the requested market'
  const metricLabel = normalizeMetric(query.metric)
  const timeHint = trimText(query.timeHint)
  const trustedSources = 'Prioritize Census, HUD, HUD User, Data Commons, and other official public statistical sources.'

  return [
    `Find the current public macro statistic for ${metricLabel} in ${subjectLabel}.`,
    trustedSources,
    'Return JSON only with keys: label, value, displayValue, periodLabel, note.',
    timeHint ? `Respect this time hint if the source supports it: ${timeHint}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function parseJson(text: string): PublicSearchJson {
  try {
    return JSON.parse(text) as PublicSearchJson
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      return JSON.parse(match[0]) as PublicSearchJson
    }
  }

  throw new Error('Google Search grounding did not return valid JSON.')
}

function chunkToCitation(
  chunk: NonNullable<VertexAiGenerateContentResponse['candidates']>[number]['groundingMetadata'] extends infer Meta
    ? Meta extends { groundingChunks?: infer Chunks }
      ? Chunks extends Array<infer Chunk>
        ? Chunk
        : never
      : never
    : never,
  scope: string,
  index: number
): ScoutChartCitation | null {
  const web = chunk?.web
  const uri = trimText(web?.uri)
  const label = trimText(web?.title) || trimText(web?.domain)
  if (!uri && !label) return null

  return {
    id: `google_search:${scope}:${index}`,
    label: label || 'Google Search grounding result',
    sourceType: 'public_dataset',
    scope,
    note: uri ? `Grounded with Google Search: ${uri}` : 'Grounded with Google Search.',
    periodLabel: 'Current Google Search grounding result',
  }
}

export async function retrievePublicMacroSearchEvidence(
  query: AgentPublicMacroQuery,
  dependencies: PublicSearchDependencies = {}
): Promise<AgentPublicMacroEvidenceResult> {
  const callGenerateContent = dependencies.callGenerateContent ?? callVertexAiGenerateContent
  if (dependencies.callGenerateContent == null && !isVertexAiConfigured()) {
    throw new Error('Vertex AI Google Search grounding is not configured.')
  }

  const subject = query.subject
  if (!subject) {
    throw new Error('Google Search public macro grounding requires a resolved subject.')
  }

  const response = await callGenerateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: buildPublicMacroPrompt(query) }],
      },
    ],
    tools: [
      {
        googleSearch: {},
      },
    ],
  })

  const text = extractVertexAiText(response)
  const parsed = parseJson(text)
  const numericValue = Number(parsed.value)
  if (!Number.isFinite(numericValue)) {
    throw new Error('Google Search public macro grounding returned an invalid numeric value.')
  }

  const scope = subject.label
  const label = trimText(parsed.label) || query.metric
  const displayValue = trimText(parsed.displayValue) || String(numericValue)
  const periodLabel = trimText(parsed.periodLabel) || 'Current public grounding result'
  const note = trimText(parsed.note) || 'Grounded with Gemini + Google Search.'
  const value: AgentPublicMacroValue = {
    metric: query.metric,
    label,
    value: numericValue,
    displayValue,
    scope,
    periodLabel,
    note,
    sourceType: 'public_dataset',
  }

  const citations = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .map((chunk, index) => chunkToCitation(chunk, scope, index))
    .filter((citation): citation is ScoutChartCitation => citation !== null)

  if (citations.length === 0) {
    throw new Error('Google Search public macro grounding returned no citations.')
  }

  const records: AgentPublicMacroRecord[] = citations.map((citation, index) => ({
    id: citation.id,
    metric: query.metric,
    label: index === 0 ? label : citation.label,
    value: numericValue,
    displayValue,
    sourceType: 'public_dataset',
    scope,
    note: citation.note,
    periodLabel,
  }))

  return {
    query,
    value,
    records,
    citations,
  }
}
