/**
 * Scout EDA Assistant API
 * Returns a concise analyst-facing response grounded in the current market or imported dataset context.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { normalizeAgentTrace } from '@/lib/agent-trace'
import type { AgentTrace, MapContext } from '@/lib/agent-types'
import { inferDirectMapControl } from '@/lib/agent-map-control'
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

type AgentJsonResponse = {
  message: string
  trace?: unknown
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

async function runAgentPipeline(context: MapContext | null, userMessage: string) {
  const mapControl = inferDirectMapControl(userMessage, context)
  if (mapControl) {
    return {
      message: mapControl.message,
      action: mapControl.action,
      trace: mapControl.trace,
    }
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

  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json' },
  })

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

    const policy = evaluateAgentRequestPolicy(userMessage)
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
