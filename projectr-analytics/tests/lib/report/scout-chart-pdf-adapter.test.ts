import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPermitUnitsChart,
  buildPdfBarRowsFromScoutChart,
  buildPdfSeriesFromScoutChart,
  buildSearchTrendsChart,
  buildZoriTrendChart,
} from '@/lib/report/scout-chart-pdf-adapter'

test('builds a shared chart contract for ZORI report series', () => {
  const chart = buildZoriTrendChart(
    [
      { date: '2025-11', value: 1820 },
      { date: '2025-12', value: 1832 },
    ],
    'Houston, TX',
    'zillow_monthly'
  )

  assert.equal(chart.kind, 'line')
  assert.equal(chart.title, 'Houston, TX rent trend')
  assert.equal(chart.citations[0]?.label, 'Zillow Research')
})

test('converts a scout line chart into pdf series rows', () => {
  const chart = buildSearchTrendsChart(
    [
      { date: '2026-01', value: 42 },
      { date: '2026-02', value: 55 },
    ],
    'Houston apartments'
  )

  const rows = buildPdfSeriesFromScoutChart(chart)
  assert.deepStrictEqual(rows, [
    { date: '2026-01', value: 42 },
    { date: '2026-02', value: 55 },
  ])
})

test('converts a scout bar chart into pdf bar rows', () => {
  const chart = buildPermitUnitsChart([
    { year: '2024', units: 120 },
    { year: '2025', units: 140 },
  ])

  const rows = buildPdfBarRowsFromScoutChart(chart)
  assert.deepStrictEqual(rows, [
    { label: '2024', value: 120 },
    { label: '2025', value: 140 },
  ])
})
