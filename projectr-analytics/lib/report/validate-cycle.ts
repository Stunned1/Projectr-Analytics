import type { CycleAnalysis } from '@/lib/cycle/types'

function isSignalDetail(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  const sc = o.score
  return (sc === -1 || sc === 0 || sc === 1) && typeof o.direction === 'string' && typeof o.value === 'string' && typeof o.source === 'string'
}

/** Accepts client-supplied cycle JSON; drops malformed payloads. */
export function parseCycleAnalysisField(raw: unknown): CycleAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const pos = c.cyclePosition
  const stage = c.cycleStage
  const dq = c.dataQuality
  if (typeof c.zip !== 'string' || !/^\d{5}$/.test(c.zip)) return null
  if (!['Recovery', 'Expansion', 'Hypersupply', 'Recession'].includes(pos as string)) return null
  if (!['Early', 'Mid', 'Late'].includes(stage as string)) return null
  if (!['High', 'Medium', 'Low'].includes(dq as string)) return null
  if (typeof c.narrative !== 'string' || typeof c.confidenceLine !== 'string') return null
  if (typeof c.confidence !== 'number' || typeof c.signalsAgreement !== 'number') return null
  if (typeof c.transitional !== 'boolean') return null
  const sig = c.signals
  if (!sig || typeof sig !== 'object') return null
  const s = sig as Record<string, unknown>
  if (!isSignalDetail(s.rent) || !isSignalDetail(s.vacancy) || !isSignalDetail(s.permits) || !isSignalDetail(s.employment)) return null
  return c as unknown as CycleAnalysis
}
