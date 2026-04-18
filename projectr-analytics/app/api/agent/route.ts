/**
 * Scout EDA Assistant API
 * Returns a concise analyst-facing response grounded in the current market or imported dataset context.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { normalizeAgentTrace } from '@/lib/agent-trace'
import type { AgentAction, AgentStep, AgentTrace, MapContext } from '@/lib/agent-types'
import { classifyAgentRequestIntent, looksAnalyticalPrompt } from '@/lib/agent-intent'
import {
  humanizeLayerKey,
  inferDirectMapControl,
  MAP_CONTROL_LAYER_KEYS,
  normalizeMapSearchQuery,
} from '@/lib/agent-map-control'
import { buildEdaContextString, buildFallbackEdaResponse, inferEdaTaskType } from '@/lib/eda-assistant'
import { evaluateAgentRequestPolicy } from '@/lib/agent-request-policy'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are Scout's EDA Assistant.

PRODUCT BOUNDARY:
- Your job is exploratory data analysis for the currently loaded market context and imported datasets.
- You may summarize datasets, describe distributions, detect outliers, compare visible segments, compare loaded geographies when context supports it, explain trend changes, explain metrics, and flag data-quality issues.
- Every claim must be grounded in the provided workspace evidence.
- Keep responses short, high-signal, and analyst-friendly.

STRICT NON-GOALS:
- No investment advice, development strategy, site recommendations, or open-ended market theses.
- No autonomous workflow planning.
- No map control instructions, layer orchestration, parcel screening, or run_analysis behavior.
- If evidence is weak or context is missing, say so plainly.

OUTPUT CONTRACT:
Return valid JSON only:
{
  "message": "2-4 sentences, concise and evidence-backed",
  "trace": {
    "summary": "one-line description of the EDA task",
    "taskType": "summarize_dataset|describe_distribution|detect_outliers|compare_segments|compare_geographies|compare_periods|spot_trends|check_data_quality|explain_metric",
    "methodology": "plain-language explanation of what evidence was used",
    "keyFindings": ["finding 1", "finding 2"],
    "evidence": ["metric or row evidence", "metric or row evidence"],
    "caveats": ["constraint or weak-evidence note"],
    "nextQuestions": ["good next EDA question"]
  }
}

STYLE RULES:
- Plain language only.
- No markdown.
- No prose outside JSON.
- Do not invent rows, metrics, benchmarks, or causal claims.

${GEMINI_NO_EM_DASH_RULE}`

const MAP_CONTROL_SYSTEM_PROMPT = `You are Scout's direct map-control interpreter for natural-language Scout terminal prompts.

Your job is to extract the intended UI control plan from a prompt that Scout already classified as direct map control.

SUPPORTED ACTIONS:
- search
- toggle_layers
- set_tilt
- focus_data_panel
- generate_memo
- none

SUPPORTED LAYER KEYS:
- ${MAP_CONTROL_LAYER_KEYS.join('\n- ')}

RULES:
- Interpret natural-language phrasing semantically. Ignore filler such as "please", "can you", or "let's".
- You may return either one direct action or an ordered "steps" array with up to 3 actions.
- Prefer "search" when the user is clearly asking to navigate to a geography or market.
- If the prompt combines navigation with another direct map action, return both steps in order. Search should come first.
- If the prompt combines map control and analysis, extract only the direct map-control action(s) and ignore the analysis clause.
- Do not invent geography names, layers, or parameters.
- Use "none" if confidence is below 0.6 or the prompt is too ambiguous.
- For toggle_layers, return a JSON object whose keys are layer keys and whose values are booleans.
- For set_tilt, return a tilt from 0 to 60.
- Keep step messages short and user-facing.

OUTPUT CONTRACT:
Return valid JSON only:
{
  "message": "short user-facing summary",
  "actionType": "search|toggle_layers|set_tilt|focus_data_panel|generate_memo|none",
  "searchQuery": "string or null",
  "layers": { "transitStops": true },
  "tilt": 45,
  "steps": [
    {
      "message": "Navigating to Dallas, TX.",
      "actionType": "search",
      "searchQuery": "Dallas, TX"
    },
    {
      "message": "Turning on permits.",
      "actionType": "toggle_layers",
      "layers": { "permits": true }
    }
  ],
  "confidence": 0.0,
  "reason": "short explanation"
}

${GEMINI_NO_EM_DASH_RULE}`

type AgentJsonResponse = {
  message: string
  trace?: unknown
  chart?: unknown
}

type MapControlActionJson = {
  actionType?: unknown
  searchQuery?: unknown
  layers?: unknown
  tilt?: unknown
  message?: unknown
}

type MapControlPlanJson = MapControlActionJson & {
  steps?: unknown
  confidence?: unknown
  reason?: unknown
}

function parseGeminiAgentJson(raw: string): AgentJsonResponse {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned) as AgentJsonResponse
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0]) as AgentJsonResponse
    } catch {
      /* ignore */
    }
  }

  return { message: raw.trim() || 'Unable to interpret the current workspace context.' }
}

function parseMapControlPlanJson(raw: string): MapControlPlanJson {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned) as MapControlPlanJson
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0]) as MapControlPlanJson
    } catch {
      /* ignore */
    }
  }

  return {}
}

function getGeminiJsonModel(systemInstruction: string) {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    generationConfig: { responseMimeType: 'application/json' },
  })
}

function mergeTrace(primary: AgentTrace, fallback: AgentTrace): AgentTrace {
  return {
    summary: primary.summary || fallback.summary,
    taskType: primary.taskType ?? fallback.taskType,
    methodology: primary.methodology ?? fallback.methodology,
    keyFindings: primary.keyFindings?.length ? primary.keyFindings : fallback.keyFindings,
    evidence: primary.evidence?.length ? primary.evidence : fallback.evidence,
    caveats: primary.caveats?.length ? primary.caveats : fallback.caveats,
    nextQuestions: primary.nextQuestions?.length ? primary.nextQuestions : fallback.nextQuestions,
    thinking: primary.thinking ?? fallback.thinking,
    detail: primary.detail ?? fallback.detail,
    plan: primary.plan?.length ? primary.plan : fallback.plan,
    eval: primary.eval ?? fallback.eval,
    executionSteps: primary.executionSteps?.length ? primary.executionSteps : fallback.executionSteps,
    toolCalls: primary.toolCalls?.length ? primary.toolCalls : fallback.toolCalls,
  }
}

function buildHybridMapAnalysisTrace(summary: string, findings: string[], caveats: string[], nextQuestions: string[]): AgentTrace {
  return {
    summary,
    taskType: 'summarize_dataset',
    methodology: 'Matched the prompt as a hybrid of explicit map control and workspace-grounded analysis, then sequenced the response without using open-ended planning.',
    keyFindings: findings,
    evidence: ['The prompt included an explicit navigation or map-control command plus an analytical follow-up request.'],
    caveats,
    nextQuestions,
  }
}

function normalizeLayerRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, enabled]) => MAP_CONTROL_LAYER_KEYS.includes(key) && typeof enabled === 'boolean')
  )
}

type NormalizedMapControlStep = {
  message: string
  action: AgentAction
  summary: string
}

type AgentPipelineResult = {
  message: string
  action?: AgentAction
  steps?: AgentStep[]
  trace: AgentTrace
  chart?: ScoutChartOutput | null
}

function maybeBuildFallbackChart(userMessage: string, context: MapContext | null): ScoutChartOutput | null {
  const prompt = userMessage.toLowerCase()
  const wantsTrend = /\b(trend|over time|history|timeline)\b/.test(prompt)
  if (!wantsTrend) return null

  const label = context?.label ?? context?.eda?.geographyLabel ?? 'Current market'

  return normalizeScoutChartOutput({
    kind: 'line',
    title: `${label} rent trend`,
    subtitle: 'Phase 1 chart contract demo',
    summary: 'Temporary chart payload used to validate the shared analytical rendering path.',
    placeholder: true,
    confidenceLabel: 'placeholder data',
    xAxis: { key: 'period', label: 'Period' },
    yAxis: { label: 'Indexed rent', valueFormat: 'index' },
    series: [
      {
        key: 'rent_index',
        label: 'Rent index',
        color: '#D76B3D',
        points: [
          { x: 'Start', y: 100 },
          { x: 'Mid', y: 104 },
          { x: 'Latest', y: 108 },
        ],
      },
    ],
    citations: [
      {
        id: 'phase1-placeholder-series',
        label: 'Phase 1 placeholder series',
        sourceType: 'placeholder',
        note: 'Replace with router-backed historical series during later convergence tasks.',
        placeholder: true,
      },
    ],
  })
}

function attachTraceCitations(trace: AgentTrace, chart: ScoutChartOutput | null): AgentTrace {
  if (!chart || chart.citations.length === 0) return trace

  return {
    ...trace,
    citations: chart.citations,
  }
}

export function buildFallbackChartedResponseForTest(userMessage: string, context: MapContext | null) {
  const fallback = buildFallbackEdaResponse(userMessage, context)
  const chart = maybeBuildFallbackChart(userMessage, context)

  return {
    message: fallback.message,
    trace: attachTraceCitations(fallback.trace, chart),
    chart,
  }
}

function buildDefaultMapControlMessage(action: AgentAction): string {
  if (action.type === 'search') return `Navigating to ${action.query}.`
  if (action.type === 'toggle_layers') {
    const layerKeys = Object.keys(action.layers ?? {})
    const allOff = layerKeys.every((key) => action.layers?.[key] === false)
    const humanLayerNames = layerKeys.map((key) => humanizeLayerKey(key)).join(', ')
    return `${allOff ? 'Turning off' : 'Turning on'} ${humanLayerNames}.`
  }
  if (action.type === 'set_tilt') return action.tilt === 0 ? 'Flattening the map to 2D.' : `Setting map tilt to ${action.tilt}°.`
  if (action.type === 'focus_data_panel') return 'Opening the data panel.'
  if (action.type === 'generate_memo') return 'Opening the analysis panel.'
  return 'Updating the map.'
}

function normalizeMapControlAction(
  parsed: MapControlActionJson,
  context: MapContext | null | undefined
): NormalizedMapControlStep | null {
  const actionType = typeof parsed.actionType === 'string' ? parsed.actionType : 'none'
  const explicitMessage = typeof parsed.message === 'string' ? parsed.message.trim() : ''

  if (actionType === 'search') {
    const query = typeof parsed.searchQuery === 'string'
      ? normalizeMapSearchQuery(parsed.searchQuery.trim().replace(/[.,;:!?]+$/g, ''))
      : ''
    if (!query || looksAnalyticalPrompt(query)) return null

    const activeLabel = context?.label?.trim().toLowerCase() ?? ''
    if (activeLabel && activeLabel === query.toLowerCase()) {
      return {
        message: explicitMessage || `${query} is already the active market.`,
        action: { type: 'none' },
        summary: 'Active market already loaded',
      }
    }

    return {
      message: explicitMessage || `Navigating to ${query}.`,
      action: { type: 'search', query },
      summary: `Navigate to ${query}`,
    }
  }

  if (actionType === 'toggle_layers') {
    const layers = normalizeLayerRecord(parsed.layers)
    const layerKeys = Object.keys(layers)
    if (layerKeys.length === 0) return null

    const action: AgentAction = { type: 'toggle_layers', layers }
    const humanLayerNames = layerKeys.map((key) => humanizeLayerKey(key)).join(', ')
    const allOff = layerKeys.every((key) => layers[key] === false)
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: `${allOff ? 'Hide' : 'Show'} ${humanLayerNames}`,
    }
  }

  if (actionType === 'set_tilt') {
    const tilt = typeof parsed.tilt === 'number' && Number.isFinite(parsed.tilt)
      ? Math.max(0, Math.min(60, Math.round(parsed.tilt)))
      : null
    if (tilt == null) return null

    const action: AgentAction = { type: 'set_tilt', tilt }
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: tilt === 0 ? 'Switch to 2D view' : 'Set map tilt',
    }
  }

  if (actionType === 'focus_data_panel') {
    const action: AgentAction = { type: 'focus_data_panel' }
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: 'Open data panel',
    }
  }

  if (actionType === 'generate_memo') {
    const action: AgentAction = { type: 'generate_memo' }
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: 'Open analysis panel',
    }
  }

  return null
}

function normalizeMapControlSteps(
  value: unknown,
  context: MapContext | null | undefined
): NormalizedMapControlStep[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return []
    const normalized = normalizeMapControlAction(step as MapControlActionJson, context)
    return normalized ? [normalized] : []
  })
}

function buildGeminiMapControlTrace(
  summary: string,
  reason: string | null,
  confidence: number | null,
  steps: NormalizedMapControlStep[]
): AgentTrace {
  const normalizedReason = reason?.replace(/[.?!\s]+$/g, '') ?? null

  return {
    summary,
    methodology:
      'Scout used a bounded Gemini parser to interpret the natural-language map-control request into explicit UI actions, then normalized the result into canonical search, layer, and view commands.',
    keyFindings: [
      summary,
      steps.length > 1 ? `${steps.length} ordered map actions were extracted from one prompt.` : 'A direct map action was extracted from the prompt.',
    ],
    evidence: [
      confidence != null ? `Parser confidence: ${confidence.toFixed(2)}.` : 'The parser returned a structured action plan.',
      normalizedReason ? `Parser reason: ${normalizedReason}.` : 'The parser used the natural-language request plus current map state to derive the action plan.',
    ],
    caveats: ['Slash-prefixed terminal commands still stay on the local deterministic path; this NLP parser is only for natural-language agent prompts.'],
    nextQuestions: ['After the action runs, ask for EDA on the active market or imported dataset if you want interpretation.'],
    executionSteps: steps.map((step) => ({
      message: step.message,
      actionType: step.action.type,
    })),
  }
}

function buildAgentSteps(steps: NormalizedMapControlStep[]): AgentStep[] {
  return steps.map((step, index) => ({
    delay: index * 900,
    message: step.message,
    action: step.action,
  }))
}

function normalizeMapControlPlan(
  parsed: MapControlPlanJson,
  context: MapContext | null | undefined
): AgentPipelineResult | null {
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : null
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null
  if (confidence != null && confidence < 0.6) return null

  const explicitMessage = typeof parsed.message === 'string' ? parsed.message.trim() : ''
  const normalizedSteps = normalizeMapControlSteps(parsed.steps, context)

  if (normalizedSteps.length > 0) {
    const summary = normalizedSteps.length > 1
      ? `Execute ${normalizedSteps.length}-step map-control sequence`
      : normalizedSteps[0]?.summary ?? 'Execute map-control action'

    return {
      message: explicitMessage || normalizedSteps.map((step) => step.message).join(' '),
      steps: buildAgentSteps(normalizedSteps),
      trace: buildGeminiMapControlTrace(summary, reason, confidence, normalizedSteps),
    }
  }

  const singleAction = normalizeMapControlAction(parsed, context)
  if (!singleAction) return null

  return {
    message: explicitMessage || singleAction.message,
    action: singleAction.action,
    trace: buildGeminiMapControlTrace(singleAction.summary, reason, confidence, [singleAction]),
  }
}

function getPrimarySearchTarget(plan: AgentPipelineResult): string | null {
  if (plan.action?.type === 'search') return plan.action.query ?? null
  return plan.steps?.find((step) => step.action.type === 'search')?.action.query ?? null
}

function normalizeDeterministicMapControl(
  deterministic: ReturnType<typeof inferDirectMapControl>
): AgentPipelineResult | null {
  if (!deterministic) return null
  return {
    message: deterministic.message,
    action: deterministic.action,
    trace: deterministic.trace,
  }
}

async function inferMapControlWithModel(
  prompt: string,
  context: MapContext | null | undefined
): Promise<AgentPipelineResult | null> {
  const deterministic = inferDirectMapControl(prompt, context)
  if (!process.env.GEMINI_API_KEY) return normalizeDeterministicMapControl(deterministic)

  try {
    const model = getGeminiJsonModel(MAP_CONTROL_SYSTEM_PROMPT)
    const result = await model.generateContent(
      [
        `USER REQUEST: ${prompt}`,
        `ACTIVE MARKET LABEL: ${context?.label ?? 'none'}`,
        `ACTIVE LAYERS: ${
          Object.entries(context?.layers ?? {})
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
            .join(', ') || 'none'
        }`,
      ].join('\n')
    )

    const parsed = normalizeMapControlPlan(parseMapControlPlanJson(result.response.text().trim()), context)
    return parsed ?? normalizeDeterministicMapControl(deterministic)
  } catch {
    return normalizeDeterministicMapControl(deterministic)
  }
}

function unresolvedMapControlPayload() {
  return {
    message:
      'I could not confidently parse that map-control request. Try a direct prompt like "take me to Harris County, TX" or "turn on transit," then ask the follow-up analysis.',
    action: { type: 'none' as const },
    trace: {
      summary: 'Map-control request could not be parsed',
      methodology:
        'Scout checked the bounded Gemini map-control parser and the deterministic backup parser, but neither produced a confident control action.',
      keyFindings: ['No map-control action was executed.'],
      evidence: ['The request was classified as direct map control, but no confident structured action could be extracted.'],
      caveats: ['Retry with a slightly more direct command if you want navigation or a UI control change first.'],
      nextQuestions: ['Try "take me to Harris County, TX."', 'Try "turn on transit."', 'After the action runs, ask the analysis question again.'],
    },
  }
}

async function runAgentPipeline(context: MapContext | null, userMessage: string): Promise<AgentPipelineResult> {
  const intent = classifyAgentRequestIntent(userMessage, context)
  if (intent.lane === 'direct_map_control') {
    const mapControl = await inferMapControlWithModel(userMessage, context)
    if (mapControl) {
      if (looksAnalyticalPrompt(userMessage)) {
        const fallback = buildFallbackEdaResponse(userMessage, context)
        const target = getPrimarySearchTarget(mapControl)

        if (target) {
          return {
            message: `Navigating to ${target}. Once that market loads, ask again and I’ll explain the requested snapshot using the active market data.`,
            action: mapControl.action,
            steps: mapControl.steps,
            trace: buildHybridMapAnalysisTrace(
              `Navigate to ${target} for follow-up analysis`,
              [
                `Matched an explicit navigation request for ${target}.`,
                mapControl.steps?.length
                  ? 'The direct prompt also included additional map actions, which will run after the navigation step.'
                  : 'The analytical part of the prompt refers to a market that is not yet the active workspace.',
              ],
              [
                `I did not answer the analysis part yet because that would have used the current workspace instead of ${target}.`,
              ],
              [`After ${target} loads, ask the same question again to get the market explanation.`]
            ),
          }
        }

        return {
          message: `${mapControl.message} ${fallback.message}`.trim(),
          action: mapControl.action,
          steps: mapControl.steps,
          trace: mergeTrace(
            {
              summary: `${mapControl.trace.summary} + ${fallback.trace.summary}`,
              methodology: 'Executed the explicit map-control request first, then answered the analytical part against the current workspace.',
              keyFindings: [
                ...(mapControl.trace.keyFindings ?? []),
                ...(fallback.trace.keyFindings ?? []),
              ].slice(0, 4),
              evidence: [
                ...(mapControl.trace.evidence ?? []),
                ...(fallback.trace.evidence ?? []),
              ].slice(0, 6),
              caveats: [
                ...(mapControl.trace.caveats ?? []),
                ...(fallback.trace.caveats ?? []),
              ].slice(0, 4),
              nextQuestions: fallback.trace.nextQuestions ?? mapControl.trace.nextQuestions,
            },
            fallback.trace
          ),
        }
      }

      return {
        message: mapControl.message,
        action: mapControl.action,
        steps: mapControl.steps,
        trace: mapControl.trace,
      }
    }

    return unresolvedMapControlPayload()
  }

  const fallback = buildFallbackEdaResponse(userMessage, context)
  const taskType = inferEdaTaskType(userMessage, context)

  if (!process.env.GEMINI_API_KEY) {
    const chart = maybeBuildFallbackChart(userMessage, context)
    return {
      message: fallback.message,
      action: { type: 'none' as const },
      trace: attachTraceCitations(fallback.trace, chart),
      chart,
    }
  }

  const model = getGeminiJsonModel(SYSTEM_PROMPT)

  try {
    const contextStr = buildEdaContextString(userMessage, context)
    const chart = maybeBuildFallbackChart(userMessage, context)
    const result = await model.generateContent(
      `${contextStr}\n\nDETERMINISTIC FALLBACK TRACE (use as the minimum evidence floor; you may rephrase but not contradict it):\n${JSON.stringify(
        {
          message: fallback.message,
          trace: fallback.trace,
        },
        null,
        2
      )}\n\nUSER REQUEST:\n${userMessage}`
    )

    const parsed = parseGeminiAgentJson(result.response.text().trim())
    const normalized = normalizeAgentTrace(
      {
        ...(parsed.trace && typeof parsed.trace === 'object' ? parsed.trace : {}),
        taskType,
      },
      null,
      null
    )

    return {
      message: parsed.message?.trim() || fallback.message,
      action: { type: 'none' as const },
      trace: attachTraceCitations(mergeTrace(normalized, fallback.trace), chart),
      chart,
    }
  } catch {
    const chart = maybeBuildFallbackChart(userMessage, context)
    return {
      message: fallback.message,
      action: { type: 'none' as const },
      trace: attachTraceCitations(fallback.trace, chart),
      chart,
    }
  }
}

function blockedAgentTrace(reason: string): AgentTrace {
  return {
    summary: 'Prompt blocked before EDA analysis',
    taskType: 'summarize_dataset',
    methodology: 'The request policy rejected this prompt before any model call or deterministic EDA work ran.',
    keyFindings: ['This prompt falls outside the bounded Scout EDA assistant scope.'],
    evidence: ['The assistant now only handles dataset- and market-grounded exploratory analysis.'],
    caveats: [`Policy reason: ${reason}.`],
    nextQuestions: ['Ask about the loaded market, an imported dataset, outliers, distributions, trends, or data quality.'],
  }
}

function blockedAgentPayload(policy: Exclude<ReturnType<typeof evaluateAgentRequestPolicy>, { allowed: true }>) {
  return {
    message: policy.message,
    action: { type: 'none' as const },
    trace: blockedAgentTrace(policy.reason),
  }
}

function blockedAgentStreamResponse(payload: ReturnType<typeof blockedAgentPayload>) {
  const encoder = new TextEncoder()
  const line = `${JSON.stringify({ type: 'done', ...payload })}\n`
  return new Response(encoder.encode(line), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function classifyAgentError(err: unknown): { message: string; status: number } {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const normalized = message.toLowerCase()

  if (normalized.includes('429') || normalized.includes('too many requests') || normalized.includes('resource exhausted')) {
    return {
      message: 'Gemini rate limit reached for this request. Retry in a moment.',
      status: 429,
    }
  }

  if (normalized.includes('503 service unavailable')) {
    return {
      message: 'Gemini is temporarily unavailable due to upstream load. Retry in a moment.',
      status: 503,
    }
  }

  return {
    message,
    status: 500,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: string
      context?: MapContext | null
      stream?: boolean
    }

    const userMessage = typeof body.message === 'string' ? body.message : ''
    const context = body.context ?? null
    const stream = body.stream === true

    const policy = evaluateAgentRequestPolicy(userMessage, context)
    if (!policy.allowed) {
      const payload = blockedAgentPayload(policy)
      if (stream) return blockedAgentStreamResponse(payload)
      return NextResponse.json(payload)
    }

    if (stream) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const push = (obj: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
          }

          try {
            push({ type: 'status', phase: 'json' })
            const out = await runAgentPipeline(context, userMessage)
            push({
              type: 'done',
              message: out.message,
              action: out.action,
              steps: out.steps,
              trace: out.trace,
              chart: out.chart,
            })
          } catch (err) {
            const failure = classifyAgentError(err)
            push({
              type: 'error',
              error: failure.message,
              status: failure.status,
              retryable: failure.status === 429 || failure.status === 503,
            })
          } finally {
            controller.close()
          }
        },
      })

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const out = await runAgentPipeline(context, userMessage)
    return NextResponse.json(out)
  } catch (err) {
    const failure = classifyAgentError(err)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
}
