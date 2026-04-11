import React from 'react'
import { type NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { supabase } from '@/lib/supabase'
import type { ClientReportPayload, MetroBenchmark, SignalIndicator } from '@/lib/report/types'
import { analyzeCycleForZip, cycleHeadline } from '@/lib/cycle/run-analysis'
import { cycleAnalysisToSignalIndicators } from '@/lib/report/cycle-signals'
import { buildSignalIndicators, confidenceFromSignals } from '@/lib/report/signals'
import { resolveZoriSeriesForReport } from '@/lib/report/fetch-zori-series'
import { generateBriefWithGemini } from '@/lib/report/gemini-brief'
import { generateMarketDossierWithGemini } from '@/lib/report/gemini-market-dossier'
import { parseCycleAnalysisField } from '@/lib/report/validate-cycle'
import { MarketReportDocument, type SiteCompareRow } from '@/lib/report/pdf-document'
import { loadProjectrLogoDataUri } from '@/lib/report/load-projectr-logo'
import type { CycleAnalysis } from '@/lib/cycle/types'
import { resolveZctaFromCoordinates } from '@/lib/upload/resolve-zcta'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function appOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000'
  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

async function fetchMetroBenchmark(zip: string | null, origin: string): Promise<MetroBenchmark | null> {
  if (!zip) return null
  try {
    const res = await fetch(`${origin}/api/metro-benchmark?zip=${encodeURIComponent(zip)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (!d.found) return null
    return {
      avg_zori: d.avg_zori ?? null,
      avg_zhvi: d.avg_zhvi ?? null,
      zip_count: d.zip_count ?? 0,
      avg_vacancy_rate: d.avg_vacancy_rate ?? null,
      avg_unemployment_rate: d.avg_unemployment_rate ?? null,
      avg_migration_movers: d.avg_migration_movers ?? null,
    }
  } catch {
    return null
  }
}

async function fetchMomentumScores(zips: string[], origin: string): Promise<Map<string, number>> {
  const clean = [...new Set(zips)].filter((z) => /^\d{5}$/.test(z))
  if (clean.length < 2) return new Map()
  try {
    const res = await fetch(`${origin}/api/momentum`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zips: clean }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return new Map()
    const d = await res.json()
    const m = new Map<string, number>()
    for (const s of d.scores ?? []) {
      if (s.zip && typeof s.score === 'number') m.set(s.zip, s.score)
    }
    return m
  } catch {
    return new Map()
  }
}

function signalLineForScore(score: number | null): string {
  if (score == null) return 'Insufficient cached series for momentum.'
  if (score >= 67) return 'Heating - relative strength vs. comparison set.'
  if (score >= 34) return 'Balanced - mixed cross-sectional drivers.'
  return 'Cooling - softer relative momentum vs. peers.'
}

async function buildSiteRows(
  payload: ClientReportPayload,
  origin: string
): Promise<SiteCompareRow[] | null> {
  if (payload.pins.length < 2) return null

  const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null
  const resolved: { label: string; zip: string }[] = []

  for (const p of payload.pins) {
    const zip =
      (await resolveZctaFromCoordinates(p.lat, p.lng, { googleApiKey: googleKey })) ??
      (await resolveZctaFromCoordinates(p.lat, p.lng, {}))
    resolved.push({ label: p.label, zip: zip ?? '-' })
  }

  const zips = resolved.map((r) => r.zip).filter((z) => /^\d{5}$/.test(z))
  const momentumMap = await fetchMomentumScores(zips, origin)

  const { data: snaps } =
    zips.length > 0
      ? await supabase.from('zillow_zip_snapshot').select('zip, zori_latest').in('zip', zips)
      : { data: [] as { zip: string; zori_latest: number | null }[] }

  const zoriByZip = new Map((snaps ?? []).map((s) => [s.zip, s.zori_latest]))

  const cycleByZip = new Map<string, CycleAnalysis>()
  await Promise.all(
    zips.map(async (z) => {
      try {
        const row = resolved.find((r) => r.zip === z)
        const a = await analyzeCycleForZip(z, row?.label ?? z, { skipGemini: true })
        cycleByZip.set(z, a)
      } catch {
        /* skip */
      }
    })
  )

  const rows: SiteCompareRow[] = resolved.map((r) => {
    const z = /^\d{5}$/.test(r.zip) ? r.zip : null
    const cycle = z ? cycleByZip.get(z) ?? null : null
    return {
      label: r.label,
      zip: r.zip,
      zori: z ? zoriByZip.get(z) ?? null : null,
      momentum: z ? momentumMap.get(z) ?? null : null,
      signalLine: signalLineForScore(z ? momentumMap.get(z) ?? null : null),
      cyclePhase: cycle ? `${cycle.cycleStage} ${cycle.cyclePosition}` : null,
    }
  })

  return rows
}

function validatePayload(body: unknown): ClientReportPayload | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.marketLabel !== 'string' || !b.marketLabel.trim()) return null
  if (!b.layers || typeof b.layers !== 'object') return null
  if (!b.zillow || !b.census || !b.permits || !b.employment || !b.fred || !b.trends) return null
  if (!Array.isArray(b.pins)) return null
  const cycle = parseCycleAnalysisField(b.cycleAnalysis)
  const payload = { ...b, cycleAnalysis: cycle } as unknown as ClientReportPayload
  return payload
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid report payload' }, { status: 400 })
    }

    const origin = appOrigin(request)

    let cycle = payload.cycleAnalysis ?? null
    if (!cycle && payload.primaryZip && /^\d{5}$/.test(payload.primaryZip)) {
      try {
        cycle = await analyzeCycleForZip(payload.primaryZip, payload.marketLabel)
      } catch {
        cycle = null
      }
    }

    let brief: { cycleHeadline: string; narrative: string; confidenceLine: string }
    let signals: SignalIndicator[]

    if (cycle) {
      brief = {
        cycleHeadline: cycleHeadline(payload.marketLabel, cycle),
        narrative: cycle.narrative,
        confidenceLine: `${cycle.confidenceLine} Data quality: ${cycle.dataQuality}.`,
      }
      signals = cycleAnalysisToSignalIndicators(cycle)
    } else {
      signals = buildSignalIndicators(payload)
      const confidenceLine = confidenceFromSignals(signals)
      brief = await generateBriefWithGemini(payload, signals, confidenceLine)
    }

    const { series: zoriSeries, source: zoriSeriesSource } = await resolveZoriSeriesForReport(payload)
    const trendsSeries = payload.trends.series ?? []

    const [metro, siteRows] = await Promise.all([
      fetchMetroBenchmark(payload.primaryZip, origin),
      buildSiteRows(payload, origin),
    ])

    const dossier = await generateMarketDossierWithGemini({
      payload,
      brief,
      signals,
      cycleAnalysis: cycle,
      metro,
      zoriSeries,
      trendsSeries,
    })

    const logoDataUri = loadProjectrLogoDataUri()

    const doc = (
      <MarketReportDocument
        payload={payload}
        brief={brief}
        dossier={dossier}
        signals={signals}
        cycleAnalysis={cycle}
        zoriSeries={zoriSeries}
        zoriSeriesSource={zoriSeriesSource}
        trendsSeries={trendsSeries}
        metro={metro}
        logoDataUri={logoDataUri}
        siteRows={siteRows && siteRows.length >= 2 ? siteRows : null}
      />
    )

    const buffer = await renderToBuffer(doc)

    const safeName = payload.marketLabel.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'market-brief'
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Projectr-${safeName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
