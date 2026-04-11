import type { CycleAnalysis, CycleSignalDetail } from '@/lib/cycle/types'

/**
 * Gemini JSON mode and example-heavy prompts often yield strings wrapped in ASCII or curly quotes,
 * or copy the prompt's "e.g. \"...\"" delimiters into fields like confidenceEcho. Those values
 * feed PDF confidence lines next to signal tiles, so stray quotes read as a signal bug.
 */
export function stripGeminiStringWrappers(s: string): string {
  let t = s.trim()
  for (let i = 0; i < 4; i++) {
    let changed = false
    const pairs: Array<[string, string]> = [
      ['"', '"'],
      ['\u201c', '\u201d'],
      ['\u2018', '\u2019'],
    ]
    for (const [open, close] of pairs) {
      if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
        t = t.slice(open.length, t.length - close.length).trim()
        changed = true
        break
      }
    }
    if (!changed) break
  }
  return t
}

/**
 * Signal `direction` / `value` / `source` sometimes pick up JSON artifacts after round-trips
 * (e.g. literal \", doubled quotes) or model echo. Use wherever cycle tiles render.
 */
export function sanitizeCycleSignalText(s: string): string {
  let t = s.trim()
  for (let pass = 0; pass < 3; pass++) {
    t = t.replace(/\\"/g, '"')
    t = stripGeminiStringWrappers(t)
    const trimmed = t.replace(/^['"]+|['"]+$/g, '').trim()
    if (trimmed === t) break
    t = trimmed
  }
  return t
}

function sanitizeDetail(d: CycleSignalDetail): CycleSignalDetail {
  return {
    score: d.score,
    direction: sanitizeCycleSignalText(d.direction),
    value: sanitizeCycleSignalText(d.value),
    source: sanitizeCycleSignalText(d.source),
  }
}

/**
 * Run before returning cycle JSON from the API and after accepting client PDF payloads.
 * Does not alter cyclePosition / cycleStage (classifier enums).
 */
export function sanitizeCycleAnalysisForDisplay(a: CycleAnalysis): CycleAnalysis {
  return {
    ...a,
    narrative: stripGeminiStringWrappers(a.narrative.trim()),
    confidenceLine: sanitizeCycleSignalText(a.confidenceLine),
    signals: {
      rent: sanitizeDetail(a.signals.rent),
      vacancy: sanitizeDetail(a.signals.vacancy),
      permits: sanitizeDetail(a.signals.permits),
      employment: sanitizeDetail(a.signals.employment),
    },
  }
}
