import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ClientReportPayload, GeminiBriefResult, SignalIndicator } from './types'

const FALLBACK: GeminiBriefResult = {
  cycleHeadline: 'Submarket under mixed signals — review data pack',
  narrative:
    'Current indicators point to a balanced market without a single dominant driver. Rent, occupancy, permits, and labor are sending overlapping signals, so underwriting should stress-test both upside lease scenarios and downside absorption.',
  confidenceLine: 'Signal mix — proceed with scenario-based planning.',
}

export async function generateBriefWithGemini(
  payload: ClientReportPayload,
  signals: SignalIndicator[],
  confidenceLine: string
): Promise<GeminiBriefResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return { ...FALLBACK, confidenceLine }

  const signalSummary = signals
    .map((s) => `${s.label}: ${s.arrow.toUpperCase()} — ${s.line}`)
    .join('\n')

  const ctx = `
Submarket: ${payload.marketLabel}
ZIP: ${payload.primaryZip ?? 'aggregate / area'}
Metro: ${payload.metroName ?? 'N/A'}
ZORI: ${payload.zillow.zori ?? 'N/A'} (${payload.zillow.zori_growth_yoy ?? 'N/A'}% YoY)
ZHVI: ${payload.zillow.zhvi ?? 'N/A'}
Vacancy: ${payload.census.vacancy_rate ?? 'N/A'}%
Permits (county BPS 2021-23 units): ${payload.permits.total_units_2021_2023 ?? 'N/A'}
Unemployment (latest): ${payload.employment.unemployment_rate ?? 'N/A'}%

Computed signals:
${signalSummary}

Confidence (deterministic): ${confidenceLine}
`

  const prompt = `You are a senior real estate analyst at Projectr Analytics. Output ONLY valid JSON (no markdown).

Choose ONE cycle phase for the headline sentence fragment (after the submarket name):
- Early Recovery
- Mid Expansion
- Late Expansion
- Early Contraction
- Deep Contraction

The client-facing headline format must be: "{Submarket} is in {Phase}" — use the exact submarket name from context.

Also write narrative: exactly 2 or 3 sentences, professional, as if a human analyst wrote it. No bullet points. Reference at most two specific numbers from the data.

Return JSON shape:
{
  "cyclePhase": "Late Expansion",
  "narrative": "two or three sentences here",
  "confidenceEcho": "short optional echo of agreement line"
}

Use confidenceEcho to restate agreement in one short clause (e.g. "Three of four signals align with late-cycle rent strength.") or null.

Context:
${ctx}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    })
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(raw) as {
      cyclePhase?: string
      narrative?: string
      confidenceEcho?: string | null
    }

    const phase = typeof parsed.cyclePhase === 'string' ? parsed.cyclePhase.trim() : 'Market Assessment'
    const narrative =
      typeof parsed.narrative === 'string' && parsed.narrative.length > 20
        ? parsed.narrative.trim()
        : FALLBACK.narrative

    const headline = `${payload.marketLabel} is in ${phase}`

    const conf =
      typeof parsed.confidenceEcho === 'string' && parsed.confidenceEcho.length > 5
        ? parsed.confidenceEcho.trim()
        : confidenceLine

    return {
      cycleHeadline: headline,
      narrative,
      confidenceLine: conf,
    }
  } catch {
    return { ...FALLBACK, confidenceLine }
  }
}
