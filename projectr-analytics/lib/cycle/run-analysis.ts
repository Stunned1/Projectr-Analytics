import { classifyCycle } from './classifier'
import { computeCycleSignals } from './compute-signals'
import { fallbackCycleNarrative, generateCycleNarrative } from './gemini-cycle-narrative'
import { loadCycleRawInputs } from './load-data'
import type { CycleAnalysis } from './types'

export function cycleHeadline(marketLabel: string, a: Pick<CycleAnalysis, 'cycleStage' | 'cyclePosition'>): string {
  return `${marketLabel} is in ${a.cycleStage} ${a.cyclePosition}`
}

export async function analyzeCycleForZip(
  zip: string,
  marketLabel: string,
  options?: { skipGemini?: boolean }
): Promise<CycleAnalysis> {
  const raw = await loadCycleRawInputs(zip)
  const features = computeCycleSignals(raw)
  const classified = classifyCycle(zip, features)
  const narrative = options?.skipGemini
    ? fallbackCycleNarrative(classified)
    : await generateCycleNarrative(classified, marketLabel)
  return { ...classified, narrative }
}
