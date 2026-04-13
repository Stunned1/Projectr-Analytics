import type { AgentStep, AgentTrace, AgentTraceToolRow } from '@/lib/agent-types'

export type { AgentTrace, AgentTraceToolRow }

function executionStepsFromAgentSteps(steps: AgentStep[] | null | undefined) {
  if (!steps?.length) return undefined
  return steps.map((s) => ({
    message: s.message,
    actionType: s.action?.type ?? 'unknown',
  }))
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map((x) => String(x).trim()).filter(Boolean)
  return out.length ? out : undefined
}

function safeToolCalls(v: unknown): AgentTraceToolRow[] | undefined {
  if (!Array.isArray(v)) return undefined
  const rows: AgentTraceToolRow[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.name !== 'string' || !r.name.trim()) continue
    rows.push({
      name: r.name.trim(),
      argsPreview: typeof r.argsPreview === 'string' ? r.argsPreview.slice(0, 500) : undefined,
      resultPreview: typeof r.resultPreview === 'string' ? r.resultPreview.slice(0, 800) : undefined,
      ok: typeof r.ok === 'boolean' ? r.ok : undefined,
    })
  }
  return rows.length ? rows : undefined
}

/**
 * Coerce model output into a safe `AgentTrace`; fill execution + plan from `steps` when helpful.
 */
export function normalizeAgentTrace(
  raw: unknown,
  steps?: AgentStep[] | null,
  /** Full prose from the pre-pass; wins over any `trace.thinking` in JSON if both exist. */
  thinkingDraft?: string | null
): AgentTrace {
  const exec = executionStepsFromAgentSteps(steps)
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const fromJson = typeof o.thinking === 'string' && o.thinking.trim() ? o.thinking.trim() : null
  const draft = thinkingDraft?.trim() || null
  const thinking = draft || fromJson || null

  let plan = asStringArray(o.plan)
  if (!plan?.length && steps?.length) {
    plan = steps.map((s, i) => {
      const head = s.message.trim().slice(0, 140)
      return `${i + 1}. ${head}${s.message.length > 140 ? '…' : ''}`
    })
  }

  let summary =
    typeof o.summary === 'string' && o.summary.trim()
      ? o.summary.trim()
      : exec?.length
        ? `Planned ${exec.length} map steps`
        : 'Agent response'

  if (!o.summary && exec?.length) {
    const types = [...new Set(exec.map((e) => e.actionType).filter(Boolean))]
    summary = `${exec.length} steps · ${types.slice(0, 4).join(', ')}${types.length > 4 ? '…' : ''}`
  }

  const detail = typeof o.detail === 'string' && o.detail.trim() ? o.detail.trim() : null
  const evalText = typeof o.eval === 'string' && o.eval.trim() ? o.eval.trim() : null

  return {
    summary,
    thinking: thinking ?? undefined,
    detail,
    plan,
    eval: evalText,
    executionSteps: exec,
    toolCalls: safeToolCalls(o.toolCalls),
  }
}
