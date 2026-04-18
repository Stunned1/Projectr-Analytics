# Phase 2 History-First Convergence Design

## Goal

Implement the first bounded Phase 2 slice as a router-first historical analysis path for the existing `/api/agent` assistant. This slice should let the assistant answer Texas-first market-vs-own-history prompts with grounded charts, citations, and concise analytical text while keeping the internals ready for later market A vs market B comparisons.

## Scope

This slice adds historical analytical reads for a narrow, explicit set of metrics:

- rent history / trend
- unemployment history / trend
- permit activity history / trend

Supported geography entry points:

- active ZIP
- explicit ZIP in prompt
- active county or metro already loaded in the workspace
- explicit Texas county or metro phrasing that the current shared resolvers can already identify

Supported time-window behavior:

- default window when the prompt omits one
- simple prompt-derived windows such as `past 12 months`, `last 5 years`, or `since 2020`

Out of scope for this slice:

- direct market A vs market B execution
- Python EDA sidecar work
- freeform BigQuery query tooling
- new charting or export surfaces beyond the existing Phase 1 rendering path
- speculative or placeholder-backed historical claims presented as grounded evidence

## Product Behavior

The assistant should support prompts such as:

- `show me rent history for Harris County`
- `how has unemployment changed over time in 78701`
- `walk me through permit activity over the last few years in Austin`

When the metric, geography, and available data are supported, `/api/agent` should return:

- a concise analytical response in the existing assistant message shape
- a `ScoutChartOutput` payload suitable for the current Phase 1 chart renderer
- citation metadata describing the underlying data source(s)

When the request is unsupported or under-specified, the assistant should fail cleanly:

- unsupported metric: say the history view is not supported yet
- unresolved geography: explain that the market could not be identified
- insufficient data: explain that there is not enough stored history to support the claim

This slice should not fall back to synthetic placeholder history for unsupported analytical requests. The intent is to establish grounded router-backed analytical behavior rather than widen the placeholder surface.

## Architecture

Phase 2 should extend the existing convergence boundaries rather than introduce new systems:

- `/api/agent` remains the single assistant backend entrypoint
- `market-data-router` remains the canonical analytical read path
- `ScoutChartOutput` remains the canonical chart payload
- the current live assistant UI remains the chart consumer

The new logic should be split into three layers:

1. intent normalization in `/api/agent`
2. router-backed analytical read helpers in `lib/data/market-data-router.ts`
3. chart-and-text assembly using existing Phase 1 response contracts

This keeps prompt parsing, data access, and UI rendering as separate concerns.

## Comparison-Ready Request Shape

Although this slice only executes market-vs-own-history prompts, the internal helper interfaces should be designed around a comparison-ready request shape so future market A vs market B work does not require reworking the agent contract again.

Recommended normalized request fields:

- `subjectMarket`
- `comparisonMode`
- `metric`
- `timeWindow`
- `comparisonMarket`

Expected values:

- `comparisonMode: 'history'` for this slice
- `comparisonMode: 'peer_market'` reserved for later
- `comparisonMarket: null` for this slice unless a later implementation fills it

The router helper should return a comparison-ready result shape that already supports multiple series, even if the first implementation usually returns one primary historical series. That makes the later A-vs-B expansion mostly an additional resolver/input problem rather than a contract rewrite.

## Data Access Rules

All historical analytical reads must go through `market-data-router`.

The route should not:

- import BigQuery helpers directly
- build ad hoc SQL in `/api/agent`
- scatter historical retrieval logic across unrelated modules

Instead, the router layer should expose narrow agent-safe helpers such as:

- `getHistoricalMetricSeries(...)`
- `getAnalyticalComparison(...)`

The exact exported names can differ, but the responsibilities should remain:

- normalize metric ids into supported stored metrics
- select the correct warm/cold router path
- normalize time windows
- return source descriptors suitable for citation rendering
- return comparison-ready series objects, not just raw database rows

## Agent Integration

`/api/agent` should gain a bounded history-intent path that:

1. detects a supported historical-analysis prompt
2. resolves the geography through the existing shared ZIP/county/metro logic
3. normalizes the metric and time window
4. calls the router helper
5. converts the result into:
   - concise analytical text
   - `ScoutChartOutput`
   - trace and citation metadata

This should remain fully compatible with the current assistant behavior:

- direct map-control parsing still stays separate
- unsupported prompts should still land on the bounded EDA fallback behavior
- NDJSON streaming and current message persistence behavior should not be regressed

## File-Level Change Areas

Primary expected changes:

- `projectr-analytics/app/api/agent/route.ts`
- `projectr-analytics/lib/data/market-data-router.ts`
- `projectr-analytics/lib/agent-types.ts` if narrow metadata additions are needed
- router tests under `projectr-analytics/tests/lib/data/`
- agent response tests under `projectr-analytics/tests/app/api/`

Expected change type by file:

- `route.ts`
  - add history-intent normalization
  - call router-backed helper
  - return grounded charted response

- `market-data-router.ts`
  - add agent-safe historical helper(s)
  - normalize supported metrics and windows
  - emit citation/source descriptors with returned series

- tests
  - prove rent, unemployment, and permit history requests return grounded chart payloads
  - include at least one Texas county or metro case
  - preserve Phase 1 test coverage

## Error Handling

The assistant should distinguish among these failure classes:

- unsupported request
- unresolved geography
- insufficient historical coverage
- router or upstream read failure

Desired behavior:

- unsupported or unresolved requests return a bounded, user-facing explanation without pretending the analysis succeeded
- insufficient data returns a grounded explanation that names the missing history problem
- internal router failures return a safe assistant error response and preserve the existing non-crashing route behavior

The route should avoid ambiguous empty-chart responses. If there is not enough history to build a meaningful chart, it is better to return text-only grounded explanation than a misleading empty series.

## Testing

This slice should be considered implemented only if verification covers both router and agent layers.

Required tests:

- router helper tests for:
  - metric normalization
  - time-window normalization
  - ZIP and area-based history retrieval behavior
  - comparison-ready series result shape

- `/api/agent` tests for:
  - grounded rent history response
  - grounded unemployment history response
  - grounded permit history response
  - at least one Texas county or metro case
  - clean unsupported-request behavior

- regression verification:
  - existing Phase 1 chart contract tests
  - imported-data bridge tests
  - PDF chart adapter tests

Lint should still pass with no new errors.

## Definition of Done

This Phase 2 slice is done when:

- `/api/agent` supports bounded router-backed history prompts for rent, unemployment, and permits
- historical reads flow through `market-data-router`, not direct BigQuery code in the route
- responses include concise analytical text, `ScoutChartOutput`, and citation metadata
- the internal helper shape is comparison-ready for later market A vs market B work
- at least one Texas county or metro history case is covered in tests
- unsupported metrics or geographies fail cleanly without placeholder-backed masquerading

## Deferred Follow-Up

The next Phase 2 slice should build on this contract by enabling actual market A vs market B execution using the same normalized analytical request/result shapes. That future work should focus on:

- dual-geography resolution
- multi-series chart assembly
- bounded comparative reasoning over two grounded datasets

This slice deliberately prepares that path without implementing it yet.
