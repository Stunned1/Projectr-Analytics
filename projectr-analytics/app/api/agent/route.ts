/**
 * Scout EDA Assistant API
 * Returns a concise analyst-facing response grounded in the current market or imported dataset context.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { normalizeAgentTrace } from '@/lib/agent-trace'
import type { AgentTrace, MapContext } from '@/lib/agent-types'
import { classifyAgentRequestIntent, looksAnalyticalPrompt } from '@/lib/agent-intent'
import {
  humanizeLayerKey,
  inferDirectMapControl,
  inferNavigationTarget,
  MAP_CONTROL_LAYER_KEYS,
} from '@/lib/agent-map-control'
import { buildEdaContextString, buildFallbackEdaResponse, inferEdaTaskType } from '@/lib/eda-assistant'
import { evaluateAgentRequestPolicy } from '@/lib/agent-request-policy'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'

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

const MAP_CONTROL_FALLBACK_SYSTEM_PROMPT = `You are Scout's fallback parser for direct map-control requests.

Your job is to extract one structured UI control action from a prompt that Scout already classified as direct map control, but which its deterministic parser could not confidently resolve.

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
- Prefer "search" when the user is clearly asking to navigate to a geography or market.
- If the prompt combines navigation and analysis, extract only the direct map-control action and ignore the analysis clause.
- Do not invent geography names, layers, or parameters.
- Use "none" if confidence is below 0.6 or the prompt is too ambiguous.
- For toggle_layers, return a JSON object whose keys are layer keys and whose values are booleans.
- For set_tilt, return a tilt from 0 to 60.

OUTPUT CONTRACT:
Return valid JSON only:
{
  "actionType": "search|toggle_layers|set_tilt|focus_data_panel|generate_memo|none",
  "searchQuery": "string or null",
  "layers": { "transitStops": true },
  "tilt": 45,
  "confidence": 0.0,
  "reason": "short explanation"
}

${GEMINI_NO_EM_DASH_RULE}`

type AgentJsonResponse = {
  message: string
  trace?: unknown
}

type MapControlFallbackJson = {
  actionType?: unknown
  searchQuery?: unknown
  layers?: unknown
  tilt?: unknown
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

function parseMapControlFallbackJson(raw: string): MapControlFallbackJson {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned) as MapControlFallbackJson
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0]) as MapControlFallbackJson
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

function buildMapControlFallbackTrace(
  summary: string,
  reason: string | null,
  confidence: number | null
): AgentTrace {
  const normalizedReason = reason?.replace(/[.?!\s]+$/g, '') ?? null

  return {
    summary,
    methodology:
      'Scout’s deterministic map-control parser could not confidently resolve the prompt, so a bounded JSON-only Gemini fallback parser extracted a single UI control action.',
    keyFindings: [summary],
    evidence: [
      confidence != null ? `Fallback parser confidence: ${confidence.toFixed(2)}.` : 'Fallback parser returned a structured action.',
      normalizedReason ? `Fallback reason: ${normalizedReason}.` : 'The fallback parser extracted the action from the original prompt.',
    ],
    caveats: ['This fallback only runs when the deterministic map-control parser fails or returns no confident action.'],
    nextQuestions: ['Ask for EDA on the loaded market or imported dataset if you want interpretation after the UI action runs.'],
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

function shouldTryMapControlFallback(
  prompt: string,
  deterministic: ReturnType<typeof inferDirectMapControl>
): boolean {
  if (!deterministic) return true
  if (deterministic.action.type !== 'search') return false

  const query = deterministic.action.query?.trim().toLowerCase() ?? ''
  if (!query) return true
  if (query.split(/\s+/).length > 8) return true
  if (/\b(?:and|then)\b/i.test(query)) return true
  if (/[?]/.test(query)) return true

  return looksAnalyticalPrompt(prompt) && looksAnalyticalPrompt(query)
}

function buildMapControlResponseFromFallback(
  parsed: MapControlFallbackJson,
  context: MapContext | null | undefined
) {
  const actionType = typeof parsed.actionType === 'string' ? parsed.actionType : 'none'
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : null
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null

  if (confidence != null && confidence < 0.6) return null

  if (actionType === 'search') {
    const query = typeof parsed.searchQuery === 'string' ? parsed.searchQuery.trim().replace(/[.,;:!?]+$/g, '') : ''
    if (!query || looksAnalyticalPrompt(query)) return null

    const activeLabel = context?.label?.trim().toLowerCase() ?? ''
    if (activeLabel && activeLabel === query.toLowerCase()) {
      return {
        message: `${query} is already the active market.`,
        action: { type: 'none' as const },
        trace: buildMapControlFallbackTrace('Active market already loaded', reason, confidence),
      }
    }

    return {
      message: `Navigating to ${query}.`,
      action: { type: 'search' as const, query },
      trace: buildMapControlFallbackTrace(`Navigate to ${query}`, reason, confidence),
    }
  }

  if (actionType === 'toggle_layers') {
    const layers = normalizeLayerRecord(parsed.layers)
    const layerKeys = Object.keys(layers)
    if (layerKeys.length === 0) return null

    const allOff = layerKeys.every((key) => layers[key] === false)
    const humanLayerNames = layerKeys.map((key) => humanizeLayerKey(key)).join(', ')

    return {
      message: `${allOff ? 'Turning off' : 'Turning on'} ${humanLayerNames}.`,
      action: { type: 'toggle_layers' as const, layers },
      trace: buildMapControlFallbackTrace(`${allOff ? 'Hide' : 'Show'} ${humanLayerNames}`, reason, confidence),
    }
  }

  if (actionType === 'set_tilt') {
    const tilt = typeof parsed.tilt === 'number' && Number.isFinite(parsed.tilt)
      ? Math.max(0, Math.min(60, Math.round(parsed.tilt)))
      : null
    if (tilt == null) return null

    return {
      message: tilt === 0 ? 'Flattening the map to 2D.' : `Setting map tilt to ${tilt}°.`,
      action: { type: 'set_tilt' as const, tilt },
      trace: buildMapControlFallbackTrace(tilt === 0 ? 'Switch to 2D view' : 'Set map tilt', reason, confidence),
    }
  }

  if (actionType === 'focus_data_panel') {
    return {
      message: 'Opening the data panel.',
      action: { type: 'focus_data_panel' as const },
      trace: buildMapControlFallbackTrace('Open data panel', reason, confidence),
    }
  }

  if (actionType === 'generate_memo') {
    return {
      message: 'Opening the analysis panel.',
      action: { type: 'generate_memo' as const },
      trace: buildMapControlFallbackTrace('Open analysis panel', reason, confidence),
    }
  }

  return null
}

async function inferMapControlWithFallback(
  prompt: string,
  context: MapContext | null | undefined
) {
  const deterministic = inferDirectMapControl(prompt, context)
  if (deterministic && !shouldTryMapControlFallback(prompt, deterministic)) return deterministic

  if (!process.env.GEMINI_API_KEY) return deterministic

  try {
    const model = getGeminiJsonModel(MAP_CONTROL_FALLBACK_SYSTEM_PROMPT)
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

    const fallback = buildMapControlResponseFromFallback(parseMapControlFallbackJson(result.response.text().trim()), context)
    return fallback ?? deterministic
  } catch {
    return deterministic
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
        'Scout checked the deterministic map-control parser and, when available, the bounded Gemini fallback parser, but neither produced a confident control action.',
      keyFindings: ['No map-control action was executed.'],
      evidence: ['The request was classified as direct map control, but no confident structured action could be extracted.'],
      caveats: ['Retry with a slightly more direct command if you want navigation or a UI control change first.'],
      nextQuestions: ['Try "take me to Harris County, TX."', 'Try "turn on transit."', 'After the action runs, ask the analysis question again.'],
    },
  }
}

async function runAgentPipeline(context: MapContext | null, userMessage: string) {
  const intent = classifyAgentRequestIntent(userMessage, context)
  if (intent.lane === 'direct_map_control') {
    const mapControl = await inferMapControlWithFallback(userMessage, context)
    if (mapControl) {
      if (looksAnalyticalPrompt(userMessage)) {
        const fallback = buildFallbackEdaResponse(userMessage, context)

        if (mapControl.action.type === 'search') {
          const target = mapControl.action.query ?? inferNavigationTarget(userMessage) ?? 'the requested market'
          return {
            message: `Navigating to ${target}. Once that market loads, ask again and I’ll explain the requested snapshot using the active market data.`,
            action: mapControl.action,
            trace: buildHybridMapAnalysisTrace(
              `Navigate to ${target} for follow-up analysis`,
              [
                `Matched an explicit navigation request for ${target}.`,
                'The analytical part of the prompt refers to a market that is not yet the active workspace.',
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
        trace: mapControl.trace,
      }
    }

    return unresolvedMapControlPayload()
  }

  const fallback = buildFallbackEdaResponse(userMessage, context)
  const taskType = inferEdaTaskType(userMessage, context)

  if (!process.env.GEMINI_API_KEY) {
    return {
      message: fallback.message,
      action: { type: 'none' as const },
      trace: fallback.trace,
    }
  }

  const model = getGeminiJsonModel(SYSTEM_PROMPT)

  try {
    const contextStr = buildEdaContextString(userMessage, context)
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
      trace: mergeTrace(normalized, fallback.trace),
    }
  } catch {
    return {
      message: fallback.message,
      action: { type: 'none' as const },
      trace: fallback.trace,
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
              trace: out.trace,
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
