import { NextRequest, NextResponse } from 'next/server'
import { resolveZctaFromCoordinates } from '@/lib/upload/resolve-zcta'
import type { UploadMarketSnippet } from '@/lib/upload/types'

interface ContextInputRow {
  rowId: string
  lat: number
  lng: number
  zip?: string | null
}

interface MomentumScoreRow {
  zip: string
  score: number
  components: { jobGrowth: number | null; rentGrowth: number | null; permitDensity: number | null }
}

function cycleFromMomentum(score: number): string {
  if (score < 34) return 'cooling'
  if (score < 67) return 'balanced'
  return 'heating'
}

function normalizeZip(z: string | null | undefined): string | null {
  if (!z || typeof z !== 'string') return null
  const m = z.trim().match(/^(\d{5})(-\d{4})?$/)
  return m ? m[1] : null
}

async function resolveRowZip(
  row: ContextInputRow,
  googleApiKey: string | null
): Promise<string | null> {
  const fromClient = normalizeZip(row.zip ?? null)
  if (fromClient) return fromClient
  return resolveZctaFromCoordinates(row.lat, row.lng, { googleApiKey })
}

async function fetchMarketSnippet(origin: string, zip: string): Promise<UploadMarketSnippet> {
  const empty: UploadMarketSnippet = {
    zip,
    zori_latest: null,
    zhvi_latest: null,
    zori_growth_12m: null,
    doz_pending_latest: null,
  }
  try {
    const res = await fetch(`${origin}/api/market?zip=${encodeURIComponent(zip)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(90000),
    })
    const data = await res.json()
    if (!res.ok || data.error) return empty
    return {
      zip,
      zori_latest: data.zillow?.zori_latest ?? null,
      zhvi_latest: data.zillow?.zhvi_latest ?? null,
      zori_growth_12m: data.zillow?.zori_growth_12m ?? null,
      doz_pending_latest: data.metro_velocity?.doz_pending_latest ?? null,
    }
  } catch {
    return empty
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rows = (Array.isArray(body.rows) ? body.rows : []) as ContextInputRow[]
    const maxConcurrency = Math.min(8, Math.max(1, Math.floor(Number(body.maxConcurrency) || 6)))
    const marketConcurrency = Math.min(6, Math.max(1, Math.floor(Number(body.marketConcurrency) || 4)))

    if (!rows.length) {
      return NextResponse.json({ error: 'No rows provided.' }, { status: 400 })
    }

    const valid = rows.filter(
      (r) =>
        r &&
        typeof r.rowId === 'string' &&
        typeof r.lat === 'number' &&
        typeof r.lng === 'number' &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng)
    )

    if (!valid.length) {
      return NextResponse.json({ error: 'No valid lat/lng rows.' }, { status: 400 })
    }

    const zipByRowId = new Map<string, string | null>()
    let idx = 0
    const googleApiKey = process.env.GOOGLE_GEOCODING_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null

    async function zipWorker() {
      while (true) {
        const i = idx
        idx += 1
        if (i >= valid.length) return
        const row = valid[i]
        try {
          const z = await resolveRowZip(row, googleApiKey)
          zipByRowId.set(row.rowId, z)
        } catch {
          zipByRowId.set(row.rowId, null)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(maxConcurrency, valid.length) }, () => zipWorker()))

    const uniqueZips = [...new Set([...zipByRowId.values()].filter((z): z is string => z != null && /^\d{5}$/.test(z)))]

    let scoresByZip = new Map<string, MomentumScoreRow>()
    const origin = new URL(request.url).origin
    if (uniqueZips.length > 0) {
      const mRes = await fetch(`${origin}/api/momentum`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ zips: uniqueZips }),
      })
      const mJson = await mRes.json()
      if (mRes.ok && Array.isArray(mJson.scores)) {
        scoresByZip = new Map(
          (mJson.scores as MomentumScoreRow[]).map((s) => [s.zip, s])
        )
      }
    }

    const marketByZip = new Map<string, UploadMarketSnippet>()
    let mi = 0
    async function marketWorker() {
      while (true) {
        const i = mi
        mi += 1
        if (i >= uniqueZips.length) return
        const z = uniqueZips[i]
        const snippet = await fetchMarketSnippet(origin, z)
        marketByZip.set(z, snippet)
      }
    }
    if (uniqueZips.length > 0) {
      await Promise.all(
        Array.from({ length: Math.min(marketConcurrency, uniqueZips.length) }, () => marketWorker())
      )
    }

    const results = valid.map((row) => {
      const zip = zipByRowId.get(row.rowId) ?? null
      if (!zip) {
        return {
          rowId: row.rowId,
          status: 'failed' as const,
          error: 'Could not resolve ZIP for coordinates',
        }
      }
      const momentum = scoresByZip.get(zip)
      const score = momentum?.score ?? 0
      const market = marketByZip.get(zip) ?? {
        zip,
        zori_latest: null,
        zhvi_latest: null,
        zori_growth_12m: null,
        doz_pending_latest: null,
      }

      return {
        rowId: row.rowId,
        status: 'ok' as const,
        zip,
        momentumScore: score,
        cyclePosition: cycleFromMomentum(score),
        momentumComponents: momentum?.components ?? null,
        market,
      }
    })

    const ok = results.filter((r) => r.status === 'ok').length
    return NextResponse.json({
      results,
      meta: {
        total: results.length,
        ok,
        failed: results.length - ok,
        uniqueZips: uniqueZips.length,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
