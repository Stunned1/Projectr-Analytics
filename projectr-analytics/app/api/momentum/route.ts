/**
 * Momentum Score API
 * Computes a 0–100 investment momentum score per ZIP from:
 * - Job market (FRED unemployment, inverted — lower = better)
 * - Rent growth (Zillow ZORI 12m YoY — stronger signal than Census median rent)
 * - Permit density (Census BPS units permitted)
 * - Population growth (Census ACS 3yr)
 *
 * All components normalized 0–100 across the input ZIP set, then weighted.
 * Returns scores + components for each ZIP.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface ZipScore {
  zip: string
  score: number
  label: 'Strong' | 'Moderate' | 'Weak' | 'No Data'
  components: {
    jobMarket: number | null
    rentGrowth: number | null
    permitDensity: number | null
    popGrowth: number | null
  }
}

const PERMIT_METRICS = ['Permit_Units', 'Permit_Buildings', 'Permit_Count']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const zips: string[] = body.zips ?? []
    if (!zips.length) return NextResponse.json({ error: 'No zip codes provided' }, { status: 400 })

    // Weights (must sum to 100)
    const w = { job: 0.25, rent: 0.35, permit: 0.25, pop: 0.15 }

    // 1. Pull Census/FRED metrics from master data
    const { data: masterRows } = await supabase
      .from('projectr_master_data')
      .select('submarket_id, metric_name, metric_value, created_at')
      .in('submarket_id', zips)
      .in('metric_name', ['Unemployment_Rate', 'Population_Growth_3yr', ...PERMIT_METRICS])
      .order('created_at', { ascending: false })

    // 2. Pull Zillow ZORI growth
    const { data: zillowRows } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_growth_12m, zhvi_growth_12m')
      .in('zip', zips)

    const zillowMap = new Map(zillowRows?.map((r) => [r.zip, r]) ?? [])

    // Latest value per zip per metric
    const byZip: Record<string, Record<string, number>> = {}
    for (const row of masterRows ?? []) {
      const z = row.submarket_id!
      if (!byZip[z]) byZip[z] = {}
      if (row.metric_value !== null && !(row.metric_name in byZip[z])) {
        byZip[z][row.metric_name] = row.metric_value
      }
    }

    // Raw component values per ZIP
    const raw = zips.map((zip) => {
      const m = byZip[zip] ?? {}
      const zillow = zillowMap.get(zip)

      const unemployment = m['Unemployment_Rate'] ?? null
      const jobRaw = unemployment !== null ? Math.max(0, 100 - unemployment * 10) : null

      // Prefer ZORI growth, fall back to ZHVI growth
      const rentGrowthPct = zillow?.zori_growth_12m ?? zillow?.zhvi_growth_12m ?? null

      const permits = m['Permit_Units'] ?? m['Permit_Buildings'] ?? m['Permit_Count'] ?? null
      const popGrowth = m['Population_Growth_3yr'] ?? null

      return { zip, jobRaw, rentGrowthPct, permits, popGrowth }
    })

    // Min-max normalize each component across the ZIP set
    function normalize(vals: (number | null)[], invert = false): Map<string, number | null> {
      const valid = vals.filter((v): v is number => v !== null)
      const min = valid.length ? Math.min(...valid) : NaN
      const max = valid.length ? Math.max(...valid) : NaN
      return new Map(
        zips.map((zip, i) => {
          const v = vals[i]
          if (v === null || !Number.isFinite(min) || max === min) return [zip, null]
          const t = (v - min) / (max - min)
          return [zip, Math.round((invert ? 1 - t : t) * 100)]
        })
      )
    }

    const jobScores = normalize(raw.map((r) => r.jobRaw))
    const rentScores = normalize(raw.map((r) => r.rentGrowthPct))
    const permitScores = normalize(raw.map((r) => r.permits))
    const popScores = normalize(raw.map((r) => r.popGrowth))

    const scores: ZipScore[] = zips.map((zip) => {
      const job = jobScores.get(zip) ?? null
      const rent = rentScores.get(zip) ?? null
      const permit = permitScores.get(zip) ?? null
      const pop = popScores.get(zip) ?? null

      const components = [
        job !== null ? job * w.job : null,
        rent !== null ? rent * w.rent : null,
        permit !== null ? permit * w.permit : null,
        pop !== null ? pop * w.pop : null,
      ].filter((v): v is number => v !== null)

      const score = components.length ? Math.round(components.reduce((a, b) => a + b, 0)) : 0
      const label: ZipScore['label'] = components.length === 0 ? 'No Data'
        : score >= 65 ? 'Strong'
        : score >= 35 ? 'Moderate'
        : 'Weak'

      return {
        zip,
        score,
        label,
        components: { jobMarket: job, rentGrowth: rent, permitDensity: permit, popGrowth: pop },
      }
    })

    return NextResponse.json({ scores, zip_count: zips.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
