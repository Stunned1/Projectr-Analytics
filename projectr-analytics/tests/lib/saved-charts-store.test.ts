import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'

const sessionStorageMock = (() => {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
})()

;(globalThis as typeof globalThis & { sessionStorage: typeof sessionStorageMock }).sessionStorage =
  sessionStorageMock as typeof sessionStorageMock

const { SAVED_CHARTS_STORAGE_KEY, useSavedChartsStore } = require('@/lib/saved-charts-store') as typeof import(
  '@/lib/saved-charts-store'
)

const baseChart: ScoutChartOutput = {
  kind: 'line',
  title: 'Rent trend',
  xAxis: { key: 'month', label: 'Month' },
  yAxis: { label: 'Rent index' },
  series: [{ key: 'zori', label: 'ZORI', points: [{ x: '2026-01', y: 100 }] }],
  citations: [],
}

const statCardOutput = {
  id: 'retail-income-card',
  kind: 'stat_card',
  savedAt: '2026-04-20T12:00:00.000Z',
  prompt: 'compare retail for Austin vs. Houston',
  marketLabel: 'Austin vs Houston',
  payload: {
    title: 'Median household income',
    summary: 'Houston leads slightly on the latest bounded macro companion.',
    stats: [
      { label: 'Austin', value: '$92,000' },
      { label: 'Houston', value: '$78,000' },
    ],
  },
} as const

const uploadedPinOutput = {
  id: 'uploaded-pin-1',
  kind: 'uploaded_pin',
  savedAt: '2026-04-20T12:01:00.000Z',
  marketLabel: 'Austin, TX',
  payload: {
    siteLabel: 'South Lamar candidate',
    lat: 30.2501,
    lng: -97.7654,
    sourceLabel: 'sites.csv',
    rowPreview: { Address: '111 Example St', Units: 220 },
  },
} as const

test('adds a saved chart record', () => {
  useSavedChartsStore.getState().resetForTests()

  const id = useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: 'Austin, TX',
  })

  const state = useSavedChartsStore.getState()
  const storedPayload = JSON.parse(sessionStorage.getItem(SAVED_CHARTS_STORAGE_KEY) ?? 'null')

  assert.equal(state.charts.length, 1)
  assert.equal(state.charts[0]?.id, id)
  assert.equal(state.charts[0]?.prompt, 'Show rent trend')
  assert.equal(state.charts[0]?.marketLabel, 'Austin, TX')
  assert.equal(state.charts[0]?.chart.title, 'Rent trend')
  assert.equal(typeof state.charts[0]?.savedAt, 'string')
  assert.ok(state.hasChart(id))
  assert.deepEqual(storedPayload.state.charts[0], {
    id,
    chart: normalizeScoutChartOutput(baseChart),
    prompt: 'Show rent trend',
    marketLabel: 'Austin, TX',
    savedAt: state.charts[0]?.savedAt,
  })
})

test('deduplicates repeated saves for the same chart signature', () => {
  useSavedChartsStore.getState().resetForTests()

  const input = {
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: 'Austin, TX',
  }

  const firstId = useSavedChartsStore.getState().saveChart(input)
  const secondId = useSavedChartsStore.getState().saveChart(input)

  const state = useSavedChartsStore.getState()
  const storedPayload = JSON.parse(sessionStorage.getItem(SAVED_CHARTS_STORAGE_KEY) ?? 'null')

  assert.equal(secondId, firstId)
  assert.equal(state.charts.length, 1)
  assert.equal(state.charts[0]?.id, firstId)
  assert.equal(storedPayload.state.charts.length, 1)
  assert.equal(storedPayload.state.charts[0]?.id, firstId)
  assert.equal(useSavedChartsStore.getState().hasSavedChart(input), true)
})

test('deduplicates unlabeled legacy saves against labeled records', () => {
  useSavedChartsStore.getState().resetForTests()

  const labeledInput = {
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: 'Austin, TX',
  }

  const firstId = useSavedChartsStore.getState().saveChart(labeledInput)
  const legacyId = useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: null,
  })

  const state = useSavedChartsStore.getState()
  assert.equal(legacyId, firstId)
  assert.equal(state.charts.length, 1)
  assert.equal(useSavedChartsStore.getState().hasSavedChart({ ...labeledInput, marketLabel: null }), true)
})

test('does not deduplicate an unlabeled legacy save when multiple markets share the same chart and prompt', () => {
  useSavedChartsStore.getState().resetForTests()

  useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: 'Austin, TX',
  })
  const secondId = useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: 'Houston, TX',
  })

  const legacyId = useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'Show rent trend',
    marketLabel: null,
  })

  const state = useSavedChartsStore.getState()
  assert.equal(state.charts.length, 3)
  assert.notEqual(legacyId, secondId)
  assert.equal(useSavedChartsStore.getState().hasSavedChart({ chart: baseChart, prompt: 'Show rent trend', marketLabel: null }), true)
})

test('keeps newest saved chart first', () => {
  useSavedChartsStore.getState().resetForTests()

  const firstId = useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'First chart',
  })
  const secondId = useSavedChartsStore.getState().saveChart({
    chart: {
      ...baseChart,
      title: 'Second chart',
    },
    prompt: 'Second chart',
  })

  const charts = useSavedChartsStore.getState().charts
  assert.equal(charts.length, 2)
  assert.equal(charts[0]?.id, secondId)
  assert.equal(charts[1]?.id, firstId)
})

test('removes a saved chart', () => {
  useSavedChartsStore.getState().resetForTests()

  const id = useSavedChartsStore.getState().saveChart({
    chart: baseChart,
    prompt: 'Remove me',
  })

  useSavedChartsStore.getState().removeChart(id)

  const state = useSavedChartsStore.getState()
  assert.equal(state.charts.length, 0)
  assert.equal(state.hasChart(id), false)
})

test('hydrates saved charts from sessionStorage', () => {
  useSavedChartsStore.getState().resetForTests()

  sessionStorage.setItem(
    SAVED_CHARTS_STORAGE_KEY,
    JSON.stringify({
      state: {
        charts: [
          {
            id: 'saved-chart-1',
            chart: baseChart,
            prompt: 'Hydrated chart',
            marketLabel: null,
            savedAt: '2026-04-20T12:00:00.000Z',
          },
          {
            id: 'saved-chart-2',
            chart: {
              ...baseChart,
              citations: 'not-an-array',
            },
            prompt: 'Broken chart',
            marketLabel: 'Ignored',
            savedAt: '2026-04-20T12:05:00.000Z',
          },
        ],
      },
      version: 0,
    })
  )

  useSavedChartsStore.persist.rehydrate()

  const state = useSavedChartsStore.getState()
  assert.equal(state.charts.length, 1)
  assert.equal(state.charts[0]?.id, 'saved-chart-1')
  assert.equal(state.charts[0]?.prompt, 'Hydrated chart')
  assert.equal(state.charts[0]?.marketLabel, null)
  assert.equal(state.charts[0]?.savedAt, '2026-04-20T12:00:00.000Z')
  assert.equal(state.charts[0]?.chart.yAxis.valueFormat, 'number')
  assert.equal(state.charts[0]?.chart.series[0]?.color, null)
})

test('saves chart and non-chart outputs in newest-first order', () => {
  useSavedChartsStore.getState().resetForTests()

  useSavedChartsStore.getState().saveOutput({
    kind: 'chart',
    prompt: 'compare retail for Austin vs. Houston',
    marketLabel: 'Austin vs Houston',
    payload: baseChart,
  })
  const statId = useSavedChartsStore.getState().saveOutput({
    kind: 'stat_card',
    prompt: statCardOutput.prompt,
    marketLabel: statCardOutput.marketLabel,
    payload: statCardOutput.payload,
  })

  const state = useSavedChartsStore.getState()
  assert.equal(state.outputs.length, 2)
  assert.equal(state.outputs[0]?.kind, 'stat_card')
  assert.equal(state.outputs[0]?.id, statId)
  assert.equal(state.outputs[1]?.kind, 'chart')
})

test('detects already-saved uploaded pin outputs by stable payload identity', () => {
  useSavedChartsStore.getState().resetForTests()

  const input = {
    kind: 'uploaded_pin' as const,
    marketLabel: 'Austin, TX',
    payload: uploadedPinOutput.payload,
  }

  useSavedChartsStore.getState().saveOutput(input)

  assert.equal(useSavedChartsStore.getState().hasSavedOutput(input), true)
})

test('hydrates mixed saved outputs from sessionStorage', () => {
  useSavedChartsStore.getState().resetForTests()

  sessionStorage.setItem(
    SAVED_CHARTS_STORAGE_KEY,
    JSON.stringify({
      state: {
        outputs: [statCardOutput, uploadedPinOutput],
      },
      version: 1,
    })
  )

  useSavedChartsStore.persist.rehydrate()

  const state = useSavedChartsStore.getState()
  assert.equal(state.outputs.length, 2)
  assert.equal(state.outputs[0]?.kind, 'stat_card')
  assert.equal(state.outputs[1]?.kind, 'uploaded_pin')
})
