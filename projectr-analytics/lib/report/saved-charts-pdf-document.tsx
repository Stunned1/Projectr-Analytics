import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { BarChartPdf, SparklinePdf } from '@/lib/report/pdf-charts'
import { buildPdfBarRowsFromScoutChart, buildPdfSeriesFromScoutChart } from '@/lib/report/scout-chart-pdf-adapter'
import type { SavedChartPdfRecord, SavedChartsPdfPayload } from '@/lib/report/saved-charts-export'

const accent = '#D76B3D'
const ink = '#18181B'
const muted = '#52525B'
const soft = '#F4F4F5'
const border = '#E4E4E7'

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: ink,
    backgroundColor: '#FFFFFF',
  },
  headerBand: {
    backgroundColor: '#0A0A0A',
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginHorizontal: -40,
    marginTop: -36,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 18,
    height: 18,
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 'bold',
  },
  meta: {
    color: '#A1A1AA',
    fontSize: 8,
    textAlign: 'right',
  },
  kicker: {
    color: accent,
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    lineHeight: 1.2,
  },
  intro: {
    fontSize: 10,
    lineHeight: 1.45,
    color: '#27272A',
    marginBottom: 14,
  },
  noteBox: {
    borderWidth: 1,
    borderColor: '#F3D0BF',
    backgroundColor: '#FFFAF7',
    borderRadius: 6,
    padding: 12,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 8,
    color: ink,
  },
  noteTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: accent,
    marginBottom: 6,
  },
  noteText: {
    fontSize: 9,
    lineHeight: 1.5,
    color: '#3F3F46',
  },
  chartListItem: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    backgroundColor: soft,
  },
  chartListTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: ink,
    marginBottom: 3,
  },
  chartListMeta: {
    fontSize: 8,
    color: muted,
    lineHeight: 1.4,
  },
  chartPageTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
    lineHeight: 1.2,
  },
  chartPageSubhead: {
    fontSize: 9,
    color: muted,
    marginBottom: 8,
  },
  chartSummary: {
    fontSize: 9,
    lineHeight: 1.5,
    color: '#27272A',
    marginBottom: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    padding: 8,
    backgroundColor: '#FFFFFF',
  },
  metricLabel: {
    fontSize: 7,
    color: muted,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  metricValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: ink,
  },
  chartWrap: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    padding: 12,
    marginBottom: 14,
  },
  sourceBox: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: soft,
  },
  sourceTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: accent,
    marginBottom: 6,
  },
  sourceLine: {
    fontSize: 8,
    color: '#3F3F46',
    lineHeight: 1.45,
    marginBottom: 4,
  },
  footer: {
    marginTop: 14,
    fontSize: 7,
    color: muted,
    lineHeight: 1.4,
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

function formatChartValue(value: number, format: SavedChartPdfRecord['chart']['yAxis']['valueFormat']): string {
  if (!Number.isFinite(value)) return 'N/A'
  const sign = value < 0 ? '-' : ''
  const absValue = Math.abs(value)
  switch (format) {
    case 'currency':
      return `${sign}$${Math.round(absValue).toLocaleString('en-US')}`
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'index':
      return value.toFixed(1)
    case 'number':
    default:
      return absValue >= 1000 ? `${sign}${Math.round(absValue).toLocaleString('en-US')}` : value.toFixed(1)
  }
}

function chartNarrative(record: SavedChartPdfRecord): string {
  const summary = record.chart.summary?.trim()
  if (summary) return summary
  const seriesLabel = record.chart.series[0]?.label?.trim() || record.chart.yAxis.label
  if (record.chart.kind === 'line') {
    return `This chart shows how ${seriesLabel.toLowerCase()} changed over the recorded periods. Use it to spot direction, volatility, and whether the latest reading looks stronger or softer than earlier periods.`
  }
  return `This chart compares ${seriesLabel.toLowerCase()} across the listed categories. Use it to see which segments stand out and how concentrated the overall distribution is.`
}

function chartMetrics(record: SavedChartPdfRecord): Array<{ label: string; value: string }> {
  const format = record.chart.yAxis.valueFormat
  const points = record.chart.series.flatMap((series) => series.points)
  if (points.length === 0) {
    return [
      { label: 'Data points', value: '0' },
      { label: 'Series', value: String(record.chart.series.length) },
      { label: 'Coverage', value: 'No rows' },
    ]
  }

  const values = points.map((point) => point.y)
  const latest = points[points.length - 1]?.y ?? values[values.length - 1]
  const max = Math.max(...values)
  const min = Math.min(...values)

  if (record.chart.kind === 'line') {
    const start = points[0]?.y ?? latest
    const delta = latest - start
    return [
      { label: 'Latest', value: formatChartValue(latest, format) },
      { label: 'Change', value: `${delta >= 0 ? '+' : ''}${formatChartValue(delta, format)}` },
      { label: 'Range', value: `${formatChartValue(min, format)} to ${formatChartValue(max, format)}` },
    ]
  }

  const total = values.reduce((sum, value) => sum + value, 0)
  return [
    { label: 'Highest bar', value: formatChartValue(max, format) },
    { label: 'Total', value: formatChartValue(total, format) },
    { label: 'Categories', value: String(points.length) },
  ]
}

function renderChart(record: SavedChartPdfRecord) {
  if (record.chart.kind === 'line') {
    return (
      <SparklinePdf
        data={buildPdfSeriesFromScoutChart(record.chart)}
        width={470}
        height={180}
        color={record.chart.series[0]?.color ?? accent}
      />
    )
  }

  return (
    <BarChartPdf
      bars={buildPdfBarRowsFromScoutChart(record.chart)}
      width={470}
      height={200}
      color={record.chart.series[0]?.color ?? accent}
      caption={record.chart.yAxis.label}
    />
  )
}

export function SavedChartsPdfDocument({
  payload,
  logoDataUri,
}: {
  payload: SavedChartsPdfPayload
  logoDataUri: string | null
}) {
  const generatedAt = formatTimestamp(payload.generatedAt)
  const notes = payload.notes.trim()

  return (
    <Document title={payload.title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View style={styles.brandWrap}>
            {/* react-pdf Image is not a DOM img element. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logoDataUri ? <Image src={logoDataUri} style={styles.logo} /> : null}
            <Text style={styles.brand}>SCOUT</Text>
          </View>
          <Text style={styles.meta}>{generatedAt}</Text>
        </View>

        <Text style={styles.kicker}>Saved Chart Export</Text>
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.intro}>
          This PDF groups the saved charts you selected in Scout into a plain-language export that is easier to scan, share,
          and review outside the product.
        </Text>

        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>Notes for readers</Text>
          <Text style={styles.noteText}>
            {notes || 'No custom notes were added for this export. The pages that follow keep the chart title, saved prompt, and source notes so the reader can understand what each view is showing.'}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Included charts</Text>
        {payload.charts.map((record, index) => (
          <View key={record.id} style={styles.chartListItem}>
            <Text style={styles.chartListTitle}>
              {index + 1}. {record.chart.title}
            </Text>
            <Text style={styles.chartListMeta}>Prompt: {record.prompt}</Text>
            {record.marketLabel ? <Text style={styles.chartListMeta}>Market: {record.marketLabel}</Text> : null}
            <Text style={styles.chartListMeta}>Saved: {formatTimestamp(record.savedAt)}</Text>
          </View>
        ))}

        <Text style={styles.footer}>
          Charts are exported from the saved-chart workspace in this browser session. Values and source notes come from the
          chart contract that Scout stores when each chart is generated.
        </Text>
      </Page>

      {payload.charts.map((record, index) => (
        <Page key={record.id} size="A4" style={styles.page}>
          <View style={styles.headerBand}>
            <View style={styles.brandWrap}>
              {/* react-pdf Image is not a DOM img element. */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              {logoDataUri ? <Image src={logoDataUri} style={styles.logo} /> : null}
              <Text style={styles.brand}>SCOUT</Text>
            </View>
            <Text style={styles.meta}>
              Chart {index + 1} of {payload.charts.length}
            </Text>
          </View>

          <Text style={styles.kicker}>Chart detail</Text>
          <Text style={styles.chartPageTitle}>{record.chart.title}</Text>
          <Text style={styles.chartPageSubhead}>
            Prompt: {record.prompt}
            {record.marketLabel ? `  |  Market: ${record.marketLabel}` : ''}
          </Text>
          <Text style={styles.chartSummary}>{chartNarrative(record)}</Text>

          <View style={styles.metricsRow}>
            {chartMetrics(record).map((metric) => (
              <View key={metric.label} style={styles.metricCard}>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                <Text style={styles.metricValue}>{metric.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.chartWrap}>{renderChart(record)}</View>

          <View style={styles.sourceBox}>
            <Text style={styles.sourceTitle}>How to read this chart</Text>
            <Text style={styles.sourceLine}>Type: {record.chart.kind === 'line' ? 'Trend over time' : 'Category comparison'}</Text>
            <Text style={styles.sourceLine}>Y-axis: {record.chart.yAxis.label}</Text>
            <Text style={styles.sourceLine}>
              Confidence: {record.chart.confidenceLabel?.trim() || 'Not explicitly labeled'}
            </Text>
            {record.chart.citations.map((citation) => (
              <Text key={citation.id} style={styles.sourceLine}>
                Source: {citation.label}
                {citation.note ? ` - ${citation.note}` : ''}
              </Text>
            ))}
          </View>

          <Text style={styles.footer}>
            Saved in Scout on {formatTimestamp(record.savedAt)}. If this chart is a placeholder or derived series, the source
            note above should be treated as the controlling explanation.
          </Text>
        </Page>
      ))}
    </Document>
  )
}
