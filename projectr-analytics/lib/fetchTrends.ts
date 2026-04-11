/**
 * Google Trends Fetcher
 *
 * Queries search interest for rental/real estate keywords.
 * Uses the unofficial google-trends-api (no key required).
 *
 * Strategy per MVP:
 * 1. Try city-level: "apartments in {city}" geo=US-{STATE}
 * 2. If all zeros (small market), fall back to state-level: "apartments {state}" geo=US-{STATE}
 *
 * Returns a TIME_SERIES of weekly interest scores (0-100).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleTrends = require('google-trends-api')

import type { GeoResult } from './geocoder'
import type { MasterDataRow } from './supabase'

type PartialRow = Omit<MasterDataRow, 'id' | 'created_at'>

export type FetchTrendsResult =
  | { ok: true; rows: PartialRow[] }
  | { ok: false; error: string }

interface TrendPoint {
  time: string
  formattedTime: string
  value: number[]
  hasData: boolean[]
}

interface TrendsResult {
  keyword: string
  geo: string
  isFallback: boolean
  points: Array<{ date: string; value: number }>
}

async function queryTrends(keyword: string, geo: string): Promise<TrendPoint[]> {
  const endTime = new Date()
  const startTime = new Date()
  startTime.setFullYear(startTime.getFullYear() - 1) // last 12 months

  const raw = await googleTrends.interestOverTime({
    keyword,
    geo,
    startTime,
    endTime,
  })

  let parsed: { default?: { timelineData?: TrendPoint[] } }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Google Trends response was not valid JSON')
  }
  return parsed?.default?.timelineData ?? []
}

/**
 * @param submarketId - Stored on synthetic rows (ZIP code, or e.g. `city:Austin:TX`)
 */
export async function fetchTrends(geo: GeoResult, submarketId: string): Promise<FetchTrendsResult> {
  const stateGeo = `US-${geo.state}`
  const results: PartialRow[] = []

  try {
    let trendsResult: TrendsResult | null = null

    const cityKeyword = `apartments in ${geo.city}`
    const cityPoints = await queryTrends(cityKeyword, stateGeo)
    const cityHasData = cityPoints.some((p) => p.hasData[0] && p.value[0] > 0)

    if (cityHasData) {
      trendsResult = {
        keyword: cityKeyword,
        geo: stateGeo,
        isFallback: false,
        points: cityPoints
          .filter((p) => p.hasData[0])
          .map((p) => ({
            date: new Date(parseInt(p.time) * 1000).toISOString().split('T')[0],
            value: p.value[0],
          })),
      }
    } else {
      await new Promise((r) => setTimeout(r, 1000))
      const stateKeyword = `apartments ${geo.state}`
      const statePoints = await queryTrends(stateKeyword, stateGeo)

      trendsResult = {
        keyword: stateKeyword,
        geo: stateGeo,
        isFallback: true,
        points: statePoints
          .filter((p) => p.hasData[0])
          .map((p) => ({
            date: new Date(parseInt(p.time) * 1000).toISOString().split('T')[0],
            value: p.value[0],
          })),
      }
    }

    if (!trendsResult || trendsResult.points.length === 0) {
      return { ok: true, rows: [] }
    }

    for (const point of trendsResult.points) {
      results.push({
        submarket_id: submarketId,
        geometry: null,
        metric_name: trendsResult.isFallback
          ? 'Search_Interest_State'
          : 'Search_Interest_Local',
        metric_value: point.value,
        time_period: point.date,
        data_source: 'Google Trends',
        visual_bucket: 'TIME_SERIES',
      })
    }

    const latest = trendsResult.points.at(-1)
    if (latest) {
      results.push({
        submarket_id: submarketId,
        geometry: null,
        metric_name: 'Search_Interest_Latest',
        metric_value: latest.value,
        time_period: latest.date,
        data_source: 'Google Trends',
        visual_bucket: 'TABULAR',
      })
    }

    return { ok: true, rows: results }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Google Trends request failed'
    return { ok: false, error: msg.length > 160 ? `${msg.slice(0, 157)}…` : msg }
  }
}
