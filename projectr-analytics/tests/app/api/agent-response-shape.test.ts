import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFallbackChartedResponseForTest, buildRentTrendChartForTest, buildRouterBackedChartForTest, buildHistoryChartedResponseForTest } from '@/app/api/agent/route'
import type { MapContext } from '@/lib/agent-types'
import type { AgentDriveTimeQuery } from '@/lib/agent-types'
import type { AgentInternalProvenanceQuery } from '@/lib/agent-types'
import type { AgentPublicMacroEvidenceResult, AgentPublicMacroQuery } from '@/lib/agent-types'
import type { AgentPlaceGroundingQuery } from '@/lib/agent-types'
import type { AnalyticalComparisonRequest, AnalyticalComparisonResult } from '@/lib/data/market-data-router'

function createActiveZipContext(zip: string, label = zip): MapContext {
  return {
    label,
    zip,
    eda: {
      focus: 'market',
      market: null,
      uploadedDatasets: [],
      uploadedDatasetCount: 0,
      geographyLabel: label,
      activeMetric: 'rent',
      activeLayerKeys: [],
      notes: [],
    },
    activeMetric: 'rent',
  } as MapContext
}

function createActiveSubjectContext(subject: { kind: 'county' | 'metro'; id: string; label: string }): MapContext {
  return {
    label: subject.label,
    activeSubject: subject,
    eda: {
      focus: 'market',
      market: null,
      uploadedDatasets: [],
      uploadedDatasetCount: 0,
      geographyLabel: subject.label,
      activeMetric: 'permits',
      activeLayerKeys: [],
      notes: [],
    },
    activeMetric: 'permits',
  } as MapContext
}

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

// Route-level downgrade should eventually live in one shared response-finalization path
// inside app/api/agent/route.ts, after history/comparison chart assembly has attached citations.
test('downgrades charted history responses when citations are missing', async () => {
  let provenanceCalled = false
  const response = await buildHistoryChartedResponseForTest('show me rent history for 78701', null, {
    getAnalyticalComparison: async () =>
      ({
        comparisonMode: 'history',
        metric: 'rent',
        metricLabel: 'Rent',
        timeWindow: { mode: 'relative', startDate: '2025-04-01', label: 'Last 12 months', monthsBack: 12 },
        series: [
          {
            key: 'zip:78701:rent',
            label: '78701',
            subject: { kind: 'zip', id: '78701', label: '78701' },
            points: [
              { x: '2025-04', y: 2100 },
              { x: '2026-04', y: 2250 },
            ],
          },
        ],
        citations: [],
      }) as AnalyticalComparisonResult,
    getInternalEvidence: async () => {
      provenanceCalled = true
      return {
        query: {
          taskType: 'spot_trends',
          metric: 'rent',
          subject: {
            kind: 'zip',
            id: '78701',
            label: '78701',
          },
          sourceIds: [],
        },
        records: [],
        citations: [],
      }
    },
  })

  assert.equal(provenanceCalled, true)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /No citation found/i)
})

test('downgrades charted history responses when citation coverage is incomplete', async () => {
  const response = await buildHistoryChartedResponseForTest('show me permit history for Harris County, TX', null, {
    getAnalyticalComparison: async () =>
      ({
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
            label: '   ',
            sourceType: 'internal_dataset',
          },
        ],
      }) as AnalyticalComparisonResult,
    getInternalEvidence: async () => ({
      query: {
        taskType: 'spot_trends',
        metric: 'permit_units',
        subject: {
          kind: 'county',
          id: 'county:TX:harris-county',
          label: 'Harris County, TX',
        },
        sourceIds: [],
      },
      records: [],
      citations: [],
    }),
  })

  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /Citation coverage is incomplete/i)
})

test('keeps charted history responses for demo use when service grounding is incomplete', async () => {
  const response = await buildHistoryChartedResponseForTest('show me permit history for Travis County, TX', null, {
    getAnalyticalComparison: async () =>
      ({
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2016-12-01', label: 'Last 10 years', monthsBack: 120 },
        series: [
          {
            key: 'county:TX:travis-county:permit_units',
            label: 'Travis County, TX',
            subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
            points: [
              { x: '2016-12-01', y: 13424 },
              { x: '2025-12-01', y: 13908 },
            ],
          },
        ],
        citations: [
          {
            id: 'texas_permits:warehouse:county:county:TX:travis-county',
            label: 'TREC Building Permits',
            sourceType: 'internal_dataset',
            scope: 'Travis County, TX',
            note: 'Texas permit history served from the specialized BigQuery texas_permits warehouse.',
            periodLabel: 'Historical Texas permit warehouse',
          },
        ],
      }) as AnalyticalComparisonResult,
    validateGroundingPayload: async () => ({
      requiresEvidence: true,
      normalizedEvidence: {
        status: 'grounded',
        citations: [
          {
            id: 'texas_permits:warehouse:county:county:TX:travis-county',
            label: 'TREC Building Permits',
            sourceType: 'internal_dataset',
            scope: 'Travis County, TX',
            note: 'Texas permit history served from the specialized BigQuery texas_permits warehouse.',
            periodLabel: 'Historical Texas permit warehouse',
            placeholder: false,
          },
        ],
      },
      validation: {
        status: 'citation_incomplete',
        userMessage: 'Citation coverage is incomplete.',
        suppressGroundedChart: true,
      },
    }),
  })

  assert.equal(response.chart?.kind, 'bar')
  assert.match(response.message, /Citation coverage is incomplete/i)
  assert.match(response.trace?.caveats?.join(' ') ?? '', /Citation coverage is incomplete/i)
})

test('keeps a history response grounded after internal provenance enrichment', async () => {
  const provenanceQueries: AgentInternalProvenanceQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] & {
    getInternalEvidence: (query: AgentInternalProvenanceQuery) => Promise<{
      query: AgentInternalProvenanceQuery
      records: Array<{
        id: string
        label: string
        sourceType: 'internal_dataset'
        scope: string
        note: string
        periodLabel: string
      }>
      citations: Array<{
        id: string
        label: string
        sourceType: 'internal_dataset'
        scope: string
        note: string
        periodLabel: string
      }>
    }>
  } = {
    getAnalyticalComparison: async () =>
      ({
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
            id: 'permit_units:county:county:TX:harris-county',
            label: '',
            sourceType: 'internal_dataset',
          },
        ],
      }) as AnalyticalComparisonResult,
    getInternalEvidence: async (query: AgentInternalProvenanceQuery) => {
      provenanceQueries.push(query)
      return {
        query,
        records: [
          {
            id: 'projectr_master_data:texas-permits:county:TX:harris-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            scope: 'Harris County, TX',
            note: 'County and metro permit activity normalized from Texas source adapters.',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
        citations: [
          {
            id: 'projectr_master_data:texas-permits:county:TX:harris-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            scope: 'Harris County, TX',
            note: 'County and metro permit activity normalized from Texas source adapters.',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
      }
    },
  }
  const response = await buildHistoryChartedResponseForTest(
    'show me permit history for Harris County, TX',
    null,
    dependencies
  )

  assert.equal(provenanceQueries.length, 1)
  assert.equal(provenanceQueries[0]?.subject?.kind, 'county')
  assert.equal(provenanceQueries[0]?.subject?.id, 'county:TX:harris-county')
  assert.equal(provenanceQueries[0]?.metric, 'permit_units')
  assert.deepEqual(provenanceQueries[0]?.sourceIds ?? [], [])
  assert.equal(response.chart?.kind, 'bar')
  const enrichedCitation = response.chart?.citations.find(
    (citation) => citation.id === 'projectr_master_data:texas-permits:county:TX:harris-county'
  )
  assert.equal(enrichedCitation?.label, 'Census BPS / Projectr master data')
  assert.equal(enrichedCitation?.periodLabel, '2021-04-01 to 2025-04-01')
  assert.ok((response.trace.citations?.length ?? 0) > 0)
  assert.match(response.message, /Harris County/i)
})

test('keeps a cited history response available when internal provenance retrieval fails', async () => {
  const response = await buildHistoryChartedResponseForTest('show me permit history for Harris County, TX', null, {
    getAnalyticalComparison: async () =>
      ({
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
            id: 'projectr_master_data:texas-permits:county:TX:harris-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            scope: 'Harris County, TX',
            note: 'County and metro permit activity normalized from Texas source adapters.',
            periodLabel: '2021-04-01 to 2025-04-01',
          },
        ],
      }) as AnalyticalComparisonResult,
    getInternalEvidence: async () => {
      throw new Error('provenance unavailable')
    },
  })

  assert.equal(response.chart?.kind, 'bar')
  assert.ok((response.chart?.citations.length ?? 0) > 0)
  assert.doesNotMatch(response.message, /No citation found|Citation coverage is incomplete/i)
  assert.match(response.message, /Harris County/i)
})

test('does not include workspace upload provenance when router-backed history has no upload source ids', async () => {
  const response = await buildHistoryChartedResponseForTest('show me permit history for Travis County, TX', null, {
    getAnalyticalComparison: async () =>
      ({
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2016-04-01', label: 'Last 10 years', monthsBack: 120 },
        series: [
          {
            key: 'county:TX:travis-county:permit_units',
            label: 'Travis County, TX',
            subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
            points: [
              { x: '2016-04-01', y: 676 },
              { x: '2026-04-01', y: 980 },
            ],
          },
        ],
        citations: [
          {
            id: 'texas_permits:warehouse',
            label: 'TREC Building Permits',
            sourceType: 'internal_dataset',
            periodLabel: '2016-04-01 to 2026-04-01',
          },
        ],
      }) as AnalyticalComparisonResult,
  })

  assert.doesNotMatch(response.trace?.evidence?.join(' ') ?? '', /Client upload session/i)
  assert.match(response.trace?.evidence?.join(' ') ?? '', /TREC Building Permits/i)
})

test('includes history source debug evidence for fallback diagnosis', async () => {
  const response = await buildHistoryChartedResponseForTest('show me permit history for Travis County, TX', null, {
    getAnalyticalComparison: async () =>
      ({
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2016-04-01', label: 'Last 10 years', monthsBack: 120 },
        series: [
          {
            key: 'county:TX:travis-county:permit_units',
            label: 'Travis County, TX',
            subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
            points: [{ x: '2026-01-01', y: 676 }],
          },
        ],
        citations: [
          {
            id: 'permit_units:county:county:TX:travis-county',
            label: 'Census BPS / Projectr master data',
            sourceType: 'internal_dataset',
            periodLabel: '2026-01-01 to 2026-01-01',
          },
        ],
        debug: {
          historySources: [
            {
              subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
              selectedSourceId: 'texas_permits',
              selectedSourceLabel: 'texas_permits',
              specializedRowsFound: 0,
              fallbackUsed: true,
              finalSourceId: 'permit_units:county:county:TX:travis-county',
              finalSourceLabel: 'Census BPS / Projectr master data',
              finalPointCount: 1,
            },
          ],
        },
      }) as AnalyticalComparisonResult,
  })

  const evidence = response.trace?.evidence?.join(' ') ?? ''
  assert.match(evidence, /Debug source selection: texas_permits/i)
  assert.match(evidence, /Debug specialized rows found: 0/i)
  assert.match(evidence, /Debug fallback used: yes/i)
  assert.match(evidence, /Debug final source: permit_units:county:county:TX:travis-county/i)
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

test('treats "last 10 years" as historical intent and forwards the explicit permit window', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('analyze the last 10 years of permit data in Travis County, Texas', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2016-04-01', label: 'Last 10 years', monthsBack: 120 },
        series: [
          {
            key: 'county:TX:travis-county:permit_units',
            label: 'Travis County, TX',
            subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
            points: [
              { x: '2016-04-01', y: 700 },
              { x: '2026-04-01', y: 980 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:county:TX:travis-county',
            label: 'TREC Building Permits',
            sourceType: 'internal_dataset',
            periodLabel: '2016-04-01 to 2026-04-01',
          },
        ],
      }
    },
    getInternalEvidence: async () => ({
      query: {
        taskType: 'spot_trends',
        metric: 'permit_units',
        subject: {
          kind: 'county',
          id: 'county:TX:travis-county',
          label: 'Travis County, TX',
        },
        sourceIds: ['permit_units:county:TX:travis-county'],
      },
      records: [
        {
          id: 'permit_units:county:TX:travis-county',
          label: 'TREC Building Permits',
          sourceType: 'internal_dataset',
          scope: 'Travis County, TX',
          note: 'Specialized Texas permit warehouse history.',
          periodLabel: '2016-04-01 to 2026-04-01',
        },
      ],
      citations: [
        {
          id: 'permit_units:county:TX:travis-county',
          label: 'TREC Building Permits',
          sourceType: 'internal_dataset',
          scope: 'Travis County, TX',
          note: 'Specialized Texas permit warehouse history.',
          periodLabel: '2016-04-01 to 2026-04-01',
        },
      ],
    }),
  })

  assert.equal(calls[0]?.metric, 'permit_units')
  assert.equal(calls[0]?.subjectMarket.kind, 'county')
  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:travis-county')
  assert.equal(calls[0]?.timeWindow.mode, 'relative')
  assert.equal(calls[0]?.timeWindow.unit, 'years')
  assert.equal(calls[0]?.timeWindow.value, 10)
  assert.equal(calls[0]?.timeWindow.label, 'Last 10 years')
  assert.equal(response.chart?.kind, 'bar')
  assert.match(response.message, /last 10 years/i)
  assert.match(response.message, /Travis County/i)
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

test('treats an explicit Texas city history prompt as the matching bounded metro subject', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('analyze the last 10 years of permit data for Austin, Texas', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2016-04-01', label: 'Last 10 years', monthsBack: 120 },
        series: [
          {
            key: 'metro:TX:austin:permit_units',
            label: 'Austin, TX',
            subject: { kind: 'metro', id: 'metro:TX:austin', label: 'Austin, TX' },
            points: [
              { x: '2016-04-01', y: 1024 },
              { x: '2026-04-01', y: 1188 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:metro:TX:austin',
            label: 'TREC Building Permits',
            sourceType: 'internal_dataset',
            periodLabel: '2016-04-01 to 2026-04-01',
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

test('retries an explicit Texas city permit history prompt through the bounded county proxy when metro history is insufficient', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('analyze the last 10 years of permit data for Austin, Texas', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      if (request.subjectMarket.id === 'metro:TX:austin') {
        throw new Error('Insufficient historical data for Austin, TX')
      }

      return {
        comparisonMode: 'history',
        metric: 'permit_units',
        metricLabel: 'Permit units',
        timeWindow: { mode: 'relative', startDate: '2016-04-01', label: 'Last 10 years', monthsBack: 120 },
        series: [
          {
            key: 'county:TX:travis-county:permit_units',
            label: 'Austin, TX (Travis County proxy)',
            subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Austin, TX (Travis County proxy)' },
            points: [
              { x: '2016-04-01', y: 700 },
              { x: '2026-04-01', y: 980 },
            ],
          },
        ],
        citations: [
          {
            id: 'permit_units:county:TX:travis-county',
            label: 'TREC Building Permits',
            sourceType: 'internal_dataset',
            periodLabel: '2016-04-01 to 2026-04-01',
          },
        ],
      }
    },
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.subjectMarket.id, 'metro:TX:austin')
  assert.equal(calls[1]?.subjectMarket.id, 'county:TX:travis-county')
  assert.match(calls[1]?.subjectMarket.label ?? '', /Austin, TX \(Travis County proxy\)/i)
  assert.equal(response.chart?.kind, 'bar')
  assert.match(response.message, /Austin, TX \(Travis County proxy\)/i)
})

test('returns a grounded public macro response for a Texas county population prompt', async () => {
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] & {
    getPublicMacroEvidence: (query: AgentPublicMacroQuery) => Promise<AgentPublicMacroEvidenceResult>
  } = {
    getPublicMacroEvidence: async (query) => ({
      query,
      value: {
        metric: 'population',
        label: 'Population',
        value: 4865000,
        displayValue: '4,865,000',
        scope: 'Harris County, TX',
        periodLabel: '2023-01-01',
        note: 'Pulled from cached ACS public-data rows in Scout.',
        sourceType: 'public_dataset',
      },
      records: [
        {
          id: 'public_macro:population:county:county:TX:harris-county',
          metric: 'population',
          label: 'U.S. Census Bureau ACS 5-year estimate',
          value: 4865000,
          displayValue: '4,865,000',
          sourceType: 'public_dataset',
          scope: 'Harris County, TX',
          note: 'Pulled from cached ACS public-data rows in Scout.',
          periodLabel: '2023-01-01',
        },
      ],
      citations: [
        {
          id: 'public_macro:population:county:county:TX:harris-county',
          label: 'U.S. Census Bureau ACS 5-year estimate',
          sourceType: 'public_dataset',
          scope: 'Harris County, TX',
          note: 'Pulled from cached ACS public-data rows in Scout.',
          periodLabel: '2023-01-01',
        },
      ],
    }),
  }
  const response = await buildHistoryChartedResponseForTest('what is the population in Harris County, TX?', null, dependencies)

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /Harris County/i)
  assert.match(response.message, /population/i)
  assert.match(response.message, /4,865,000/i)
  assert.match(response.message, /\[source:/i)
  assert.match(response.trace?.summary ?? '', /public macro/i)
  assert.equal(response.trace?.citations?.[0]?.sourceType, 'public_dataset')
  assert.equal(response.trace?.citations?.[0]?.scope, 'Harris County, TX')
  assert.equal(response.trace?.citations?.[0]?.periodLabel, '2023-01-01')
})

test('returns a grounded public macro response for a Texas county median household income prompt', async () => {
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] & {
    getPublicMacroEvidence: (query: AgentPublicMacroQuery) => Promise<AgentPublicMacroEvidenceResult>
  } = {
    getPublicMacroEvidence: async (query) => ({
      query,
      value: {
        metric: 'median household income',
        label: 'Median household income',
        value: 84632,
        displayValue: '$84,632',
        scope: 'Travis County, TX',
        periodLabel: '2023-01-01',
        note: 'Pulled from cached ACS public-data rows in Scout.',
        sourceType: 'public_dataset',
      },
      records: [
        {
          id: 'public_macro:median household income:county:TX:travis-county',
          metric: 'median household income',
          label: 'U.S. Census Bureau ACS 5-year estimate',
          value: 84632,
          displayValue: '$84,632',
          sourceType: 'public_dataset',
          scope: 'Travis County, TX',
          note: 'Pulled from cached ACS public-data rows in Scout.',
          periodLabel: '2023-01-01',
        },
      ],
      citations: [
        {
          id: 'public_macro:median household income:county:TX:travis-county',
          label: 'U.S. Census Bureau ACS 5-year estimate',
          sourceType: 'public_dataset',
          scope: 'Travis County, TX',
          note: 'Pulled from cached ACS public-data rows in Scout.',
          periodLabel: '2023-01-01',
        },
      ],
    }),
  }

  const response = await buildHistoryChartedResponseForTest(
    'what is the median household income in Travis County, TX?',
    null,
    dependencies
  )

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /\$84,632/)
  assert.match(response.message, /\[source:/i)
  assert.match(response.trace?.summary ?? '', /public macro/i)
  assert.equal(response.trace?.citations?.[0]?.scope, 'Travis County, TX')
  assert.equal(response.trace?.citations?.[0]?.sourceType, 'public_dataset')
  assert.equal(response.trace?.citations?.[0]?.periodLabel, '2023-01-01')
})

test('returns a grounded public macro response for a Texas metro housing cost burden prompt', async () => {
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] & {
    getPublicMacroEvidence: (query: AgentPublicMacroQuery) => Promise<AgentPublicMacroEvidenceResult>
  } = {
    getPublicMacroEvidence: async (query) => ({
      query,
      value: {
        metric: 'housing cost burden',
        label: 'Housing cost burden',
        value: 31.4,
        displayValue: '31.4%',
        scope: 'Austin, TX',
        periodLabel: '2023-01-01',
        note: 'Derived from cached ACS public-data rows in Scout using median gross rent times 12 divided by median household income.',
        sourceType: 'public_dataset',
      },
      records: [
        {
          id: 'public_macro:housing cost burden:metro:TX:austin',
          metric: 'housing cost burden',
          label: 'U.S. Census Bureau ACS 5-year estimate',
          value: 31.4,
          displayValue: '31.4%',
          sourceType: 'public_dataset',
          scope: 'Austin, TX',
          note: 'Derived from cached ACS public-data rows in Scout using median gross rent times 12 divided by median household income.',
          periodLabel: '2023-01-01',
        },
      ],
      citations: [
        {
          id: 'public_macro:housing cost burden:metro:TX:austin',
          label: 'U.S. Census Bureau ACS 5-year estimate',
          sourceType: 'public_dataset',
          scope: 'Austin, TX',
          note: 'Derived from cached ACS public-data rows in Scout using median gross rent times 12 divided by median household income.',
          periodLabel: '2023-01-01',
        },
      ],
    }),
  }

  const response = await buildHistoryChartedResponseForTest(
    'what is the housing cost burden in Austin metro, TX?',
    null,
    dependencies
  )

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /31.4%/)
  assert.match(response.trace?.summary ?? '', /public macro/i)
  assert.equal(response.trace?.citations?.[0]?.scope, 'Austin, TX')
  assert.equal(response.trace?.citations?.[0]?.sourceType, 'public_dataset')
  assert.equal(response.trace?.citations?.[0]?.periodLabel, '2023-01-01')
})

test('returns a bounded unsupported-metric response for public macro prompts outside the supported set', async () => {
  const response = await buildHistoryChartedResponseForTest('what is the vacancy rate in Harris County, TX?', null)

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /not supported yet/i)
  assert.match(response.trace?.summary ?? '', /public macro/i)
})

test('returns a bounded unresolved-geography response for public macro prompts without a Texas subject', async () => {
  const response = await buildHistoryChartedResponseForTest('what is the population in Cook County, IL?', null)

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|Texas/i)
  assert.match(response.trace?.summary ?? '', /public macro/i)
})

test('falls back cleanly when public macro retrieval fails', async () => {
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] & {
    getPublicMacroEvidence: (query: AgentPublicMacroQuery) => Promise<AgentPublicMacroEvidenceResult>
  } = {
    getPublicMacroEvidence: async () => {
      throw new Error('public macro adapter unavailable')
    },
  }
  const response = await buildHistoryChartedResponseForTest(
    'what is the median household income in Travis County, TX?',
    null,
    dependencies
  )

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not verify|citation/i)
  assert.match(response.trace?.summary ?? '', /public macro/i)
})

test('returns a grounded place response for a Texas county place prompt', async () => {
  const queries: AgentPlaceGroundingQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] = {
    getPlaceGrounding: async (query) => ({
      ...(queries.push(query), {}),
      query,
      value: {
        label: 'Harris County, TX',
        scope: 'Harris County, TX',
        sourceType: 'derived',
        note: 'Resolved from bounded Texas place grounding.',
        periodLabel: 'Current place context',
        lat: 29.7752,
        lng: -95.3103,
      },
      records: [
        {
          id: 'place:county:TX:harris-county',
          label: 'Harris County, TX',
          sourceType: 'derived',
          scope: 'Harris County, TX',
          note: 'Resolved from bounded Texas place grounding.',
          periodLabel: 'Current place context',
          lat: 29.7752,
          lng: -95.3103,
        },
      ],
      citations: [
        {
          id: 'place:county:TX:harris-county',
          label: 'Harris County, TX',
          sourceType: 'derived',
          scope: 'Harris County, TX',
          note: 'Resolved from bounded Texas place grounding.',
          periodLabel: 'Current place context',
        },
      ],
    }),
  }

  const response = await buildHistoryChartedResponseForTest('where is Harris County, TX?', null, dependencies)

  assert.ok(response, 'expected a place-grounding route response')
  assert.equal(response.chart ?? null, null)
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.requestType, 'place')
  assert.equal(queries[0]?.subject?.kind, 'county')
  assert.equal(queries[0]?.subject?.id, 'county:TX:harris-county')
  assert.equal(queries[0]?.subject?.label, 'Harris County, TX')
  assert.match(response.message, /Harris County/i)
  assert.match(response.message, /coordinates|place/i)
  assert.match(response.trace?.summary ?? '', /place/i)
  assert.equal(response.trace?.citations?.[0]?.sourceType, 'derived')
  assert.equal(response.trace?.citations?.[0]?.scope, 'Harris County, TX')
  assert.equal(response.trace?.citations?.[0]?.periodLabel, 'Current place context')
})

test('returns a grounded place response for a Texas metro coordinate prompt', async () => {
  const queries: AgentPlaceGroundingQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] = {
    getPlaceGrounding: async (query) => ({
      ...(queries.push(query), {}),
      query,
      value: {
        label: 'Austin metro, TX',
        scope: 'Austin metro, TX',
        sourceType: 'derived',
        note: 'Resolved from bounded Texas place grounding.',
        periodLabel: 'Current place context',
        lat: 30.2672,
        lng: -97.7431,
      },
      records: [
        {
          id: 'place:metro:TX:austin',
          label: 'Austin metro, TX',
          sourceType: 'derived',
          scope: 'Austin metro, TX',
          note: 'Resolved from bounded Texas place grounding.',
          periodLabel: 'Current place context',
          lat: 30.2672,
          lng: -97.7431,
        },
      ],
      citations: [
        {
          id: 'place:metro:TX:austin',
          label: 'Austin metro, TX',
          sourceType: 'derived',
          scope: 'Austin metro, TX',
          note: 'Resolved from bounded Texas place grounding.',
          periodLabel: 'Current place context',
        },
      ],
    }),
  }

  const response = await buildHistoryChartedResponseForTest(
    'where are the coordinates for Austin metro, TX?',
    null,
    dependencies
  )

  assert.ok(response, 'expected a place-grounding route response')
  assert.equal(response.chart ?? null, null)
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.requestType, 'place')
  assert.equal(queries[0]?.subject?.kind, 'metro')
  assert.equal(queries[0]?.subject?.id, 'metro:TX:austin')
  assert.equal(queries[0]?.subject?.label, 'Austin, TX')
  assert.match(response.message, /Austin/i)
  assert.match(response.trace?.summary ?? '', /place/i)
  assert.equal(response.trace?.citations?.[0]?.scope, 'Austin metro, TX')
})

test('returns a bounded unresolved-geography response for place prompts without a Texas subject', async () => {
  const response = await buildHistoryChartedResponseForTest('where is Cook County, IL?', null, {
    getPlaceGrounding: async () => {
      throw new Error('should not be called')
    },
  })

  assert.ok(response, 'expected a bounded unresolved place response')
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|Texas/i)
  assert.match(response.trace?.summary ?? '', /place/i)
})

test('falls back cleanly when place grounding retrieval fails', async () => {
  const queries: AgentPlaceGroundingQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] = {
    getPlaceGrounding: async (query) => {
      queries.push(query)
      throw new Error('place grounding adapter unavailable')
    },
  }

  const response = await buildHistoryChartedResponseForTest('where are the coordinates for Austin metro, TX?', null, dependencies)

  assert.ok(response, 'expected a bounded place failure response')
  assert.equal(response.chart ?? null, null)
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.requestType, 'place')
  assert.equal(queries[0]?.subject?.kind, 'metro')
  assert.equal(queries[0]?.subject?.id, 'metro:TX:austin')
  assert.equal(queries[0]?.subject?.label, 'Austin, TX')
  assert.match(response.message, /could not verify|place/i)
  assert.match(response.trace?.summary ?? '', /place/i)
})

test('returns a grounded drive-time response for explicit Texas metro prompts', async () => {
  const queries: AgentDriveTimeQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] = {
    getDriveTimeGrounding: async (query) => ({
      ...(queries.push(query), {}),
      query,
      value: {
        label: 'Estimated drive time',
        scope: 'Austin, TX to Dallas, TX',
        sourceType: 'derived',
        driveMinutes: 208,
        displayValue: 'about 3 hr 28 min',
        distanceMiles: 208.4,
        note: 'Estimated from bounded Texas place coordinates with a conservative road-distance factor.',
        periodLabel: 'Current route context',
      },
      records: [
        {
          id: 'drive_time:metro:TX:austin:metro:TX:dallas',
          label: 'Bounded Texas route estimate',
          sourceType: 'derived',
          scope: 'Austin, TX to Dallas, TX',
          note: 'Estimated from bounded Texas place coordinates with a conservative road-distance factor.',
          periodLabel: 'Current route context',
          driveMinutes: 208,
          distanceMiles: 208.4,
        },
      ],
      citations: [
        {
          id: 'drive_time:metro:TX:austin:metro:TX:dallas',
          label: 'Bounded Texas route estimate',
          sourceType: 'derived',
          scope: 'Austin, TX to Dallas, TX',
          note: 'Estimated from bounded Texas place coordinates with a conservative road-distance factor.',
          periodLabel: 'Current route context',
        },
      ],
    }),
  }

  const response = await buildHistoryChartedResponseForTest('drive time from Austin to Dallas', null, dependencies)

  assert.ok(response, 'expected a bounded drive-time response')
  assert.equal(response.chart ?? null, null)
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.origin?.kind, 'metro')
  assert.equal(queries[0]?.origin?.id, 'metro:TX:austin')
  assert.equal(queries[0]?.destination?.kind, 'metro')
  assert.equal(queries[0]?.destination?.id, 'metro:TX:dallas')
  assert.match(response.message, /drive time/i)
  assert.match(response.message, /\[source:/i)
  assert.match(response.trace?.summary ?? '', /drive-time/i)
  assert.equal(response.trace?.citations?.[0]?.periodLabel, 'Current route context')
})

test('returns a grounded drive-time response for active-vs-explicit prompts', async () => {
  const queries: AgentDriveTimeQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] = {
    getDriveTimeGrounding: async (query) => ({
      ...(queries.push(query), {}),
      query,
      value: {
        label: 'Estimated drive time',
        scope: 'Austin, TX to Dallas, TX',
        sourceType: 'derived',
        driveMinutes: 208,
        displayValue: 'about 3 hr 28 min',
        distanceMiles: 208.4,
        note: 'Estimated from bounded Texas place coordinates with a conservative road-distance factor.',
        periodLabel: 'Current route context',
      },
      records: [
        {
          id: 'drive_time:metro:TX:austin:metro:TX:dallas',
          label: 'Bounded Texas route estimate',
          sourceType: 'derived',
          scope: 'Austin, TX to Dallas, TX',
          note: 'Estimated from bounded Texas place coordinates with a conservative road-distance factor.',
          periodLabel: 'Current route context',
          driveMinutes: 208,
          distanceMiles: 208.4,
        },
      ],
      citations: [
        {
          id: 'drive_time:metro:TX:austin:metro:TX:dallas',
          label: 'Bounded Texas route estimate',
          sourceType: 'derived',
          scope: 'Austin, TX to Dallas, TX',
          note: 'Estimated from bounded Texas place coordinates with a conservative road-distance factor.',
          periodLabel: 'Current route context',
        },
      ],
    }),
  }

  const response = await buildHistoryChartedResponseForTest(
    'drive time from this metro to Dallas metro, TX',
    { ...createActiveZipContext('78701', 'Austin, TX'), activeSubject: { kind: 'metro', id: 'metro:TX:austin', label: 'Austin, TX' } },
    dependencies
  )

  assert.ok(response)
  assert.equal(response.chart ?? null, null)
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.origin?.id, 'metro:TX:austin')
  assert.equal(queries[0]?.destination?.id, 'metro:TX:dallas')
  assert.match(response.message, /Austin, TX/i)
  assert.match(response.message, /Dallas, TX/i)
  assert.match(response.message, /\[source:/i)
})

test('returns a bounded unresolved-geography response for drive-time prompts without two Texas subjects', async () => {
  const response = await buildHistoryChartedResponseForTest('drive time from Austin to Chicago', null, {
    getDriveTimeGrounding: async () => {
      throw new Error('should not be called')
    },
  })

  assert.ok(response, 'expected a bounded unresolved drive-time response')
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify|Texas/i)
  assert.match(response.trace?.summary ?? '', /drive-time/i)
})

test('falls back cleanly when drive-time grounding retrieval fails', async () => {
  const queries: AgentDriveTimeQuery[] = []
  const dependencies: Parameters<typeof buildHistoryChartedResponseForTest>[2] = {
    getDriveTimeGrounding: async (query) => {
      queries.push(query)
      throw new Error('drive-time grounding adapter unavailable')
    },
  }

  const response = await buildHistoryChartedResponseForTest('drive time from Austin to Dallas', null, dependencies)

  assert.ok(response, 'expected a bounded drive-time failure response')
  assert.equal(response.chart ?? null, null)
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.origin?.id, 'metro:TX:austin')
  assert.equal(queries[0]?.destination?.id, 'metro:TX:dallas')
  assert.match(response.message, /could not verify|drive-time/i)
  assert.match(response.trace?.summary ?? '', /drive-time/i)
})

test('returns a grounded rent comparison chart for two ZIP prompts', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('compare rent history between 78701 and 77002', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'peer_market',
        metric: 'rent',
        metricLabel: 'Rent',
        timeWindow: { mode: 'relative', startDate: '2025-04-01', label: 'Last 12 months', monthsBack: 12 },
        series: [
          {
            key: 'zip:78701:rent',
            label: '78701',
            subject: { kind: 'zip', id: '78701', label: '78701' },
            points: [
              { x: '2025-04', y: 2100 },
              { x: '2026-04', y: 2250 },
            ],
          },
          {
            key: 'zip:77002:rent',
            label: '77002',
            subject: { kind: 'zip', id: '77002', label: '77002' },
            points: [
              { x: '2025-04', y: 1950 },
              { x: '2026-04', y: 2050 },
            ],
          },
        ],
        citations: [
          { id: 'rent:zip:78701', label: 'Zillow Research', sourceType: 'public_dataset', periodLabel: '2025-04 to 2026-04' },
          { id: 'rent:zip:77002', label: 'Zillow Research', sourceType: 'public_dataset', periodLabel: '2025-04 to 2026-04' },
        ],
      }
    },
  })

  assert.equal(calls[0]?.comparisonMode, 'peer_market')
  assert.equal(calls[0]?.subjectMarket.id, '78701')
  assert.equal(calls[0]?.comparisonMarket?.id, '77002')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /78701 versus 77002/i)
})

test('returns a grounded permit comparison chart for two Texas county prompts', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest(
    'compare permit history for Harris County, TX and Travis County, TX',
    null,
    {
      getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
        calls.push(request)
        return {
          comparisonMode: 'peer_market',
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
            {
              key: 'county:TX:travis-county:permit_units',
              label: 'Travis County, TX',
              subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
              points: [
                { x: '2021-04-01', y: 820 },
                { x: '2025-04-01', y: 910 },
              ],
            },
          ],
          citations: [
            { id: 'permit:county:TX:harris-county', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
            { id: 'permit:county:TX:travis-county', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
          ],
        }
      },
    }
  )

  assert.equal(calls[0]?.comparisonMode, 'peer_market')
  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:harris-county')
  assert.equal(calls[0]?.comparisonMarket?.id, 'county:TX:travis-county')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /Harris County, TX versus Travis County, TX/i)
})

test('returns a grounded permit comparison chart for two Texas metro prompts', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest(
    'compare Austin metro area to Dallas metro area on permits',
    null,
    {
      getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
        calls.push(request)
        return {
          comparisonMode: 'peer_market',
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
            {
              key: 'metro:TX:dallas:permit_units',
              label: 'Dallas, TX',
              subject: { kind: 'metro', id: 'metro:TX:dallas', label: 'Dallas, TX' },
              points: [
                { x: '2021-04-01', y: 980 },
                { x: '2025-04-01', y: 1115 },
              ],
            },
          ],
          citations: [
            { id: 'permit:metro:TX:austin', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
            { id: 'permit:metro:TX:dallas', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
          ],
        }
      },
    }
  )

  assert.equal(calls[0]?.comparisonMode, 'peer_market')
  assert.equal(calls[0]?.metric, 'permit_units')
  assert.equal(calls[0]?.subjectMarket.kind, 'metro')
  assert.equal(calls[0]?.comparisonMarket?.kind, 'metro')
  assert.equal(calls[0]?.subjectMarket.id, 'metro:TX:austin')
  assert.equal(calls[0]?.comparisonMarket?.id, 'metro:TX:dallas')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /Austin, TX versus Dallas, TX/i)
})

test('treats this market as the active ZIP in a comparison against an explicit ZIP on rent', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('compare this market to 77002 on rent', createActiveZipContext('78701'), {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'peer_market',
        metric: 'rent',
        metricLabel: 'Rent',
        timeWindow: { mode: 'relative', startDate: '2025-04-01', label: 'Last 12 months', monthsBack: 12 },
        series: [
          {
            key: 'zip:78701:rent',
            label: '78701',
            subject: { kind: 'zip', id: '78701', label: '78701' },
            points: [
              { x: '2025-04', y: 2100 },
              { x: '2026-04', y: 2250 },
            ],
          },
          {
            key: 'zip:77002:rent',
            label: '77002',
            subject: { kind: 'zip', id: '77002', label: '77002' },
            points: [
              { x: '2025-04', y: 1950 },
              { x: '2026-04', y: 2050 },
            ],
          },
        ],
        citations: [
          { id: 'rent:zip:78701', label: 'Zillow Research', sourceType: 'public_dataset', periodLabel: '2025-04 to 2026-04' },
          { id: 'rent:zip:77002', label: 'Zillow Research', sourceType: 'public_dataset', periodLabel: '2025-04 to 2026-04' },
        ],
      }
    },
  })

  assert.equal(calls[0]?.comparisonMode, 'peer_market')
  assert.equal(calls[0]?.subjectMarket.kind, 'zip')
  assert.equal(calls[0]?.subjectMarket.id, '78701')
  assert.equal(calls[0]?.comparisonMarket?.kind, 'zip')
  assert.equal(calls[0]?.comparisonMarket?.id, '77002')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /78701 versus 77002/i)
})

test('rejects active-vs-explicit vacancy comparisons without calling the router', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('compare this market to 77002 on vacancy', createActiveZipContext('78701'), {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /not supported yet/i)
  assert.match(response.trace?.summary ?? '', /unsupported comparison metric/i)
  assert.match(response.trace?.evidence?.join(' ') ?? '', /78701/i)
  assert.match(response.trace?.evidence?.join(' ') ?? '', /77002/i)
})

test('returns a bounded failure mentioning the active market when none is loaded', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('compare this market to 77002 on rent', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /active market/i)
  assert.match(response.trace?.summary ?? '', /active market/i)
})

test('treats this county as the active county in a comparison against an explicit Texas county on permits', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest(
    'compare this county to Travis County on permits',
    createActiveSubjectContext({ kind: 'county', id: 'county:TX:harris-county', label: 'Harris County, TX' }),
    {
      getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
        calls.push(request)
        return {
          comparisonMode: 'peer_market',
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
            {
              key: 'county:TX:travis-county:permit_units',
              label: 'Travis County, TX',
              subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
              points: [
                { x: '2021-04-01', y: 820 },
                { x: '2025-04-01', y: 910 },
              ],
            },
          ],
          citations: [
            { id: 'permit:county:TX:harris-county', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
            { id: 'permit:county:TX:travis-county', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
          ],
        }
      },
    }
  )

  assert.equal(calls[0]?.comparisonMode, 'peer_market')
  assert.equal(calls[0]?.subjectMarket.kind, 'county')
  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:harris-county')
  assert.equal(calls[0]?.comparisonMarket?.id, 'county:TX:travis-county')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /Harris County, TX versus Travis County, TX/i)
})

test('treats this metro as the active metro in a comparison against an explicit Texas metro on unemployment', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest(
    'compare this metro to Dallas metro on unemployment',
    createActiveSubjectContext({ kind: 'metro', id: 'metro:TX:austin', label: 'Austin, TX' }),
    {
      getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
        calls.push(request)
        return {
          comparisonMode: 'peer_market',
          metric: 'unemployment_rate',
          metricLabel: 'Unemployment rate',
          timeWindow: { mode: 'relative', startDate: '2024-04-01', label: 'Last 24 months', monthsBack: 24 },
          series: [
            {
              key: 'metro:TX:austin:unemployment_rate',
              label: 'Austin, TX',
              subject: { kind: 'metro', id: 'metro:TX:austin', label: 'Austin, TX' },
              points: [
                { x: '2024-04', y: 3.6 },
                { x: '2026-04', y: 4.1 },
              ],
            },
            {
              key: 'metro:TX:dallas:unemployment_rate',
              label: 'Dallas, TX',
              subject: { kind: 'metro', id: 'metro:TX:dallas', label: 'Dallas, TX' },
              points: [
                { x: '2024-04', y: 3.9 },
                { x: '2026-04', y: 4.3 },
              ],
            },
          ],
          citations: [
            { id: 'unemployment:metro:TX:austin', label: 'FRED / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2024-04 to 2026-04' },
            { id: 'unemployment:metro:TX:dallas', label: 'FRED / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2024-04 to 2026-04' },
          ],
        }
      },
    }
  )

  assert.equal(calls[0]?.comparisonMode, 'peer_market')
  assert.equal(calls[0]?.subjectMarket.kind, 'metro')
  assert.equal(calls[0]?.subjectMarket.id, 'metro:TX:austin')
  assert.equal(calls[0]?.comparisonMarket?.id, 'metro:TX:dallas')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /Austin, TX versus Dallas, TX/i)
})

test('parses compare 78701 to 77002 on rent as an explicit comparison request', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('compare 78701 to 77002 on rent', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'peer_market',
        metric: 'rent',
        metricLabel: 'Rent',
        timeWindow: { mode: 'relative', startDate: '2025-04-01', label: 'Last 12 months', monthsBack: 12 },
        series: [
          {
            key: 'zip:78701:rent',
            label: '78701',
            subject: { kind: 'zip', id: '78701', label: '78701' },
            points: [
              { x: '2025-04', y: 2100 },
              { x: '2026-04', y: 2250 },
            ],
          },
          {
            key: 'zip:77002:rent',
            label: '77002',
            subject: { kind: 'zip', id: '77002', label: '77002' },
            points: [
              { x: '2025-04', y: 1950 },
              { x: '2026-04', y: 2050 },
            ],
          },
        ],
        citations: [
          { id: 'rent:zip:78701', label: 'Zillow Research', sourceType: 'public_dataset', periodLabel: '2025-04 to 2026-04' },
          { id: 'rent:zip:77002', label: 'Zillow Research', sourceType: 'public_dataset', periodLabel: '2025-04 to 2026-04' },
        ],
      }
    },
  })

  assert.ok(response)
  assert.equal(calls[0]?.metric, 'rent')
  assert.equal(calls[0]?.subjectMarket.id, '78701')
  assert.equal(calls[0]?.comparisonMarket?.id, '77002')
  assert.equal(response.chart?.series.length, 2)
  assert.match(response.message, /78701 versus 77002/i)
})

test('parses compare Harris County and Travis County on permits as an explicit comparison request', async () => {
  const calls: AnalyticalComparisonRequest[] = []
  const response = await buildHistoryChartedResponseForTest('compare Harris County and Travis County on permits', null, {
    getAnalyticalComparison: async (request: AnalyticalComparisonRequest): Promise<AnalyticalComparisonResult> => {
      calls.push(request)
      return {
        comparisonMode: 'peer_market',
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
          {
            key: 'county:TX:travis-county:permit_units',
            label: 'Travis County, TX',
            subject: { kind: 'county', id: 'county:TX:travis-county', label: 'Travis County, TX' },
            points: [
              { x: '2021-04-01', y: 820 },
              { x: '2025-04-01', y: 910 },
            ],
          },
        ],
        citations: [
          { id: 'permit:county:TX:harris-county', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
          { id: 'permit:county:TX:travis-county', label: 'Census BPS / Projectr master data', sourceType: 'internal_dataset', periodLabel: '2021-04-01 to 2025-04-01' },
        ],
      }
    },
  })

  assert.ok(response)
  assert.equal(calls[0]?.metric, 'permit_units')
  assert.equal(calls[0]?.subjectMarket.kind, 'county')
  assert.equal(calls[0]?.comparisonMarket?.kind, 'county')
  assert.equal(calls[0]?.subjectMarket.id, 'county:TX:harris-county')
  assert.equal(calls[0]?.comparisonMarket?.id, 'county:TX:travis-county')
  assert.equal(response.chart?.series.length, 2)
})

test('parses compare 78701 and 77002 on vacancy without calling the router', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('compare 78701 and 77002 on vacancy', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.ok(response)
  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /not supported yet/i)
  assert.match(response.trace?.summary ?? '', /unsupported comparison metric/i)
  assert.match(response.trace?.evidence?.join(' ') ?? '', /78701/i)
  assert.match(response.trace?.evidence?.join(' ') ?? '', /77002/i)
})

test('keeps unresolved explicit comparisons inside the bounded comparison lane', async () => {
  let called = false
  const response = await buildHistoryChartedResponseForTest('compare Harris County and Austin on permits', null, {
    getAnalyticalComparison: async () => {
      called = true
      throw new Error('router should not be called')
    },
  })

  assert.equal(called, false)
  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /could not identify two explicit comparison markets/i)
  assert.match(response.trace?.summary ?? '', /comparison request missing two resolvable markets/i)
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
