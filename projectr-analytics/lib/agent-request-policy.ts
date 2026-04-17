import type { MapContext } from '@/lib/agent-types'
import { classifyAgentRequestIntent } from '@/lib/agent-intent'

export type AgentRequestPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: 'empty' | 'slash_command' | 'arithmetic' | 'off_topic'; message: string }

export function evaluateAgentRequestPolicy(
  prompt: string,
  context?: MapContext | null
): AgentRequestPolicyDecision {
  const intent = classifyAgentRequestIntent(prompt, context)
  if (intent.lane === 'blocked') {
    return { allowed: false, reason: intent.reason, message: intent.message }
  }
  return { allowed: true }
}
