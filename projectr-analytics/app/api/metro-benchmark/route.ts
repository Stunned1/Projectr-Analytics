import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/

/** Metro peer averages for ZORI/ZHVI (Zillow-tracked ZIPs sharing metro_name_short). */
export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip' }, { status: 400 })
  }

  try {
    const { data: row } = await supabase
      .from('zip_metro_lookup')
      .select('metro_name_short')
      .eq('zip', zip)
      .maybeSingle()

    const metro = row?.metro_name_short
    if (!metro) {
      return NextResponse.json({ found: false, avg_zori: null, avg_zhvi: null, zip_count: 0 })
    }

    const { data: peers } = await supabase.from('zip_metro_lookup').select('zip').eq('metro_name_short', metro)

    const zips = (peers ?? []).map((p) => p.zip).filter(Boolean)
    if (!zips.length) {
      return NextResponse.json({ found: true, metro_name_short: metro, avg_zori: null, avg_zhvi: null, zip_count: 0 })
    }

    const { data: snaps } = await supabase
      .from('zillow_zip_snapshot')
      .select('zori_latest, zhvi_latest')
      .in('zip', zips)

    const zoris = (snaps ?? []).map((s) => s.zori_latest).filter((v): v is number => v != null && v > 0)
    const zhvis = (snaps ?? []).map((s) => s.zhvi_latest).filter((v): v is number => v != null && v > 0)

    const avg_zori = zoris.length ? Math.round(zoris.reduce((a, b) => a + b, 0) / zoris.length) : null
    const avg_zhvi = zhvis.length ? Math.round(zhvis.reduce((a, b) => a + b, 0) / zhvis.length) : null

    return NextResponse.json({
      found: true,
      metro_name_short: metro,
      avg_zori,
      avg_zhvi,
      zip_count: zips.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
