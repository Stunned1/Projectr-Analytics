import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFallbackChartedResponseForTest, buildRentTrendChartForTest, buildRouterBackedChartForTest, buildHistoryChartedResponseForTest } from '@/app/api/agent/route'
import type { MapContext } from '@/lib/agent-types'
import type { AnalyticalComparisonRequest, AnalyticalComparisonResult } from '@/lib/data/market-data-router'

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

test('returns a grounded rent history chart for an active zip prompt', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest(
    'show me rent history',
    {
      label: '78701',
      zip: '78701',
      eda: {
        focus: 'market',
        market: null,
        uploadedDatasets: [],
        uploadedDatasetCount: 0,
        geographyLabel: '78701',
        activeMetric: 'rent',
        activeLayerKeys: [],
        notes: [],
      },
      activeMetric: 'rent',
    } as MapContext,
    {
      getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
        calls.push(request)
        return {
          comparisonMode: 'history',
          metric: 'rent',
          metricLabel: 'Rent',
          timeWindow: { mode: 'relative', startDate: '2024-04-01', label: 'Last 24 months', monthsBack: 24 },
          series: [
            {
              key: 'zip:78701:rent',
              label: '78701',
              subject: { kind: 'zip', id: '78701', label: '78701' },
              points: [
                { x: '2024-04', y: 2100 },
                { x: '2025-04', y: 2250 },
              ],
            },
          ],
          citations: [
            {
              id: 'rent:zip:78701',
              label: 'Zillow Research',
              sourceType: 'public_dataset',
              periodLabel: '2024-04 to 2025-04',
            },
          ],
        }
      },
    }
  )

  assert.equal(calls[0]?.metric, 'rent')
  assert.equal(calls[0]?.timeWindow.mode, 'relative')
  assert.equal(calls[0]?.timeWindow.unit, 'months')
  assert.equal(calls[0]?.timeWindow.value, 24)
  assert.equal(response.chart?.kind, 'line')
  assert.equal(response.chart?.placeholder, false)
  assert.ok((response.trace.citations?.length ?? 0) > 0)
})

test('returns a grounded permit history chart for an explicit Texas county prompt', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('show me permit history for Harris County, TX', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2021-04-01', label: 'Last 5 years', monthsBack: 60 },
        series: [
          {
            key: 'county:TX:harris-county:permit_units',
            label: 'Harris County, TX',
            subject: { kind: 'county', id: 'county:TX:harris-county', label: 'Harris County, TX' },
            points: [
              { x: '2021-04-01', y: 1024 },
              { x: '2025-04-01', y: 1180 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:county:TX:harris-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
      }
    },
  })

  assert.equal(calls[0]?.metric, 'permit_units')
  assert.equal(calls[0]?.subjectMarket.kind, 'county')
  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:harris-county')
  assert.match(calls[0]?.subjectMarket.label ?? '', /Harris County, TX/i)
  assert.equal(response.chart?.kind, 'bar')
  assert.match(response.message, /Harris County/i)
})

test('ignores trailing non-state words after a Texas county subject', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('show me permit history for Harris County over time', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2021-04-01', label: 'Last 5 years', monthsBack: 60 },
        series: [
          {
            key: 'county:TX:harris-county:permit_units',
            label: 'Harris County, TX',
            subject: { kind: 'county', id: 'county:TX:harris-county', label: 'Harris County, TX' },
            points: [
              { x: '2021-04-01', y: 1024 },
              { x: '2025-04-01', y: 1180 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:county:TX:harris-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
      }
    },
  })

  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:harris-county')
  assert.equal(calls[0]?.subjectMarket.label, 'Harris County, TX')
  assert.equal(response.chart?.kind, 'bar')
})

test('resolves a Texas county history prompt written with "in Texas"', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('show me permit history for Harris County in Texas', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2021-04-01', label: 'Last 5 years', monthsBack: 60 },
        series: [
          {
            key: 'county:TX:harris-county:permit_units',
            label: 'Harris County, TX',
            subject: { kind: 'county', id: 'county:TX:harris-county', label: 'Harris County, TX' },
            points: [
              { x: '2021-04-01', y: 1024 },
              { x: '2025-04-01', y: 1180 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:county:TX:harris-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
      }
    },
  })

  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:harris-county')
  assert.equal(calls[0]?.subjectMarket.label, 'Harris County, TX')
  assert.equal(response.chart?.kind, 'bar')
})

test('returns a grounded permit history chart for an explicit Texas metro prompt', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('show me permit history for Austin metro area, TX', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2021-04-01', label: 'Last 5 years', monthsBack: 60 },
        series: [
          {
            key: 'metro:TX:austin:permit_units',
            label: 'Austin, TX',
            subject: { kind: 'metro', id: 'metro:TX:austin', label: 'Austin, TX' },
            points: [
              { x: '2021-04-01', y: 1024 },
              { x: '2025-04-01', y: 1188 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:metro:TX:austin',
            label: 'Census BPS / Projectr master data',
            sourceType: 'public_dataset',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
      }
    },
  })

  assert.equal(calls[0]?.metric, 'permit_units')
  assert.equal(calls[0]?.subjectMarket.kind, 'metro')
  assert.equal(calls[0]?.subjectMarket.id, 'metro:TX:austin')
  assert.match(calls[0]?.subjectMarket.label ?? '', /Austin, TX/i)
  assert.equal(response.chart?.kind, 'bar')
  assert.match(response.message, /Austin/i)
})

test('rejects a space-delimited non-Texas county history prompt', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('show me permit history for Cook County Illinois', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|not supported yet/i)
})

test('rejects a space-delimited non-Texas metro history prompt', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('show me permit history for Miami metro area Florida', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|not supported yet/i)
})

test('returns no history chart for unsupported history metrics', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('show me income history for Austin', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /not supported yet/i)
})

test('does not rewrite a non-Texas county history prompt into a Texas chart', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('show me permit history for Cook County, IL', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|not supported yet/i)
})

test('does not rewrite a non-Texas metro history prompt into a Texas chart', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('show me rent history for Miami metro area, FL', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|not supported yet/i)
})
