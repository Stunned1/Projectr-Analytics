/**
 * Agent JSON uses `permits` for the NYC DOB layer; CommandMap LayerState uses `nycPermits`.
 */

import { SLASH_LAYER_KEYS } from '@/lib/slash-layer-keys'

export function normalizeAgentLayerKey(layer: string): string {
  return layer === 'permits' ? 'nycPermits' : layer
}

export function normalizeAgentLayersRecord(layers: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(layers)) {
    out[normalizeAgentLayerKey(k)] = v
  }
  return out
}

/** Map context for Gemini — keep vocabulary aligned with AVAILABLE LAYERS (`permits`). */
export function denormalizeAgentLayersForContext(overrides: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = { ...overrides }
  if (Object.prototype.hasOwnProperty.call(out, 'nycPermits')) {
    out.permits = out.nycPermits
    delete out.nycPermits
  }
  return out
}

/** True when the patch sets every canonical layer key to `false` (e.g. `/clear:layers`). */
export function patchTurnsEveryLayerOff(patch: Record<string, boolean>): boolean {
  const m = normalizeAgentLayersRecord(patch)
  for (const k of SLASH_LAYER_KEYS) {
    if (m[k] !== false) return false
  }
  return true
}
