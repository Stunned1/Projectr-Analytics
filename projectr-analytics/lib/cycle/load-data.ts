import { supabase } from '@/lib/supabase'
import type { MasterRow } from './types'

function dedupeMasterRows(rows: MasterRow[]): MasterRow[] {
  const map = new Map<string, MasterRow>()
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const r of sorted) {
    const k = `${r.data_source}|${r.metric_name}|${r.time_period ?? ''}`
    map.set(k, r)
  }
  return [...map.values()]
}

export interface ZoriMonthlyPoint {
  month: string
  zori: number
}

export interface CycleRawInputs {
  masterRows: MasterRow[]
  zoriMonthly: ZoriMonthlyPoint[]
  zoriGrowthYoy: number | null
  zoriLatest: number | null
}

export async function loadCycleRawInputs(zip: string): Promise<CycleRawInputs> {
  const [{ data: rawMaster, error: masterErr }, { data: monthly, error: zErr }, { data: snap, error: sErr }] =
    await Promise.all([
      supabase.from('projectr_master_data').select('metric_name, metric_value, data_source, time_period, created_at').eq('submarket_id', zip).limit(800),
      supabase.from('zillow_zori_monthly').select('month, zori').eq('zip', zip).order('month', { ascending: true }),
      supabase.from('zillow_zip_snapshot').select('zori_growth_12m, zori_latest').eq('zip', zip).maybeSingle(),
    ])

  if (masterErr) throw new Error(masterErr.message)
  if (zErr) throw new Error(zErr.message)
  if (sErr) throw new Error(sErr.message)

  const masterRows = dedupeMasterRows((rawMaster ?? []) as MasterRow[])

  const zoriMonthly: ZoriMonthlyPoint[] = (monthly ?? [])
    .map((r) => ({
      month: typeof r.month === 'string' ? r.month : String(r.month),
      zori: Number(r.zori),
    }))
    .filter((r) => Number.isFinite(r.zori))

  return {
    masterRows,
    zoriMonthly,
    zoriGrowthYoy: snap?.zori_growth_12m != null && Number.isFinite(snap.zori_growth_12m) ? snap.zori_growth_12m : null,
    zoriLatest: snap?.zori_latest != null && Number.isFinite(snap.zori_latest) ? snap.zori_latest : null,
  }
}
