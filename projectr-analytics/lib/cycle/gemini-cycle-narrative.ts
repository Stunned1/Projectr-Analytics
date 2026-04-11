import { GoogleGenerativeAI } from '@google/generative-ai'
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

  const ctx = JSON.stringify({
    marketLabel,
    zip: partial.zip,
    cyclePosition: partial.cyclePosition,
    cycleStage: partial.cycleStage,
    confidence: partial.confidence,
    signalsAgreement: partial.signalsAgreement,
    dataQuality: partial.dataQuality,
    transitional: partial.transitional,
    confidenceLine: partial.confidenceLine,
    signals: partial.signals,
  })

  const prompt = `You are a senior multifamily / residential investment analyst at Projectr Analytics.

The deterministic cycle classifier has already locked in the phase — do NOT contradict it.

Write exactly 2 or 3 sentences of narrative for the executive brief. Sound like a human analyst, not a list.
Reference at most three concrete facts from the signal values (numbers or percentages) when available.
Explain what the phase implies for supply/demand and underwriting (risk or opportunity), in plain language.
No bullet points, no JSON, no markdown.

Classifier output (JSON):
${ctx}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 512 },
    })
    const result = await model.generateContent(prompt)
    const text = stripGeminiStringWrappers(result.response.text().trim())
    if (text.length > 40) return text
    return fallbackCycleNarrative(partial)
  } catch {
    return fallbackCycleNarrative(partial)
  }
}
