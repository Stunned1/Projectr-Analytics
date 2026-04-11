import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type { CycleAnalysis } from '@/lib/cycle/types'
import type {
  ClientReportPayload,
  GeminiBriefResult,
  MetroBenchmark,
  SignalIndicator,
} from './types'
import { BarChartPdf, SparklinePdf } from './pdf-charts'
import { CycleSignalTilesPdf, CycleWheelPdf } from './pdf-cycle-visual'
import { PdfTrendArrow, trendKindToVariant, signalIndicatorToVariant } from './pdf-trend-arrow'
import type { ZoriSeriesSource } from './fetch-zori-series'
import { METHODOLOGY_PDF_ROWS } from '@/lib/metric-definitions'

/** A4 content width (595.28pt − 40pt padding × 2). Fixed pt width fixes @react-pdf Text wrap. */
const PDF_CONTENT_WIDTH_PT = 515

const accent = '#D76B3D'
const ink = '#1a1a1a'
const muted = '#666666'

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: ink,
    backgroundColor: '#ffffff',
  },
  headerBand: {
    backgroundColor: '#0a0a0a',
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginHorizontal: -40,
    marginTop: -36,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#ffffff', fontSize: 11, letterSpacing: 2, fontFamily: 'Helvetica', fontWeight: 'bold' },
  meta: { color: '#9ca3af', fontSize: 8, textAlign: 'right' },
  h1: {
    fontSize: 22,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    color: ink,
    marginBottom: 10,
    lineHeight: 1.3,
    /** Numeric pt — percentage width on Text often resolves wrong in @react-pdf and clips to one line. */
    width: PDF_CONTENT_WIDTH_PT,
  },
  narrative: {
    fontSize: 10,
    lineHeight: 1.45,
    color: '#333',
    marginBottom: 10,
    width: PDF_CONTENT_WIDTH_PT,
  },
  body: {
    width: PDF_CONTENT_WIDTH_PT,
    alignSelf: 'flex-start',
  },
  signalRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  signalCard: {
    width: '47%',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
    marginRight: '3%',
  },
  signalTitle: { fontFamily: 'Helvetica', fontWeight: 'bold', fontSize: 8, color: accent, marginBottom: 4 },
  signalArrow: { fontSize: 14, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 2 },
  signalLine: { fontSize: 8, color: '#444', lineHeight: 1.35 },
  confidence: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#fafafa',
    borderLeftWidth: 3,
    borderLeftColor: accent,
    fontSize: 9,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    width: PDF_CONTENT_WIDTH_PT,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    color: ink,
    marginTop: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
    paddingBottom: 4,
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eee', paddingVertical: 5 },
  th: { fontFamily: 'Helvetica', fontWeight: 'bold', fontSize: 8, color: '#555' },
  td: { fontSize: 8, color: ink },
  foot: { marginTop: 12, fontSize: 7, color: muted, lineHeight: 1.35 },
  mapBox: { marginTop: 8, borderWidth: 1, borderColor: '#ddd' },
  methTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    color: ink,
    marginTop: 12,
    marginBottom: 6,
  },
  methHeaderRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', paddingBottom: 3, marginBottom: 2 },
  methRow: { flexDirection: 'row', paddingVertical: 3 },
  methColMetric: { width: '18%', fontSize: 6.5, fontFamily: 'Helvetica', fontWeight: 'bold', color: '#444' },
  methColDef: { width: '57%', fontSize: 6.5, color: '#555', lineHeight: 1.35, paddingRight: 6 },
  methColSrc: { width: '25%', fontSize: 6.5, color: muted, lineHeight: 1.35 },
})

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return '$' + Math.round(n).toLocaleString('en-US')
}

/**
 * Multiple shorter Text nodes wrap/page-break more reliably than one long @react-pdf Text
 * (percentage width + single block often clips mid-line at the page margin).
 */
function narrativeTextBlocks(raw: string): string[] {
  const t = raw
    .replace(/\r\n/g, '\n')
    .replace(/\u2019/g, "'")
    .replace(/[\u2028\u2029\u00a0]/g, ' ')
    .trim()
  if (!t) return []

  const out: string[] = []
  for (const para of t.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= 300) {
      out.push(para)
      continue
    }
    const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
    if (sentences.length > 1) out.push(...sentences)
    else out.push(para)
  }
  return out.length > 0 ? out : [t]
}

export interface SiteCompareRow {
  label: string
  zip: string
  zori: number | null
  momentum: number | null
  signalLine: string
  cyclePhase: string | null
}

export interface MarketReportPdfInput {
  payload: ClientReportPayload
  brief: GeminiBriefResult
  signals: SignalIndicator[]
  cycleAnalysis: CycleAnalysis | null
  zoriSeries: { date: string; value: number }[]
  zoriSeriesSource: ZoriSeriesSource
  trendsSeries: { date: string; value: number }[]
  metro: MetroBenchmark | null
  mapImageDataUri: string | null
  logoDataUri: string | null
  siteRows: SiteCompareRow[] | null
}

export function MarketReportDocument(props: MarketReportPdfInput) {
  const {
    payload,
    brief,
    signals,
    cycleAnalysis,
    zoriSeries,
    zoriSeriesSource,
    trendsSeries,
    metro,
    mapImageDataUri,
    logoDataUri,
    siteRows,
  } = props
  const dateStr = new Date(payload.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const metroZori = metro?.avg_zori ?? null
  const metroZhvi = metro?.avg_zhvi ?? null
  const metroVac = metro?.avg_vacancy_rate ?? null
  const metroUnemp = metro?.avg_unemployment_rate ?? null
  const metroMig = metro?.avg_migration_movers ?? null

  const tableRows: {
    label: string
    sub: string
    bench: string
    signalKey?: 'rent' | 'vacancy' | 'permits' | 'employment'
  }[] = [
    {
      label: 'Median rent (ZORI index)',
      sub: fmtMoney(payload.zillow.zori),
      bench: fmtMoney(metroZori),
      signalKey: 'rent',
    },
    {
      label: 'Vacancy rate',
      sub: payload.census.vacancy_rate != null ? `${payload.census.vacancy_rate.toFixed(1)}%` : '—',
      bench: metroVac != null ? `${metroVac.toFixed(1)}% avg` : '—',
      signalKey: 'vacancy',
    },
    {
      label: 'Permits (county BPS, 2021–23 units)',
      sub: payload.permits.total_units_2021_2023 != null ? String(Math.round(payload.permits.total_units_2021_2023)) : '—',
      bench: 'County scope',
      signalKey: 'permits',
    },
    {
      label: 'Median home value (ZHVI)',
      sub: fmtMoney(payload.zillow.zhvi),
      bench: fmtMoney(metroZhvi),
    },
    {
      label: 'Employment (local)',
      sub:
        payload.employment.employment_rate != null
          ? `${payload.employment.employment_rate.toFixed(1)}% employed (est.)`
          : payload.employment.unemployment_rate != null
            ? `${payload.employment.unemployment_rate.toFixed(1)}% unemployment`
            : '—',
      bench:
        metroUnemp != null
          ? `${metroUnemp.toFixed(1)}% unempl. (avg)`
          : '—',
      signalKey: 'employment',
    },
    {
      label: 'Migration / mobility (ACS)',
      sub:
        payload.census.migration_movers != null
          ? `${Math.round(payload.census.migration_movers).toLocaleString()} movers (diff. state)`
          : '—',
      bench:
        metroMig != null
          ? `${metroMig.toLocaleString()} movers (avg / ZIP)`
          : '—',
    },
  ]

  const permitBars = payload.permits.by_year.map((y) => ({ label: y.year, value: y.units }))

  const trends12 = [...trendsSeries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12)

  return (
    <Document title={`Projectr Brief — ${payload.marketLabel}`} author="Projectr Analytics">
      {/* Page 1 — Brief */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {logoDataUri ? <Image src={logoDataUri} style={{ width: 100, height: 26 }} /> : <Text style={styles.brand}>PROJECTR</Text>}
          </View>
          <View>
            <Text style={styles.meta}>Market brief</Text>
            <Text style={styles.meta}>{dateStr}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={{ fontSize: 9, color: muted, marginBottom: 4 }} wrap>
            {payload.marketLabel}
          </Text>
          <Text style={styles.h1} wrap hyphenationCallback={(word) => [word]}>
            {brief.cycleHeadline}
          </Text>
          {narrativeTextBlocks(brief.narrative).map((block, i) => (
            <Text
              key={i}
              style={[styles.narrative, ...(i > 0 ? [{ marginTop: 6 }] : [])]}
              wrap
              hyphenationCallback={(word) => [word]}
            >
              {block}
            </Text>
          ))}

          {cycleAnalysis ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Cycle map</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, width: '100%' }}>
                <CycleWheelPdf cycle={cycleAnalysis} />
                <View style={{ flex: 1, minWidth: 120, paddingTop: 4, marginLeft: 14 }}>
                  <Text
                    style={{ fontSize: 8, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', width: '100%' }}
                    wrap
                    hyphenationCallback={(word) => [word]}
                  >
                    {cycleAnalysis.cycleStage} {cycleAnalysis.cyclePosition}
                  </Text>
                  <Text
                    style={{ fontSize: 7, color: muted, marginTop: 4, lineHeight: 1.35, width: '100%' }}
                    wrap
                    hyphenationCallback={(word) => [word]}
                  >
                    Dot color reflects confidence; stroke indicates trajectory hint. Quadrants: Recovery (upper-left),
                    Expansion (upper-right), Hypersupply (lower-right), Recession (lower-left).
                  </Text>
                </View>
              </View>
              <Text style={[styles.sectionTitle, { marginTop: 4 }]}>Signals</Text>
              <CycleSignalTilesPdf cycle={cycleAnalysis} />
            </>
          ) : (
            <View style={styles.signalRow}>
              {signals.map((s) => (
                <View key={s.id} style={styles.signalCard}>
                  <Text style={styles.signalTitle}>{s.label}</Text>
                  <View style={{ height: 14, marginBottom: 2, justifyContent: 'center' }}>
                    <PdfTrendArrow variant={signalIndicatorToVariant(s)} color={accent} />
                  </View>
                  <Text style={styles.signalLine} wrap>
                    {s.line}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.confidence} wrap hyphenationCallback={(word) => [word]}>
            Confidence — {brief.confidenceLine}
          </Text>

          <Text style={styles.methTitle}>Methodology & definitions</Text>
          <Text style={{ fontSize: 6.5, color: muted, marginBottom: 6, width: PDF_CONTENT_WIDTH_PT }} wrap>
            Key metrics below are documented for client deliverables. Cycle position uses four directional signals (rent,
            vacancy, permits, employment); momentum blends labor, rent level, and permit volume vs. a ZIP comparison set.
          </Text>
          <View style={styles.methHeaderRow}>
            <Text style={styles.methColMetric}>Metric</Text>
            <Text style={styles.methColDef}>Definition</Text>
            <Text style={styles.methColSrc}>Source</Text>
          </View>
          {METHODOLOGY_PDF_ROWS.map((row) => (
            <View key={row.metric} style={styles.methRow} wrap={false}>
              <Text style={styles.methColMetric} wrap={false}>
                {row.metric}
              </Text>
              <Text style={styles.methColDef} wrap>
                {row.definition}
              </Text>
              <Text style={styles.methColSrc} wrap>
                {row.source}
              </Text>
            </View>
          ))}

          {cycleAnalysis && (
            <Text style={[styles.foot, { marginBottom: 6, width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>
              Analytical cycle classifier: {cycleAnalysis.signalsAgreement}/4 signals agree · data quality{' '}
              {cycleAnalysis.dataQuality}
              {cycleAnalysis.transitional ? ' · transitional / mixed read' : ''}.
            </Text>
          )}

          <Text style={[styles.foot, { width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>
            Projectr Analytics · Data: Zillow Research (ZORI/ZHVI), Census ACS & BPS, FRED, Google Trends.
            {zoriSeriesSource === 'zillow_monthly'
              ? ' ZORI trend uses monthly index values from ingested Zillow Research data.'
              : ' ZORI trend is modeled from latest index and YoY until the zillow_zori_monthly table is populated (npm run ingest:zillow).'}
          </Text>
        </View>
      </Page>

      {/* Page 2 — Data */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          {logoDataUri ? <Image src={logoDataUri} style={{ width: 100, height: 26 }} /> : <Text style={styles.brand}>PROJECTR</Text>}
          <Text style={styles.meta}>Market data · {payload.marketLabel}</Text>
        </View>

        <Text style={styles.sectionTitle}>Key metrics vs. metro benchmark</Text>
        <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
          <Text style={[styles.th, { width: '38%' }]}>Metric</Text>
          <Text style={[styles.th, { width: '22%' }]}>Submarket</Text>
          <Text style={[styles.th, { width: '10%' }]}>Signal</Text>
          <Text style={[styles.th, { width: '30%' }]}>Metro peer avg</Text>
        </View>
        {tableRows.map((r) => (
          <View key={r.label} style={[styles.tableRow, { flexDirection: 'row', alignItems: 'center' }]} wrap={false}>
            <Text style={[styles.td, { width: '38%' }]} wrap={false}>
              {r.label}
            </Text>
            <Text style={[styles.td, { width: '22%', fontFamily: 'Helvetica', fontWeight: 'bold' }]} wrap={false}>
              {r.sub}
            </Text>
            <View style={{ width: '10%', alignItems: 'center', justifyContent: 'center', minHeight: 14 }}>
              {r.signalKey && cycleAnalysis ? (
                <PdfTrendArrow
                  variant={trendKindToVariant(r.signalKey, cycleAnalysis.signals[r.signalKey].score)}
                  color={ink}
                />
              ) : (
                <Text style={[styles.td, { textAlign: 'center' }]}>—</Text>
              )}
            </View>
            <Text style={[styles.td, { width: '30%', color: muted }]} wrap={false}>
              {r.bench}
            </Text>
          </View>
        ))}
        {metro && (
          <Text style={[styles.foot, { marginTop: 6 }]}>
            Metro peer column: ZORI/ZHVI are simple means across {metro.zip_count} Zillow-tracked ZIPs in the same metro.
            Vacancy, unemployment, and migration benchmarks are simple means across peer ZIPs that have those rows in
            cache (ACS / FRED) — many peers may be missing data until cold-loaded.
          </Text>
        )}

        <Text style={styles.sectionTitle}>
          Rent trajectory (ZORI — {zoriSeriesSource === 'zillow_monthly' ? 'monthly, Zillow Research' : 'modeled from latest + YoY'})
        </Text>
        <SparklinePdf data={zoriSeries} width={480} height={72} />

        <Text style={styles.sectionTitle}>Permit acceleration (Census BPS, county)</Text>
        <BarChartPdf bars={permitBars} width={480} height={118} />

        <Text style={styles.sectionTitle}>Search sentiment (Google Trends)</Text>
        <Text style={{ fontSize: 7, color: muted, marginBottom: 4 }}>{payload.trends.keyword_scope}</Text>
        <SparklinePdf data={trends12} width={480} height={72} color="#64748b" />

        <Text style={styles.foot}>
          FRED uses the first ZIP&apos;s county; the employment row prefers a computed employment rate when labor-force
          series match, otherwise latest unemployment. Vacancy, migration, and BPS permits need Census ACS/BPS rows in
          Supabase for this area (cold-load at least one ZIP via the map). County BPS counts are identical for all ZIPs in
          the same county — the chart uses one anchor ZIP&apos;s yearly series.
        </Text>
      </Page>

      {/* Page 3 — Map */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          {logoDataUri ? <Image src={logoDataUri} style={{ width: 100, height: 26 }} /> : <Text style={styles.brand}>PROJECTR</Text>}
          <Text style={styles.meta}>Map snapshot · {payload.marketLabel}</Text>
        </View>

        {mapImageDataUri ? (
          <View style={{ width: 515, height: 420, position: 'relative' }}>
            <View style={styles.mapBox}>
              <Image src={mapImageDataUri} style={{ width: 515, height: 420 }} />
            </View>
            {cycleAnalysis && (
              <View
                style={{
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  backgroundColor: 'rgba(255,255,255,0.94)',
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                  borderWidth: 1,
                  borderColor: '#ddd',
                  borderRadius: 3,
                  maxWidth: 220,
                }}
              >
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica', fontWeight: 'bold', color: ink }}>
                  {cycleAnalysis.cycleStage} {cycleAnalysis.cyclePosition}
                </Text>
                <Text style={{ fontSize: 7, color: muted, marginTop: 2 }}>
                  {cycleAnalysis.confidence}% confidence · {cycleAnalysis.dataQuality} data
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.mapBox, { height: 420, justifyContent: 'center', alignItems: 'center', padding: 16 }]}>
            <Text style={{ color: muted, textAlign: 'center', fontSize: 9 }} wrap>
              Static map unavailable (check Google Static Maps API key). Boundary and client markers would appear here
              when the key is configured.
            </Text>
          </View>
        )}

        <Text style={{ fontSize: 8, color: muted, marginTop: 10, lineHeight: 1.45 }} wrap>
          Orange outline: primary submarket boundary · orange markers: client sites · dark basemap (Google Static Maps).
        </Text>
      </Page>

      {/* Page 4 — Site comparison */}
      {siteRows && siteRows.length >= 2 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.headerBand}>
            {logoDataUri ? <Image src={logoDataUri} style={{ width: 100, height: 26 }} /> : <Text style={styles.brand}>PROJECTR</Text>}
            <Text style={styles.meta}>Site comparison</Text>
          </View>

          <Text style={styles.sectionTitle}>Ranked by momentum score</Text>
          <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
            <Text style={[styles.th, { width: '7%' }]}>#</Text>
            <Text style={[styles.th, { width: '18%' }]}>Site</Text>
            <Text style={[styles.th, { width: '12%' }]}>ZIP</Text>
            <Text style={[styles.th, { width: '12%' }]}>ZORI</Text>
            <Text style={[styles.th, { width: '10%' }]}>Mom.</Text>
            <Text style={[styles.th, { width: '18%' }]}>Cycle</Text>
            <Text style={[styles.th, { width: '23%' }]}>Read</Text>
          </View>
          {[...siteRows].sort((a, b) => (b.momentum ?? -1) - (a.momentum ?? -1)).map((r, i) => (
            <View key={r.label + r.zip} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, { width: '7%' }]}>{i + 1}</Text>
              <Text style={[styles.td, { width: '18%' }]}>{r.label}</Text>
              <Text style={[styles.td, { width: '12%' }]}>{r.zip}</Text>
              <Text style={[styles.td, { width: '12%' }]}>{fmtMoney(r.zori)}</Text>
              <Text style={[styles.td, { width: '10%' }]}>{r.momentum != null ? String(r.momentum) : '—'}</Text>
              <Text style={[styles.td, { width: '18%', fontSize: 7 }]}>{r.cyclePhase ?? '—'}</Text>
              <Text style={[styles.td, { width: '23%', fontSize: 7 }]}>{r.signalLine}</Text>
            </View>
          ))}

          <Text style={styles.foot}>
            Momentum score from /api/momentum; cycle phase from the same cached inputs as the ZIP classifier (no extra API calls).
          </Text>
        </Page>
      )}
    </Document>
  )
}
