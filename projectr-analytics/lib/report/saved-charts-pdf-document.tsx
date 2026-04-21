import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { BarChartPdf, SparklinePdf } from '@/lib/report/pdf-charts'
import { buildPdfBarRowsFromScoutChart, buildPdfSeriesFromScoutChart } from '@/lib/report/scout-chart-pdf-adapter'
import type { SavedChartsPdfPayload, SavedOutputPdfRecord } from '@/lib/report/saved-charts-export'

const palette = {
  black: '#101010',
  white: '#FFFFFF',
  paper: '#F3F0EA',
  mist: '#DDD7CE',
  text: '#2F2B27',
  muted: '#6D665E',
  gold: '#B18B3D',
  slate: '#6B8690',
  slateLight: '#C6D7DB',
  panel: '#1E1E1E',
  rose: '#8D4B4B',
}

const styles = StyleSheet.create({
  coverPage: {
    backgroundColor: palette.paper,
    flexDirection: 'column',
  },
  coverHero: {
    height: 380,
    backgroundColor: palette.black,
    paddingHorizontal: 42,
    paddingTop: 42,
    paddingBottom: 48,
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  heroTop: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLogo: {
    width: 64,
    height: 64,
  },
  heroEyebrow: {
    fontSize: 9,
    color: palette.gold,
    letterSpacing: 2.4,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 54,
    color: palette.white,
    lineHeight: 0.95,
    letterSpacing: -2,
    fontFamily: 'Helvetica',
  },
  heroSubtitle: {
    marginTop: 16,
    maxWidth: 400,
    fontSize: 11,
    lineHeight: 1.55,
    color: palette.mist,
    fontFamily: 'Helvetica',
  },
  coverBottom: {
    flex: 1,
    paddingHorizontal: 42,
    paddingTop: 30,
    paddingBottom: 38,
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 16,
    height: 16,
    marginRight: 8,
  },
  brandText: {
    fontSize: 10,
    letterSpacing: 2.4,
    color: palette.muted,
    fontFamily: 'Helvetica-Bold',
  },
  coverMeta: {
    fontSize: 8,
    color: palette.muted,
    fontFamily: 'Helvetica',
  },
  coverTitle: {
    fontSize: 48,
    color: palette.black,
    lineHeight: 0.95,
    letterSpacing: -1.8,
    fontFamily: 'Helvetica',
    marginTop: 18,
  },
  coverSubtitle: {
    marginTop: 12,
    maxWidth: 460,
    fontSize: 11,
    lineHeight: 1.55,
    color: palette.text,
    fontFamily: 'Helvetica',
  },
  coverNotes: {
    marginTop: 16,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: palette.gold,
    fontSize: 10,
    lineHeight: 1.5,
    color: palette.muted,
    fontFamily: 'Helvetica',
  },
  coverKicker: {
    fontSize: 9,
    color: palette.gold,
    letterSpacing: 1.8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  statStrip: {
    flexDirection: 'row',
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: palette.mist,
    paddingTop: 18,
  },
  statStripItem: {
    flex: 1,
    paddingRight: 12,
  },
  statStripLabel: {
    fontSize: 7,
    color: palette.muted,
    letterSpacing: 1.1,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  statStripValue: {
    fontSize: 18,
    color: palette.black,
    fontFamily: 'Helvetica-Bold',
    marginTop: 4,
  },
  page: {
    backgroundColor: palette.paper,
    paddingHorizontal: 42,
    paddingTop: 34,
    paddingBottom: 34,
    color: palette.text,
    fontFamily: 'Helvetica',
  },
  darkPage: {
    backgroundColor: palette.black,
    paddingHorizontal: 42,
    paddingTop: 34,
    paddingBottom: 34,
    color: palette.white,
    fontFamily: 'Helvetica',
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  pageHeaderBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pageHeaderText: {
    fontSize: 9,
    letterSpacing: 2.2,
    color: palette.muted,
    fontFamily: 'Helvetica-Bold',
  },
  pageHeaderTextLight: {
    fontSize: 9,
    letterSpacing: 2.2,
    color: palette.slateLight,
    fontFamily: 'Helvetica-Bold',
  },
  pageHeaderMeta: {
    fontSize: 8,
    color: palette.muted,
  },
  pageHeaderMetaLight: {
    fontSize: 8,
    color: '#BEB8AF',
  },
  displayDark: {
    fontSize: 38,
    lineHeight: 0.95,
    letterSpacing: -1.4,
    color: palette.black,
    fontFamily: 'Helvetica',
  },
  displayLight: {
    fontSize: 38,
    lineHeight: 0.95,
    letterSpacing: -1.4,
    color: palette.white,
    fontFamily: 'Helvetica',
  },
  sectionLead: {
    marginTop: 10,
    fontSize: 10,
    lineHeight: 1.55,
    color: palette.text,
    maxWidth: 470,
  },
  sectionLeadLight: {
    marginTop: 10,
    fontSize: 10,
    lineHeight: 1.55,
    color: '#E7E1D9',
    maxWidth: 470,
  },
  sectionLine: {
    height: 2,
    width: 170,
    backgroundColor: palette.gold,
    marginTop: 10,
    marginBottom: 18,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 18,
  },
  col: {
    flex: 1,
  },
  noteCard: {
    backgroundColor: palette.white,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.mist,
  },
  noteCardDark: {
    backgroundColor: palette.panel,
    borderRadius: 6,
    padding: 16,
  },
  cardKicker: {
    fontSize: 8,
    color: palette.gold,
    letterSpacing: 1.2,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 15,
    color: palette.black,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
  },
  cardTitleLight: {
    fontSize: 15,
    color: palette.white,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
  },
  body: {
    fontSize: 9,
    lineHeight: 1.55,
    color: palette.text,
  },
  bodyLight: {
    fontSize: 9,
    lineHeight: 1.55,
    color: '#E7E1D9',
  },
  indexCard: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#D6CEC3',
  },
  indexRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  indexTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: palette.black,
  },
  indexNum: {
    fontSize: 34,
    lineHeight: 1,
    color: palette.black,
    opacity: 0.12,
    fontFamily: 'Helvetica',
  },
  indexMeta: {
    marginTop: 5,
    fontSize: 8,
    color: palette.muted,
    lineHeight: 1.45,
  },
  detailCard: {
    backgroundColor: '#171717',
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
  },
  detailMeta: {
    fontSize: 8,
    color: '#BAB3A9',
    lineHeight: 1.45,
    marginBottom: 10,
  },
  chartWrap: {
    marginTop: 10,
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#F7F4EF',
  },
  statGrid: {
    marginTop: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#2F2F2F',
  },
  statLabel: {
    flex: 1,
    fontSize: 8,
    color: '#CFC8BE',
  },
  statValue: {
    fontSize: 9,
    color: palette.white,
    fontFamily: 'Helvetica-Bold',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    right: 42,
    fontSize: 8,
    color: palette.muted,
  },
  footerLight: {
    position: 'absolute',
    bottom: 20,
    right: 42,
    fontSize: 8,
    color: '#BEB8AF',
  },
})

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function outputTitle(record: SavedOutputPdfRecord): string {
  if (record.kind === 'chart') return record.payload.title
  if (record.kind === 'stat_card') return record.payload.title
  if (record.kind === 'permit_detail') return record.payload.title
  return record.payload.siteLabel
}

function outputKindLabel(record: SavedOutputPdfRecord): string {
  if (record.kind === 'chart') return 'Chart'
  if (record.kind === 'stat_card') return 'Stat card'
  if (record.kind === 'places_context') return 'Nearby context'
  if (record.kind === 'permit_detail') return 'Permit detail'
  return 'Site snapshot'
}

function countKinds(records: SavedOutputPdfRecord[]) {
  return records.reduce(
    (acc, record) => {
      acc.total += 1
      acc[record.kind] += 1
      return acc
    },
    {
      total: 0,
      chart: 0,
      stat_card: 0,
      permit_detail: 0,
      places_context: 0,
      uploaded_pin: 0,
    }
  )
}

function summarizeSelection(records: SavedOutputPdfRecord[]): string {
  const counts = countKinds(records)
  const parts = [
    counts.chart ? `${counts.chart} chart${counts.chart === 1 ? '' : 's'}` : null,
    counts.stat_card ? `${counts.stat_card} snapshot${counts.stat_card === 1 ? '' : 's'}` : null,
    counts.permit_detail ? `${counts.permit_detail} permit detail${counts.permit_detail === 1 ? '' : 's'}` : null,
    counts.places_context ? `${counts.places_context} nearby context card${counts.places_context === 1 ? '' : 's'}` : null,
    counts.uploaded_pin ? `${counts.uploaded_pin} site pin${counts.uploaded_pin === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  if (parts.length === 0) return 'No saved outputs were included.'
  if (parts.length === 1) return `This export includes ${parts[0]}.`
  return `This export includes ${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}.`
}

function buildOverviewNotes(payload: SavedChartsPdfPayload): string[] {
  const lines: string[] = []
  const notes = payload.notes.trim()
  if (notes) lines.push(notes)
  lines.push(summarizeSelection(payload.outputs))
  lines.push('The layout intentionally curates the strongest saved outputs into a short editorial packet suited for review rather than exhaustive archival export.')
  return lines.slice(0, 3)
}

function buildExhibitRecords(payload: SavedChartsPdfPayload): SavedOutputPdfRecord[] {
  const ranked = [...payload.outputs].sort((a, b) => {
    const score = (record: SavedOutputPdfRecord) => {
      switch (record.kind) {
        case 'chart':
          return 5
        case 'stat_card':
          return 4
        case 'permit_detail':
          return 3
        case 'places_context':
          return 2
        case 'uploaded_pin':
          return 1
      }
    }
    return score(b) - score(a)
  })
  return ranked.slice(0, 3)
}

function renderChart(record: Extract<SavedOutputPdfRecord, { kind: 'chart' }>) {
  if (record.payload.kind === 'line') {
    return (
      <SparklinePdf
        data={buildPdfSeriesFromScoutChart(record.payload)}
        width={455}
        height={120}
        color={record.payload.series[0]?.color ?? palette.gold}
      />
    )
  }

  return (
    <BarChartPdf
      bars={buildPdfBarRowsFromScoutChart(record.payload)}
      width={455}
      height={140}
      color={record.payload.series[0]?.color ?? palette.gold}
      caption={record.payload.yAxis.label}
    />
  )
}

function renderRecordBody(record: SavedOutputPdfRecord) {
  if (record.kind === 'chart') {
    return (
      <View style={styles.chartWrap}>
        {renderChart(record)}
      </View>
    )
  }

  if (record.kind === 'stat_card') {
    return (
      <>
        {record.payload.summary ? <Text style={styles.bodyLight}>{record.payload.summary}</Text> : null}
        <View style={styles.statGrid}>
          {record.payload.stats.slice(0, 5).map((stat) => (
            <View key={stat.label} style={styles.statRow}>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
            </View>
          ))}
        </View>
      </>
    )
  }

  if (record.kind === 'permit_detail') {
    return (
      <>
        <Text style={styles.bodyLight}>{record.payload.addressOrPlace}</Text>
        <Text style={styles.detailMeta}>
          {record.payload.categoryLabel} | {record.payload.sourceName}
          {record.payload.dateLabel ? ` | ${record.payload.dateLabel}` : ''}
        </Text>
        <View style={styles.statGrid}>
          {record.payload.stats.slice(0, 5).map((stat) => (
            <View key={`${stat.label}:${stat.value}`} style={styles.statRow}>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
            </View>
          ))}
        </View>
      </>
    )
  }

  if (record.kind === 'places_context') {
    return (
      <>
        <Text style={styles.bodyLight}>{record.payload.summary}</Text>
        <View style={styles.statGrid}>
          {record.payload.countsByCategory.slice(0, 5).map((entry) => (
            <View key={entry.category} style={styles.statRow}>
              <Text style={styles.statLabel}>{entry.label}</Text>
              <Text style={styles.statValue}>{String(entry.count)}</Text>
            </View>
          ))}
        </View>
      </>
    )
  }

  return (
    <>
      <Text style={styles.bodyLight}>
        {record.payload.lat.toFixed(5)}, {record.payload.lng.toFixed(5)}
      </Text>
      <View style={styles.statGrid}>
        {Object.entries(record.payload.rowPreview).slice(0, 5).map(([label, value]) => (
          <View key={label} style={styles.statRow}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{String(value)}</Text>
          </View>
        ))}
      </View>
    </>
  )
}

function CoverPage({
  payload,
  logoDataUri,
}: {
  payload: SavedChartsPdfPayload
  logoDataUri: string | null
}) {
  const counts = countKinds(payload.outputs)
  return (
    <Page size="A4" style={styles.coverPage}>
      <View style={styles.coverHero}>
        <View style={styles.heroTop}>
          {logoDataUri ? <Image src={logoDataUri} style={styles.heroLogo} /> : <View />}
          <Text style={[styles.coverMeta, { color: palette.muted }]}>{formatTimestamp(payload.generatedAt)}</Text>
        </View>
        <View>
          <Text style={styles.heroEyebrow}>Projectr Scout Analytics</Text>
          <Text style={styles.heroTitle}>EXPORT{"\n"}REPORT</Text>
          <Text style={styles.heroSubtitle}>{payload.title}</Text>
        </View>
      </View>
      <View style={styles.coverBottom}>
        <View>
          <View style={styles.brandRow}>
            <View style={styles.brandWrap}>
              <Text style={styles.brandText}>REPORT OVERVIEW</Text>
            </View>
          </View>
          <Text style={styles.coverSubtitle}>
            This comprehensive market packet highlights localized real estate metrics, context cards, and contextual insights curated for fast executive review. It contains the key saved outputs and data discoveries from your current Scout session.
          </Text>
          {payload.notes ? (
            <View style={styles.coverNotes}>
              <Text>{payload.notes}</Text>
            </View>
          ) : null}
        </View>

        <View>
          <Text style={styles.coverKicker}>Executive Summary & Output Details</Text>
          <View style={styles.statStrip}>
            <View style={styles.statStripItem}>
              <Text style={styles.statStripLabel}>Total</Text>
              <Text style={styles.statStripValue}>{String(counts.total)}</Text>
            </View>
            <View style={styles.statStripItem}>
              <Text style={styles.statStripLabel}>Charts</Text>
              <Text style={styles.statStripValue}>{String(counts.chart)}</Text>
            </View>
            <View style={styles.statStripItem}>
              <Text style={styles.statStripLabel}>Snapshots</Text>
              <Text style={styles.statStripValue}>{String(counts.stat_card + counts.places_context + counts.uploaded_pin)}</Text>
            </View>
            <View style={styles.statStripItem}>
              <Text style={styles.statStripLabel}>Permits</Text>
              <Text style={styles.statStripValue}>{String(counts.permit_detail)}</Text>
            </View>
          </View>
        </View>
      </View>
    </Page>
  )
}

function SummaryPage({ payload, logoDataUri }: { payload: SavedChartsPdfPayload; logoDataUri: string | null }) {
  const overviewNotes = buildOverviewNotes(payload)
  const records = payload.outputs.slice(0, 6)
  const omitted = Math.max(payload.outputs.length - records.length, 0)

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderBrand}>
          {logoDataUri ? <Image src={logoDataUri} style={styles.logo} /> : null}
          <Text style={styles.pageHeaderText}>SCOUT EXPORT</Text>
        </View>
        <Text style={styles.pageHeaderMeta}>Page 2</Text>
      </View>

      <Text style={styles.displayDark}>CONTENTS</Text>
      <Text style={styles.sectionLead}>
        This spread frames the packet before the final exhibit page: reader notes, output index, and a quick description of what was selected for presentation.
      </Text>
      <View style={styles.sectionLine} />

      <View style={styles.twoCol}>
        <View style={styles.col}>
          <View style={styles.noteCard}>
            <Text style={styles.cardKicker}>Reader notes</Text>
            <Text style={styles.cardTitle}>{payload.title}</Text>
            {overviewNotes.map((line, index) => (
              <Text key={index} style={[styles.body, { marginBottom: index === overviewNotes.length - 1 ? 0 : 8 }]}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.col}>
          {records.map((record, index) => (
            <View key={record.id} style={styles.indexCard}>
              <View style={styles.indexRow}>
                <Text style={styles.indexTitle}>{outputTitle(record)}</Text>
                <Text style={styles.indexNum}>{index + 1}</Text>
              </View>
              <Text style={styles.indexMeta}>Type: {outputKindLabel(record)}</Text>
              {'prompt' in record && record.prompt ? <Text style={styles.indexMeta}>Prompt: {record.prompt}</Text> : null}
              {record.marketLabel ? <Text style={styles.indexMeta}>Market: {record.marketLabel}</Text> : null}
            </View>
          ))}
          {omitted > 0 ? (
            <Text style={styles.indexMeta}>+ {omitted} additional saved output{omitted === 1 ? '' : 's'} omitted from this short-form export.</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.footer}>Curated for concise review rather than full-session archival export.</Text>
    </Page>
  )
}

function ExhibitsPage({
  payload,
  logoDataUri,
}: {
  payload: SavedChartsPdfPayload
  logoDataUri: string | null
}) {
  const exhibits = buildExhibitRecords(payload)
  return (
    <Page size="A4" style={styles.darkPage}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderBrand}>
          {logoDataUri ? <Image src={logoDataUri} style={styles.logo} /> : null}
          <Text style={styles.pageHeaderTextLight}>SCOUT EXHIBITS</Text>
        </View>
        <Text style={styles.pageHeaderMetaLight}>Page 3</Text>
      </View>

      <Text style={styles.displayLight}>SELECTED{"\n"}EXHIBITS</Text>
      <Text style={styles.sectionLeadLight}>
        The page below elevates the strongest saved outputs into a judge-facing narrative spread. It preserves provenance while emphasizing the clearest visual or analytical takeaways.
      </Text>
      <View style={styles.sectionLine} />

      {exhibits.map((record) => (
        <View key={record.id} style={styles.detailCard}>
          <Text style={styles.cardKicker}>{outputKindLabel(record)}</Text>
          <Text style={styles.cardTitleLight}>{outputTitle(record)}</Text>
          <Text style={styles.detailMeta}>
            {'prompt' in record && record.prompt ? `Prompt: ${record.prompt}` : 'Saved sidebar artifact'}
            {record.marketLabel ? ` | Market: ${record.marketLabel}` : ''}
            {` | Saved: ${formatTimestamp(record.savedAt)}`}
          </Text>
          {renderRecordBody(record)}
        </View>
      ))}

      <Text style={styles.footerLight}>This packet is intentionally capped to a short executive review format.</Text>
    </Page>
  )
}

export function SavedChartsPdfDocument({
  payload,
  logoDataUri,
}: {
  payload: SavedChartsPdfPayload
  logoDataUri: string | null
}) {
  return (
    <Document title={payload.title}>
      <CoverPage payload={payload} logoDataUri={logoDataUri} />
      <SummaryPage payload={payload} logoDataUri={logoDataUri} />
      <ExhibitsPage payload={payload} logoDataUri={logoDataUri} />
    </Document>
  )
}
