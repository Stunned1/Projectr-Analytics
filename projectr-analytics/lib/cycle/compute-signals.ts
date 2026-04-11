import type { CycleRawInputs } from './load-data'
import type { CycleSignalDetail, CycleSignalScore, MasterRow } from './types'

function clampScore(n: number): CycleSignalScore {
  if (n >= 1) return 1
  if (n <= -1) return -1
  return 0
}

function fredUnemploymentSeries(rows: MasterRow[]): { date: string; value: number }[] {
  return rows
    .filter((r) => r.metric_name === 'Unemployment_Rate' && r.data_source === 'FRED' && r.time_period)
    .sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
    .map((r) => ({ date: r.time_period!, value: r.metric_value }))
}

function permitUnitsByYear(rows: MasterRow[]): { year: string; units: number }[] {
  const units = rows.filter((r) => r.metric_name === 'Permit_Units' && r.data_source === 'Census BPS' && r.time_period)
  return [...units]
    .sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
    .map((r) => ({
      year: (r.time_period ?? '').slice(0, 4),
      units: Math.round(r.metric_value),
    }))
}

function latestVacancy(rows: MasterRow[]): number | null {
  const r = rows.find((x) => x.metric_name === 'Vacancy_Rate' && x.data_source === 'Census ACS')
  return r?.metric_value != null && Number.isFinite(r.metric_value) ? r.metric_value : null
}

export interface ComputedCycleFeatures {
  rent: CycleSignalDetail
  vacancy: CycleSignalDetail
  permits: CycleSignalDetail
  employment: CycleSignalDetail
  /** 3-month total % change on ZORI when monthly series used */
  rent3moPct: number | null
  rentYoyFallback: number | null
  usedZoriSlope: boolean
  vacancyPct: number | null
  permYoYLatest: number | null
  permYoYPrior: number | null
  permAccel: number | null
  /** Latest minus ~6 months earlier (percentage points); positive = unemployment worsening */
  unempDelta6m: number | null
  timeSeriesCount: number
}

export function computeCycleSignals(inputs: CycleRawInputs): ComputedCycleFeatures {
  const { masterRows, zoriMonthly, zoriGrowthYoy } = inputs

  let rent: CycleSignalDetail
  let rent3moPct: number | null = null
  let usedZoriSlope = false
  const last4 = zoriMonthly.length >= 4 ? zoriMonthly.slice(-4) : []

  if (last4.length >= 4) {
    const first = last4[0]!.zori
    const last = last4[last4.length - 1]!.zori
    if (first > 0 && last > 0) {
      rent3moPct = ((last - first) / first) * 100
      usedZoriSlope = true
    }
  }

  if (usedZoriSlope && rent3moPct != null) {
    const s =
      rent3moPct > 1.25 ? 1 : rent3moPct < -1 ? -1 : 0
    const dir =
      s === 1 ? 'Rent trajectory strengthening (3-month)' : s === -1 ? 'Rent trajectory softening (3-month)' : 'Rent trajectory roughly flat (3-month)'
    rent = {
      score: clampScore(s),
      direction: dir,
      value: `${rent3moPct >= 0 ? '+' : ''}${rent3moPct.toFixed(2)}% over 3 months`,
      source: 'ZORI 3-month slope',
    }
  } else if (zoriGrowthYoy != null) {
    const s = zoriGrowthYoy > 2 ? 1 : zoriGrowthYoy < -0.5 ? -1 : 0
    rent = {
      score: clampScore(s),
      direction:
        s === 1 ? 'Rent up year-over-year' : s === -1 ? 'Rent down year-over-year' : 'Rent growth muted YoY',
      value: `${zoriGrowthYoy >= 0 ? '+' : ''}${zoriGrowthYoy.toFixed(2)}% YoY`,
      source: 'Zillow snapshot YoY fallback',
    }
  } else {
    rent = {
      score: 0,
      direction: 'Insufficient rent trend data',
      value: '-',
      source: 'Unavailable',
    }
  }

  const vacancyPct = latestVacancy(masterRows)
  let vacancy: CycleSignalDetail
  if (vacancyPct == null) {
    vacancy = {
      score: 0,
      direction: 'Vacancy data unavailable',
      value: '-',
      source: 'ACS - not cached',
    }
  } else {
    const s = vacancyPct < 6.5 ? 1 : vacancyPct > 10.5 ? -1 : 0
    vacancy = {
      score: clampScore(s),
      direction:
        s === 1 ? 'Occupancy tight (low vacancy)' : s === -1 ? 'Elevated vacancy vs. typical' : 'Balanced occupancy',
      value: `${vacancyPct.toFixed(1)}%`,
      source: 'ACS 5-year (2022 vintage, ZIP)',
    }
  }

  const byYear = permitUnitsByYear(masterRows)
  let permits: CycleSignalDetail
  let permYoYLatest: number | null = null
  let permYoYPrior: number | null = null
  let permAccel: number | null = null

  if (byYear.length >= 2) {
    const sorted = [...byYear].sort((a, b) => a.year.localeCompare(b.year))
    const ys = sorted.map((x) => x.units)
    const yLast = ys[ys.length - 1]!
    const yPrev = ys[ys.length - 2]!
    if (yPrev > 0) permYoYLatest = ((yLast - yPrev) / yPrev) * 100
    if (ys.length >= 3) {
      const yPrev2 = ys[ys.length - 3]!
      if (yPrev2 > 0) permYoYPrior = ((yPrev - yPrev2) / yPrev2) * 100
      if (permYoYLatest != null && permYoYPrior != null) permAccel = permYoYLatest - permYoYPrior
    }
    const yoy = permYoYLatest ?? 0
    const s = yoy > 12 ? 1 : yoy < -12 ? -1 : 0
    const accelStr = permAccel != null ? `; acceleration ${permAccel >= 0 ? '+' : ''}${permAccel.toFixed(1)} pp vs. prior YoY` : ''
    permits = {
      score: clampScore(s),
      direction:
        s === 1
          ? 'County permit pipeline expanding briskly'
          : s === -1
            ? 'County permit pipeline contracting'
            : 'Permit pipeline steady vs. prior year',
      value: `Units YoY ${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%${accelStr}`,
      source: 'Census BPS (county)',
    }
  } else {
    permits = {
      score: 0,
      direction: 'Insufficient permit history',
      value: '-',
      source: 'Census BPS - not cached',
    }
  }

  const uSeries = fredUnemploymentSeries(masterRows)
  let employment: CycleSignalDetail
  let unempDelta6m: number | null = null
  if (uSeries.length >= 6) {
    const latest = uSeries[uSeries.length - 1]!.value
    const prior = uSeries[uSeries.length - 7]?.value ?? uSeries[0]!.value
    unempDelta6m = latest - prior
    const s = unempDelta6m < -0.2 ? 1 : unempDelta6m > 0.25 ? -1 : 0
    employment = {
      score: clampScore(s),
      direction:
        s === 1 ? 'Local unemployment trending down' : s === -1 ? 'Local unemployment trending up' : 'Labor market stable',
      value: `${unempDelta6m >= 0 ? '+' : ''}${unempDelta6m.toFixed(2)} pp over ~6 months`,
      source: 'FRED county unemployment (6-month change)',
    }
  } else if (uSeries.length >= 2) {
    const latest = uSeries[uSeries.length - 1]!.value
    const prior = uSeries[0]!.value
    unempDelta6m = latest - prior
    const s = unempDelta6m < -0.15 ? 1 : unempDelta6m > 0.2 ? -1 : 0
    employment = {
      score: clampScore(s),
      direction: 'Limited history - coarse labor read',
      value: `${unempDelta6m >= 0 ? '+' : ''}${unempDelta6m.toFixed(2)} pp (partial window)`,
      source: 'FRED county unemployment (partial series)',
    }
  } else {
    employment = {
      score: 0,
      direction: 'Unemployment series unavailable',
      value: '-',
      source: 'FRED - not cached',
    }
  }

  const rentTS = usedZoriSlope && zoriMonthly.length >= 4
  const vacTS = false
  const permitTS = byYear.length >= 2
  const empTS = uSeries.length >= 6
  const timeSeriesCount = [rentTS, vacTS, permitTS, empTS].filter(Boolean).length

  return {
    rent,
    vacancy,
    permits,
    employment,
    rent3moPct,
    rentYoyFallback: zoriGrowthYoy,
    usedZoriSlope,
    vacancyPct,
    permYoYLatest,
    permYoYPrior,
    permAccel,
    unempDelta6m,
    timeSeriesCount,
  }
}
