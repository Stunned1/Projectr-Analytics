import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CycleAnalysis } from '@/lib/cycle/types'
import { METHODOLOGY_PDF_ROWS } from '@/lib/metric-definitions'
import type { ReportConfig } from '@/lib/report/config'
import { resolveReportMetricEvidence } from '@/lib/report/metric-evidence'
import type { MarketDossierGemini } from './gemini-market-dossier'
import type { ZoriSeriesSource } from './fetch-zori-series'
import { BarChartPdf, SparklinePdf } from './pdf-charts'
import { CycleSignalTilesPdf, CycleWheelPdf } from './pdf-cycle-visual'
import { PdfTrendArrow, signalIndicatorToVariant, trendKindToVariant } from './pdf-trend-arrow'
import {
  buildChartCitationFooter,
  buildPdfBarRowsFromScoutChart,
  buildPdfSeriesFromScoutChart,
  buildPermitUnitsChart,
  buildSearchTrendsChart,
  buildSiteMomentumChart,
  buildZoriTrendChart,
} from './scout-chart-pdf-adapter'
import type { ClientReportPayload, GeminiBriefResult, MetroBenchmark, SignalIndicator } from './types'

const PDF_CONTENT_WIDTH_PT = 515
const accent = '#D76B3D'
const ink = '#1a1a1a'
const muted = '#666666'

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 40, paddingBottom: 40, fontFamily: 'Helvetica', fontSize: 9, color: ink, backgroundColor: '#ffffff' },
  clientLightPage: { paddingTop: 48, paddingHorizontal: 48, paddingBottom: 40, fontFamily: 'Helvetica', fontSize: 9, color: ink, backgroundColor: '#f4f0ec' },
  clientDarkPage: { paddingTop: 48, paddingHorizontal: 48, paddingBottom: 40, fontFamily: 'Helvetica', fontSize: 9, color: '#ffffff', backgroundColor: '#111111' },
  clientCoverPage: { paddingTop: 0, paddingHorizontal: 0, paddingBottom: 0, fontFamily: 'Helvetica', fontSize: 9, color: ink, backgroundColor: '#efe7e1' },
  clientCoverHero: { backgroundColor: '#161616', paddingTop: 44, paddingHorizontal: 48, paddingBottom: 36, minHeight: 560, justifyContent: 'space-between' },
  clientCoverHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  clientCoverBrandLockup: { flexDirection: 'row', alignItems: 'center' },
  clientCoverBrand: { fontSize: 10, color: '#f5f1eb', letterSpacing: 1.8, textTransform: 'uppercase' },
  clientCoverMetaText: { fontSize: 8, color: '#c9bfb6', textAlign: 'right', lineHeight: 1.4 },
  clientCoverCenter: { alignItems: 'flex-start', justifyContent: 'center', paddingTop: 26 },
  clientCoverLogo: { width: 92, height: 92, marginBottom: 22, borderRadius: 18 },
  clientCoverRule: { width: 150, height: 3, backgroundColor: accent, marginBottom: 20 },
  clientCoverTitle: { fontSize: 50, color: '#ffffff', fontFamily: 'Helvetica', fontWeight: 'bold', lineHeight: 0.96, letterSpacing: -1.8, marginBottom: 12, width: '82%' },
  clientCoverSubtitle: { fontSize: 12.5, color: '#ddd3cb', lineHeight: 1.5, width: '72%' },
  clientCoverFooter: { backgroundColor: '#efe7e1', paddingHorizontal: 48, paddingTop: 20, paddingBottom: 26 },
  clientCoverMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT },
  clientCoverMetaCard: { width: '31.5%', marginRight: '2.75%', borderWidth: 1, borderColor: '#ddd0c6', borderRadius: 10, padding: 10, backgroundColor: '#f8f3ef' },
  clientCoverMetaCardLast: { marginRight: 0 },
  clientCoverMetaLabel: { fontSize: 7, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 4 },
  clientCoverMetaValue: { fontSize: 9, color: '#322923', lineHeight: 1.4 },
  headerBand: { backgroundColor: '#151515', paddingVertical: 14, paddingHorizontal: 40, marginHorizontal: -40, marginTop: -36, marginBottom: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: accent },
  brand: { color: '#ffffff', fontSize: 11, letterSpacing: 2, fontFamily: 'Helvetica', fontWeight: 'bold' },
  meta: { color: '#9ca3af', fontSize: 8, textAlign: 'right' },
  clientPageNumber: { position: 'absolute', bottom: 20, right: 34, fontSize: 8, color: muted },
  clientPageNumberLight: { position: 'absolute', bottom: 20, right: 34, fontSize: 8, color: '#ffffff', opacity: 0.55 },
  coverEyebrow: { fontSize: 7.5, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
  coverHero: { width: PDF_CONTENT_WIDTH_PT, borderWidth: 1, borderColor: '#eadfd7', backgroundColor: '#fcf7f3', padding: 16, borderRadius: 8, marginBottom: 12 },
  h1: { fontSize: 22, fontFamily: 'Helvetica', fontWeight: 'bold', color: ink, marginBottom: 10, lineHeight: 1.3, width: PDF_CONTENT_WIDTH_PT },
  coverDeck: { fontSize: 10.5, lineHeight: 1.45, color: '#43332b', marginTop: 6, width: '100%' },
  coverSnapshotRow: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT, marginBottom: 12 },
  coverSnapshotCard: { width: '23.5%', marginRight: '2%', marginBottom: 8, borderWidth: 1, borderColor: '#ece7e2', borderRadius: 6, padding: 8, backgroundColor: '#ffffff' },
  coverSnapshotCardLast: { marginRight: 0 },
  coverSnapshotLabel: { fontSize: 7, color: muted, textTransform: 'uppercase', marginBottom: 4 },
  coverSnapshotValue: { fontSize: 12, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 3 },
  coverSnapshotDelta: { fontSize: 7, color: '#5b463d', lineHeight: 1.3 },
  coverSummaryPanel: { width: PDF_CONTENT_WIDTH_PT, borderWidth: 1, borderColor: '#ebe5df', borderRadius: 6, backgroundColor: '#ffffff', padding: 12, marginBottom: 12 },
  coverSummaryTitle: { fontSize: 8, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 5, letterSpacing: 1.1 },
  coverSummaryBody: { fontSize: 9, color: '#333', lineHeight: 1.45 },
  takeawayRow: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT, marginBottom: 10 },
  takeawayCard: { width: '32%', marginRight: '2%', borderWidth: 1, borderColor: '#ebe5df', borderRadius: 6, padding: 9, backgroundColor: '#faf8f6' },
  takeawayCardLast: { marginRight: 0 },
  takeawayLabel: { fontSize: 7, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 4 },
  takeawayValue: { fontSize: 8.5, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 3, lineHeight: 1.35 },
  takeawayBody: { fontSize: 7.2, color: '#4b4b4b', lineHeight: 1.35 },
  comparisonLeaderboard: { flexDirection: 'row', width: PDF_CONTENT_WIDTH_PT, marginBottom: 10 },
  comparisonHeroCard: { width: '48.5%', marginRight: '3%', borderWidth: 1, borderColor: '#eadfd7', borderRadius: 8, padding: 12, backgroundColor: '#fcf7f3' },
  comparisonSupportCard: { width: '48.5%', borderWidth: 1, borderColor: '#ece7e2', borderRadius: 8, padding: 12, backgroundColor: '#ffffff' },
  comparisonRankLabel: { fontSize: 7, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 4, letterSpacing: 1.1 },
  comparisonSiteName: { fontSize: 13, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 4 },
  comparisonSiteMeta: { fontSize: 8, color: muted, marginBottom: 6 },
  comparisonScore: { fontSize: 18, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 4 },
  comparisonBody: { fontSize: 7.4, color: '#444', lineHeight: 1.4 },
  comparisonStatsRow: { flexDirection: 'row', width: PDF_CONTENT_WIDTH_PT, marginBottom: 10 },
  comparisonStatCard: { width: '32%', marginRight: '2%', borderWidth: 1, borderColor: '#ece7e2', borderRadius: 6, padding: 9, backgroundColor: '#faf8f6' },
  comparisonStatCardLast: { marginRight: 0 },
  comparisonStatLabel: { fontSize: 7, color: muted, textTransform: 'uppercase', marginBottom: 4 },
  comparisonStatValue: { fontSize: 10.5, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 3 },
  comparisonStatBody: { fontSize: 7.1, color: '#4b4b4b', lineHeight: 1.35 },
  clientSectionKicker: { fontSize: 8, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' },
  clientSectionHeadline: { fontSize: 26, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', lineHeight: 1.1, marginBottom: 8, width: PDF_CONTENT_WIDTH_PT },
  clientSectionBody: { fontSize: 9, color: '#4b4b4b', lineHeight: 1.5, width: '85%', marginBottom: 14 },
  clientMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT, marginBottom: 10 },
  clientMetricCard: { width: '48%', marginRight: '2%', marginBottom: 8, borderWidth: 1, borderColor: '#e3dad2', borderRadius: 8, padding: 10, backgroundColor: '#ffffff', minHeight: 82 },
  clientMetricCardTitle: { fontSize: 7.5, color: muted, textTransform: 'uppercase', marginBottom: 5 },
  clientMetricCardValue: { fontSize: 15, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 4 },
  clientMetricCardBench: { fontSize: 7.3, color: '#5c4c43', marginBottom: 4, lineHeight: 1.35 },
  clientMetricCardBody: { fontSize: 7.1, color: '#4b4b4b', lineHeight: 1.35 },
  clientChartsPanel: { width: PDF_CONTENT_WIDTH_PT, borderWidth: 1, borderColor: '#e3dad2', borderRadius: 8, padding: 12, backgroundColor: '#ffffff', marginBottom: 12 },
  clientChartTitle: { fontSize: 11, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 6 },
  clientNarrativePanel: { width: PDF_CONTENT_WIDTH_PT, borderWidth: 1, borderColor: '#e3dad2', borderRadius: 8, padding: 14, backgroundColor: '#ffffff', marginBottom: 12 },
  clientNarrativeTitle: { fontSize: 11, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 6 },
  clientNarrativeText: { fontSize: 8.2, color: '#333', lineHeight: 1.5, marginBottom: 8 },
  clientBulletGrid: { flexDirection: 'row', width: PDF_CONTENT_WIDTH_PT, marginBottom: 12 },
  clientBulletColumn: { width: '49%', paddingRight: 8 },
  clientImagePanel: { width: PDF_CONTENT_WIDTH_PT, borderWidth: 1, borderColor: '#e3dad2', borderRadius: 8, padding: 10, backgroundColor: '#ffffff', marginBottom: 12 },
  clientMapImage: { width: PDF_CONTENT_WIDTH_PT - 20, height: 220, borderRadius: 6, marginBottom: 8 },
  clientImageCaption: { fontSize: 7.1, color: '#4b4b4b', lineHeight: 1.35 },
  clientMethodGrid: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT, marginBottom: 12 },
  clientMethodCard: { width: '48%', marginRight: '2%', marginBottom: 8, borderWidth: 1, borderColor: '#e3dad2', borderRadius: 8, padding: 10, backgroundColor: '#ffffff', minHeight: 92 },
  clientMethodMetric: { fontSize: 8, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 5 },
  clientMethodDef: { fontSize: 7.3, color: '#333', lineHeight: 1.4, marginBottom: 5 },
  clientMethodSrc: { fontSize: 6.9, color: muted, lineHeight: 1.35 },
  clientEvidencePanel: { width: PDF_CONTENT_WIDTH_PT, borderWidth: 1, borderColor: '#e3dad2', borderRadius: 8, padding: 12, backgroundColor: '#ffffff', marginBottom: 10 },
  clientEvidenceRow: { paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#ece2db' },
  clientEvidenceMetric: { fontSize: 8, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 3 },
  clientEvidenceBody: { fontSize: 7.1, color: '#4b4b4b', lineHeight: 1.35 },
  narrative: { fontSize: 10, lineHeight: 1.45, color: '#333', marginBottom: 10, width: PDF_CONTENT_WIDTH_PT },
  body: { width: PDF_CONTENT_WIDTH_PT, alignSelf: 'flex-start' },
  signalRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  signalCard: { width: '47%', borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 4, padding: 8, marginBottom: 8, marginRight: '3%' },
  signalTitle: { fontFamily: 'Helvetica', fontWeight: 'bold', fontSize: 8, color: accent, marginBottom: 4 },
  signalLine: { fontSize: 8, color: '#444', lineHeight: 1.35 },
  confidence: { marginTop: 10, padding: 10, backgroundColor: '#fafafa', borderLeftWidth: 3, borderLeftColor: accent, fontSize: 9, fontFamily: 'Helvetica', fontWeight: 'bold', width: PDF_CONTENT_WIDTH_PT },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica', fontWeight: 'bold', color: ink, marginTop: 16, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e5e5e5', paddingBottom: 4 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eee', paddingVertical: 5 },
  th: { fontFamily: 'Helvetica', fontWeight: 'bold', fontSize: 8, color: '#555' },
  td: { fontSize: 8, color: ink },
  foot: { marginTop: 12, fontSize: 7, color: muted, lineHeight: 1.35 },
  chartFoot: { marginTop: 4, fontSize: 6.5, color: muted, lineHeight: 1.35, width: PDF_CONTENT_WIDTH_PT },
  methTitle: { fontSize: 9, fontFamily: 'Helvetica', fontWeight: 'bold', color: ink, marginTop: 12, marginBottom: 6 },
  methHeaderRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', paddingBottom: 3, marginBottom: 2 },
  methRow: { flexDirection: 'row', paddingVertical: 3 },
  methColMetric: { width: '18%', fontSize: 6.5, fontFamily: 'Helvetica', fontWeight: 'bold', color: '#444' },
  methColDef: { width: '57%', fontSize: 6.5, color: '#555', lineHeight: 1.35, paddingRight: 6 },
  methColSrc: { width: '25%', fontSize: 6.5, color: muted, lineHeight: 1.35 },
  dossierKicker: { fontSize: 8, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', letterSpacing: 1.2, marginBottom: 6 },
  dossierIntro: { fontSize: 8, lineHeight: 1.45, color: '#444', marginBottom: 10, padding: 10, backgroundColor: '#f8f6f4', borderLeftWidth: 3, borderLeftColor: accent, width: PDF_CONTENT_WIDTH_PT },
  dossierCard: { width: '48%', borderWidth: 1, borderColor: '#e8e0d8', borderRadius: 5, padding: 9, marginBottom: 8, marginRight: '2%', backgroundColor: '#fdfcfa', minHeight: 72 },
  dossierCardTitle: { fontSize: 9, fontFamily: 'Helvetica', fontWeight: 'bold', color: accent, marginBottom: 5 },
  dossierCardBody: { fontSize: 8, lineHeight: 1.45, color: '#333', width: '100%' },
  dossierListTitle: { fontSize: 9, fontFamily: 'Helvetica', fontWeight: 'bold', color: ink, marginBottom: 5, marginTop: 4 },
  dossierBullet: { fontSize: 8, color: '#333', marginBottom: 4, paddingLeft: 8, lineHeight: 1.4, width: '100%' },
  dossierLimitations: { marginTop: 10, padding: 9, backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 4, fontSize: 7.5, color: '#555', lineHeight: 1.45, width: PDF_CONTENT_WIDTH_PT },
  dossierClientSummary: { fontSize: 8.2, lineHeight: 1.45, color: '#333', marginBottom: 8, width: PDF_CONTENT_WIDTH_PT },
  dossierClientGrid: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT, marginTop: 2, marginBottom: 2 },
  dossierClientColumn: { width: '49%', paddingRight: 8 },
  clientContentsGhost: { position: 'absolute', left: 28, top: 58, fontSize: 74, color: '#111111', opacity: 0.06, letterSpacing: -4 },
  clientContentsBlock: { marginTop: 52, marginBottom: 26, borderBottomWidth: 1, borderBottomColor: '#ddd3cb', paddingBottom: 18 },
  clientContentsHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', width: PDF_CONTENT_WIDTH_PT },
  clientContentsTitle: { fontSize: 17, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 4 },
  clientContentsPage: { fontSize: 44, color: ink, opacity: 0.12, lineHeight: 1 },
  clientContentsBody: { fontSize: 8.5, color: '#4b4b4b', lineHeight: 1.45, width: '82%' },
  clientThesisKicker: { fontSize: 8, color: accent, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12, fontFamily: 'Helvetica', fontWeight: 'bold' },
  clientThesisHeadline: { fontSize: 30, color: ink, lineHeight: 1.1, fontFamily: 'Helvetica', fontWeight: 'bold', width: '88%', marginBottom: 14 },
  clientThesisBody: { fontSize: 11, color: '#433833', lineHeight: 1.55, width: '85%', marginBottom: 16 },
  clientThesisBullet: { fontSize: 8.5, color: '#433833', marginBottom: 8, lineHeight: 1.4 },
  clientCycleRow: { flexDirection: 'row', width: '100%', marginTop: 16, marginBottom: 14, alignItems: 'flex-start' },
  clientCycleMeta: { flex: 1, marginLeft: 16, paddingTop: 6 },
  clientCycleTitle: { fontSize: 9, color: '#231f1d', fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 6 },
  clientCycleBody: { fontSize: 7.4, color: '#5a4e47', lineHeight: 1.45, width: '95%' },
  clientSignalGrid: { flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT, marginTop: 2 },
  clientSignalCard: { width: '48%', marginRight: '2%', marginBottom: 8, borderWidth: 1, borderColor: '#363636', borderRadius: 6, padding: 8, backgroundColor: '#1b1b1b' },
  clientSignalCardTitle: { fontSize: 7, color: '#d8a078', fontFamily: 'Helvetica', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 4 },
  clientSignalCardBody: { fontSize: 7.1, color: '#ffffff', opacity: 0.8, lineHeight: 1.35 },
  clientChapterPage: { paddingTop: 52, paddingHorizontal: 48, paddingBottom: 40, fontFamily: 'Helvetica', fontSize: 9, color: '#ffffff', backgroundColor: '#111111' },
  clientChapterNumber: { fontSize: 10, color: '#b8962e', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  clientChapterTitle: { fontSize: 48, color: '#ffffff', lineHeight: 0.95, letterSpacing: -2, width: PDF_CONTENT_WIDTH_PT, marginBottom: 10 },
  clientChapterBody: { fontSize: 10, color: '#ffffff', opacity: 0.82, lineHeight: 1.5, width: '74%', marginBottom: 16 },
  clientChapterRule: { width: 180, height: 2, backgroundColor: '#b8962e', marginBottom: 16 },
  coverMetaRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, width: PDF_CONTENT_WIDTH_PT },
  coverMetaCard: { width: '48%', marginRight: '2%', marginBottom: 6, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 4, padding: 8, backgroundColor: '#fafafa' },
  coverMetaLabel: { fontSize: 7, color: muted, textTransform: 'uppercase', marginBottom: 2 },
  coverMetaValue: { fontSize: 8.5, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold' },
  analystNoteBox: { marginTop: 10, padding: 10, backgroundColor: '#f8f6f4', borderLeftWidth: 3, borderLeftColor: accent, width: PDF_CONTENT_WIDTH_PT },
  analystNoteTitle: { fontSize: 8, color: accent, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 4 },
  analystNoteBody: { fontSize: 8, color: '#333', lineHeight: 1.45 },
  metricLabelCell: { width: '38%', paddingRight: 6 },
  metricLabelTitle: { fontSize: 8, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold' },
  metricLabelSub: { marginTop: 2, fontSize: 6.7, color: muted, lineHeight: 1.35 },
  sectionIntro: { fontSize: 8, color: '#444', lineHeight: 1.45, marginBottom: 8, width: PDF_CONTENT_WIDTH_PT },
})

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '-'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${n.toFixed(digits)}%`
}

function formatDeltaLabel(value: number | null | undefined, unit: 'currency' | 'percent' | 'number', comparatorLabel: string) {
  if (value == null || !Number.isFinite(value)) return `Benchmark unavailable for ${comparatorLabel.toLowerCase()}.`
  if (Math.abs(value) < 0.05) return `Roughly in line with ${comparatorLabel.toLowerCase()}.`
  const direction = value > 0 ? 'above' : 'below'
  if (unit === 'currency') return `${fmtMoney(Math.abs(value))} ${direction} ${comparatorLabel.toLowerCase()}.`
  if (unit === 'percent') return `${Math.abs(value).toFixed(1)} pts ${direction} ${comparatorLabel.toLowerCase()}.`
  return `${Math.round(Math.abs(value)).toLocaleString()} ${direction} ${comparatorLabel.toLowerCase()}.`
}

function benchmarkRead(delta: number | null | undefined, positiveAbove: boolean) {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.05) return 'In line with peers'
  const favorable = positiveAbove ? delta > 0 : delta < 0
  return favorable ? 'Favorable vs peers' : 'Softer vs peers'
}

function narrativeTextBlocks(raw: string): string[] {
  const t = raw.replace(/\r\n/g, '\n').replace(/\u2019/g, "'").replace(/[\u2028\u2029\u00a0]/g, ' ').trim()
  if (!t) return []
  const out: string[] = []
  for (const para of t.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= 300) out.push(para)
    else {
      const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
      out.push(...(sentences.length > 1 ? sentences : [para]))
    }
  }
  return out.length > 0 ? out : [t]
}

function compactText(raw: string, maxChars = 160): string {
  const normalized = narrativeTextBlocks(raw).join(' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  const sliced = normalized.slice(0, maxChars)
  const cut = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('; '), sliced.lastIndexOf(', '), sliced.lastIndexOf(' '))
  const safe = cut > Math.floor(maxChars * 0.55) ? sliced.slice(0, cut) : sliced
  return `${safe.trimEnd()}…`
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
  dossier: MarketDossierGemini
  signals: SignalIndicator[]
  cycleAnalysis: CycleAnalysis | null
  zoriSeries: { date: string; value: number }[]
  zoriSeriesSource: ZoriSeriesSource
  trendsSeries: { date: string; value: number }[]
  metro: MetroBenchmark | null
  logoDataUri: string | null
  staticMap: { dataUri: string; caption: string } | null
  siteRows: SiteCompareRow[] | null
}

interface ClientChapterItem {
  key: string
  title: string
  description: string
  page: number
}

function hasSection(config: ReportConfig, key: keyof ReportConfig['sections']) {
  return Boolean(config.sections[key])
}

function asDashBullet(entry: string) {
  return `- ${entry}`
}

function asChecklistItem(entry: string) {
  return `[ ] ${entry}`
}

function buildClientChapterItems(args: {
  includeThesis: boolean
  includeMarketData: boolean
  includeSiteComparison: boolean
  includeNarrative: boolean
  includeMethodology: boolean
}): ClientChapterItem[] {
  let page = 4
  const items: ClientChapterItem[] = []

  if (args.includeThesis) {
    items.push({
      key: 'thesis',
      title: 'Market thesis',
      description: 'The headline market stance and the few client-facing points that set up the rest of the brief.',
      page: 3,
    })
  }

  if (args.includeMarketData) {
    items.push({
      key: 'market_data',
      title: 'Market snapshot',
      description: 'Benchmark framing, core metrics, and the main trend charts that ground the market read.',
      page,
    })
    page += 3
  }

  if (args.includeSiteComparison) {
    items.push({
      key: 'site_comparison',
      title: 'Site comparison',
      description: 'A ranked shortlist view using Scout momentum, cycle phase, and comparable site context.',
      page,
    })
    page += 2
  }

  if (args.includeNarrative) {
    items.push({
      key: 'market_dossier',
      title: 'Supporting narrative',
      description: 'Condensed supporting context, opportunity framing, and monitoring watchpoints for the market.',
      page,
    })
    page += 3
  }

  if (args.includeMethodology) {
    items.push({
      key: 'methodology',
      title: 'Methodology appendix',
      description: 'Definitions, evidence references, and source notes used to support the client deliverable.',
      page,
    })
    page += 3
  }

  return items
}

function PageHeader({ logoDataUri, metaLeft, metaRight }: { logoDataUri: string | null; metaLeft: string; metaRight: string }) {
  return (
    <View style={styles.headerBand}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {logoDataUri ? <Image src={logoDataUri} alt="" style={{ width: 100, height: 26 }} /> : <Text style={styles.brand}>SCOUT</Text>}
      </View>
      <View>
        <Text style={styles.meta}>{metaLeft}</Text>
        <Text style={styles.meta}>{metaRight}</Text>
      </View>
    </View>
  )
}

function ClientPageNumber({ page, light = false }: { page: number; light?: boolean }) {
  return <Text style={light ? styles.clientPageNumberLight : styles.clientPageNumber}>Pg. {page}</Text>
}

export function MarketReportDocument(props: MarketReportPdfInput) {
  const { payload, brief, dossier, signals, cycleAnalysis, zoriSeries, zoriSeriesSource, trendsSeries, metro, logoDataUri, staticMap, siteRows } = props
  const reportConfig = payload.reportConfig
  const reportTitle = reportConfig.title ?? payload.marketLabel
  const reportSubtitle = reportConfig.subtitle ?? payload.metroName ?? null
  const templateLabel = reportConfig.template === 'internal' ? 'Internal Memo' : 'Client Brief'
  const dateStr = new Date(payload.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const zoriChart = buildZoriTrendChart(zoriSeries, payload.marketLabel, zoriSeriesSource)
  const permitChart = buildPermitUnitsChart(payload.permits.by_year)
  const trendsChart = buildSearchTrendsChart([...trendsSeries].sort((a, b) => a.date.localeCompare(b.date)).slice(-12), payload.trends.keyword_scope)
  const siteMomentumChart = siteRows && siteRows.length >= 2 ? buildSiteMomentumChart([...siteRows].sort((a, b) => (b.momentum ?? -1) - (a.momentum ?? -1))) : null
  const sortedSiteRows = siteRows ? [...siteRows].sort((a, b) => (b.momentum ?? -1) - (a.momentum ?? -1)) : null
  const zoriDelta = payload.zillow.zori != null && metro?.avg_zori != null ? payload.zillow.zori - metro.avg_zori : null
  const vacancyDelta = payload.census.vacancy_rate != null && metro?.avg_vacancy_rate != null ? payload.census.vacancy_rate - metro.avg_vacancy_rate : null
  const employmentValue = payload.employment.employment_rate ?? (payload.employment.unemployment_rate != null ? 100 - payload.employment.unemployment_rate : null)
  const employmentBenchmark = metro?.avg_unemployment_rate != null
    ? 100 - metro.avg_unemployment_rate
    : null
  const employmentDelta = employmentValue != null && employmentBenchmark != null ? employmentValue - employmentBenchmark : null
  const tableRows = [
    { key: 'zori' as const, sub: fmtMoney(payload.zillow.zori), bench: fmtMoney(metro?.avg_zori), signalKey: 'rent' as const, periodLabel: zoriSeriesSource === 'zillow_monthly' ? 'monthly Zillow history + latest snapshot' : 'latest Zillow snapshot', scope: payload.marketLabel },
    { key: 'vacancy' as const, sub: payload.census.vacancy_rate != null ? `${payload.census.vacancy_rate.toFixed(1)}%` : '-', bench: metro?.avg_vacancy_rate != null ? `${metro.avg_vacancy_rate.toFixed(1)}% avg` : '-', signalKey: 'vacancy' as const, periodLabel: 'latest cached ACS vintage', scope: payload.marketLabel },
    { key: 'permits' as const, sub: payload.permits.total_units_2021_2023 != null ? String(Math.round(payload.permits.total_units_2021_2023)) : '-', bench: 'County scope', signalKey: 'permits' as const, periodLabel: '2021-2023', scope: 'county proxy' },
    { key: 'zhvi' as const, sub: fmtMoney(payload.zillow.zhvi), bench: fmtMoney(metro?.avg_zhvi), periodLabel: 'latest Zillow snapshot', scope: payload.marketLabel },
    { key: 'employment' as const, sub: payload.employment.employment_rate != null ? `${payload.employment.employment_rate.toFixed(1)}% employed (est.)` : payload.employment.unemployment_rate != null ? `${payload.employment.unemployment_rate.toFixed(1)}% unemployment` : '-', bench: metro?.avg_unemployment_rate != null ? `${metro.avg_unemployment_rate.toFixed(1)}% unempl. (avg)` : '-', signalKey: 'employment' as const, periodLabel: 'latest FRED labor read', scope: payload.marketLabel },
    { key: 'migration' as const, sub: payload.census.migration_movers != null ? `${Math.round(payload.census.migration_movers).toLocaleString()} movers (diff. state)` : '-', bench: metro?.avg_migration_movers != null ? `${metro.avg_migration_movers.toLocaleString()} movers (avg / ZIP)` : '-', periodLabel: 'latest cached ACS vintage', scope: payload.marketLabel },
  ]
  const resolvedTableRows = tableRows.map((row) => ({
    ...row,
    evidence: resolveReportMetricEvidence(row.key, reportConfig.template, {
      periodLabel: row.periodLabel,
      scope: row.scope,
    }),
  }))
  const appendixRows = [
    ...resolvedTableRows.map((row) => row.evidence),
    resolveReportMetricEvidence('site_momentum', reportConfig.template, { periodLabel: 'current comparison run', scope: 'selected sites' }),
    resolveReportMetricEvidence('site_zori', reportConfig.template, { periodLabel: 'latest Zillow snapshot', scope: 'resolved site ZIPs' }),
    resolveReportMetricEvidence('site_cycle', reportConfig.template, { periodLabel: 'current comparison run', scope: 'selected sites' }),
  ]
  const coverSnapshots = [
    {
      label: 'Rent',
      value: fmtMoney(payload.zillow.zori),
      delta: formatDeltaLabel(zoriDelta, 'currency', 'metro average'),
    },
    {
      label: 'Vacancy',
      value: fmtPct(payload.census.vacancy_rate),
      delta: formatDeltaLabel(vacancyDelta, 'percent', 'metro average'),
    },
    {
      label: 'Permits',
      value: payload.permits.total_units_2021_2023 != null ? Math.round(payload.permits.total_units_2021_2023).toLocaleString() : '-',
      delta: payload.permits.total_units_2021_2023 != null ? 'County-based supply signal, 2021-2023.' : 'Permit series unavailable.',
    },
    {
      label: 'Employment',
      value: employmentValue != null ? fmtPct(employmentValue) : '-',
      delta: formatDeltaLabel(employmentDelta, 'percent', 'peer labor read'),
    },
  ]
  const marketTakeaways = [
    {
      label: 'Rent positioning',
      value: benchmarkRead(zoriDelta, true),
      body: zoriDelta != null
        ? `Current rent sits ${formatDeltaLabel(zoriDelta, 'currency', 'metro average').toLowerCase()}`
        : 'Rent benchmark comparison is not available for this export.',
    },
    {
      label: 'Supply pressure',
      value: benchmarkRead(vacancyDelta, false),
      body: vacancyDelta != null
        ? `Vacancy is ${formatDeltaLabel(vacancyDelta, 'percent', 'metro average').toLowerCase()}`
        : 'Vacancy benchmark comparison is not available for this export.',
    },
    {
      label: 'Labor backdrop',
      value: benchmarkRead(employmentDelta, true),
      body: employmentValue != null
        ? `Employment read is ${employmentValue != null ? fmtPct(employmentValue) : '-'}${employmentDelta != null ? `, ${formatDeltaLabel(employmentDelta, 'percent', 'peer labor read').toLowerCase()}` : '.'}`
        : 'Labor backdrop is unavailable for this export.',
    },
  ]
  const topSite = sortedSiteRows?.[0] ?? null
  const runnerUpSite = sortedSiteRows?.[1] ?? null
  const bottomSite = sortedSiteRows && sortedSiteRows.length > 0 ? sortedSiteRows[sortedSiteRows.length - 1] : null
  const momentumSpread =
    topSite?.momentum != null && bottomSite?.momentum != null ? topSite.momentum - bottomSite.momentum : null
  const comparisonTakeaways = [
    {
      label: 'Lead site',
      value: topSite ? `${topSite.label}${topSite.momentum != null ? ` (${topSite.momentum})` : ''}` : 'Unavailable',
      body: topSite
        ? `${topSite.zip}${topSite.cyclePhase ? ` • ${topSite.cyclePhase}` : ''}. ${topSite.signalLine}`
        : 'No ranked site available for this comparison.',
    },
    {
      label: 'Runner-up',
      value: runnerUpSite ? `${runnerUpSite.label}${runnerUpSite.momentum != null ? ` (${runnerUpSite.momentum})` : ''}` : 'Unavailable',
      body: runnerUpSite
        ? `${runnerUpSite.zip}${runnerUpSite.cyclePhase ? ` • ${runnerUpSite.cyclePhase}` : ''}. ${runnerUpSite.signalLine}`
        : 'Only one site is available, so no runner-up read is shown.',
    },
    {
      label: 'Score spread',
      value: momentumSpread != null ? `${momentumSpread} pts` : 'Unavailable',
      body:
        momentumSpread != null
          ? momentumSpread >= 10
            ? 'There is a meaningful separation between the top and bottom ranked sites.'
            : 'The comparison set is relatively tight, so underwriting assumptions will matter more.'
          : 'A full top-to-bottom spread is not available for this comparison.',
    },
  ]
  const clientSnapshotRows = resolvedTableRows.map((row) => ({
    title: row.evidence.activeLabel,
    value: row.sub,
    benchmark: row.bench,
    body: row.evidence.whyItMatters,
  }))
  const clientChapterItems = buildClientChapterItems({
    includeThesis: reportConfig.template === 'client',
    includeMarketData: hasSection(reportConfig, 'market_data'),
    includeSiteComparison: hasSection(reportConfig, 'site_comparison') && Boolean(siteRows && siteRows.length >= 2),
    includeNarrative: hasSection(reportConfig, 'market_dossier'),
    includeMethodology: hasSection(reportConfig, 'methodology'),
  })
  const clientPageFor = (key: string, fallback: number) => clientChapterItems.find((item) => item.key === key)?.page ?? fallback
  const clientChapterNumberFor = (key: string, fallback: number) => {
    const index = clientChapterItems.findIndex((item) => item.key === key)
    return index >= 0 ? String(index + 1).padStart(2, '0') : String(fallback).padStart(2, '0')
  }
  const clientThesisBullets = [
    brief.cycleHeadline,
    marketTakeaways[0]?.body ?? '',
    comparisonTakeaways[0]?.body ?? 'Comparison insights will appear when multiple sites are available.',
  ].filter(Boolean).slice(0, 3)
  const clientNarrativeSummaryCards = [
    {
      label: 'Market stance',
      value: compactText(brief.cycleHeadline, 44),
      body: compactText(dossier.geographyContext, 120),
    },
    {
      label: 'Peer context',
      value: marketTakeaways[0]?.value ?? 'Benchmark read',
      body: compactText(dossier.peerAndBenchmarkRead, 120),
    },
    {
      label: 'Near-term focus',
      value: dossier.opportunities[0] ? 'Opportunity led' : 'Watch market',
      body: compactText(dossier.opportunities[0] ?? dossier.monitoringChecklist[0] ?? dossier.limitations, 120),
    },
  ]
  const clientNarrativeThemes = [
    dossier.demandAndDemographics,
    dossier.supplyAndConstruction,
    dossier.pricingAndCapitalMarkets,
    dossier.laborAndMacro,
  ].map((card) => ({
    title: card.title,
    body: compactText(card.body, 150),
  }))
  const clientMethodologyTakeaways = [
    {
      label: 'Reading benchmarks',
      value: 'Market vs metro',
      body: 'Benchmark cards compare the selected market with metro peers instead of presenting raw values in isolation.',
    },
    {
      label: 'Primary sources',
      value: 'Zillow, ACS, FRED',
      body: 'Headline rent, vacancy, labor, and supply reads come from the same bounded source families used across Scout.',
    },
    {
      label: 'Evidence types',
      value: 'Direct and proxy',
      body: 'Some rows are direct observations while supply and model outputs are flagged as proxy or derived reads.',
    },
  ]
  const clientMethodologyRows = METHODOLOGY_PDF_ROWS.slice(0, 6)
  const clientEvidenceGroupsMap = new Map<string, {
    sourceLabel: string
    strengthLabel: string
    metrics: string[]
    sourceDetail: string
  }>()
  appendixRows.forEach((row) => {
    const existing = clientEvidenceGroupsMap.get(row.sourceLabel)
    if (existing) {
      if (!existing.metrics.includes(row.activeLabel)) existing.metrics.push(row.activeLabel)
      return
    }
    clientEvidenceGroupsMap.set(row.sourceLabel, {
      sourceLabel: row.sourceLabel,
      strengthLabel: row.strengthLabel,
      metrics: [row.activeLabel],
      sourceDetail: row.sourceDetail,
    })
  })
  const clientEvidenceGroups = Array.from(clientEvidenceGroupsMap.values()).slice(0, 4)
  const clientEvidenceRows = appendixRows.slice(0, 6)
  const clientCoverMetaCards = [
    { label: 'Document', value: 'Client market brief' },
    { label: 'Prepared for', value: reportConfig.preparedFor ?? 'Client review' },
    { label: 'Prepared by', value: reportConfig.preparedBy ?? 'Scout' },
  ]

  return (
    <Document title={`Scout Brief - ${payload.marketLabel}`} author="Scout">
      {hasSection(reportConfig, 'executive_summary') && reportConfig.template === 'internal' && (
        <Page size="A4" style={styles.page}>
          <PageHeader logoDataUri={logoDataUri} metaLeft={templateLabel} metaRight={dateStr} />
          <View style={styles.body}>
            <Text style={styles.coverEyebrow}>{reportConfig.template === 'internal' ? 'Internal Market Memo' : 'Market Brief'}</Text>
            <View style={styles.coverHero}>
              <Text style={{ fontSize: 9, color: muted, marginBottom: 4 }} wrap>{payload.marketLabel}</Text>
              <Text style={styles.h1} wrap hyphenationCallback={(word) => [word]}>{reportTitle}</Text>
              {reportSubtitle ? <Text style={[styles.narrative, { fontSize: 9, color: muted, marginBottom: 4 }]} wrap hyphenationCallback={(word) => [word]}>{reportSubtitle}</Text> : null}
              <Text style={styles.coverDeck} wrap hyphenationCallback={(word) => [word]}>
                {reportConfig.template === 'internal'
                  ? 'Working memo for analyst review, with cycle context, benchmark positioning, and source-grounded evidence.'
                  : 'Decision-ready market snapshot designed for client conversations, with cycle context, benchmark positioning, and supporting evidence.'}
              </Text>
            </View>
            {(reportConfig.preparedFor || reportConfig.preparedBy) ? (
              <View style={styles.coverMetaRow}>
                {reportConfig.preparedFor ? <View style={styles.coverMetaCard}><Text style={styles.coverMetaLabel}>Prepared For</Text><Text style={styles.coverMetaValue}>{reportConfig.preparedFor}</Text></View> : null}
                {reportConfig.preparedBy ? <View style={styles.coverMetaCard}><Text style={styles.coverMetaLabel}>Prepared By</Text><Text style={styles.coverMetaValue}>{reportConfig.preparedBy}</Text></View> : null}
              </View>
            ) : null}
            <View style={styles.coverSnapshotRow}>
              {coverSnapshots.map((item, index) => (
                <View key={item.label} style={[styles.coverSnapshotCard, ...(index === coverSnapshots.length - 1 ? [styles.coverSnapshotCardLast] : [])]}>
                  <Text style={styles.coverSnapshotLabel}>{item.label}</Text>
                  <Text style={styles.coverSnapshotValue}>{item.value}</Text>
                  <Text style={styles.coverSnapshotDelta} wrap hyphenationCallback={(word) => [word]}>{item.delta}</Text>
                </View>
              ))}
            </View>
            <View style={styles.coverSummaryPanel}>
              <Text style={styles.coverSummaryTitle}>Executive read</Text>
              <Text style={styles.coverSummaryBody} wrap hyphenationCallback={(word) => [word]}>{brief.cycleHeadline}</Text>
            </View>
            {narrativeTextBlocks(brief.narrative).map((block, i) => <Text key={i} style={[styles.narrative, ...(i > 0 ? [{ marginTop: 6 }] : [])]} wrap hyphenationCallback={(word) => [word]}>{block}</Text>)}
            {cycleAnalysis ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Cycle map</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, width: '100%' }}>
                  <CycleWheelPdf cycle={cycleAnalysis} />
                  <View style={{ flex: 1, minWidth: 120, paddingTop: 4, marginLeft: 14 }}>
                    <Text style={{ fontSize: 8, color: ink, fontFamily: 'Helvetica', fontWeight: 'bold', width: '100%' }} wrap hyphenationCallback={(word) => [word]}>{cycleAnalysis.cycleStage} {cycleAnalysis.cyclePosition}</Text>
                    <Text style={{ fontSize: 7, color: muted, marginTop: 4, lineHeight: 1.35, width: '100%' }} wrap hyphenationCallback={(word) => [word]}>Dot color reflects confidence; stroke indicates trajectory hint. Quadrants: Recovery, Expansion, Hypersupply, Recession.</Text>
                  </View>
                </View>
                <Text style={[styles.sectionTitle, { marginTop: 4 }]}>Signals</Text>
                <CycleSignalTilesPdf cycle={cycleAnalysis} />
              </>
            ) : (
              <View style={styles.signalRow}>
                {signals.map((signal) => (
                  <View key={signal.id} style={styles.signalCard}>
                    <Text style={styles.signalTitle}>{signal.label}</Text>
                    <View style={{ height: 14, marginBottom: 2, justifyContent: 'center' }}>
                      <PdfTrendArrow variant={signalIndicatorToVariant(signal)} color={accent} />
                    </View>
                    <Text style={styles.signalLine} wrap>{signal.line}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.confidence} wrap hyphenationCallback={(word) => [word]}>Confidence - {brief.confidenceLine}</Text>
            {reportConfig.analystNote ? <View style={styles.analystNoteBox}><Text style={styles.analystNoteTitle}>{reportConfig.template === 'internal' ? 'Internal Analyst Note' : 'Analyst Note'}</Text><Text style={styles.analystNoteBody} wrap hyphenationCallback={(word) => [word]}>{reportConfig.analystNote}</Text></View> : null}
            {cycleAnalysis ? <Text style={[styles.foot, { marginBottom: 6, width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>Analytical cycle classifier: {cycleAnalysis.signalsAgreement}/4 signals agree - data quality {cycleAnalysis.dataQuality}{cycleAnalysis.transitional ? ' - transitional / mixed read' : ''}.</Text> : null}
            <Text style={[styles.foot, { width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>Scout - Data: Zillow Research (ZORI/ZHVI), Census ACS & BPS, FRED, Google Trends.{zoriSeriesSource === 'zillow_monthly' ? ' ZORI trend uses monthly index values from ingested Zillow Research data.' : ' ZORI trend is modeled from latest index and YoY until the zillow_zori_monthly table is populated (npm run ingest:zillow).'}</Text>
          </View>
        </Page>
      )}

      {hasSection(reportConfig, 'executive_summary') && reportConfig.template === 'client' && (
        <Page size="A4" style={styles.clientCoverPage}>
          <View style={styles.clientCoverHero}>
            <View style={styles.clientCoverHeaderRow}>
              <View style={styles.clientCoverBrandLockup}>
                <Text style={styles.clientCoverBrand}>Scout Market Brief</Text>
              </View>
              <Text style={styles.clientCoverMetaText}>
                Client brief{"\n"}{dateStr}
              </Text>
            </View>
            <View style={styles.clientCoverCenter}>
              {logoDataUri ? <Image src={logoDataUri} alt="" style={styles.clientCoverLogo} /> : null}
              <View style={styles.clientCoverRule} />
              <Text style={styles.clientCoverTitle}>{reportTitle}</Text>
              <Text style={styles.clientCoverSubtitle} wrap hyphenationCallback={(word) => [word]}>
                {reportSubtitle ? `${reportSubtitle}. ` : ''}
                Decision-ready market brief with benchmark context, selected evidence, and presentation-grade comparison pages.
              </Text>
            </View>
          </View>
          <View style={styles.clientCoverFooter}>
            <View style={styles.clientCoverMetaGrid}>
              {clientCoverMetaCards.map((item, index) => (
                <View key={`cover-meta-${item.label}`} style={[styles.clientCoverMetaCard, ...(index === clientCoverMetaCards.length - 1 ? [styles.clientCoverMetaCardLast] : [])]}>
                  <Text style={styles.clientCoverMetaLabel}>{item.label}</Text>
                  <Text style={styles.clientCoverMetaValue} wrap hyphenationCallback={(word) => [word]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        </Page>
      )}

      {reportConfig.template === 'client' && (
        <Page size="A4" style={styles.clientLightPage}>
          <Text style={styles.clientContentsGhost}>CONTENTS</Text>
          <View style={{ marginTop: 54 }}>
            {clientChapterItems.map((item) => (
              <View key={item.key} style={styles.clientContentsBlock}>
                <View style={styles.clientContentsHeader}>
                  <Text style={styles.clientContentsTitle}>{item.title}</Text>
                  <Text style={styles.clientContentsPage}>{item.page}</Text>
                </View>
                <View style={[styles.clientChapterRule, { marginBottom: 10, width: 150 }]} />
                <Text style={styles.clientContentsBody} wrap hyphenationCallback={(word) => [word]}>
                  {item.description}
                </Text>
              </View>
            ))}
          </View>
          <ClientPageNumber page={2} />
        </Page>
      )}

      {reportConfig.template === 'client' && (
        <Page size="A4" style={styles.clientLightPage}>
          <Text style={styles.clientThesisKicker}>Market thesis</Text>
          <Text style={styles.clientThesisHeadline} wrap hyphenationCallback={(word) => [word]}>
            {brief.cycleHeadline}
          </Text>
          <Text style={styles.clientThesisBody} wrap hyphenationCallback={(word) => [word]}>
            {reportConfig.analystNote
              ? reportConfig.analystNote
              : narrativeTextBlocks(brief.narrative)[0] ?? 'This section summarizes the main market stance that shapes the rest of the client brief.'}
          </Text>
          <Text style={[styles.clientSectionKicker, { marginBottom: 8 }]}>What matters most</Text>
          {clientThesisBullets.map((item, index) => (
            <Text key={`thesis-bullet-${index}`} style={styles.clientThesisBullet} wrap hyphenationCallback={(word) => [word]}>
              {asDashBullet(item)}
            </Text>
          ))}
          {cycleAnalysis ? (
            <>
              <View style={styles.clientCycleRow}>
                <CycleWheelPdf cycle={cycleAnalysis} />
                <View style={styles.clientCycleMeta}>
                  <Text style={styles.clientCycleTitle} wrap hyphenationCallback={(word) => [word]}>
                    {cycleAnalysis.cycleStage} {cycleAnalysis.cyclePosition}
                  </Text>
                  <Text style={styles.clientCycleBody} wrap hyphenationCallback={(word) => [word]}>
                    The wheel shows where the market sits in the current cycle, while the signals below explain what is driving that placement.
                  </Text>
                  <Text style={styles.clientCycleBody} wrap hyphenationCallback={(word) => [word]}>
                    Dot color reflects confidence and the quadrant labels summarize the four-stage Scout cycle framework.
                  </Text>
                </View>
              </View>
              <CycleSignalTilesPdf cycle={cycleAnalysis} />
            </>
          ) : null}
          <ClientPageNumber page={3} />
        </Page>
      )}

      {hasSection(reportConfig, 'market_data') && reportConfig.template === 'client' && (
        <Page size="A4" style={styles.clientChapterPage}>
          <Text style={styles.clientChapterNumber}>Chapter {clientChapterNumberFor('market_data', 1)}</Text>
          <Text style={styles.clientChapterTitle}>Market{"\n"}Snapshot</Text>
          <View style={styles.clientChapterRule} />
          <Text style={styles.clientChapterBody} wrap hyphenationCallback={(word) => [word]}>
            Benchmark context, headline metrics, and key time-series visuals that explain where this market sits today.
          </Text>
          <ClientPageNumber page={clientPageFor('market_data', 4)} light />
        </Page>
      )}

      {hasSection(reportConfig, 'market_dossier') && reportConfig.template === 'internal' && (
        <>
          <Page size="A4" style={styles.page}>
            <PageHeader logoDataUri={logoDataUri} metaLeft="Market intelligence dossier" metaRight={payload.marketLabel} />
            <Text style={styles.dossierKicker}>AI-GENERATED - FULL MARKET CONTEXT</Text>
            <Text style={styles.dossierIntro} wrap hyphenationCallback={(word) => [word]}>{dossier.geographyContext}</Text>
            <Text style={styles.sectionTitle}>Executive summary (dossier)</Text>
            {narrativeTextBlocks(dossier.executiveSummary).map((block, i) => <Text key={`d-exec-${i}`} style={[styles.narrative, { marginBottom: 6 }]} wrap hyphenationCallback={(word) => [word]}>{block}</Text>)}
            <Text style={styles.sectionTitle}>Thematic deep dive</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: PDF_CONTENT_WIDTH_PT }}>
              {[dossier.demandAndDemographics, dossier.supplyAndConstruction, dossier.pricingAndCapitalMarkets, dossier.laborAndMacro].map((card) => (
                <View key={card.title} style={styles.dossierCard}>
                  <Text style={styles.dossierCardTitle}>{card.title}</Text>
                  <Text style={styles.dossierCardBody} wrap hyphenationCallback={(word) => [word]}>{card.body}</Text>
                </View>
              ))}
            </View>
          </Page>
          <Page size="A4" style={styles.page}>
            <PageHeader logoDataUri={logoDataUri} metaLeft="Dossier (continued)" metaRight={payload.marketLabel} />
            <Text style={styles.sectionTitle}>Peer & benchmark read</Text>
            {narrativeTextBlocks(dossier.peerAndBenchmarkRead).map((block, i) => <Text key={`d-peer-${i}`} style={[styles.narrative, { marginBottom: 6 }]} wrap hyphenationCallback={(word) => [word]}>{block}</Text>)}
            <View style={{ flexDirection: 'row', width: PDF_CONTENT_WIDTH_PT, marginTop: 6 }}>
              <View style={{ width: '49%', paddingRight: 6 }}>
                <Text style={styles.dossierListTitle}>Key risks</Text>
                {dossier.risks.map((entry, i) => <Text key={`r-${i}`} style={styles.dossierBullet} wrap hyphenationCallback={(word) => [word]}>{asDashBullet(entry)}</Text>)}
              </View>
              <View style={{ width: '49%', paddingLeft: 6 }}>
                <Text style={styles.dossierListTitle}>Opportunities</Text>
                {dossier.opportunities.map((entry, i) => <Text key={`o-${i}`} style={styles.dossierBullet} wrap hyphenationCallback={(word) => [word]}>{asDashBullet(entry)}</Text>)}
              </View>
            </View>
            <Text style={styles.dossierListTitle}>Underwriting scenarios</Text>
            {dossier.scenarios.map((entry, i) => <Text key={`s-${i}`} style={styles.dossierBullet} wrap hyphenationCallback={(word) => [word]}>{i + 1}. {entry}</Text>)}
          </Page>
          <Page size="A4" style={styles.page}>
            <PageHeader logoDataUri={logoDataUri} metaLeft="Dossier (continued)" metaRight={payload.marketLabel} />
            <Text style={styles.dossierListTitle}>Monitoring checklist</Text>
            {dossier.monitoringChecklist.map((entry, i) => <Text key={`m-${i}`} style={styles.dossierBullet} wrap hyphenationCallback={(word) => [word]}>{asChecklistItem(entry)}</Text>)}
            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Data limitations</Text>
            <Text style={styles.dossierLimitations} wrap hyphenationCallback={(word) => [word]}>{dossier.limitations}</Text>
            <Text style={[styles.foot, { marginTop: 10 }]} wrap hyphenationCallback={(word) => [word]}>Dossier narrative is model-generated from the same cached metrics as the charts in this PDF; validate material decisions against primary sources (Zillow Research, Census, FRED).</Text>
          </Page>
        </>
      )}

      {hasSection(reportConfig, 'market_data') && reportConfig.template === 'client' && (
        <>
          <Page size="A4" style={styles.clientLightPage}>
            <Text style={styles.clientSectionKicker}>Market snapshot</Text>
            <Text style={styles.clientSectionHeadline}>Key Metrics And Peer Context</Text>
            <Text style={styles.clientSectionBody} wrap hyphenationCallback={(word) => [word]}>
              This page keeps the client-facing benchmark story tight: what the market looks like now, where it sits against metro peers, and which signals are doing the most work.
            </Text>
            <View style={styles.takeawayRow}>
              {marketTakeaways.map((item, index) => (
                <View key={`client-takeaway-${item.label}`} style={[styles.takeawayCard, ...(index === marketTakeaways.length - 1 ? [styles.takeawayCardLast] : [])]}>
                  <Text style={styles.takeawayLabel}>{item.label}</Text>
                  <Text style={styles.takeawayValue} wrap hyphenationCallback={(word) => [word]}>{item.value}</Text>
                  <Text style={styles.takeawayBody} wrap hyphenationCallback={(word) => [word]}>{item.body}</Text>
                </View>
              ))}
            </View>
            <View style={styles.clientMetricGrid}>
              {clientSnapshotRows.map((row, index) => (
                <View key={`client-metric-${row.title}`} style={[styles.clientMetricCard, ...(index % 2 === 1 ? [{ marginRight: 0 }] : [])]}>
                  <Text style={styles.clientMetricCardTitle}>{row.title}</Text>
                  <Text style={styles.clientMetricCardValue} wrap hyphenationCallback={(word) => [word]}>{row.value}</Text>
                  <Text style={styles.clientMetricCardBench} wrap hyphenationCallback={(word) => [word]}>Metro benchmark: {row.benchmark}</Text>
                  <Text style={styles.clientMetricCardBody} wrap hyphenationCallback={(word) => [word]}>{row.body}</Text>
                </View>
              ))}
            </View>
            {metro ? <Text style={[styles.foot, { width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>Metro peer values are simple means across available ZIP-level rows in the same metro for Zillow, ACS, and FRED-backed metrics.</Text> : null}
            <ClientPageNumber page={clientPageFor('market_data', 4) + 1} />
          </Page>
          <Page size="A4" style={styles.clientLightPage}>
            <Text style={styles.clientSectionKicker}>Market charts</Text>
            <Text style={styles.clientSectionHeadline}>Trajectory And Demand Signals</Text>
            <Text style={styles.clientSectionBody} wrap hyphenationCallback={(word) => [word]}>
              These visuals carry the time-series evidence behind the market read: rent movement, supply pressure, and search behavior.
            </Text>
            <View style={styles.clientChartsPanel}>
              <Text style={styles.clientChartTitle}>Rent trajectory</Text>
              <SparklinePdf data={buildPdfSeriesFromScoutChart(zoriChart)} width={PDF_CONTENT_WIDTH_PT - 24} height={82} />
              <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(zoriChart)}</Text>
            </View>
            <View style={styles.clientChartsPanel}>
              <Text style={styles.clientChartTitle}>Permit acceleration</Text>
              <BarChartPdf bars={buildPdfBarRowsFromScoutChart(permitChart)} width={PDF_CONTENT_WIDTH_PT - 24} height={116} />
              <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(permitChart)}</Text>
            </View>
            <View style={styles.clientChartsPanel}>
              <Text style={styles.clientChartTitle}>Search sentiment</Text>
              <Text style={{ fontSize: 7, color: muted, marginBottom: 4 }} wrap>{payload.trends.keyword_scope}</Text>
              <SparklinePdf data={buildPdfSeriesFromScoutChart(trendsChart)} width={PDF_CONTENT_WIDTH_PT - 24} height={82} color="#64748b" />
              <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(trendsChart)}</Text>
            </View>
            <ClientPageNumber page={clientPageFor('market_data', 4) + 2} />
          </Page>
        </>
      )}

      {hasSection(reportConfig, 'market_data') && reportConfig.template === 'internal' && (
        <>
          <Page size="A4" style={styles.page}>
            <PageHeader logoDataUri={logoDataUri} metaLeft="Market data" metaRight={payload.marketLabel} />
            <Text style={styles.sectionTitle}>Key metrics vs. metro benchmark</Text>
            <Text style={styles.sectionIntro} wrap hyphenationCallback={(word) => [word]}>
              {reportConfig.template === 'internal'
                ? 'This table keeps the core market metrics, source classes, and metro comparisons visible for analyst review.'
                : 'This table highlights the main market indicators clients ask about most: rent, vacancy, supply, pricing, labor, and migration.'}
            </Text>
            <View style={styles.takeawayRow}>
              {marketTakeaways.map((item, index) => (
                <View key={item.label} style={[styles.takeawayCard, ...(index === marketTakeaways.length - 1 ? [styles.takeawayCardLast] : [])]}>
                  <Text style={styles.takeawayLabel}>{item.label}</Text>
                  <Text style={styles.takeawayValue} wrap hyphenationCallback={(word) => [word]}>{item.value}</Text>
                  <Text style={styles.takeawayBody} wrap hyphenationCallback={(word) => [word]}>{item.body}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
              <Text style={[styles.th, { width: '38%' }]}>Metric</Text>
              <Text style={[styles.th, { width: '22%' }]}>Submarket</Text>
              <Text style={[styles.th, { width: '10%' }]}>Signal</Text>
              <Text style={[styles.th, { width: '30%' }]}>Metro peer avg</Text>
            </View>
            {resolvedTableRows.map((row) => (
              <View key={row.evidence.key} style={[styles.tableRow, { flexDirection: 'row', alignItems: 'flex-start' }]}>
                <View style={styles.metricLabelCell}>
                  <Text style={styles.metricLabelTitle} wrap hyphenationCallback={(word) => [word]}>{row.evidence.activeLabel}</Text>
                  <Text style={styles.metricLabelSub} wrap hyphenationCallback={(word) => [word]}>
                    {row.evidence.explanation} {row.evidence.strengthLabel}. Source: {row.evidence.sourceLabel}.
                  </Text>
                </View>
                <Text style={[styles.td, { width: '22%', fontFamily: 'Helvetica', fontWeight: 'bold' }]} wrap hyphenationCallback={(word) => [word]}>{row.sub}</Text>
                <View style={{ width: '10%', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2, minHeight: 14 }}>
                  {row.signalKey && cycleAnalysis ? <PdfTrendArrow variant={trendKindToVariant(row.signalKey, cycleAnalysis.signals[row.signalKey].score)} color={ink} /> : <Text style={[styles.td, { textAlign: 'center' }]}>-</Text>}
                </View>
                <Text style={[styles.td, { width: '30%', color: muted }]} wrap hyphenationCallback={(word) => [word]}>{row.bench}</Text>
              </View>
            ))}
            {metro ? <Text style={[styles.foot, { marginTop: 6 }]}>Metro peer column: ZORI/ZHVI are simple means across {metro.zip_count} Zillow-tracked ZIPs in the same metro. Vacancy, unemployment, and migration benchmarks are simple means across peer ZIPs that have those rows in cache (ACS / FRED).</Text> : null}
            <Text style={styles.sectionTitle}>Rent trajectory (ZORI - {zoriSeriesSource === 'zillow_monthly' ? 'monthly, Zillow Research' : 'modeled from latest + YoY'})</Text>
            <SparklinePdf data={buildPdfSeriesFromScoutChart(zoriChart)} width={PDF_CONTENT_WIDTH_PT} height={68} />
            <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(zoriChart)}</Text>
            <Text style={styles.sectionTitle}>Permit acceleration (Census BPS, county)</Text>
            <BarChartPdf bars={buildPdfBarRowsFromScoutChart(permitChart)} width={PDF_CONTENT_WIDTH_PT} height={108} />
            <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(permitChart)}</Text>
          </Page>
          <Page size="A4" style={styles.page}>
            <PageHeader logoDataUri={logoDataUri} metaLeft="Market data (continued)" metaRight={payload.marketLabel} />
            <Text style={styles.sectionTitle}>Search sentiment (Google Trends)</Text>
            <Text style={{ fontSize: 7, color: muted, marginBottom: 4, width: PDF_CONTENT_WIDTH_PT }} wrap>{payload.trends.keyword_scope}</Text>
            <SparklinePdf data={buildPdfSeriesFromScoutChart(trendsChart)} width={PDF_CONTENT_WIDTH_PT} height={68} color="#64748b" />
            <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(trendsChart)}</Text>
            <Text style={[styles.foot, { marginTop: 14, width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>FRED uses the first ZIP&apos;s county; the employment row prefers a computed employment rate when labor-force series match, otherwise latest unemployment. Vacancy, migration, and BPS permits need Census ACS/BPS rows in Supabase for this area (cold-load at least one ZIP via the map).</Text>
          </Page>
        </>
      )}

      {hasSection(reportConfig, 'site_comparison') && siteRows && siteRows.length >= 2 && (
        <>
        {reportConfig.template === 'client' ? (
          <Page size="A4" style={styles.clientChapterPage}>
            <Text style={styles.clientChapterNumber}>Chapter {clientChapterNumberFor('site_comparison', 2)}</Text>
            <Text style={styles.clientChapterTitle}>Site{"\n"}Comparison</Text>
            <View style={styles.clientChapterRule} />
            <Text style={styles.clientChapterBody} wrap hyphenationCallback={(word) => [word]}>
              A ranked shortlist view using the same Scout comparison signals shown in the EDA chat workflow, translated into a cleaner client-facing chapter.
            </Text>
            <ClientPageNumber page={clientPageFor('site_comparison', 7)} light />
          </Page>
        ) : null}
        <Page size="A4" style={styles.page}>
          <PageHeader logoDataUri={logoDataUri} metaLeft="Site comparison" metaRight={payload.marketLabel} />
          <Text style={styles.sectionTitle}>Ranked by momentum score</Text>
          <Text style={styles.sectionIntro} wrap hyphenationCallback={(word) => [word]}>
            This page summarizes how the current comparison set stacks up on the same momentum and cycle signals used in Scout charts inside the EDA workflow.
          </Text>
          {topSite ? (
            <View style={styles.comparisonLeaderboard}>
              <View style={styles.comparisonHeroCard}>
                <Text style={styles.comparisonRankLabel}>Current leader</Text>
                <Text style={styles.comparisonSiteName} wrap hyphenationCallback={(word) => [word]}>{topSite.label}</Text>
                <Text style={styles.comparisonSiteMeta} wrap hyphenationCallback={(word) => [word]}>
                  {topSite.zip}{topSite.cyclePhase ? ` • ${topSite.cyclePhase}` : ''}
                </Text>
                <Text style={styles.comparisonScore}>{topSite.momentum != null ? `${topSite.momentum}` : '-'}</Text>
                <Text style={styles.comparisonBody} wrap hyphenationCallback={(word) => [word]}>{topSite.signalLine}</Text>
              </View>
              <View style={styles.comparisonSupportCard}>
                <Text style={styles.comparisonRankLabel}>{runnerUpSite ? 'Closest alternative' : 'Comparison note'}</Text>
                <Text style={styles.comparisonSiteName} wrap hyphenationCallback={(word) => [word]}>
                  {runnerUpSite ? runnerUpSite.label : 'Single leading site'}
                </Text>
                <Text style={styles.comparisonSiteMeta} wrap hyphenationCallback={(word) => [word]}>
                  {runnerUpSite
                    ? `${runnerUpSite.zip}${runnerUpSite.cyclePhase ? ` • ${runnerUpSite.cyclePhase}` : ''}`
                    : 'No second-ranked site is available in this export.'}
                </Text>
                <Text style={styles.comparisonScore}>{runnerUpSite?.momentum != null ? `${runnerUpSite.momentum}` : '-'}</Text>
                <Text style={styles.comparisonBody} wrap hyphenationCallback={(word) => [word]}>
                  {runnerUpSite ? runnerUpSite.signalLine : 'Add more saved or uploaded sites to unlock a fuller competitive ladder.'}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.comparisonStatsRow}>
            {comparisonTakeaways.map((item, index) => (
              <View key={item.label} style={[styles.comparisonStatCard, ...(index === comparisonTakeaways.length - 1 ? [styles.comparisonStatCardLast] : [])]}>
                <Text style={styles.comparisonStatLabel}>{item.label}</Text>
                <Text style={styles.comparisonStatValue} wrap hyphenationCallback={(word) => [word]}>{item.value}</Text>
                <Text style={styles.comparisonStatBody} wrap hyphenationCallback={(word) => [word]}>{item.body}</Text>
              </View>
            ))}
          </View>
          {siteMomentumChart ? (
            <>
              <BarChartPdf bars={buildPdfBarRowsFromScoutChart(siteMomentumChart)} width={PDF_CONTENT_WIDTH_PT} height={110} />
              <Text style={styles.chartFoot} wrap hyphenationCallback={(word) => [word]}>Evidence - {buildChartCitationFooter(siteMomentumChart)}</Text>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', paddingBottom: 4, marginTop: 8 }}>
            <Text style={[styles.th, { width: '7%' }]}>#</Text>
            <Text style={[styles.th, { width: '18%' }]}>Site</Text>
            <Text style={[styles.th, { width: '12%' }]}>ZIP</Text>
            <Text style={[styles.th, { width: '12%' }]}>ZORI</Text>
            <Text style={[styles.th, { width: '10%' }]}>Mom.</Text>
            <Text style={[styles.th, { width: '18%' }]}>Cycle</Text>
            <Text style={[styles.th, { width: '23%' }]}>Read</Text>
          </View>
          {sortedSiteRows?.map((row, i) => (
            <View key={row.label + row.zip} style={[styles.tableRow, { flexDirection: 'row', alignItems: 'flex-start' }]}>
              <Text style={[styles.td, { width: '7%' }]} wrap={false}>{i + 1}</Text>
              <Text style={[styles.td, { width: '18%' }]} wrap hyphenationCallback={(word) => [word]}>{row.label}</Text>
              <Text style={[styles.td, { width: '12%' }]} wrap={false}>{row.zip}</Text>
              <Text style={[styles.td, { width: '12%' }]} wrap={false}>{fmtMoney(row.zori)}</Text>
              <Text style={[styles.td, { width: '10%' }]} wrap={false}>{row.momentum != null ? String(row.momentum) : '-'}</Text>
              <Text style={[styles.td, { width: '18%', fontSize: 7 }]} wrap hyphenationCallback={(word) => [word]}>{row.cyclePhase ?? '-'}</Text>
              <Text style={[styles.td, { width: '23%', fontSize: 7 }]} wrap hyphenationCallback={(word) => [word]}>{row.signalLine}</Text>
            </View>
          ))}
          <Text style={styles.foot}>Momentum score from /api/momentum; cycle phase from the same cached inputs as the ZIP classifier (no extra API calls).</Text>
        </Page>
        </>
      )}

      {hasSection(reportConfig, 'market_dossier') && reportConfig.template === 'client' && (
        <>
        <Page size="A4" style={styles.clientChapterPage}>
          <Text style={styles.clientChapterNumber}>Chapter {clientChapterNumberFor('market_dossier', 3)}</Text>
          <Text style={styles.clientChapterTitle}>Supporting{"\n"}Narrative</Text>
          <View style={styles.clientChapterRule} />
          <Text style={styles.clientChapterBody} wrap hyphenationCallback={(word) => [word]}>
            A condensed narrative layer that frames opportunities, risk watchpoints, and the broader market story without turning the brief into a memo.
          </Text>
          <ClientPageNumber page={clientPageFor('market_dossier', 7)} light />
        </Page>
        <Page size="A4" style={styles.clientLightPage}>
          <Text style={styles.clientSectionKicker}>Supporting narrative</Text>
          <Text style={styles.clientSectionHeadline}>Context, Opportunities, And Watchpoints</Text>
          <Text style={styles.clientSectionBody} wrap hyphenationCallback={(word) => [word]}>
            This chapter keeps the qualitative layer concise: what is shaping the market, where the opportunity sits, and what to keep monitoring as conditions evolve.
          </Text>
          <View style={styles.takeawayRow}>
            {clientNarrativeSummaryCards.map((item, index) => (
              <View key={`client-narrative-${item.label}`} style={[styles.takeawayCard, ...(index === clientNarrativeSummaryCards.length - 1 ? [styles.takeawayCardLast] : [])]}>
                <Text style={styles.takeawayLabel}>{item.label}</Text>
                <Text style={styles.takeawayValue} wrap hyphenationCallback={(word) => [word]}>{item.value}</Text>
                <Text style={styles.takeawayBody} wrap hyphenationCallback={(word) => [word]}>{item.body}</Text>
              </View>
            ))}
          </View>
          {staticMap ? (
            <View style={styles.clientImagePanel} wrap={false}>
              <Image src={staticMap.dataUri} alt="" style={styles.clientMapImage} />
              <Text style={styles.clientNarrativeTitle}>Neighborhood snapshot</Text>
              <Text style={styles.clientImageCaption} wrap hyphenationCallback={(word) => [word]}>
                {staticMap.caption}
              </Text>
            </View>
          ) : null}
          <View style={styles.clientNarrativePanel} wrap={false}>
            <Text style={styles.clientNarrativeTitle}>What is driving the market</Text>
            {narrativeTextBlocks(dossier.executiveSummary).slice(0, 2).map((block, i) => (
              <Text key={`d-client-${i}`} style={styles.clientNarrativeText} wrap hyphenationCallback={(word) => [word]}>
                {block}
              </Text>
            ))}
          </View>
          <View style={styles.clientNarrativePanel} wrap={false}>
            <View style={styles.clientBulletGrid}>
              <View style={styles.clientBulletColumn}>
                <Text style={styles.clientNarrativeTitle}>Opportunities to emphasize</Text>
                {dossier.opportunities.slice(0, 3).map((entry, i) => (
                  <Text key={`client-o-${i}`} style={styles.clientNarrativeText} wrap hyphenationCallback={(word) => [word]}>
                    {asDashBullet(entry)}
                  </Text>
                ))}
              </View>
              <View style={[styles.clientBulletColumn, { paddingRight: 0, paddingLeft: 6 }]}>
                <Text style={styles.clientNarrativeTitle}>Monitoring watchpoints</Text>
                {dossier.monitoringChecklist.slice(0, 3).map((entry, i) => (
                  <Text key={`client-m-${i}`} style={styles.clientNarrativeText} wrap hyphenationCallback={(word) => [word]}>
                    {asChecklistItem(entry)}
                  </Text>
                ))}
              </View>
            </View>
          </View>
          <ClientPageNumber page={clientPageFor('market_dossier', 7) + 1} />
        </Page>
        <Page size="A4" style={styles.clientLightPage}>
          <Text style={styles.clientSectionKicker}>Supporting narrative</Text>
          <Text style={styles.clientSectionHeadline}>Market Themes And Caveats</Text>
          <Text style={styles.clientSectionBody} wrap hyphenationCallback={(word) => [word]}>
            These cards keep the qualitative read aligned with the rest of the report: short, scannable, and directly tied back to the broader market framing.
          </Text>
          <View style={styles.clientMethodGrid}>
            {clientNarrativeThemes.map((card, index) => (
              <View key={`client-${card.title}`} style={[styles.clientMethodCard, ...(index % 2 === 1 ? [{ marginRight: 0 }] : [])]} wrap={false}>
                <Text style={styles.clientMethodMetric}>{card.title}</Text>
                <Text style={styles.clientMethodDef} wrap hyphenationCallback={(word) => [word]}>{card.body}</Text>
              </View>
            ))}
          </View>
          <View style={styles.clientNarrativePanel} wrap={false}>
            <Text style={styles.clientNarrativeTitle}>Peer and benchmark read</Text>
            {narrativeTextBlocks(dossier.peerAndBenchmarkRead).slice(0, 2).map((block, i) => (
              <Text key={`peer-client-${i}`} style={styles.clientNarrativeText} wrap hyphenationCallback={(word) => [word]}>
                {block}
              </Text>
            ))}
          </View>
          <View style={styles.clientNarrativePanel} wrap={false}>
            <Text style={styles.clientNarrativeTitle}>Limitations</Text>
            <Text style={styles.clientNarrativeText} wrap hyphenationCallback={(word) => [word]}>{dossier.limitations}</Text>
          </View>
          <Text style={[styles.foot, { marginTop: 10, width: PDF_CONTENT_WIDTH_PT }]} wrap hyphenationCallback={(word) => [word]}>
            This supporting narrative is condensed for client delivery and should be read alongside the cycle and market-data pages.
          </Text>
          <ClientPageNumber page={clientPageFor('market_dossier', 7) + 2} />
        </Page>
        </>
      )}

      {hasSection(reportConfig, 'methodology') && reportConfig.template === 'client' && (
        <>
          <Page size="A4" style={styles.clientChapterPage}>
            <Text style={styles.clientChapterNumber}>Chapter {clientChapterNumberFor('methodology', 4)}</Text>
            <Text style={styles.clientChapterTitle}>Methodology{"\n"}Appendix</Text>
            <View style={styles.clientChapterRule} />
            <Text style={styles.clientChapterBody} wrap hyphenationCallback={(word) => [word]}>
              Definitions, evidence notes, and source framing for the client-facing metrics shown earlier in the brief.
            </Text>
            <ClientPageNumber page={clientPageFor('methodology', 10)} light />
          </Page>
          <Page size="A4" style={styles.clientLightPage}>
            <Text style={styles.clientSectionKicker}>Methodology</Text>
            <Text style={styles.clientSectionHeadline}>How To Read The Core Metrics</Text>
            <Text style={styles.clientSectionBody} wrap hyphenationCallback={(word) => [word]}>
              These definitions explain what each headline metric means, why it matters, and which source family it comes from.
            </Text>
            <View style={styles.takeawayRow}>
              {clientMethodologyTakeaways.map((item, index) => (
                <View key={`client-method-takeaway-${item.label}`} style={[styles.takeawayCard, ...(index === clientMethodologyTakeaways.length - 1 ? [styles.takeawayCardLast] : [])]}>
                  <Text style={styles.takeawayLabel}>{item.label}</Text>
                  <Text style={styles.takeawayValue} wrap hyphenationCallback={(word) => [word]}>{item.value}</Text>
                  <Text style={styles.takeawayBody} wrap hyphenationCallback={(word) => [word]}>{item.body}</Text>
                </View>
              ))}
            </View>
            <View style={styles.clientMethodGrid}>
              {clientMethodologyRows.map((row, index) => (
                <View key={`client-method-${row.metric}`} style={[styles.clientMethodCard, ...(index % 2 === 1 ? [{ marginRight: 0 }] : [])]}>
                  <Text style={styles.clientMethodMetric}>{row.metric}</Text>
                  <Text style={styles.clientMethodDef} wrap hyphenationCallback={(word) => [word]}>{row.definition}</Text>
                  <Text style={styles.clientMethodSrc} wrap hyphenationCallback={(word) => [word]}>{row.source}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.foot, { width: PDF_CONTENT_WIDTH_PT, marginTop: 4 }]} wrap hyphenationCallback={(word) => [word]}>
              For client delivery, this appendix focuses on the headline metrics used in the brief. The internal memo retains the fuller glossary and evidence table.
            </Text>
            <ClientPageNumber page={clientPageFor('methodology', 10) + 1} />
          </Page>
          <Page size="A4" style={styles.clientLightPage}>
            <Text style={styles.clientSectionKicker}>Methodology appendix</Text>
            <Text style={styles.clientSectionHeadline}>Source Families And Evidence Notes</Text>
            <Text style={styles.clientSectionBody} wrap hyphenationCallback={(word) => [word]}>
              This page groups the main source families behind the brief so clients can see what is observed directly, what is aggregated, and where Scout adds derived signals.
            </Text>
            <View style={styles.clientMethodGrid}>
              {clientEvidenceGroups.map((group, index) => (
                <View key={`client-evidence-group-${group.sourceLabel}`} style={[styles.clientMethodCard, ...(index % 2 === 1 ? [{ marginRight: 0 }] : [])]}>
                  <Text style={styles.clientMethodMetric}>{group.sourceLabel}</Text>
                  <Text style={styles.clientMethodDef} wrap hyphenationCallback={(word) => [word]}>
                    {group.strengthLabel}. Used for {group.metrics.join(', ')}.
                  </Text>
                  <Text style={styles.clientMethodSrc} wrap hyphenationCallback={(word) => [word]}>{group.sourceDetail}</Text>
                </View>
              ))}
            </View>
            <View style={styles.clientEvidencePanel}>
              <Text style={styles.clientNarrativeTitle}>Evidence reference</Text>
              {clientEvidenceRows.map((row, index) => (
                <View key={`client-evidence-${row.key}-${index}`} style={[styles.clientEvidenceRow, ...(index === clientEvidenceRows.length - 1 ? [{ borderBottomWidth: 0 }] : [])]}>
                  <Text style={styles.clientEvidenceMetric}>{row.activeLabel}</Text>
                  <Text style={styles.clientEvidenceBody} wrap hyphenationCallback={(word) => [word]}>
                    {row.explanation} {row.whyItMatters} Source: {row.sourceLabel}. {[row.scope, row.periodLabel].filter(Boolean).join(' - ')}
                  </Text>
                </View>
              ))}
            </View>
            <ClientPageNumber page={clientPageFor('methodology', 10) + 2} />
          </Page>
        </>
      )}

      {hasSection(reportConfig, 'methodology') && reportConfig.template === 'internal' && (
        <Page size="A4" style={styles.page}>
          <PageHeader logoDataUri={logoDataUri} metaLeft="Methodology" metaRight={payload.marketLabel} />
          <Text style={styles.methTitle}>Methodology & definitions</Text>
          <Text style={{ fontSize: 6.5, color: muted, marginBottom: 6, width: PDF_CONTENT_WIDTH_PT }} wrap>Key metrics below are documented for {reportConfig.template === 'internal' ? 'internal review' : 'client deliverables'}. Cycle position uses four directional signals (rent, vacancy, permits, employment); momentum blends labor, rent level, and permit volume vs. a ZIP comparison set.</Text>
          <View style={styles.methHeaderRow}>
            <Text style={styles.methColMetric}>Metric</Text>
            <Text style={styles.methColDef}>Definition</Text>
            <Text style={styles.methColSrc}>Source</Text>
          </View>
          {METHODOLOGY_PDF_ROWS.map((row) => (
            <View key={row.metric} style={styles.methRow}>
              <Text style={styles.methColMetric}>{row.metric}</Text>
              <Text style={styles.methColDef} wrap hyphenationCallback={(word) => [word]}>{row.definition}</Text>
              <Text style={styles.methColSrc} wrap hyphenationCallback={(word) => [word]}>{row.source}</Text>
            </View>
          ))}
          <Text style={[styles.foot, { width: PDF_CONTENT_WIDTH_PT, marginTop: 10 }]} wrap hyphenationCallback={(word) => [word]}>This appendix is included because the report template requested methodology detail. Hide it for slimmer client-facing exports.</Text>
        </Page>
      )}

      {reportConfig.template === 'internal' && (
        <Page size="A4" style={styles.page}>
          <PageHeader logoDataUri={logoDataUri} metaLeft="Evidence appendix" metaRight={payload.marketLabel} />
          <Text style={styles.sectionTitle}>Metric evidence reference</Text>
          <Text style={styles.sectionIntro} wrap hyphenationCallback={(word) => [word]}>
            This appendix lists how the headline metrics in this report are sourced, what they mean, and whether they are direct observations, aggregated reads, derived scores, or proxy measures.
          </Text>
          <View style={styles.methHeaderRow}>
            <Text style={[styles.methColMetric, { width: '22%' }]}>Metric</Text>
            <Text style={[styles.methColDef, { width: '40%' }]}>Meaning</Text>
            <Text style={[styles.methColSrc, { width: '18%' }]}>Source</Text>
            <Text style={[styles.methColSrc, { width: '20%' }]}>Scope / period</Text>
          </View>
          {appendixRows.map((row, index) => (
            <View key={`${row.key}:${index}`} style={styles.methRow}>
              <Text style={[styles.methColMetric, { width: '22%' }]}>{row.activeLabel}</Text>
              <Text style={[styles.methColDef, { width: '40%' }]} wrap hyphenationCallback={(word) => [word]}>
                {row.explanation} {row.whyItMatters} {row.strengthLabel}.
              </Text>
              <Text style={[styles.methColSrc, { width: '18%' }]} wrap hyphenationCallback={(word) => [word]}>
                {row.sourceLabel}
              </Text>
              <Text style={[styles.methColSrc, { width: '20%' }]} wrap hyphenationCallback={(word) => [word]}>
                {[row.scope, row.periodLabel, row.sourceDetail].filter(Boolean).join(' - ')}
              </Text>
            </View>
          ))}
        </Page>
      )}
    </Document>
  )
}
