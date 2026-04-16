import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type AreaMetricRow = {
  submarket_id: string | null
  metric_name: string
  metric_value: number | null
  time_period: string | null
  data_source: string
  visual_bucket: string
  created_at: string
}

export async function GET(request: NextRequest) {
  const areaKey = request.nextUrl.searchParams.get('areaKey')?.trim()
  const limitParam = request.nextUrl.searchParams.get('limit')?.trim()
  const limit = Math.min(Number.parseInt(limitParam ?? '200', 10) || 200, 1000)

  if (!areaKey) {
    return NextResponse.json({ error: 'Missing areaKey' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase
      .from('projectr_master_data')
      .select('submarket_id, metric_name, metric_value, time_period, data_source, visual_bucket, created_at')
      .eq('submarket_id', areaKey)
      .order('time_period', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as AreaMetricRow[]
    const latestByMetric = new Map<string, AreaMetricRow>()
    for (const row of rows) {
      if (!latestByMetric.has(row.metric_name)) latestByMetric.set(row.metric_name, row)
    }

    return NextResponse.json({
      area_key: areaKey,
      row_count: rows.length,
      rows,
      latest_metrics: Array.from(latestByMetric.values()),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
