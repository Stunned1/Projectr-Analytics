import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSavedChartsPdfPayload } from '@/lib/report/saved-charts-export'

test('normalizes chart and non-chart saved outputs for pdf export', () => {
  const payload = normalizeSavedChartsPdfPayload({
    title: 'Scout saved outputs',
    outputs: [
      {
        id: 'chart-1',
        kind: 'chart',
        savedAt: '2026-04-20T12:00:00.000Z',
        prompt: 'compare retail for Austin vs. Houston',
        payload: {
          kind: 'bar',
          title: 'Austin vs Houston core retail context',
          xAxis: { key: 'category', label: 'Category' },
          yAxis: { label: 'Count' },
          series: [{ key: 'austin', label: 'Austin', points: [{ x: 'Food', y: 12 }] }],
          citations: [],
        },
      },
      {
        id: 'places-1',
        kind: 'places_context',
        savedAt: '2026-04-20T12:01:00.000Z',
        payload: {
          siteLabel: 'South Lamar candidate',
          lat: 30.25,
          lng: -97.76,
          radiusMeters: 500,
          summary: 'Within 500m: 3 coffee shops and 8 restaurants.',
          countsByCategory: [{ category: 'coffee_cafe', label: 'Coffee', count: 3 }],
          topPlaces: [{ name: 'Cosmic', categoryLabel: 'Coffee' }],
        },
      },
    ],
  })

  assert.ok(payload)
  assert.equal(payload?.outputs.length, 2)
  assert.equal(payload?.outputs[0]?.kind, 'chart')
  assert.equal(payload?.outputs[1]?.kind, 'places_context')
})

test('normalizes permit detail outputs for pdf export', () => {
  const payload = normalizeSavedChartsPdfPayload({
    title: 'Scout saved outputs',
    outputs: [
      {
        id: 'permit-1',
        kind: 'permit_detail',
        savedAt: '2026-04-20T12:00:00.000Z',
        marketLabel: 'Austin, TX',
        payload: {
          title: 'South Lamar candidate permit',
          permitLabel: 'New Construction',
          sourceKind: 'texas_raw',
          sourceName: 'City of Austin Open Data',
          addressOrPlace: '111 Example St',
          categoryLabel: 'New construction',
          stats: [{ label: 'Units', value: '220' }],
        },
      },
    ],
  })

  assert.equal(payload?.outputs[0]?.kind, 'permit_detail')
})
