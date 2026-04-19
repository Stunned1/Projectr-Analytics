import type { AgentInternalEvidenceResult } from '@/lib/agent-internal-grounding'
import type { AgentInternalProvenanceQuery } from '@/lib/agent-types'
import type { ScoutChartCitation } from '@/lib/scout-chart-output'
import {
  callVertexAiGenerateContent,
  isVertexAiConfigured,
  type VertexAiGenerateContentResponse,
} from '@/lib/vertex-ai-client'

type VertexSearchDependencies = {
  callGenerateContent?: (body: Record<string, unknown>) => Promise<VertexAiGenerateContentResponse>
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function metricPrompt(metric: AgentInternalProvenanceQuery['metric']): string {
  if (metric === 'rent') return 'rent history'
  if (metric === 'unemployment_rate') return 'unemployment history'
  if (metric === 'permit_units') return 'permit activity'
  return 'market evidence'
}

function buildVertexSearchPrompt(query: AgentInternalProvenanceQuery): string {
  const subjectLabel = trimText(query.subject?.label) || 'the requested market'
  const metricLabel = metricPrompt(query.metric)
  const taskLabel = trimText(query.taskType) || 'analytical support'
  return [
    `Find internal Scout evidence for ${metricLabel} in ${subjectLabel}.`,
    `Task context: ${taskLabel}.`,
    'Return grounded supporting context from internal Projectr data only.',
  ].join(' ')
}

function chunkToCitation(chunk: NonNullable<VertexAiGenerateContentResponse['candidates']>[number]['groundingMetadata'] extends infer Meta
  ? Meta extends { groundingChunks?: infer Chunks }
    ? Chunks extends Array<infer Chunk>
      ? Chunk
      : never
    : never
  : never, subjectLabel: string, index: number): ScoutChartCitation | null {
  const context = chunk?.retrievedContext
  const id = `vertex_search:${subjectLabel}:${index}`
  const label = trimText(context?.title) || 'Vertex AI Search result'
  const uri = trimText(context?.uri)
  if (!uri && !label) return null

  return {
    id,
    label,
    sourceType: 'internal_dataset',
    scope: subjectLabel,
    note: uri ? `Vertex AI Search grounded result: ${uri}` : 'Vertex AI Search grounded result.',
    periodLabel: 'Current Vertex AI Search grounding result',
  }
}

export async function retrieveVertexSearchInternalEvidence(
  query: AgentInternalProvenanceQuery,
  dependencies: VertexSearchDependencies = {}
): Promise<AgentInternalEvidenceResult> {
  if (!isVertexAiConfigured()) {
    return {
      query,
      records: [],
      citations: [],
    }
  }

  const callGenerateContent = dependencies.callGenerateContent ?? callVertexAiGenerateContent
  const datastore = trimText(process.env.VERTEX_AI_SEARCH_DATASTORE)
  if (!datastore) {
    return {
      query,
      records: [],
      citations: [],
    }
  }

  const response = await callGenerateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: buildVertexSearchPrompt(query) }],
      },
    ],
    tools: [
      {
        retrieval: {
          vertexAiSearch: {
            datastore,
          },
        },
      },
    ],
  })

  const subjectLabel = trimText(query.subject?.label) || 'workspace'
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  const citations = chunks
    .map((chunk, index) => chunkToCitation(chunk, subjectLabel, index))
    .filter((citation): citation is ScoutChartCitation => citation !== null)

  return {
    query,
    records: citations.map((citation) => ({
      id: citation.id,
      label: citation.label,
      sourceType: 'internal_dataset',
      scope: citation.scope,
      note: citation.note,
      periodLabel: citation.periodLabel,
    })),
    citations,
  }
}
