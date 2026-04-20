import type { AgentCompanionOutput, AgentTrace } from '@/lib/agent-types'
import type { ScoutChartOutput } from '@/lib/scout-chart-output'

export type AgentStreamDonePayload = {
  message: string
  action?: { type: string; [key: string]: unknown }
  steps?: Array<{ delay: number; message: string; action: { type: string; [key: string]: unknown } }>
  insight?: string | null
  trace: AgentTrace
  chart?: ScoutChartOutput | null
  companionOutputs?: AgentCompanionOutput[]
}

type NdjsonLine =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'ping' }
  | { type: 'status'; phase: 'json' }
  | {
      type: 'done'
      message: string
      action?: AgentStreamDonePayload['action']
      steps?: AgentStreamDonePayload['steps']
      insight?: string | null
      trace: AgentTrace
      chart?: ScoutChartOutput | null
      companionOutputs?: AgentCompanionOutput[]
    }
  | { type: 'error'; error: string }

/**
 * Reads newline-delimited JSON from `POST /api/agent` when `stream: true`.
 */
export async function consumeAgentNdjsonStream(
  response: Response,
  handlers: {
    onThinkingDelta?: (accumulated: string, delta: string) => void
    /** Fired before the JSON map-action model runs; `thinkingSoFar` is full reasoning accumulated so far. */
    onJsonPhase?: (thinkingSoFar: string) => void
  }
): Promise<AgentStreamDonePayload> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let thinkingAcc = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let ev: NdjsonLine
      try {
        ev = JSON.parse(trimmed) as NdjsonLine
      } catch {
        continue
      }
      if (ev.type === 'ping') {
        continue
      }
      if (ev.type === 'thinking_delta' && typeof ev.delta === 'string') {
        thinkingAcc += ev.delta
        handlers.onThinkingDelta?.(thinkingAcc, ev.delta)
      } else if (ev.type === 'status' && ev.phase === 'json') {
        handlers.onJsonPhase?.(thinkingAcc)
      } else if (ev.type === 'error') {
        throw new Error(typeof ev.error === 'string' ? ev.error : 'Agent stream error')
      } else if (ev.type === 'done') {
        return {
          message: ev.message,
          action: ev.action,
          steps: ev.steps,
          insight: ev.insight ?? null,
          trace: ev.trace,
          chart: ev.chart ?? null,
          companionOutputs: ev.companionOutputs ?? [],
        }
      }
    }
  }

  throw new Error('Agent stream ended without a result')
}
