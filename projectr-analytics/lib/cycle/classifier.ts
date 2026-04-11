import type { ComputedCycleFeatures } from './compute-signals'
import type { CycleAnalysis, CycleDataQuality, CyclePosition, CycleStage, CycleSignalDetail } from './types'

/** Rent (ZORI monthly), permits (BPS multi-year), and FRED can form time series; ACS vacancy in cache is point-in-time only. */
function dataQualityFromTsCount(n: number): CycleDataQuality {
  if (n >= 3) return 'High'
  if (n === 2) return 'Medium'
  return 'Low'
}

function signalSupportsPosition(
  pos: CyclePosition,
  s: { rent: CycleSignalDetail; vacancy: CycleSignalDetail; permits: CycleSignalDetail; employment: CycleSignalDetail }
): boolean[] {
  const { rent, vacancy, permits, employment } = s

  switch (pos) {
    case 'Recession':
      return [
        rent.score <= 0,
        true,
        permits.score <= 0,
        employment.score <= 0,
      ]
    case 'Hypersupply':
      return [
        rent.score <= 0,
        vacancy.score <= 0,
        permits.score >= 1,
        true,
      ]
    case 'Recovery':
      return [
        rent.score >= -1,
        vacancy.score <= 0,
        permits.score <= 0,
        employment.score >= 0,
      ]
    case 'Expansion':
    default:
      return [
        rent.score >= 0,
        vacancy.score >= 0,
        permits.score === 1 ? rent.score >= 0 : permits.score >= -1,
        employment.score >= 0,
      ]
  }
}

function agreementFor(pos: CyclePosition, features: ComputedCycleFeatures): number {
  const sig = {
    rent: features.rent,
    vacancy: features.vacancy,
    permits: features.permits,
    employment: features.employment,
  }
  return signalSupportsPosition(pos, sig).filter(Boolean).length
}

function pickPosition(f: ComputedCycleFeatures): CyclePosition {
  const { rent, permits, employment } = f
  const u = f.unempDelta6m
  const pYoY = f.permYoYLatest
  const pAcc = f.permAccel ?? 0
  const vac = f.vacancyPct

  const laborWeak = employment.score === -1 || (u != null && u > 0.15)
  const laborStrong = employment.score === 1 || (u != null && u < -0.08)
  const rentWeak = rent.score <= 0 && (f.rentYoyFallback == null || f.rentYoyFallback < 1.5)
  const rentStrong = rent.score === 1
  const supplyHot =
    (pYoY != null && pYoY > 14) ||
    (pYoY != null && pYoY > 7 && pAcc > 5) ||
    (permits.score === 1 && pAcc > 8)
  const elevatedVacancy = vac != null && vac > 7.5

  if (laborWeak && rentWeak && (u == null || u > 0.05)) return 'Recession'

  if (supplyHot && (rent.score <= 0 || (f.rentYoyFallback != null && f.rentYoyFallback < 2))) return 'Hypersupply'

  if (laborStrong && elevatedVacancy && rent.score >= -1 && (pYoY == null || pYoY < 25)) return 'Recovery'

  if (rentStrong && !laborWeak) return 'Expansion'

  if (!laborWeak && rent.score >= 0) return 'Expansion'

  if (supplyHot) return 'Hypersupply'

  return laborWeak ? 'Recession' : 'Expansion'
}

function pickStage(pos: CyclePosition, f: ComputedCycleFeatures): CycleStage {
  const { rent, vacancy, permits } = f
  const pAcc = f.permAccel ?? 0
  const pYoY = f.permYoYLatest ?? 0

  if (pos === 'Expansion') {
    const lateWarning =
      permits.score === 1 &&
      pAcc > 4 &&
      (rent.score <= 0 || (f.rent3moPct != null && f.rent3moPct < 0.8 && f.rent3moPct > -2))
    if (lateWarning && vacancy.score >= 0) return 'Late'
    if (vacancy.score <= 0 && permits.score <= 0) return 'Early'
    if (permits.score === 1 && rent.score === 1 && vacancy.score >= 0) return 'Mid'
    if (vacancy.score <= 0) return 'Early'
    return 'Mid'
  }

  if (pos === 'Recovery') {
    if (f.vacancyPct != null && f.vacancyPct > 9 && permits.score <= 0) return 'Early'
    if (rent.score === 1 && permits.score >= 0) return 'Late'
    return 'Mid'
  }

  if (pos === 'Hypersupply') {
    if (pYoY > 20 && pAcc > 5) return 'Late'
    if (permits.score <= 0) return 'Early'
    return 'Mid'
  }

  if (pos === 'Recession') {
    if (rent.score === -1 && f.employment.score === -1) return 'Late'
    return 'Mid'
  }

  return 'Mid'
}

function baseConfidence(agreement: number): { min: number; max: number; label: string } {
  switch (agreement) {
    case 4:
      return { min: 85, max: 100, label: 'High' }
    case 3:
      return { min: 65, max: 84, label: 'Medium-High' }
    case 2:
      return { min: 40, max: 64, label: 'Medium' }
    case 1:
      return { min: 20, max: 39, label: 'Low' }
    default:
      return { min: 10, max: 24, label: 'Low' }
  }
}

function applyQualityCap(confidence: number, q: CycleDataQuality): number {
  const cap = q === 'High' ? 100 : q === 'Medium' ? 82 : 58
  return Math.min(Math.round(confidence), cap)
}

function buildConfidenceLine(agreement: number, label: string, confidence: number, transitional: boolean): string {
  const tail = transitional ? ' — transitional / mixed signals' : ''
  if (agreement <= 1) {
    return `${agreement} of 4 signals align — insufficient signal for a clean cycle read (${label}, score ${confidence}).${tail}`
  }
  return `${agreement} of 4 signals align — ${label} confidence (${confidence}).${tail}`
}

export function classifyCycle(zip: string, features: ComputedCycleFeatures): Omit<CycleAnalysis, 'narrative'> {
  const position = pickPosition(features)
  const stage = pickStage(position, features)
  const signalsAgreement = agreementFor(position, features)
  const { min, max, label } = baseConfidence(signalsAgreement)
  const rawConfidence = Math.round((min + max) / 2)
  const dataQuality = dataQualityFromTsCount(features.timeSeriesCount)
  const confidence = applyQualityCap(rawConfidence, dataQuality)
  const transitional = signalsAgreement === 2

  const confidenceLine = buildConfidenceLine(signalsAgreement, label, confidence, transitional)

  return {
    zip,
    cyclePosition: position,
    cycleStage: stage,
    confidence,
    signalsAgreement,
    signals: {
      rent: features.rent,
      vacancy: features.vacancy,
      permits: features.permits,
      employment: features.employment,
    },
    dataQuality,
    confidenceLine,
    transitional,
  }
}
