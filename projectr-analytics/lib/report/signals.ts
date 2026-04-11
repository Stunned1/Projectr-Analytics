import type { ClientReportPayload, SignalIndicator } from './types'

function trendUnemployment(points: { date: string; value: number }[]): 'up' | 'down' | 'flat' {
  if (points.length < 4) return 'flat'
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const recent = sorted.slice(-3).reduce((s, p) => s + p.value, 0) / 3
  const older = sorted.slice(0, 3).reduce((s, p) => s + p.value, 0) / Math.min(3, sorted.length)
  if (recent < older - 0.15) return 'down'
  if (recent > older + 0.15) return 'up'
  return 'flat'
}

export function buildSignalIndicators(payload: ClientReportPayload): SignalIndicator[] {
  const { zillow, census, permits, employment, fred } = payload

  const rentArrow: 'up' | 'down' | 'flat' =
    zillow.zori_growth_yoy == null
      ? 'flat'
      : zillow.zori_growth_yoy > 0.5
        ? 'up'
        : zillow.zori_growth_yoy < -0.5
          ? 'down'
          : 'flat'

  const vacancy = census.vacancy_rate
  const vacancyArrow: 'up' | 'down' | 'flat' =
    vacancy == null ? 'flat' : vacancy > 9 ? 'up' : vacancy < 6 ? 'down' : 'flat'

  const byYear = [...permits.by_year].sort((a, b) => a.year.localeCompare(b.year))
  const firstU = byYear[0]?.units ?? 0
  const lastU = byYear[byYear.length - 1]?.units ?? 0
  const permitsArrow: 'up' | 'down' | 'flat' =
    byYear.length < 2 ? 'flat' : lastU > firstU * 1.1 ? 'up' : lastU < firstU * 0.9 ? 'down' : 'flat'

  const uTrend = trendUnemployment(fred.unemployment_monthly)
  const employmentArrow: 'up' | 'down' | 'flat' =
    uTrend === 'down' ? 'up' : uTrend === 'up' ? 'down' : 'flat'

  const rentLine =
    rentArrow === 'up'
      ? 'Rent index rising vs. prior year — landlord pricing power intact.'
      : rentArrow === 'down'
        ? 'Rent index softening YoY — watch concessions and lease-up risk.'
        : 'Rent index roughly flat YoY — stable rent regime.'

  const vacancyLine =
    vacancy == null
      ? 'Vacancy data unavailable for this view.'
      : vacancyArrow === 'down'
        ? `Vacancy near ${vacancy.toFixed(1)}% — tight occupancy signal.`
        : vacancyArrow === 'up'
          ? `Vacancy elevated near ${vacancy.toFixed(1)}% — monitor supply pressure.`
          : `Vacancy near ${vacancy.toFixed(1)}% — balanced occupancy.`

  const permitsLine =
    permitsArrow === 'up'
      ? 'County permit pipeline accelerating — forward supply building.'
      : permitsArrow === 'down'
        ? 'Permit volumes cooling — less near-term delivery risk.'
        : 'Permit trend mixed — pipeline steady vs. prior years.'

  const employmentLine =
    employmentArrow === 'up'
      ? 'Local unemployment trending down — labor market supportive.'
      : employmentArrow === 'down'
        ? 'Unemployment drifting up — macro headwind for demand.'
        : 'Employment signal neutral — no sharp labor shock.'

  const indicators: SignalIndicator[] = [
    {
      id: 'rent',
      label: 'Rent',
      arrow: rentArrow,
      line: rentLine,
      positiveForInvestor: rentArrow === 'up',
    },
    {
      id: 'vacancy',
      label: 'Vacancy',
      arrow: vacancyArrow,
      line: vacancyLine,
      positiveForInvestor: vacancyArrow === 'down',
    },
    {
      id: 'permits',
      label: 'Permits',
      arrow: permitsArrow,
      line: permitsLine,
      positiveForInvestor: permitsArrow === 'down',
    },
    {
      id: 'employment',
      label: 'Employment',
      arrow: employmentArrow,
      line: employmentLine,
      positiveForInvestor: employmentArrow === 'up',
    },
  ]

  return indicators
}

export function confidenceFromSignals(signals: SignalIndicator[]): string {
  const n = signals.filter((s) => s.arrow !== 'flat').length
  const pos = signals.filter((s) => s.positiveForInvestor).length
  const total = signals.length
  return `${pos}/${total} signals supportive of a landlord / development read`
}
