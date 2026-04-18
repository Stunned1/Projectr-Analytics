import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFallbackChartedResponseForTest,
  buildRentTrendChartForTest,
  buildRouterBackedChartForTest,
} from '@/app/api/agent/route'
import type { MapContext } from '@/lib/agent-types'

test('returns a chart payload for a supported analytical prompt', () => {
  const context: MapContext = {
    label: 'Austin, TX',
    eda: {
      focus: 'market',
      market: null,
      uploadedDatasets: [],
      uploadedDatasetCount: 0,
      geographyLabel: 'Austin, TX',
      activeMetric: 'zori',
      activeLayerKeys: [],
      notes: [],
    },
  }

  const out = buildFallbackChartedResponseForTest('show the rent trend', context)

  assert.equal(out.chart?.kind, 'line')
  assert.equal(out.chart?.placeholder, true)
  assert.ok((out.trace.citations?.length ?? 0) > 0)
})

test('keeps chart output optional for unsupported prompts', () => {
  const out = buildFallbackChartedResponseForTest('summarize the dataset', null)

  assert.equal(out.chart ?? null, null)
})

test('builds a router-backed unemployment trend chart for an active zip', async () => {
  const chart = await buildRouterBackedChartForTest(
    'show unemployment trend',
    { zip: '77002', label: 'Houston, TX' },
    async () => [
      {
        submarket_id: '77002',
        metric_name: 'Unemployment_Rate',
        metric_value: 4.8,
        time_period: '2025-01-01',
        data_source: 'FRED',
        visual_bucket: 'TIME_SERIES',
        created_at: '2026-04-18T00:00:00.000Z',
      },
      {
        submarket_id: '77002',
        metric_name: 'Unemployment_Rate',
        metric_value: 4.2,
        time_period: '2026-01-01',
        data_source: 'FRED',
        visual_bucket: 'TIME_SERIES',
        created_at: '2026-04-18T00:00:00.000Z',
      },
    ]
  )

  assert.equal(chart?.kind, 'line')
  assert.equal(chart?.placeholder, false)
  assert.equal(chart?.title.includes('unemployment'), true)
  assert.equal(chart?.citations[0]?.sourceType, 'internal_dataset')
  assert.equal(chart?.series[0]?.points.length, 2)
})

test('builds a Zillow monthly rent trend chart for an active zip', async () => {
  const chart = await buildRentTrendChartForTest(
    'show rent trend',
    { zip: '77002', label: 'Houston, TX' },
    async () => [
      { date: '2025-11', value: 1820 },
      { date: '2025-12', value: 1832 },
      { date: '2026-01', value: 1841 },
    ]
  )

  assert.equal(chart?.kind, 'line')
  assert.equal(chart?.placeholder, false)
  assert.equal(chart?.title.includes('rent trend'), true)
  assert.equal(chart?.citations[0]?.label, 'Zillow Research')
  assert.equal(chart?.series[0]?.points.length, 3)
})
