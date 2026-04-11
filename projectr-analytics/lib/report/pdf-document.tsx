import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type {
  ClientReportPayload,
  GeminiBriefResult,
  MetroBenchmark,
  SignalIndicator,
} from './types'
import { formatActiveLayersList } from './layer-labels'
import { BarChartPdf, SparklinePdf } from './pdf-charts'
import type { ZoriSeriesSource } from './fetch-zori-series'

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
  h1: { fontSize: 22, fontFamily: 'Helvetica', fontWeight: 'bold', color: ink, marginBottom: 10, lineHeight: 1.15 },
  narrative: { fontSize: 10, lineHeight: 1.45, color: '#333', marginBottom: 14 },
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
  legend: {
    marginTop: 10,
    backgroundColor: '#f9fafb',
    padding: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 7,
  },
})

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return '$' + Math.round(n).toLocaleString('en-US')
}

/** Helvetica in @react-pdf often lacks Unicode arrows — use ASCII-only marks. */
function arrowChar(a: SignalIndicator['arrow']) {
  if (a === 'up') return '+'
  if (a === 'down') return '-'
  return '~'
}

export interface SiteCompareRow {
  label: string
  zip: string
  zori: number | null
  momentum: number | null
  signalLine: string
}

export interface MarketReportPdfInput {
  payload: ClientReportPayload
  brief: GeminiBriefResult
  signals: SignalIndicator[]
  zoriSeries: { date: string; value: number }[]
  zoriSeriesSource: ZoriSeriesSource
  trendsSeries: { date: string; value: number }[]
  metro: MetroBenchmark | null
  mapImageDataUri: string | null
  logoDataUri: string | null
  siteRows: SiteCompareRow[] | null
}

export function MarketReportDocument(props: MarketReportPdfInput) {
  const { payload, brief, signals, zoriSeries, zoriSeriesSource, trendsSeries, metro, mapImageDataUri, logoDataUri, siteRows } =
    props
  const dateStr = new Date(payload.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const metroZori = metro?.avg_zori ?? null
  const metroZhvi = metro?.avg_zhvi ?? null

  const tableRows: { label: string; sub: string; bench: string }[] = [
    {
      label: 'Median rent (ZORI index)',
      sub: fmtMoney(payload.zillow.zori),
      bench: fmtMoney(metroZori),
    },
    {
      label: 'Vacancy rate',
      sub: payload.census.vacancy_rate != null ? `${payload.census.vacancy_rate.toFixed(1)}%` : '—',
      bench: '—',
    },
    {
      label: 'Permits (county BPS, 2021–23 units)',
      sub: payload.permits.total_units_2021_2023 != null ? String(Math.round(payload.permits.total_units_2021_2023)) : '—',
      bench: 'County scope',
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
      bench: '—',
    },
    {
      label: 'Migration / mobility (ACS)',
      sub:
        payload.census.migration_movers != null
          ? `${Math.round(payload.census.migration_movers).toLocaleString()} movers (diff. state)`
          : '—',
      bench: '—',
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

        <Text style={{ fontSize: 9, color: muted, marginBottom: 4 }}>{payload.marketLabel}</Text>
        <Text style={styles.h1}>{brief.cycleHeadline}</Text>
        <Text style={styles.narrative}>{brief.narrative}</Text>

        <View style={styles.signalRow}>
          {signals.map((s) => (
            <View key={s.id} style={styles.signalCard}>
              <Text style={styles.signalTitle}>{s.label}</Text>
              <Text style={styles.signalArrow}>{arrowChar(s.arrow)}</Text>
              <Text style={styles.signalLine}>{s.line}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.confidence}>Confidence — {brief.confidenceLine}</Text>

        <Text style={styles.foot}>
          Projectr Analytics · Data: Zillow Research (ZORI/ZHVI), Census ACS & BPS, FRED, Google Trends.
          {zoriSeriesSource === 'zillow_monthly'
            ? ' ZORI trend uses monthly index values from ingested Zillow Research data.'
            : ' ZORI trend is modeled from latest index and YoY until the zillow_zori_monthly table is populated (npm run ingest:zillow).'}
        </Text>
      </Page>

      {/* Page 2 — Data */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          {logoDataUri ? <Image src={logoDataUri} style={{ width: 100, height: 26 }} /> : <Text style={styles.brand}>PROJECTR</Text>}
          <Text style={styles.meta}>Market data · {payload.marketLabel}</Text>
        </View>

        <Text style={styles.sectionTitle}>Key metrics vs. metro benchmark</Text>
        <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
          <Text style={[styles.th, { width: '44%' }]}>Metric</Text>
          <Text style={[styles.th, { width: '28%' }]}>Submarket</Text>
          <Text style={[styles.th, { width: '28%' }]}>Metro peer avg</Text>
        </View>
        {tableRows.map((r) => (
          <View key={r.label} style={styles.tableRow} wrap={false}>
            <Text style={[styles.td, { width: '44%' }]}>{r.label}</Text>
            <Text style={[styles.td, { width: '28%', fontFamily: 'Helvetica', fontWeight: 'bold' }]}>{r.sub}</Text>
            <Text style={[styles.td, { width: '28%', color: muted }]}>{r.bench}</Text>
          </View>
        ))}
        {metro && (
          <Text style={[styles.foot, { marginTop: 6 }]}>
            Metro benchmark averages ZORI/ZHVI across {metro.zip_count} Zillow-tracked ZIPs in the same metro (where
            available).
          </Text>
        )}

        <Text style={styles.sectionTitle}>
          Rent trajectory (ZORI — {zoriSeriesSource === 'zillow_monthly' ? 'monthly, Zillow Research' : 'modeled from latest + YoY'})
        </Text>
        <SparklinePdf data={zoriSeries} width={480} height={72} />

        <Text style={styles.sectionTitle}>Permit acceleration (Census BPS, county)</Text>
        <BarChartPdf bars={permitBars} width={480} height={100} />

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
          <View style={styles.mapBox}>
            <Image src={mapImageDataUri} style={{ width: 515, height: 290 }} />
          </View>
        ) : (
          <View style={[styles.mapBox, { height: 200, justifyContent: 'center', alignItems: 'center', padding: 16 }]}>
            <Text style={{ color: muted, textAlign: 'center', fontSize: 9 }}>
              Static map unavailable (check Google Static Maps API key). Submarket boundary and pin positions are still
              listed in the legend.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Active layers at export</Text>
        <Text style={{ fontSize: 8, lineHeight: 1.4 }}>{formatActiveLayersList(payload.layers)}</Text>
        <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Geography</Text>
        <Text style={{ fontSize: 8 }}>
          Primary ZIP: {payload.primaryZip ?? '—'} · Center:{' '}
          {payload.geo ? `${payload.geo.lat.toFixed(4)}, ${payload.geo.lng.toFixed(4)}` : '—'}
        </Text>
        {payload.pins.length > 0 && (
          <Text style={{ fontSize: 8, marginTop: 6 }}>
            Client pins: {payload.pins.map((p) => p.label).join('; ')}
          </Text>
        )}

        <View style={styles.legend}>
          <Text style={{ fontFamily: 'Helvetica', fontWeight: 'bold', fontSize: 7, marginBottom: 4 }}>Legend</Text>
          <Text style={{ fontSize: 6, lineHeight: 1.35 }}>
            Orange outline: ZIP boundary (approx.) · Orange markers: client uploads / sites · Basemap: Google Static
            Maps (dark styled)
          </Text>
        </View>
        <Text style={styles.foot} wrap>
          Deck.gl overlay layers (tracts, flood, etc.) are listed above; only basemap + boundary + markers render in
          static export.
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
            <Text style={[styles.th, { width: '8%' }]}>#</Text>
            <Text style={[styles.th, { width: '22%' }]}>Site</Text>
            <Text style={[styles.th, { width: '14%' }]}>ZIP</Text>
            <Text style={[styles.th, { width: '14%' }]}>ZORI</Text>
            <Text style={[styles.th, { width: '14%' }]}>Score</Text>
            <Text style={[styles.th, { width: '28%' }]}>Read</Text>
          </View>
          {[...siteRows].sort((a, b) => (b.momentum ?? -1) - (a.momentum ?? -1)).map((r, i) => (
            <View key={r.label + r.zip} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, { width: '8%' }]}>{i + 1}</Text>
              <Text style={[styles.td, { width: '22%' }]}>{r.label}</Text>
              <Text style={[styles.td, { width: '14%' }]}>{r.zip}</Text>
              <Text style={[styles.td, { width: '14%' }]}>{fmtMoney(r.zori)}</Text>
              <Text style={[styles.td, { width: '14%' }]}>{r.momentum != null ? String(r.momentum) : '—'}</Text>
              <Text style={[styles.td, { width: '28%', fontSize: 7 }]}>{r.signalLine}</Text>
            </View>
          ))}

          <Text style={styles.foot}>
            Momentum blends normalized rent, permits, and unemployment proxies from cached county/ZIP data (see /api/momentum).
          </Text>
        </Page>
      )}
    </Document>
  )
}
