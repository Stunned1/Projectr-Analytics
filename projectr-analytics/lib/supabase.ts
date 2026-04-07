import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type VisualBucket = 'POLYGON' | 'MARKER' | 'HEATMAP' | 'TIME_SERIES' | 'TABULAR'

export interface MasterDataRow {
  id: string
  submarket_id: string | null
  geometry: unknown | null
  metric_name: string
  metric_value: number | null
  time_period: string | null
  data_source: string
  visual_bucket: VisualBucket
  created_at: string
}
