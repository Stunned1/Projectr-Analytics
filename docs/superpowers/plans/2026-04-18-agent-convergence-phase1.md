# Agent Convergence Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared chart and citation contract, make `/api/agent` emit charted analytical responses, render those charts in the live assistant UI, and bridge one existing chart surface onto the same contract.

**Architecture:** Extend the current bounded `/api/agent` contract instead of adding a parallel route, introduce a repo-native `ScoutChartOutput` schema in `lib`, render it through a reusable `recharts` component in app surfaces, and keep PDF export unchanged for now. Use backward-compatible optional fields so the existing streamed assistant flow and persisted session behavior continue to work while Phase 1 lands.

**Tech Stack:** Next.js App Router, TypeScript, React 19, `recharts`, Node `tsx --test`

---

### Task 1: Define The Shared Chart And Citation Contract

**Files:**
- Create: `projectr-analytics/lib/scout-chart-output.ts`
- Modify: `projectr-analytics/lib/agent-types.ts`
- Test: `projectr-analytics/tests/lib/scout-chart-output.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isScoutChartOutput,
  normalizeScoutChartOutput,
  type ScoutChartOutput,
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
  assert.equal(normalized.citations.length, 1)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/scout-chart-output.test.ts`
Expected: FAIL with import or symbol errors because `scout-chart-output.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ScoutCitationSourceType =
  | 'internal_dataset'
  | 'public_dataset'
  | 'workspace_upload'
  | 'derived'
  | 'placeholder'

export interface ScoutChartCitation {
  id: string
  label: string
  sourceType: ScoutCitationSourceType
  scope?: string | null
  note?: string | null
  periodLabel?: string | null
  placeholder?: boolean
}

export interface ScoutChartPoint {
  x: string
  y: number
}

export interface ScoutChartSeries {
  key: string
  label: string
  color?: string | null
  points: ScoutChartPoint[]
}

export interface ScoutChartOutput {
  kind: 'line' | 'bar'
  title: string
  subtitle?: string | null
  summary?: string | null
  placeholder?: boolean
  confidenceLabel?: string | null
  xAxis: { key: string; label: string }
  yAxis: { label: string; valueFormat?: 'number' | 'currency' | 'percent' | 'index' }
  series: ScoutChartSeries[]
  citations: ScoutChartCitation[]
}

export function isScoutChartOutput(value: unknown): value is ScoutChartOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const chart = value as Partial<ScoutChartOutput>
  return (
    (chart.kind === 'line' || chart.kind === 'bar') &&
    typeof chart.title === 'string' &&
    Boolean(chart.xAxis && typeof chart.xAxis.key === 'string' && typeof chart.xAxis.label === 'string') &&
    Boolean(chart.yAxis && typeof chart.yAxis.label === 'string') &&
    Array.isArray(chart.series) &&
    Array.isArray(chart.citations)
  )
}

export function normalizeScoutChartOutput(input: ScoutChartOutput): ScoutChartOutput {
  return {
    ...input,
    subtitle: input.subtitle ?? null,
    summary: input.summary ?? null,
    placeholder: input.placeholder === true,
    confidenceLabel: input.confidenceLabel ?? null,
    citations: input.citations.map((citation) => ({
      ...citation,
      scope: citation.scope ?? null,
      note: citation.note ?? null,
      periodLabel: citation.periodLabel ?? null,
      placeholder: citation.placeholder === true,
    })),
    series: input.series.map((series) => ({
      ...series,
      color: series.color ?? null,
    })),
  }
}
```

- [ ] **Step 4: Extend the agent types minimally**

```ts
import type { ScoutChartCitation, ScoutChartOutput } from '@/lib/scout-chart-output'

export interface AgentTrace {
  // existing fields...
  citations?: ScoutChartCitation[]
}

export interface AgentMessage {
  // existing fields...
  chart?: ScoutChartOutput
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/scout-chart-output.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add projectr-analytics/lib/scout-chart-output.ts projectr-analytics/lib/agent-types.ts projectr-analytics/tests/lib/scout-chart-output.test.ts
git commit -m "feat: add scout chart and citation contract"
```

### Task 2: Emit Chart Output From The Agent Contract

**Files:**
- Modify: `projectr-analytics/app/api/agent/route.ts`
- Modify: `projectr-analytics/lib/agent-types.ts`
- Test: `projectr-analytics/tests/app/api/agent-response-shape.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFallbackChartedResponseForTest } from '@/app/api/agent/route'

test('returns a chart payload for a supported analytical prompt', () => {
  const out = buildFallbackChartedResponseForTest('show the rent trend', {
    label: 'Austin, TX',
    eda: { focus: 'market', market: null, uploadedDatasets: [], uploadedDatasetCount: 0, geographyLabel: 'Austin, TX', activeMetric: 'zori', activeLayerKeys: [], notes: [] },
  })

  assert.equal(out.chart?.kind, 'line')
  assert.ok(out.trace.citations?.length)
})

test('keeps chart output optional for unsupported prompts', () => {
  const out = buildFallbackChartedResponseForTest('summarize the dataset', null)
  assert.equal(out.chart ?? null, null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/app/api/agent-response-shape.test.ts`
Expected: FAIL because the helper does not exist and the response has no chart field yet.

- [ ] **Step 3: Write minimal implementation**

```ts
function maybeBuildFallbackChart(userMessage: string, context: MapContext | null): ScoutChartOutput | null {
  const prompt = userMessage.toLowerCase()
  const wantsTrend = /\b(trend|over time|history|timeline)\b/.test(prompt)
  if (!wantsTrend) return null

  const label = context?.label ?? context?.eda?.geographyLabel ?? 'Current market'
  const series = [
    { x: 'Start', y: 100 },
    { x: 'Mid', y: 104 },
    { x: 'Latest', y: 108 },
  ]

  return normalizeScoutChartOutput({
    kind: 'line',
    title: `${label} rent trend`,
    subtitle: 'Phase 1 chart contract demo',
    summary: 'Temporary chart payload used to validate the shared analytical rendering path.',
    placeholder: true,
    confidenceLabel: 'placeholder data',
    xAxis: { key: 'period', label: 'Period' },
    yAxis: { label: 'Indexed rent', valueFormat: 'index' },
    series: [{ key: 'rent_index', label: 'Rent index', color: '#D76B3D', points: series }],
    citations: [
      {
        id: 'phase1-placeholder-series',
        label: 'Phase 1 placeholder series',
        sourceType: 'placeholder',
        note: 'Replace with router-backed historical series during later convergence tasks.',
        placeholder: true,
      },
    ],
  })
}

function attachTraceCitations(trace: AgentTrace, chart: ScoutChartOutput | null): AgentTrace {
  if (!chart || chart.citations.length === 0) return trace
  return {
    ...trace,
    citations: chart.citations,
  }
}
```

- [ ] **Step 4: Return the optional chart in the agent pipeline**

```ts
const chart = maybeBuildFallbackChart(userMessage, context)

return {
  message: parsed.message?.trim() || fallback.message,
  action: { type: 'none' as const },
  trace: attachTraceCitations(mergeTrace(normalized, fallback.trace), chart),
  chart,
}
```

- [ ] **Step 5: Export a narrow test helper instead of testing the whole route**

```ts
export function buildFallbackChartedResponseForTest(userMessage: string, context: MapContext | null) {
  const fallback = buildFallbackEdaResponse(userMessage, context)
  const chart = maybeBuildFallbackChart(userMessage, context)
  return {
    message: fallback.message,
    trace: attachTraceCitations(fallback.trace, chart),
    chart,
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/app/api/agent-response-shape.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add projectr-analytics/app/api/agent/route.ts projectr-analytics/lib/agent-types.ts projectr-analytics/tests/app/api/agent-response-shape.test.ts
git commit -m "feat: add charted agent response contract"
```

### Task 3: Render Shared Charts In The Assistant UI And Bridge Imported Data

**Files:**
- Create: `projectr-analytics/components/ScoutChartCard.tsx`
- Modify: `projectr-analytics/lib/use-agent-intelligence.ts`
- Modify: `projectr-analytics/components/AgentTerminal.tsx`
- Modify: `projectr-analytics/lib/client-upload-presentation.ts`
- Modify: `projectr-analytics/components/ImportedDataPanel.tsx`
- Test: `projectr-analytics/tests/lib/imported-chart-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { toScoutChartOutputFromImportedChart } from '@/lib/client-upload-presentation'

test('bridges imported line charts into ScoutChartOutput', () => {
  const chart = toScoutChartOutputFromImportedChart({
    kind: 'line',
    title: 'Rent trend',
    points: [
      { label: '2026-01', value: 100 },
      { label: '2026-02', value: 101 },
    ],
  })

  assert.equal(chart?.kind, 'line')
  assert.equal(chart?.series[0]?.points.length, 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/imported-chart-bridge.test.ts`
Expected: FAIL because the bridge function does not exist.

- [ ] **Step 3: Write minimal bridge implementation**

```ts
import { normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'

export function toScoutChartOutputFromImportedChart(model: ImportedChartModel | null): ScoutChartOutput | null {
  if (!model) return null

  return normalizeScoutChartOutput({
    kind: model.kind,
    title: model.title,
    subtitle: 'Imported dataset preview',
    summary: 'Converted from the imported-data fallback chart model.',
    xAxis: { key: 'label', label: model.kind === 'line' ? 'Period' : 'Category' },
    yAxis: { label: 'Value', valueFormat: 'number' },
    series: [
      {
        key: 'primary',
        label: model.title,
        points: model.points.map((point) => ({ x: point.label, y: point.value })),
      },
    ],
    citations: [
      {
        id: 'imported-dataset-session',
        label: 'Imported dataset session',
        sourceType: 'workspace_upload',
        note: 'Derived from the active imported dataset preview in the current browser session.',
      },
    ],
  })
}
```

- [ ] **Step 4: Add a reusable chart card and use it in both surfaces**

```tsx
export function ScoutChartCard({ chart }: { chart: ScoutChartOutput }) {
  return <div>{/* title, summary, Recharts chart, citation footer */}</div>
}
```

Use it in:

```tsx
{msg.chart ? <ScoutChartCard chart={msg.chart} /> : null}
```

and:

```tsx
const scoutChart = toScoutChartOutputFromImportedChart(chartModel)
{activeView === 'chart' && scoutChart ? <ScoutChartCard chart={scoutChart} /> : null}
```

- [ ] **Step 5: Propagate the optional chart field through the assistant client hook**

```ts
type AgentResponse = {
  message: string
  action?: AgentAction
  steps?: AgentStep[]
  insight?: string | null
  trace?: AgentTrace
  chart?: ScoutChartOutput
}
```

and persist it into `AgentMessage`.

- [ ] **Step 6: Run targeted tests to verify they pass**

Run: `npm test -- tests/lib/imported-chart-bridge.test.ts`
Expected: PASS

Run: `npm test -- tests/lib/scout-chart-output.test.ts tests/app/api/agent-response-shape.test.ts tests/lib/imported-chart-bridge.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add projectr-analytics/components/ScoutChartCard.tsx projectr-analytics/lib/use-agent-intelligence.ts projectr-analytics/components/AgentTerminal.tsx projectr-analytics/lib/client-upload-presentation.ts projectr-analytics/components/ImportedDataPanel.tsx projectr-analytics/tests/lib/imported-chart-bridge.test.ts
git commit -m "feat: render shared scout charts in agent ui"
```

### Task 4: Update Documentation And Tracking

**Files:**
- Modify: `README.md`
- Modify: `dev/agent-convergence-worklog.md`

- [ ] **Step 1: Update the convergence worklog during implementation**

Add:

```md
- current task status
- landed changes
- design decisions made during implementation
- any placeholder-related concerns
```

- [ ] **Step 2: Update README changelog in the correct section**

Add an `_04.18.2026_` entry under:

```md
**Infrastructure**
- Added the Phase 1 Scout chart/citation contract and extended `/api/agent` plus the live assistant UI to support structured chart output.

**UI**
- Added shared analytical chart rendering in the assistant flow and bridged imported-data chart previews onto the same contract.
```

- [ ] **Step 3: Run final verification commands**

Run: `npm test -- tests/lib/scout-chart-output.test.ts tests/app/api/agent-response-shape.test.ts tests/lib/imported-chart-bridge.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: PASS or report real failures before claiming success.

- [ ] **Step 4: Commit**

```bash
git add README.md dev/agent-convergence-worklog.md
git commit -m "docs: record phase 1 agent convergence progress"
```
