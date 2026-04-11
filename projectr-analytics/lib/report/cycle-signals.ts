import type { CycleAnalysis, CycleSignalDetail } from '@/lib/cycle/types'
import { sanitizeCycleSignalText } from '@/lib/sanitize-gemini-string'
import type { SignalIndicator } from './types'

function rentArrow(score: number): SignalIndicator['arrow'] {
  if (score >= 1) return 'up'
  if (score <= -1) return 'down'
  return 'flat'
}

/** Low / tight vacancy reads as a "down" arrow on the vacancy metric (legacy PDF convention). */
function vacancyArrow(score: number): SignalIndicator['arrow'] {
  if (score >= 1) return 'down'
  if (score <= -1) return 'up'
  return 'flat'
}

function permitsArrow(score: number): SignalIndicator['arrow'] {
  return rentArrow(score)
}

function employmentArrow(score: number): SignalIndicator['arrow'] {
  return rentArrow(score)
}

function lineFromDetail(d: CycleSignalDetail): string {
  return `${sanitizeCycleSignalText(d.direction)} — ${sanitizeCycleSignalText(d.value)}`
}

export function cycleAnalysisToSignalIndicators(cycle: CycleAnalysis): SignalIndicator[] {
  const { rent, vacancy, permits, employment } = cycle.signals

  return [
    {
      id: 'rent',
      label: 'Rent',
      arrow: rentArrow(rent.score),
      line: lineFromDetail(rent),
      positiveForInvestor: rent.score === 1,
    },
    {
      id: 'vacancy',
      label: 'Vacancy',
      arrow: vacancyArrow(vacancy.score),
      line: lineFromDetail(vacancy),
      positiveForInvestor: vacancy.score === 1,
    },
    {
      id: 'permits',
      label: 'Permits',
      arrow: permitsArrow(permits.score),
      line: lineFromDetail(permits),
      positiveForInvestor: permits.score === -1,
    },
    {
      id: 'employment',
      label: 'Employment',
      arrow: employmentArrow(employment.score),
      line: lineFromDetail(employment),
      positiveForInvestor: employment.score === 1,
    },
  ]
}
