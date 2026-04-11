import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import type { LocationColumnSuggestion, UploadRawRow } from './types'

function isLikelyZip(text: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(text.trim())
}

function isLikelyLat(text: string): boolean {
  const n = Number(text)
  return Number.isFinite(n) && n >= -90 && n <= 90
}

function isLikelyLng(text: string): boolean {
  const n = Number(text)
  return Number.isFinite(n) && n >= -180 && n <= 180
}

function scoreColumn(column: string, sampleRows: UploadRawRow[]): { score: number; reason: string } {
  const lower = column.toLowerCase()
  let score = 0
  const reasons: string[] = []

  if (/(address|street|location|site|property)/.test(lower)) {
    score += 45
    reasons.push('name suggests address/location')
  }
  if (/(zip|postal)/.test(lower)) {
    score += 40
    reasons.push('name suggests postal code')
  }
  if (/(city|county|state)/.test(lower)) {
    score += 15
    reasons.push('name suggests place field')
  }
  if (/^lat(itude)?$/.test(lower)) {
    score += 25
    reasons.push('name suggests latitude')
  }
  if (/^(lon|lng|longitude)$/.test(lower)) {
    score += 25
    reasons.push('name suggests longitude')
  }

  const values = sampleRows
    .map((row) => row[column])
    .filter((v): v is string | number | boolean => v !== null && v !== undefined)
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0)

  if (values.length > 0) {
    const zipMatches = values.filter(isLikelyZip).length
    const latMatches = values.filter(isLikelyLat).length
    const lngMatches = values.filter(isLikelyLng).length
    const addressLike = values.filter((v) => /[A-Za-z]/.test(v) && /\d/.test(v)).length

    if (zipMatches / values.length >= 0.6) {
      score += 35
      reasons.push('sample values match zip pattern')
    }
    if (latMatches / values.length >= 0.8) {
      score += 20
      reasons.push('sample values match latitude range')
    }
    if (lngMatches / values.length >= 0.8) {
      score += 20
      reasons.push('sample values match longitude range')
    }
    if (addressLike / values.length >= 0.4) {
      score += 25
      reasons.push('sample values look like street addresses')
    }
  }

  return {
    score,
    reason: reasons.join('; ') || 'best available heuristic match',
  }
}

export function heuristicLocationColumnSuggestion(
  columns: string[],
  sampleRows: UploadRawRow[]
): LocationColumnSuggestion {
  if (columns.length === 0) {
    return { suggestedLocationColumn: null, confidence: 0.1, reasoning: 'No columns provided.' }
  }

  const ranked = columns.map((column) => ({ column, ...scoreColumn(column, sampleRows) }))
  ranked.sort((a, b) => b.score - a.score)
  const top = ranked[0]

  if (!top || top.score < 25) {
    return {
      suggestedLocationColumn: null,
      confidence: 0.2,
      reasoning: 'Could not confidently identify a location column from headers/samples.',
    }
  }

  const confidence = Math.min(0.98, Math.max(0.3, top.score / 100))
  return {
    suggestedLocationColumn: top.column,
    confidence,
    reasoning: `Heuristic match: ${top.reason}.`,
  }
}

async function geminiLocationColumnSuggestion(
  columns: string[],
  sampleRows: UploadRawRow[]
): Promise<LocationColumnSuggestion | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const prompt = [
    'Identify the single best location column from uploaded tabular data.',
    'Return ONLY valid JSON with this exact shape:',
    '{"suggestedLocationColumn":"string|null","confidence":0.0,"reasoning":"string"}',
    'If no column appears usable for geocoding, return null for suggestedLocationColumn.',
    GEMINI_NO_EM_DASH_RULE,
    `Columns: ${JSON.stringify(columns)}`,
    `SampleRows: ${JSON.stringify(sampleRows.slice(0, 12))}`,
  ].join('\n')

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  const parsed = JSON.parse(raw) as LocationColumnSuggestion
  if (
    parsed &&
    (parsed.suggestedLocationColumn === null || columns.includes(parsed.suggestedLocationColumn)) &&
    typeof parsed.confidence === 'number'
  ) {
    return {
      suggestedLocationColumn: parsed.suggestedLocationColumn,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reasoning: parsed.reasoning,
    }
  }
  return null
}

export async function suggestLocationColumn(
  columns: string[],
  sampleRows: UploadRawRow[]
): Promise<{ suggestion: LocationColumnSuggestion; source: 'gemini' | 'heuristic' }> {
  const fallback = heuristicLocationColumnSuggestion(columns, sampleRows)
  try {
    const gemini = await geminiLocationColumnSuggestion(columns, sampleRows)
    if (gemini) return { suggestion: gemini, source: 'gemini' }
  } catch {
    // fall through
  }
  return { suggestion: fallback, source: 'heuristic' }
}
