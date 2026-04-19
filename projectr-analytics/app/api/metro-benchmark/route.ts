import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchTexasZctaRowsByMetro } from '@/lib/data/bigquery-texas-zcta'
import { mergeTexasPeerZipLists } from '@/lib/data/texas-metro-coverage'
import { getLatestRowsForSubmarkets } from '@/lib/data/market-data-router'
import { resolveZipAreaContext } from '@/lib/data/zip-area-context'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/

const MAX_PEER_ZIPS = 650

type PeerZipRow = {
  zip: string
}

type SnapshotPeerRow = {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
}

function mean(nums: number[]): number | null {
  const v = nums.filter((n) => Number.isFinite(n))
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

/** Metro peer averages for ZORI/ZHVI (Zillow-tracked ZIPs sharing metro_name_short). */
export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  if (!zip || !ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid zip' }, { status: 400 })
  }

  try {
    const origin = await resolveZipAreaContext(zip)
    const metro = origin?.metro_name_short ?? origin?.metro_name
    if (!metro) {
      return NextResponse.json({
        found: false,
        avg_zori: null,
        avg_zhvi: null,
        zip_count: 0,
        avg_vacancy_rate: null,
        avg_unemployment_rate: null,
        avg_migration_movers: null,
      })
    }

    let peerQuery = supabase.from('zip_metro_lookup').select('zip').eq('metro_name_short', metro)
    if (origin?.state) {
      peerQuery = peerQuery.eq('state', origin.state)
    }
    const { data: peersData } = await peerQuery
    const peers = (peersData ?? []) as PeerZipRow[]

    const canonicalPeers =
      origin?.isTexas
        ? await fetchTexasZctaRowsByMetro(
            origin.metro_name_short ?? origin.metro_name ?? metro,
            'TX',
            { limit: MAX_PEER_ZIPS }
          )
        : []

    const zips = mergeTexasPeerZipLists(
      peers.map((peer) => peer.zip).filter(Boolean),
      canonicalPeers
    )
    if (!zips.length) {
      return NextResponse.json({
        found: true,
        metro_name_short: metro,
        avg_zori: null,
        avg_zhvi: null,
        zip_count: 0,
        avg_vacancy_rate: null,
        avg_unemployment_rate: null,
        avg_migration_movers: null,
      })
    }

    const { data: snapsData } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zhvi_latest')
      .in('zip', zips)
    const snaps = (snapsData ?? []) as SnapshotPeerRow[]

    const zoris = snaps.map((snap) => snap.zori_latest).filter((v): v is number => v != null && v > 0)
    const zhvis = snaps.map((snap) => snap.zhvi_latest).filter((v): v is number => v != null && v > 0)
    const pricingPeerZipCount = new Set(snaps.map((snap) => snap.zip).filter(Boolean)).size

    const avg_zori = zoris.length ? Math.round(zoris.reduce((a, b) => a + b, 0) / zoris.length) : null
    const avg_zhvi = zhvis.length ? Math.round(zhvis.reduce((a, b) => a + b, 0) / zhvis.length) : null

    const peerZips = zips.slice(0, MAX_PEER_ZIPS)
    const masterRows = await getLatestRowsForSubmarkets(peerZips, {
      metricName: ['Vacancy_Rate', 'Moved_From_Different_State', 'Unemployment_Rate'],
      limit: 8,
    })

    const vacByZip = new Map<string, number>()
    const migByZip = new Map<string, number>()
    const unempByZip = new Map<string, { t: string; v: number }>()

    for (const r of masterRows) {
      const sid = r.submarket_id
      const value = r.metric_value
      if (!sid || value == null) continue

      if (r.metric_name === 'Vacancy_Rate' && r.data_source === 'Census ACS') {
        vacByZip.set(sid, value)
      }
      if (r.metric_name === 'Moved_From_Different_State' && r.data_source === 'Census ACS') {
        migByZip.set(sid, value)
      }
      if (r.metric_name === 'Unemployment_Rate' && r.data_source === 'FRED' && r.time_period) {
        const cur = unempByZip.get(sid)
        const t = r.time_period
        if (!cur || t.localeCompare(cur.t) > 0) {
          unempByZip.set(sid, { t, v: value })
        }
      }
    }

    const avg_vacancy_raw = mean([...vacByZip.values()])
    const avg_vacancy_rate =
      avg_vacancy_raw != null ? parseFloat(avg_vacancy_raw.toFixed(2)) : null
    const avg_migration_raw = mean([...migByZip.values()])
    const avg_migration_movers =
      avg_migration_raw != null ? Math.round(avg_migration_raw) : null
    const avg_unemp_raw = mean([...unempByZip.values()].map((x) => x.v))
    const avg_unemployment_rate =
      avg_unemp_raw != null ? parseFloat(avg_unemp_raw.toFixed(2)) : null

    return NextResponse.json({
      found: true,
      metro_name_short: metro,
      avg_zori,
      avg_zhvi,
      zip_count: pricingPeerZipCount,
      avg_vacancy_rate,
      avg_unemployment_rate,
      avg_migration_movers,
      acs_peer_zip_sample: vacByZip.size,
      fred_peer_zip_sample: unempByZip.size,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
