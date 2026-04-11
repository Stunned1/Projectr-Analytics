import type { CycleAnalysis, CycleSignalDetail, CycleSignalScore } from '@/lib/cycle/types'
import { sanitizeCycleAnalysisForDisplay } from '@/lib/sanitize-gemini-string'

function coerceZip(raw: unknown): string | null {
  if (typeof raw === 'string' && /^\d{5}$/.test(raw.trim())) return raw.trim()
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 99999) {
    return String(raw).padStart(5, '0')
  }
  return null
}

function coerceSignalScore(raw: unknown): CycleSignalScore | null {
  if (raw === 1 || raw === -1 || raw === 0) return raw
  if (raw === '1') return 1
  if (raw === '-1') return -1
  if (raw === '0') return 0
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw)
  if (n === 1) return 1
  if (n === -1) return -1
  if (n === 0 && raw !== '' && raw != null && !Number.isNaN(n)) return 0
  return null
}

function coerceSignalStr(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  return ''
}

function parseSignalDetail(raw: unknown): CycleSignalDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const score = coerceSignalScore(o.score)
  if (score === null) return null
  return {
    score,
    direction: coerceSignalStr(o.direction),
    value: coerceSignalStr(o.value),
    source: coerceSignalStr(o.source),
  }
}

function coerceFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t === '') return null
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  return null
}

function coerceBool(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === 1 || raw === '1') return true
  if (raw === 'false' || raw === 0 || raw === '0') return false
  return false
}

/** Accepts client-supplied cycle JSON; coerces common JSON/stringify shapes before display. */
export function parseCycleAnalysisField(raw: unknown): CycleAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>

  const zip = coerceZip(c.zip)
  if (!zip) return null

  const pos = c.cyclePosition
  const stage = c.cycleStage
  const dq = c.dataQuality
  if (!['Recovery', 'Expansion', 'Hypersupply', 'Recession'].includes(pos as string)) return null
  if (!['Early', 'Mid', 'Late'].includes(stage as string)) return null
  if (!['High', 'Medium', 'Low'].includes(dq as string)) return null

  const narrative = coerceSignalStr(c.narrative)
  const confidenceLine = coerceSignalStr(c.confidenceLine)
  if (narrative.trim().length === 0 || confidenceLine.trim().length === 0) return null

  const confidence = coerceFiniteNumber(c.confidence)
  const signalsAgreement = coerceFiniteNumber(c.signalsAgreement)
  if (confidence == null || signalsAgreement == null) return null

  const sig = c.signals
  if (!sig || typeof sig !== 'object') return null
  const s = sig as Record<string, unknown>
  const rent = parseSignalDetail(s.rent)
  const vacancy = parseSignalDetail(s.vacancy)
  const permits = parseSignalDetail(s.permits)
  const employment = parseSignalDetail(s.employment)
  if (!rent || !vacancy || !permits || !employment) return null

  const normalized: CycleAnalysis = {
    zip,
    cyclePosition: pos as CycleAnalysis['cyclePosition'],
    cycleStage: stage as CycleAnalysis['cycleStage'],
    confidence,
    signalsAgreement: Math.round(signalsAgreement),
    signals: { rent, vacancy, permits, employment },
    dataQuality: dq as CycleAnalysis['dataQuality'],
    narrative,
    confidenceLine,
    transitional: coerceBool(c.transitional),
  }

  return sanitizeCycleAnalysisForDisplay(normalized)
}
