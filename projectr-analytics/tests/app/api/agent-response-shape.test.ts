import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFallbackChartedResponseForTest } from '@/app/api/agent/route'
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
