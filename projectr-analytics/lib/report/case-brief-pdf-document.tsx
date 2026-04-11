import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type { CaseBriefSitePayload } from '@/lib/report/case-brief-shared'
import { BarChartPdf, HorizontalBarChartPdf } from '@/lib/report/pdf-charts'

const accent = '#D76B3D'
const ink = '#1a1a1a'
const muted = '#666666'
const W = 515

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 44,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: ink,
    backgroundColor: '#ffffff',
  },
  headerBand: {
    backgroundColor: '#0a0a0a',
    paddingVertical: 12,
    paddingHorizontal: 40,
    marginHorizontal: -40,
    marginTop: -36,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#ffffff', fontSize: 10, letterSpacing: 2, fontFamily: 'Helvetica', fontWeight: 'bold' },
  meta: { color: '#9ca3af', fontSize: 8, textAlign: 'right', maxWidth: 200 },
  kicker: { fontSize: 8, color: accent, letterSpacing: 1.5, marginBottom: 6, fontFamily: 'Helvetica', fontWeight: 'bold' },
  h1: { fontSize: 19, fontWeight: 'bold', marginBottom: 6, width: W, lineHeight: 1.25 },
  sub: { fontSize: 10, color: muted, marginBottom: 8, width: W, lineHeight: 1.4 },
  headline: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 10,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: accent,
    width: W - 10,
    lineHeight: 1.35,
  },
  box: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
    width: W,
  },
  boxLabel: { fontSize: 8, color: muted, marginBottom: 5, fontWeight: 'bold' },
  boxBody: { fontSize: 9, lineHeight: 1.45, color: '#333', width: W - 20 },
  section: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
    paddingBottom: 3,
    width: W,
  },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2 },
  tile: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#e0d8d0',
    borderRadius: 6,
    padding: 9,
    marginBottom: 8,
    marginRight: '2%',
    backgroundColor: '#faf7f4',
  },
  tileTitle: { fontSize: 8, fontWeight: 'bold', color: accent, marginBottom: 3 },
  tileBody: { fontSize: 8, color: '#444', lineHeight: 1.35 },
  siteCard: {
    borderWidth: 1,
    borderColor: '#e8d5cc',
    backgroundColor: '#fffaf8',
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
    width: W,
  },
  siteRank: { fontSize: 9, fontWeight: 'bold', color: accent },
  siteAddr: { fontSize: 10, fontWeight: 'bold', color: ink, marginTop: 2 },
  siteWhy: { fontSize: 8, color: '#444', marginTop: 5, lineHeight: 1.4, width: W - 20 },
  siteWatch: { fontSize: 7, color: '#666', marginTop: 5, width: W - 20, lineHeight: 1.35 },
  bullet: { fontSize: 9, color: '#333', marginBottom: 4, paddingLeft: 10, width: W - 10, lineHeight: 1.4 },
  riskRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 6,
    width: W,
  },
  riskCell: { width: '32%', fontSize: 8, fontWeight: 'bold', color: ink, paddingRight: 6 },
  mitCell: { width: '68%', fontSize: 8, color: '#444', lineHeight: 1.35 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f3f3',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 5,
    paddingHorizontal: 4,
    width: W,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 4,
    paddingHorizontal: 4,
    width: W,
  },
  th: { fontSize: 6, fontWeight: 'bold', color: ink },
  td: { fontSize: 6, color: '#333' },
  chartWrap: { marginTop: 6, marginBottom: 10, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 4, padding: 8, width: W },
  chartWrapHalf: {
    marginTop: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 4,
    padding: 8,
    width: (W - 10) / 2,
  },
  chartRow: { flexDirection: 'row', justifyContent: 'space-between', width: W, marginBottom: 2 },
  findingCard: {
    flexDirection: 'row',
    width: W,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: '#e5dcd4',
    borderRadius: 5,
    backgroundColor: '#fdfcfa',
    minHeight: 36,
  },
  findingStripe: { width: 5, backgroundColor: accent },
  findingBodyCol: { flexGrow: 1, flexShrink: 1, paddingVertical: 8, paddingLeft: 10, paddingRight: 10, maxWidth: W - 5 },
  findingTitle: { fontSize: 9.5, fontWeight: 'bold', color: ink, lineHeight: 1.3, marginBottom: 3, width: W - 50 },
  findingText: { fontSize: 8, color: '#3d3d3d', lineHeight: 1.45, width: W - 36 },
  findingIndex: { fontSize: 8, fontWeight: 'bold', color: '#c4c4c4', marginTop: 1 },
  statPillRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, width: W - 36 },
  statPill: {
    borderWidth: 1,
    borderColor: '#e8d5cc',
    backgroundColor: '#ffffff',
    paddingVertical: 3,
    paddingHorizontal: 7,
    marginRight: 5,
    marginBottom: 3,
    borderRadius: 3,
  },
  statPillLabel: { fontSize: 6, color: muted, marginBottom: 1 },
  statPillValue: { fontSize: 7.5, fontWeight: 'bold', color: ink },
  foot: { fontSize: 7, color: '#888', marginTop: 12, lineHeight: 1.35, width: W },
})

export interface CaseBriefSiteNarrative {
  rank: number
  address: string
  scoreRationale: string
  watchItems?: string
}

export interface CaseBriefKeyFindingStructured {
  title?: string
  headline?: string
  body?: string
  detail?: string
  stats?: Array<{ label?: string; value?: string }>
}

export interface CaseBriefPdfBriefShape {
  title?: string
  headline?: string
  marketLine?: string
  executiveSummary?: string
  keyFindings?: Array<string | CaseBriefKeyFindingStructured>
  investmentThesis?: string
  signalTiles?: Array<{ label: string; body: string }>
  sites?: CaseBriefSiteNarrative[]
  risksAndMitigations?: Array<{ risk: string; mitigation: string }>
  recommendedNextSteps?: string[]
  assumptionsAndLimits?: string
  methodology?: string
  footer?: string
}

function safeStr(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s.length > 12000 ? `${s.slice(0, 12000)}…` : s
}

export interface CaseBriefKeyFindingNormalized {
  title: string
  body: string
  stats: Array<{ label: string; value: string }>
}

/** Supports legacy string bullets and structured Gemini objects. */
export function normalizeCaseBriefKeyFindings(raw: unknown): CaseBriefKeyFindingNormalized[] {
  if (!Array.isArray(raw)) return []
  const out: CaseBriefKeyFindingNormalized[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item === 'string') {
      const t = item.trim()
      if (!t) continue
      const breakAt = t.indexOf('. ')
      if (breakAt >= 18 && breakAt <= 110) {
        out.push({
          title: t.slice(0, breakAt).trim(),
          body: t.slice(breakAt + 2).trim() || t,
          stats: [],
        })
      } else {
        out.push({ title: `Finding ${i + 1}`, body: t, stats: [] })
      }
      continue
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>
      const title = safeStr(o.title ?? o.headline, `Finding ${i + 1}`)
      let body = safeStr(o.body ?? o.detail, '')
      if (!body) body = title
      const stats: Array<{ label: string; value: string }> = []
      if (Array.isArray(o.stats)) {
        for (const st of o.stats) {
          if (st && typeof st === 'object') {
            const r = st as Record<string, unknown>
            const lab = safeStr(r.label, '')
            const val = safeStr(r.value, '')
            if (lab && val) stats.push({ label: lab, value: val })
          }
        }
      }
      out.push({ title, body, stats })
    }
  }
  return out
}

function KeyFindingCard({
  index,
  item,
}: {
  index: number
  item: CaseBriefKeyFindingNormalized
}) {
  const idx = String(index + 1).padStart(2, '0')
  return (
    <View style={styles.findingCard}>
      <View style={styles.findingStripe} />
      <View style={styles.findingBodyCol}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: W - 24 }}>
          <Text style={styles.findingTitle}>{item.title}</Text>
          <Text style={styles.findingIndex}>{idx}</Text>
        </View>
        <Text style={styles.findingText}>{item.body}</Text>
        {item.stats.length > 0 ? (
          <View style={styles.statPillRow}>
            {item.stats.map((p, j) => (
              <View key={j} style={styles.statPill}>
                <Text style={styles.statPillLabel}>{p.label}</Text>
                <Text style={styles.statPillValue}>{p.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )
}

function formatBriefDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

function fmtCtx(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1000 && v < 500000) return '$' + v.toLocaleString('en-US')
    return String(v)
  }
  return String(v)
}

function BriefPageHeader({
  logoDataUri,
  generatedAt,
}: {
  logoDataUri: string | null
  generatedAt: string
}) {
  return (
    <View style={styles.headerBand} fixed>
      {logoDataUri ? (
        <Image src={logoDataUri} style={{ width: 108, height: 28 }} />
      ) : (
        <Text style={styles.brand}>PROJECTR</Text>
      )}
      <Text style={styles.meta}>Case study brief · {formatBriefDate(generatedAt)}</Text>
    </View>
  )
}

function FarUtilBar({ utilization }: { utilization: number }) {
  const pct = Math.min(100, Math.max(0, utilization * 100))
  const fillW = (130 * pct) / 100
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <Text style={{ fontSize: 7, width: 48, color: muted }}>FAR used</Text>
      <View style={{ width: 130, height: 7, backgroundColor: '#e8e8e8', borderRadius: 1 }}>
        <View style={{ width: fillW, height: 7, backgroundColor: accent, borderRadius: 1 }} />
      </View>
      <Text style={{ fontSize: 7, marginLeft: 5, color: '#444', width: 28 }}>{pct.toFixed(0)}%</Text>
    </View>
  )
}

function MarketSnapshotTable({ ctx }: { ctx: Record<string, unknown> }) {
  const rows: Array<{ k: string; v: string }> = []
  if (ctx.label != null) rows.push({ k: 'Market / view', v: fmtCtx(ctx.label) })
  if (ctx.zip != null) rows.push({ k: 'ZIP (anchor)', v: fmtCtx(ctx.zip) })
  rows.push({ k: 'Median rent (ZORI)', v: ctx.zori != null ? fmtCtx(ctx.zori) : '—' })
  rows.push({ k: 'Home value (ZHVI)', v: ctx.zhvi != null ? fmtCtx(ctx.zhvi) : '—' })
  rows.push({ k: 'ZORI YoY %', v: ctx.zoriGrowth != null ? `${fmtCtx(ctx.zoriGrowth)}%` : '—' })
  rows.push({ k: 'Vacancy %', v: ctx.vacancyRate != null ? `${fmtCtx(ctx.vacancyRate)}%` : '—' })
  if (rows.length === 0) return null
  return (
    <View style={styles.box}>
      <Text style={styles.boxLabel}>Market snapshot (dashboard context)</Text>
      {rows.map((r, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
            borderBottomColor: '#eee',
            paddingVertical: 4,
            width: W - 20,
          }}
        >
          <Text style={{ width: '38%', fontSize: 8, color: muted, fontWeight: 'bold' }}>{r.k}</Text>
          <Text style={{ width: '62%', fontSize: 8, color: '#222' }}>{r.v}</Text>
        </View>
      ))}
    </View>
  )
}

function SitesMetricsTable({ sites }: { sites: CaseBriefSitePayload[] }) {
  if (!sites.length) return null
  const colAddr = 150
  const colZone = 52
  const colScore = 36
  const colFar = 36
  const colAir = 44
  const colZori = 40
  const colMom = 42
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={styles.section}>Site metrics (model inputs)</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: colAddr }]}># / Address</Text>
        <Text style={[styles.th, { width: colZone }]}>Zone</Text>
        <Text style={[styles.th, { width: colScore }]}>Score</Text>
        <Text style={[styles.th, { width: colFar }]}>FAR %</Text>
        <Text style={[styles.th, { width: colAir }]}>Air R.</Text>
        <Text style={[styles.th, { width: colZori }]}>ZORI Δ</Text>
        <Text style={[styles.th, { width: colMom }]}>Permits</Text>
      </View>
      {sites.map((s, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={[styles.td, { width: colAddr }]}>
            {i + 1}. {s.address.length > 42 ? `${s.address.slice(0, 40)}…` : s.address}
          </Text>
          <Text style={[styles.td, { width: colZone }]}>{s.zone.length > 10 ? s.zone.slice(0, 8) + '…' : s.zone}</Text>
          <Text style={[styles.td, { width: colScore }]}>{s.score.toFixed(0)}</Text>
          <Text style={[styles.td, { width: colFar }]}>{(s.far_utilization * 100).toFixed(0)}%</Text>
          <Text style={[styles.td, { width: colAir }]}>{(s.air_rights_sqft / 1000).toFixed(0)}k</Text>
          <Text style={[styles.td, { width: colZori }]}>
            {s.zori_growth != null ? `${s.zori_growth > 0 ? '+' : ''}${s.zori_growth.toFixed(1)}%` : '—'}
          </Text>
          <Text style={[styles.td, { width: colMom }]}>{s.momentum ?? '—'}</Text>
        </View>
      ))}
    </View>
  )
}

export function CaseBriefPdfDocument({
  brief,
  generatedAt,
  mapLabel,
  logoDataUri,
  sitesRaw,
  mapContext,
}: {
  brief: CaseBriefPdfBriefShape
  generatedAt: string
  mapLabel?: string | null
  logoDataUri: string | null
  sitesRaw: CaseBriefSitePayload[]
  mapContext: Record<string, unknown>
}) {
  const title = safeStr(brief.title, 'Case study brief')
  const headline = safeStr(brief.headline)
  const marketLine = safeStr(brief.marketLine)
  const exec = safeStr(brief.executiveSummary)
  const keyFindingItems = normalizeCaseBriefKeyFindings(brief.keyFindings)
  const thesis = safeStr(brief.investmentThesis)
  const tiles = Array.isArray(brief.signalTiles) ? brief.signalTiles.slice(0, 8) : []
  const sitesNarr = Array.isArray(brief.sites) ? brief.sites : []
  const risks = Array.isArray(brief.risksAndMitigations) ? brief.risksAndMitigations : []
  const steps = Array.isArray(brief.recommendedNextSteps)
    ? brief.recommendedNextSteps.map((x) => safeStr(x)).filter(Boolean)
    : []
  const assumptions = safeStr(brief.assumptionsAndLimits)
  const methodology = safeStr(brief.methodology)
  const footer = safeStr(brief.footer, 'Projectr Analytics')

  const scoreBars = sitesRaw.map((s, i) => ({
    label: `${i + 1}`,
    value: Math.max(0, s.score),
  }))

  const airRightsRows = sitesRaw.map((s, i) => ({
    label: `#${i + 1}`,
    value: Math.max(0, s.air_rights_sqft) / 1e6,
  }))
  const farRows = sitesRaw.map((s, i) => ({
    label: `#${i + 1}`,
    value: Math.round(s.far_utilization * 1000) / 10,
  }))
  const permitBars = sitesRaw.map((s, i) => ({
    label: `${i + 1}`,
    value: Math.max(0, s.momentum ?? 0),
  }))
  const zoriBars = sitesRaw.map((s, i) => ({
    label: `${i + 1}`,
    value: s.zori_growth ?? 0,
  }))
  const hasZoriSite = sitesRaw.some((s) => s.zori_growth != null)
  const zoriMin = hasZoriSite ? Math.min(...sitesRaw.map((s) => s.zori_growth ?? 0)) : 0
  const zoriMax = hasZoriSite ? Math.max(...sitesRaw.map((s) => s.zori_growth ?? 0)) : 0
  const showZoriChart =
    hasZoriSite &&
    zoriMax > zoriMin &&
    sitesRaw.every((s) => (s.zori_growth ?? 0) >= 0)

  const halfChartW = (W - 10) / 2
  const chartSvgW = Math.floor(halfChartW - 16)

  const siteByRank = (rank: number) => {
    const i = Math.max(0, Math.min(sitesRaw.length - 1, rank - 1))
    return sitesRaw[i] ?? null
  }

  const narrativeChunks: CaseBriefSiteNarrative[][] = []
  const CHUNK = 2
  for (let i = 0; i < sitesNarr.length; i += CHUNK) {
    narrativeChunks.push(sitesNarr.slice(i, i + CHUNK))
  }

  return (
    <Document>
      {/* Page 1 — cover + executive depth */}
      <Page size="A4" style={styles.page}>
        <BriefPageHeader logoDataUri={logoDataUri} generatedAt={generatedAt} />

        <Text style={styles.kicker}>SPATIAL ANALYSIS REPORT</Text>
        <Text style={styles.h1}>{title}</Text>
        {mapLabel ? <Text style={styles.sub}>Market: {safeStr(mapLabel)}</Text> : null}
        {marketLine ? <Text style={styles.sub}>{marketLine}</Text> : null}

        <MarketSnapshotTable ctx={mapContext} />

        {headline ? <Text style={styles.headline}>{headline}</Text> : null}

        {exec ? (
          <View style={styles.box}>
            <Text style={styles.boxLabel}>Executive summary</Text>
            <Text style={styles.boxBody}>{exec}</Text>
          </View>
        ) : null}

        {thesis ? (
          <View style={styles.box}>
            <Text style={styles.boxLabel}>Investment thesis</Text>
            <Text style={styles.boxBody}>{thesis}</Text>
          </View>
        ) : null}
      </Page>

      {/* Page 2 — key findings cards + market signals (skip if Gemini omitted both) */}
      {keyFindingItems.length > 0 || tiles.length > 0 ? (
        <Page size="A4" style={styles.page}>
          <BriefPageHeader logoDataUri={logoDataUri} generatedAt={generatedAt} />

          {keyFindingItems.length > 0 ? (
          <>
            <Text style={styles.section}>Key findings</Text>
            <Text style={{ fontSize: 7, color: muted, marginBottom: 8, width: W }}>
              Evidence-backed takeaways from the ranked set — metrics in pills echo site-level inputs where the model supplied them.
            </Text>
            {keyFindingItems.map((kf, i) => (
              <KeyFindingCard key={i} index={i} item={kf} />
            ))}
          </>
        ) : null}

        {tiles.length > 0 ? (
          <>
            <Text style={styles.section}>Market signals</Text>
            <View style={styles.tileRow}>
              {tiles.map((t, i) => (
                <View key={i} style={styles.tile}>
                  <Text style={styles.tileTitle}>{safeStr(t.label, 'Signal')}</Text>
                  <Text style={styles.tileBody}>{safeStr(t.body)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
        </Page>
      ) : null}

      {/* Charts + metrics on their own page so findings/tiles are not clipped */}
      {sitesRaw.length > 0 ? (
        <Page size="A4" style={styles.page}>
          <BriefPageHeader logoDataUri={logoDataUri} generatedAt={generatedAt} />
          <Text style={styles.section}>Rank comparison (model inputs)</Text>
          <Text style={{ fontSize: 7, color: muted, marginBottom: 6, width: W }}>
            Rank #1 is leftmost in column charts; horizontal bars follow rank #1 → #{sitesRaw.length} top to bottom.
          </Text>
          <View style={styles.chartRow}>
            <View style={styles.chartWrapHalf}>
              <Text style={[styles.boxLabel, { marginBottom: 4 }]}>Composite score</Text>
              <BarChartPdf
                bars={scoreBars}
                width={chartSvgW}
                height={100}
                caption={`Score (max ${Math.max(...scoreBars.map((b) => b.value), 1).toFixed(0)})`}
              />
            </View>
            <View style={styles.chartWrapHalf}>
              <Text style={[styles.boxLabel, { marginBottom: 4 }]}>Air rights</Text>
              <HorizontalBarChartPdf
                rows={airRightsRows}
                width={chartSvgW}
                height={100}
                color="#0d9488"
                caption="Million sq ft (unbuilt envelope)"
                formatValue={(v) => `${v.toFixed(2)}M`}
              />
            </View>
          </View>
          <View style={styles.chartRow}>
            <View style={styles.chartWrapHalf}>
              <Text style={[styles.boxLabel, { marginBottom: 4 }]}>FAR utilization</Text>
              <HorizontalBarChartPdf
                rows={farRows}
                width={chartSvgW}
                height={100}
                color="#c2410c"
                caption="Percent of max FAR built"
                formatValue={(v) => `${v}%`}
              />
            </View>
            <View style={styles.chartWrapHalf}>
              <Text style={[styles.boxLabel, { marginBottom: 4 }]}>Permit momentum</Text>
              <BarChartPdf
                bars={permitBars}
                width={chartSvgW}
                height={100}
                caption="Nearby permit count (model)"
                color="#7c3aed"
              />
            </View>
          </View>
          {showZoriChart ? (
            <View style={styles.chartWrap}>
              <Text style={[styles.boxLabel, { marginBottom: 4 }]}>Rent growth (ZORI YoY %) by rank</Text>
              <BarChartPdf
                bars={zoriBars}
                width={W - 16}
                height={96}
                caption={`YoY % (range ${zoriMin.toFixed(1)} to ${zoriMax.toFixed(1)})`}
                color="#2563eb"
              />
            </View>
          ) : null}
          <SitesMetricsTable sites={sitesRaw} />
        </Page>
      ) : null}

      {narrativeChunks.map((chunk, chunkIdx) => (
        <Page key={`narr-${chunkIdx}`} size="A4" style={styles.page}>
          <BriefPageHeader logoDataUri={logoDataUri} generatedAt={generatedAt} />
          <Text style={styles.section}>
            Ranked sites — narrative{narrativeChunks.length > 1 && chunkIdx > 0 ? ' (continued)' : ''}
          </Text>
          {chunk.map((s, j) => {
            const globalIdx = chunkIdx * CHUNK + j
            const rank = typeof s.rank === 'number' ? s.rank : globalIdx + 1
            const raw = siteByRank(rank)
            return (
              <View key={globalIdx} style={styles.siteCard}>
                <Text style={styles.siteRank}>#{rank}</Text>
                <Text style={styles.siteAddr}>{safeStr(s.address, 'Address')}</Text>
                {raw ? <FarUtilBar utilization={raw.far_utilization} /> : null}
                {raw ? (
                  <Text style={{ fontSize: 7, color: muted, marginTop: 3 }}>
                    Zone {raw.zone} · Air rights ~{(raw.air_rights_sqft / 1000).toFixed(0)}k sqft
                    {raw.zori_growth != null ? ` · ZORI YoY ${raw.zori_growth > 0 ? '+' : ''}${raw.zori_growth.toFixed(1)}%` : ''}
                    {raw.momentum != null ? ` · Nearby permit activity ${raw.momentum}` : ''}
                  </Text>
                ) : null}
                <Text style={styles.siteWhy}>{safeStr(s.scoreRationale)}</Text>
                {s.watchItems ? <Text style={styles.siteWatch}>Watch: {safeStr(s.watchItems)}</Text> : null}
              </View>
            )
          })}
        </Page>
      ))}

      {/* Page 4 — risks, steps, methodology */}
      <Page size="A4" style={styles.page}>
        <BriefPageHeader logoDataUri={logoDataUri} generatedAt={generatedAt} />

        {risks.length > 0 ? (
          <>
            <Text style={styles.section}>Risks and mitigations</Text>
            <View style={[styles.tableHeader, { backgroundColor: '#faf5f2', borderBottomColor: accent }]}>
              <Text style={[styles.th, { width: '32%' }]}>Risk</Text>
              <Text style={[styles.th, { width: '68%' }]}>Mitigation / underwriting</Text>
            </View>
            {risks.map((r, i) => (
              <View key={i} style={styles.riskRow}>
                <Text style={styles.riskCell}>{safeStr(r.risk, '—')}</Text>
                <Text style={styles.mitCell}>{safeStr(r.mitigation, '—')}</Text>
              </View>
            ))}
          </>
        ) : null}

        {steps.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.section}>Recommended next steps</Text>
            {steps.map((st, i) => (
              <Text key={i} style={styles.bullet}>
                {i + 1}. {st}
              </Text>
            ))}
          </View>
        ) : null}

        {assumptions ? (
          <View style={[styles.box, { marginTop: 12 }]}>
            <Text style={styles.boxLabel}>Assumptions and limitations</Text>
            <Text style={styles.boxBody}>{assumptions}</Text>
          </View>
        ) : null}

        {methodology ? (
          <>
            <Text style={styles.section}>Methodology</Text>
            <Text style={{ fontSize: 8, color: '#444', lineHeight: 1.45, width: W }}>{methodology}</Text>
          </>
        ) : null}

        <Text style={styles.foot}>{footer}</Text>
      </Page>
    </Document>
  )
}
