import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null

let cachedSupabase: ReturnType<typeof createClient> | null = null

function getSupabaseClient(): ReturnType<typeof createClient> {
  if (cachedSupabase) return cachedSupabase
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }
  cachedSupabase = createClient(supabaseUrl, supabaseAnonKey)
  return cachedSupabase
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, property, receiver) {
    return Reflect.get(getSupabaseClient(), property, receiver)
  },
})

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
