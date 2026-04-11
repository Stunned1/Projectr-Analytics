import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { sanitizeCycleSignalText, stripGeminiStringWrappers } from '@/lib/sanitize-gemini-string'
import type { CycleAnalysis } from './types'

export function fallbackCycleNarrative(partial: Omit<CycleAnalysis, 'narrative'>): string {
  const { cycleStage, cyclePosition, signals, dataQuality, transitional } = partial
  const bits = [
    `Rent: ${sanitizeCycleSignalText(signals.rent.direction)} (${sanitizeCycleSignalText(signals.rent.value)}).`,
    `Vacancy: ${sanitizeCycleSignalText(signals.vacancy.direction)} (${sanitizeCycleSignalText(signals.vacancy.value)}).`,
    `Permits: ${sanitizeCycleSignalText(signals.permits.direction)} (${sanitizeCycleSignalText(signals.permits.value)}).`,
    `Employment: ${sanitizeCycleSignalText(signals.employment.direction)} (${sanitizeCycleSignalText(signals.employment.value)}).`,
  ]
  const tail = transitional
    ? ' Signals are mixed; treat this as a transitional submarket until the set aligns.'
    : ` Data quality is ${dataQuality.toLowerCase()} (time-series coverage varies by signal).`
  return `The submarket reads as ${cycleStage} ${cyclePosition}. ${bits.join(' ')}${tail}`
}

export async function generateCycleNarrative(
  partial: Omit<CycleAnalysis, 'narrative'>,
  marketLabel: string
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return fallbackCycleNarrative(partial)

  const rentDir = sanitizeCycleSignalText(partial.signals.rent.direction)
  const rentVal = sanitizeCycleSignalText(partial.signals.rent.value)
  const vacDir = sanitizeCycleSignalText(partial.signals.vacancy.direction)
  const vacVal = sanitizeCycleSignalText(partial.signals.vacancy.value)
  const permDir = sanitizeCycleSignalText(partial.signals.permits.direction)
  const permVal = sanitizeCycleSignalText(partial.signals.permits.value)
  const empDir = sanitizeCycleSignalText(partial.signals.employment.direction)
  const empVal = sanitizeCycleSignalText(partial.signals.employment.value)

  const prompt = `You are a real estate analyst writing a one-paragraph market brief for a consulting client.

Market: ${marketLabel}
ZIP (anchor): ${partial.zip}
Cycle position: ${partial.cycleStage} ${partial.cyclePosition} - this classification is LOCKED; do not contradict or re-label it.
Confidence: ${partial.confidence}% (${partial.signalsAgreement}/4 signals agree)
Data quality: ${partial.dataQuality}${partial.transitional ? ' · transitional / mixed read' : ''}

Rent signal: ${rentDir} - ${rentVal}
Vacancy signal: ${vacDir} - ${vacVal}
Permit signal: ${permDir} - ${permVal}
Employment signal: ${empDir} - ${empVal}

Deterministic summary line (for tone only): ${sanitizeCycleSignalText(partial.confidenceLine)}

Write exactly 2–3 sentences. Reference specific numbers or percentages from the four signal lines whenever they contain quantitative detail. End with one forward-looking implication for a developer or investor (supply, rents, risk, or timing). Sound like a human analyst - not a list.

No bullet points, no JSON, no markdown. Do not use vague filler such as "nuanced picture," "presents opportunities," "robust outlook," or "landscape."

${GEMINI_NO_EM_DASH_RULE}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 2048 },
    })
    const result = await model.generateContent(prompt)
    const response = result.response as unknown as {
      text: () => string
      candidates?: Array<{ finishReason?: string }>
    }
    const finish = response.candidates?.[0]?.finishReason
    const text = stripGeminiStringWrappers(response.text().trim())
    // Truncated model output often ends mid-clause (e.g. "confidence (9"); prefer full deterministic brief.
    if (finish === 'MAX_TOKENS') return fallbackCycleNarrative(partial)
    if (text.length > 40) return text
    return fallbackCycleNarrative(partial)
  } catch {
    return fallbackCycleNarrative(partial)
  }
}
