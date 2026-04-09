import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface MomentumWeights {
  jobGrowth: number    // 0–100
  rentGrowth: number   // 0–100
  permitDensity: number // 0–100
}

interface ZipScore {
  zip: string
  score: number        // 0–100
  components: {
    jobGrowth: number | null
    rentGrowth: number | null
    permitDensity: number | null
  }
}

const PERMIT_METRICS = ['Permit_Units', 'Permit_Buildings', 'Permit_Count'] as const

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const weights: MomentumWeights = {
      jobGrowth: body.jobGrowth ?? 33,
      rentGrowth: body.rentGrowth ?? 33,
      permitDensity: body.permitDensity ?? 34,
    }
    const zips: string[] = body.zips ?? []

    if (!zips.length) {
      return NextResponse.json({ error: 'No zip codes provided' }, { status: 400 })
    }

    // Pull relevant metrics for all requested zips
    const { data, error } = await supabase
      .from('projectr_master_data')
      .select('submarket_id, metric_name, metric_value, created_at')
      .in('submarket_id', zips)
      .in('metric_name', ['Unemployment_Rate', 'Median_Gross_Rent', ...PERMIT_METRICS])
      .order('created_at', { ascending: true })

    if (error) throw new Error(error.message)

    // Aggregate latest value per zip per metric using created_at.
    const byZip: Record<string, Record<string, { value: number; created_at: string }>> = {}
    for (const row of data ?? []) {
      const z = row.submarket_id!
      if (!byZip[z]) byZip[z] = {}
      if (row.metric_value === null) continue
      const existing = byZip[z][row.metric_name]
      if (!existing || row.created_at > existing.created_at) {
        byZip[z][row.metric_name] = {
          value: row.metric_value,
          created_at: row.created_at,
        }
      }
    }

    // Normalize weights to sum to 1
    const totalWeight = weights.jobGrowth + weights.rentGrowth + weights.permitDensity
    const w = {
      job: weights.jobGrowth / totalWeight,
      rent: weights.rentGrowth / totalWeight,
      permit: weights.permitDensity / totalWeight,
    }

    // Collect raw values for normalization across zips
    const rawScores = zips.map((zip) => {
      const metrics = byZip[zip] ?? {}
      // Lower unemployment = better job market → invert
      const unemployment = metrics['Unemployment_Rate']?.value ?? null
      const jobScore = unemployment !== null ? Math.max(0, 100 - unemployment * 10) : null
      const rent = metrics['Median_Gross_Rent']?.value ?? null
      const permits =
        metrics['Permit_Units']?.value ??
        metrics['Permit_Buildings']?.value ??
        metrics['Permit_Count']?.value ??
        null

      return { zip, jobScore, rent, permits }
    })

    // Min-max normalize rent and permits across the set
    const rents = rawScores.map((r) => r.rent).filter((v): v is number => v !== null)
    const permits = rawScores.map((r) => r.permits).filter((v): v is number => v !== null)
    const minRent = rents.length > 0 ? Math.min(...rents) : NaN
    const maxRent = rents.length > 0 ? Math.max(...rents) : NaN
    const minPermit = permits.length > 0 ? Math.min(...permits) : NaN
    const maxPermit = permits.length > 0 ? Math.max(...permits) : NaN

    const normalize = (val: number | null, min: number, max: number) => {
      if (val === null || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return null
      return ((val - min) / (max - min)) * 100
    }

    const scores: ZipScore[] = rawScores.map(({ zip, jobScore, rent, permits }) => {
      const rentScore = normalize(rent, minRent, maxRent)
      const permitScore = normalize(permits, minPermit, maxPermit)

      const components = { jobGrowth: jobScore, rentGrowth: rentScore, permitDensity: permitScore }
      const available = [
        jobScore !== null ? jobScore * w.job : null,
        rentScore !== null ? rentScore * w.rent : null,
        permitScore !== null ? permitScore * w.permit : null,
      ].filter((v): v is number => v !== null)

      const score = available.length ? Math.round(available.reduce((a, b) => a + b, 0)) : 0

      return { zip, score, components }
    })

    return NextResponse.json({ weights, scores })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
