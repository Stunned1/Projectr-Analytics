import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeSavedChartsPdfPayload } from '@/lib/report/saved-charts-export'

const baseChart = {
  kind: 'line' as const,
  title: 'Rent trend',
  xAxis: { key: 'month', label: 'Month' },
  yAxis: { label: 'Rent index', valueFormat: 'index' as const },
  series: [{ key: 'zori', label: 'ZORI', points: [{ x: '2026-01', y: 100 }] }],
  citations: [{ id: 'citation-1', label: 'Zillow', sourceType: 'internal_dataset' as const, note: 'Monthly snapshot' }],
}

test('normalizes a valid saved-chart PDF payload', () => {
  const payload = normalizeSavedChartsPdfPayload({
    title: ' Austin chart report ',
    notes: ' Reader summary ',
    generatedAt: '2026-04-20T12:00:00.000Z',
    charts: [
      {
        id: 'chart-1',
        prompt: 'Show rent trend',
        marketLabel: 'Austin, TX',
        savedAt: '2026-04-20T11:00:00.000Z',
        chart: baseChart,
      },
    ],
  })

  assert.ok(payload)
  assert.equal(payload?.title, 'Austin chart report')
  assert.equal(payload?.notes, 'Reader summary')
  assert.equal(payload?.charts.length, 1)
  assert.equal(payload?.charts[0]?.marketLabel, 'Austin, TX')
  assert.equal(payload?.charts[0]?.chart.yAxis.valueFormat, 'index')
})

test('rejects payloads with too many charts', () => {
  const charts = Array.from({ length: 13 }, (_, index) => ({
    id: `chart-${index + 1}`,
    prompt: 'Show rent trend',
    marketLabel: 'Austin, TX',
    savedAt: '2026-04-20T11:00:00.000Z',
    chart: baseChart,
  }))

  const payload = normalizeSavedChartsPdfPayload({
    title: 'Austin chart report',
    notes: '',
    generatedAt: '2026-04-20T12:00:00.000Z',
    charts,
  })

  assert.equal(payload, null)
})

test('rejects payloads with malformed chart records', () => {
  const payload = normalizeSavedChartsPdfPayload({
    title: 'Austin chart report',
    notes: '',
    generatedAt: '2026-04-20T12:00:00.000Z',
    charts: [
      {
        id: 'chart-1',
        prompt: 'Show rent trend',
        savedAt: '2026-04-20T11:00:00.000Z',
        chart: { ...baseChart, citations: 'bad-shape' },
      },
    ],
  })

  assert.equal(payload, null)
})
