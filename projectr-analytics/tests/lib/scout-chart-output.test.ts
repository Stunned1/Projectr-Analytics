import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isScoutChartOutput,
  normalizeScoutChartOutput,
} from '@/lib/scout-chart-output'

test('normalizes a valid line chart payload with citations', () => {
  const normalized = normalizeScoutChartOutput({
    kind: 'line',
    title: 'ZORI trend',
    xAxis: { key: 'date', label: 'Month' },
    yAxis: { label: 'Rent index' },
    series: [{ key: 'zori', label: 'ZORI', points: [{ x: '2026-01', y: 100 }] }],
    citations: [{ id: 'zillow-zori', label: 'Zillow Research', sourceType: 'internal_dataset' }],
  })

  assert.equal(normalized.kind, 'line')
  assert.equal(normalized.subtitle, null)
  assert.equal(normalized.citations.length, 1)
  assert.equal(normalized.citations[0]?.periodLabel, null)
})

test('marks placeholder charts and citations explicitly', () => {
  const chart = normalizeScoutChartOutput({
    kind: 'bar',
    title: 'Placeholder comparison',
    placeholder: true,
    xAxis: { key: 'label', label: 'Market' },
    yAxis: { label: 'Value' },
    series: [{ key: 'series', label: 'Series', points: [{ x: 'Austin', y: 1 }] }],
    citations: [{ id: 'placeholder', label: 'Placeholder', sourceType: 'placeholder', placeholder: true }],
  })

  assert.equal(chart.placeholder, true)
  assert.equal(chart.citations[0]?.placeholder, true)
})

test('rejects incomplete chart payloads', () => {
  assert.equal(isScoutChartOutput({ title: 'Missing kind' }), false)
})
