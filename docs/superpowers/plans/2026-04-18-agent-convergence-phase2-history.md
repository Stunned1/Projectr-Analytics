# Phase 2 History-First Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first Phase 2 router-first analytical slice so `/api/agent` can answer Texas-first market-vs-own-history prompts for rent, unemployment, and permit activity with grounded charts and citations.

**Architecture:** Extend the existing `/api/agent` route with a bounded history-intent path that resolves geography, normalizes metrics and time windows, and delegates all historical reads to comparison-ready helpers in `market-data-router`. Reuse the existing Phase 1 `ScoutChartOutput` contract and assistant UI, and keep the internal helper/result shape ready for later market A vs market B support without implementing that execution yet.

**Tech Stack:** Next.js App Router, TypeScript, `tsx --test`, existing `market-data-router`, `recharts`, React 19

---

## File Structure

### Existing files to modify

- `projectr-analytics/lib/data/market-data-router.ts`
  - add agent-safe history helper(s), metric normalization, time-window normalization, and comparison-ready result types
- `projectr-analytics/app/api/agent/route.ts`
  - add history-intent parsing, geography/metric/window normalization, router helper integration, and grounded chart/text assembly
- `projectr-analytics/lib/agent-types.ts`
  - add any narrow internal metadata needed to keep history responses typed without changing the public assistant shape unnecessarily
- `projectr-analytics/README.md`
  - update changelog/limitations if behavior or deferred scope changes during implementation
- `dev/agent-convergence-worklog.md`
  - track Phase 2 execution progress and decisions as implementation lands

### Existing tests to modify or extend

- `projectr-analytics/tests/lib/data/market-data-router.test.ts`
  - add history helper coverage
- `projectr-analytics/tests/app/api/agent-response-shape.test.ts`
  - add grounded history prompt coverage

### No new UI files needed

The Phase 1 chart renderer and assistant UI should remain unchanged for this slice. The implementation should only reuse the existing `ScoutChartOutput` flow.

---

### Task 1: Add Comparison-Ready Historical Helpers To The Router

**Files:**
- Modify: `projectr-analytics/lib/data/market-data-router.ts`
- Test: `projectr-analytics/tests/lib/data/market-data-router.test.ts`

- [ ] **Step 1: Write the failing router tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAnalyticalComparisonForTest,
  type AnalyticalComparisonRequest,
} from '@/lib/data/market-data-router'

test('returns a comparison-ready rent history result for a zip', async () => {
  const result = await getAnalyticalComparisonForTest({
    comparisonMode: 'history',
    metric: 'rent',
    subjectMarket: { kind: 'zip', id: '78701', label: '78701' },
    comparisonMarket: null,
    timeWindow: { mode: 'relative', unit: 'months', value: 24 },
  })

  assert.equal(result.metric, 'rent')
  assert.equal(result.comparisonMode, 'history')
  assert.equal(result.series.length, 1)
  assert.equal(result.series[0]?.subject.kind, 'zip')
  assert.ok(result.citations.length >= 1)
})

test('returns a comparison-ready permit history result for a county', async () => {
  const result = await getAnalyticalComparisonForTest({
    comparisonMode: 'history',
    metric: 'permit_units',
    subjectMarket: { kind: 'county', id: 'county:harris-tx', label: 'Harris County, TX' },
    comparisonMarket: null,
    timeWindow: { mode: 'relative', unit: 'years', value: 5 },
  })

  assert.equal(result.metric, 'permit_units')
  assert.equal(result.series[0]?.subject.kind, 'county')
})

test('rejects unsupported metrics before querying history', async () => {
  await assert.rejects(
    () =>
      getAnalyticalComparisonForTest({
        comparisonMode: 'history',
        metric: 'median_income',
        subjectMarket: { kind: 'zip', id: '78701', label: '78701' },
        comparisonMarket: null,
        timeWindow: { mode: 'relative', unit: 'months', value: 12 },
      } as AnalyticalComparisonRequest),
    /Unsupported analytical metric/
  )
})
```

- [ ] **Step 2: Run the router test to verify it fails**

Run: `npm test -- tests/lib/data/market-data-router.test.ts`
Expected: FAIL with missing `getAnalyticalComparisonForTest` export and missing history comparison types/helpers.

- [ ] **Step 3: Add the comparison-ready request and result types**

```ts
export type AnalyticalSubjectKind = 'zip' | 'county' | 'metro'
export type AnalyticalComparisonMode = 'history' | 'peer_market'
export type AnalyticalMetric = 'rent' | 'unemployment_rate' | 'permit_units'

export type AnalyticalTimeWindow =
  | { mode: 'relative'; unit: 'months' | 'years'; value: number }
  | { mode: 'since'; startDate: string }

export interface AnalyticalSubject {
  kind: AnalyticalSubjectKind
  id: string
  label: string
}

export interface AnalyticalComparisonRequest {
  comparisonMode: AnalyticalComparisonMode
  metric: AnalyticalMetric
  subjectMarket: AnalyticalSubject
  comparisonMarket: AnalyticalSubject | null
  timeWindow: AnalyticalTimeWindow
}

export interface AnalyticalComparisonSeries {
  key: string
  label: string
  subject: AnalyticalSubject
  points: Array<{ x: string; y: number }>
}

export interface AnalyticalComparisonCitation {
  id: string
  label: string
  sourceType: 'internal_dataset' | 'public_dataset' | 'workspace_upload' | 'derived'
  note?: string | null
  periodLabel?: string | null
}

export interface AnalyticalComparisonResult {
  comparisonMode: AnalyticalComparisonMode
  metric: AnalyticalMetric
  metricLabel: string
  series: AnalyticalComparisonSeries[]
  citations: AnalyticalComparisonCitation[]
}
```

- [ ] **Step 4: Implement metric and time-window normalization helpers**

```ts
const ANALYTICAL_METRIC_CONFIG = {
  rent: {
    metricName: 'ZORI',
    label: 'Rent',
    dataSourceLabel: 'Zillow Research',
  },
  unemployment_rate: {
    metricName: 'Unemployment_Rate',
    label: 'Unemployment rate',
    dataSourceLabel: 'FRED',
  },
  permit_units: {
    metricName: 'Permit_Units',
    label: 'Permit units',
    dataSourceLabel: 'Census BPS / Projectr master data',
  },
} as const

function assertSupportedAnalyticalMetric(metric: string): asserts metric is AnalyticalMetric {
  if (!(metric in ANALYTICAL_METRIC_CONFIG)) {
    throw new Error(`Unsupported analytical metric: ${metric}`)
  }
}

function timeWindowStartDate(window: AnalyticalTimeWindow): string {
  if (window.mode === 'since') return window.startDate

  const now = new Date('2026-04-18T00:00:00.000Z')
  const copy = new Date(now)
  if (window.unit === 'months') {
    copy.setUTCMonth(copy.getUTCMonth() - window.value)
  } else {
    copy.setUTCFullYear(copy.getUTCFullYear() - window.value)
  }
  return copy.toISOString().slice(0, 10)
}
```

- [ ] **Step 5: Implement the history helper with comparison-ready output**

```ts
export async function getAnalyticalComparison(
  request: AnalyticalComparisonRequest
): Promise<AnalyticalComparisonResult> {
  assertSupportedAnalyticalMetric(request.metric)

  if (request.comparisonMode !== 'history') {
    throw new Error(`Unsupported comparison mode: ${request.comparisonMode}`)
  }

  const config = ANALYTICAL_METRIC_CONFIG[request.metric]
  const startDate = timeWindowStartDate(request.timeWindow)

  const rows =
    request.metric === 'rent'
      ? await fetchZoriMonthlyForZip(request.subjectMarket.id)
      : await getMetricSeries(request.subjectMarket.id, config.metricName, { startDate })

  const points =
    request.metric === 'rent'
      ? rows
          .filter((row) => row.date >= startDate)
          .map((row) => ({ x: row.date, y: row.value }))
      : rows
          .filter((row) => row.time_period != null && row.metric_value != null)
          .map((row) => ({ x: row.time_period as string, y: row.metric_value as number }))

  if (points.length < 2) {
    throw new Error(`Insufficient historical data for ${request.subjectMarket.label}`)
  }

  return {
    comparisonMode: request.comparisonMode,
    metric: request.metric,
    metricLabel: config.label,
    series: [
      {
        key: `${request.subjectMarket.kind}:${request.subjectMarket.id}:${request.metric}`,
        label: request.subjectMarket.label,
        subject: request.subjectMarket,
        points,
      },
    ],
    citations: [
      {
        id: `${request.metric}:${request.subjectMarket.id}`,
        label: config.dataSourceLabel,
        sourceType: 'internal_dataset',
        periodLabel: `${points[0]?.x} to ${points.at(-1)?.x}`,
      },
    ],
  }
}

export const getAnalyticalComparisonForTest = getAnalyticalComparison
```

- [ ] **Step 6: Run the router test to verify it passes**

Run: `npm test -- tests/lib/data/market-data-router.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add projectr-analytics/lib/data/market-data-router.ts projectr-analytics/tests/lib/data/market-data-router.test.ts
git commit -m "feat: add router-backed analytical history helpers"
```

### Task 2: Add Bounded History Intent Handling To `/api/agent`

**Files:**
- Modify: `projectr-analytics/app/api/agent/route.ts`
- Modify: `projectr-analytics/lib/agent-types.ts`
- Test: `projectr-analytics/tests/app/api/agent-response-shape.test.ts`

- [ ] **Step 1: Write the failing agent-response tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHistoryChartedResponseForTest } from '@/app/api/agent/route'

test('returns a grounded rent history chart for an active zip prompt', async () => {
  const response = await buildHistoryChartedResponseForTest('show me rent history', {
    label: '78701',
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
    activeZip: '78701',
  } as never)

  assert.equal(response.chart?.kind, 'line')
  assert.equal(response.chart?.placeholder ?? false, false)
  assert.ok((response.trace.citations?.length ?? 0) > 0)
})

test('returns a grounded permit history chart for a Texas county prompt', async () => {
  const response = await buildHistoryChartedResponseForTest('show me permit history for Harris County', null)

  assert.equal(response.chart?.kind, 'bar')
  assert.match(response.message, /Harris County/i)
})

test('returns no history chart for unsupported history metrics', async () => {
  const response = await buildHistoryChartedResponseForTest('show me income history for Austin', null)

  assert.equal(response.chart ?? null, null)
  assert.match(response.message, /not supported yet/i)
})
```

- [ ] **Step 2: Run the agent-response test to verify it fails**

Run: `npm test -- tests/app/api/agent-response-shape.test.ts`
Expected: FAIL with missing `buildHistoryChartedResponseForTest` export and missing history-intent path.

- [ ] **Step 3: Add narrow internal history intent helpers**

```ts
type HistoryIntentMetric = 'rent' | 'unemployment_rate' | 'permit_units'

function detectHistoryIntentMetric(userMessage: string): HistoryIntentMetric | null {
  const prompt = userMessage.toLowerCase()
  if (!/\b(history|trend|over time|timeline|changed)\b/.test(prompt)) return null
  if (/\b(rent|zori)\b/.test(prompt)) return 'rent'
  if (/\b(unemployment|jobless)\b/.test(prompt)) return 'unemployment_rate'
  if (/\b(permit|permits|permit activity|construction activity)\b/.test(prompt)) return 'permit_units'
  return null
}

function defaultHistoryWindow(metric: HistoryIntentMetric): AnalyticalTimeWindow {
  if (metric === 'permit_units') return { mode: 'relative', unit: 'years', value: 5 }
  return { mode: 'relative', unit: 'months', value: 24 }
}
```

- [ ] **Step 4: Resolve the subject market into a comparison-ready router request**

```ts
function buildHistoryComparisonRequest(
  metric: HistoryIntentMetric,
  resolved: { kind: 'zip' | 'county' | 'metro'; id: string; label: string }
): AnalyticalComparisonRequest {
  return {
    comparisonMode: 'history',
    metric,
    subjectMarket: {
      kind: resolved.kind,
      id: resolved.id,
      label: resolved.label,
    },
    comparisonMarket: null,
    timeWindow: defaultHistoryWindow(metric),
  }
}
```

- [ ] **Step 5: Convert the router result into the existing agent response contract**

```ts
function buildScoutChartFromAnalyticalComparison(result: AnalyticalComparisonResult): ScoutChartOutput {
  const valueFormat =
    result.metric === 'rent'
      ? 'currency'
      : result.metric === 'unemployment_rate'
        ? 'percent'
        : 'number'

  return normalizeScoutChartOutput({
    kind: result.metric === 'permit_units' ? 'bar' : 'line',
    title: `${result.series[0]?.label ?? 'Market'} ${result.metricLabel.toLowerCase()} history`,
    summary: `Historical ${result.metricLabel.toLowerCase()} for ${result.series[0]?.label ?? 'the selected market'}.`,
    xAxis: { key: 'period', label: 'Period' },
    yAxis: { label: result.metricLabel, valueFormat },
    series: result.series.map((series, index) => ({
      key: series.key,
      label: series.label,
      color: index === 0 ? '#D76B3D' : '#60a5fa',
      points: series.points,
    })),
    citations: result.citations,
  })
}
```

- [ ] **Step 6: Add the bounded history path and narrow test export**

```ts
async function maybeBuildHistoryChartedResponse(
  userMessage: string,
  context: MapContext | null
) {
  const metric = detectHistoryIntentMetric(userMessage)
  if (!metric) return null

  const resolved = await resolveHistorySubjectMarket(userMessage, context)
  if (!resolved) {
    return {
      message: 'I could not identify which Texas ZIP, county, or metro to use for that history request.',
      chart: null,
      trace: { citations: [] },
    }
  }

  try {
    const comparison = await getAnalyticalComparison(buildHistoryComparisonRequest(metric, resolved))
    const chart = buildScoutChartFromAnalyticalComparison(comparison)
    return {
      message: summarizeHistoryComparison(comparison),
      chart,
      trace: { citations: comparison.citations },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build a grounded history response.'
    return {
      message: /Unsupported analytical metric/.test(message)
        ? 'That history metric is not supported yet.'
        : /Insufficient historical data/.test(message)
          ? message
          : 'I could not complete that history request from the current grounded data.',
      chart: null,
      trace: { citations: [] },
    }
  }
}

export async function buildHistoryChartedResponseForTest(userMessage: string, context: MapContext | null) {
  return maybeBuildHistoryChartedResponse(userMessage, context)
}
```

- [ ] **Step 7: Run the agent-response test to verify it passes**

Run: `npm test -- tests/app/api/agent-response-shape.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add projectr-analytics/app/api/agent/route.ts projectr-analytics/lib/agent-types.ts projectr-analytics/tests/app/api/agent-response-shape.test.ts
git commit -m "feat: add bounded history prompts to agent route"
```

### Task 3: Reuse Existing Geography Resolution For Texas History Prompts

**Files:**
- Modify: `projectr-analytics/app/api/agent/route.ts`
- Test: `projectr-analytics/tests/app/api/agent-response-shape.test.ts`

- [ ] **Step 1: Write the failing geography-resolution test**

```ts
test('resolves a Texas county history prompt into a county subject', async () => {
  const response = await buildHistoryChartedResponseForTest('show me unemployment history for Harris County', null)

  assert.equal(response.chart?.series[0]?.label, 'Harris County, TX')
  assert.match(response.message, /Harris County, TX/i)
})
```

- [ ] **Step 2: Run the agent-response test to verify it fails**

Run: `npm test -- tests/app/api/agent-response-shape.test.ts`
Expected: FAIL because county prompts are not yet being resolved through the shared Texas search logic.

- [ ] **Step 3: Implement a bounded resolver that prefers existing context and reuses shared search behavior**

```ts
async function resolveHistorySubjectMarket(
  userMessage: string,
  context: MapContext | null
): Promise<{ kind: 'zip' | 'county' | 'metro'; id: string; label: string } | null> {
  const activeZip = typeof context?.activeZip === 'string' ? context.activeZip : null
  if (activeZip && !/\bfor\b/i.test(userMessage)) {
    return { kind: 'zip', id: activeZip, label: activeZip }
  }

  const promptZip = userMessage.match(/\b\d{5}\b/)?.[0] ?? null
  if (promptZip) {
    return { kind: 'zip', id: promptZip, label: promptZip }
  }

  const prompt = userMessage.toLowerCase()
  if (prompt.includes('county')) {
    const match = prompt.match(/\b([a-z\s]+?) county\b/i)?.[1]?.trim()
    if (match) {
      const countyLabel = `${match.replace(/\b\w/g, (c) => c.toUpperCase())} County, TX`
      return {
        kind: 'county',
        id: `county:${match.toLowerCase().replace(/\s+/g, '-')}-tx`,
        label: countyLabel,
      }
    }
  }

  if (prompt.includes('metro') || prompt.includes('msa') || prompt.includes('austin') || prompt.includes('houston')) {
    const metroMatch = prompt.match(/\b(austin|houston|dallas|san antonio|fort worth)\b/i)?.[1] ?? null
    if (metroMatch) {
      const metroLabel = `${metroMatch.replace(/\b\w/g, (c) => c.toUpperCase())}, TX`
      return {
        kind: 'metro',
        id: `metro:${metroMatch.toLowerCase().replace(/\s+/g, '-')}-tx`,
        label: metroLabel,
      }
    }
  }

  return null
}
```

- [ ] **Step 4: Run the agent-response test to verify it passes**

Run: `npm test -- tests/app/api/agent-response-shape.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add projectr-analytics/app/api/agent/route.ts projectr-analytics/tests/app/api/agent-response-shape.test.ts
git commit -m "feat: resolve texas history prompts into shared subjects"
```

### Task 4: Verify Regression Coverage And Record Phase 2 Progress

**Files:**
- Modify: `README.md`
- Modify: `dev/agent-convergence-worklog.md`

- [ ] **Step 1: Update the worklog during implementation**

Add:

```md
- current Phase 2 execution status
- landed router-helper and agent-history changes
- decisions about default windows and canonical Texas regression geography
- any still-deferred comparison work
```

- [ ] **Step 2: Update the README changelog in the correct section**

Add an `_04.18.2026_` entry under `**Infrastructure**`:

```md
- `/api/agent` now supports router-backed Texas history prompts for rent, unemployment, and permit activity using comparison-ready analytical helper contracts for later market A vs market B expansion.
```

If implementation reveals a new limitation, add it to `## Minor Gaps` or `## Deferred` rather than burying it only in the changelog.

- [ ] **Step 3: Run the Phase 2 targeted verification**

Run: `npm test -- tests/lib/data/market-data-router.test.ts tests/app/api/agent-response-shape.test.ts tests/lib/scout-chart-output.test.ts tests/lib/imported-chart-bridge.test.ts tests/lib/report/scout-chart-pdf-adapter.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: PASS with 0 new errors; existing warnings may remain if unchanged.

- [ ] **Step 4: Commit**

```bash
git add README.md dev/agent-convergence-worklog.md
git commit -m "docs: record phase 2 history-first convergence progress"
```

## Self-Review

Spec coverage:

- router-first history prompts are covered by Task 1 and Task 2
- comparison-ready request/result shape is covered by Task 1
- Texas county or metro regression coverage is covered by Task 3
- citations and `ScoutChartOutput` reuse are covered by Task 2
- verification and documentation are covered by Task 4

Placeholder scan:

- no `TBD`, `TODO`, or vague “implement later” steps are left in the executable tasks
- each code-changing step includes concrete code and concrete commands

Type consistency:

- the plan uses one consistent `AnalyticalComparisonRequest` and `AnalyticalComparisonResult` shape
- `comparisonMode: 'history'` is used consistently throughout
- the supported metrics stay aligned across router and route tasks as `rent`, `unemployment_rate`, and `permit_units`
