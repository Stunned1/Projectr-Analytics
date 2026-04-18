# Agent Convergence Worklog

## Goal

Track the full multi-phase convergence effort described by `dev/agent-planning.md`, implemented in the context of the current Scout repository and refined by `dev/agent-logic-convergence-plan.md`.

## Phase Status

- Phase 1: Complete
- Phase 2: In progress
- Phase 3: Not started
- Phase 4: Not started

## Current Focus

- Extend the first Phase 2 slice from market-vs-own-history into bounded market A vs market B execution on the same analytical router contract.
- Keep legacy NYC-only route cleanup deferred unless it blocks shared infrastructure or a future verification gate we explicitly choose to enforce.
- Keep this worklog updated as each planning or implementation change lands.

## Completed

- Read `README.md`, `dev/agent-planning.md`, and `dev/agent-logic-convergence-plan.md`.
- Audited the current assistant, imported-data charting, and PDF export surfaces relevant to convergence.
- Confirmed that the repo already has Google Maps integration, `recharts`, imported-data chart rendering, and React PDF export.
- Confirmed that Phase 1 should be handled as a convergence effort rather than a net-new architecture build.
- Captured the approved design direction in `docs/superpowers/specs/2026-04-18-agent-convergence-design.md`.
- Wrote the implementation plan in `docs/superpowers/plans/2026-04-18-agent-convergence-phase1.md`.
- Added `projectr-analytics/lib/scout-chart-output.ts` as the shared chart and citation contract for Phase 1.
- Extended `projectr-analytics/app/api/agent/route.ts` so bounded analytical prompts can return an optional chart payload plus trace citations.
- Added `projectr-analytics/components/ScoutChartCard.tsx` and rendered chart output inside the live assistant terminal flow.
- Bridged imported-data chart previews onto the shared chart contract through `projectr-analytics/lib/client-upload-presentation.ts`.
- Added targeted Phase 1 tests for the chart contract, agent response shape, and imported-data bridge.
- Added the first router-backed chart path for active-ZIP unemployment or permit trend prompts in `/api/agent`, while leaving rent-trend prompts on the explicit placeholder path for now.
- Added a grounded rent-trend chart path in `/api/agent` that reuses the persisted Zillow monthly series helper for active ZIP prompts.
- Added `projectr-analytics/lib/report/scout-chart-pdf-adapter.ts` so the market report PDF now derives its rent, permit, and search-trends charts from the shared chart contract before rendering them through the existing React PDF chart components.
- Fixed a nullability mismatch in `projectr-analytics/app/api/metro-benchmark/route.ts` so build-time type checking no longer treats nullable router `submarket_id` values as guaranteed strings.
- Hardened `projectr-analytics/components/ScoutChartCard.tsx` against `recharts` formatter unions so the Phase 1 chart card now type-checks under the full production build.
- Tightened shared router helpers and write paths in `lib/data/postgres-master-data.ts`, `lib/data/bigquery-master-data.ts`, `lib/transformers.ts`, `lib/texas-source-adapters.ts`, and `lib/texas-source-fetchers.ts` so stricter operational row contracts no longer inherit `geometry: unknown` or mis-handle scalar-vs-array filter inputs.
- Changed `projectr-analytics/lib/supabase.ts` to lazy-create the client so `next build` no longer crashes during module evaluation when Supabase env vars are absent in the local build environment.
- Typed previously implicit Supabase payloads in `app/api/aggregate/route.ts` and `app/api/analyze/route.ts` so those routes no longer collapse query results to `never[]` during stricter build checks.
- Added comparison-ready history helpers in `projectr-analytics/lib/data/market-data-router.ts` so rent, unemployment rate, and permit-unit history requests now share one normalized analytical request/result contract.
- Extended `projectr-analytics/app/api/agent/route.ts` and `projectr-analytics/lib/agent-types.ts` so bounded history prompts can resolve a subject, call the router history helper, and return grounded charted responses with citations.
- Replaced the route-local Texas county / metro history parser shim with shared area-name normalization plus canonical Texas area keys, and added regression coverage for explicit Texas prompts, `in Texas` phrasing, trailing non-state words, and non-Texas rejection.
- Extended the shared analytical request path so `/api/agent` and `market-data-router` can execute bounded peer-market comparisons with multi-series chart output on the same contract used for history prompts.

## Remaining By Phase

### Phase 1

- Closed for the Texas-first scope: shared chart/citation contract, charted `/api/agent` responses, assistant rendering, imported-data bridge, and market-PDF adoption are implemented and verified by the targeted Phase 1 test suite plus lint.
- Deferred from Phase 1 closeout: unsupported trend prompts may still return explicit placeholder charts, and legacy NYC-only route type cleanup remains maintenance work unless a later phase or deployment gate requires it.

### Phase 2

- Expand router-first analytical reads for agent-facing EDA requests.
- Define missing comparison and historical-read helpers.
- Avoid direct BigQuery query sprawl outside `market-data-router`.
- First active slice: implement market-vs-own-history prompts now using comparison-ready request/result contracts so market A vs market B can be added later without rewriting the assistant boundary.
- Newly landed bounded peer slice: explicit ZIP-vs-ZIP rent comparisons and Texas county-vs-county permit comparisons now run on the same analytical contract.
- Next follow-up after this slice: broaden peer-market execution beyond explicit type-matched prompts without introducing a second route-local comparison path.

### Phase 3

- Add internal evidence normalization and citation completeness checks.
- Add optional external grounding adapters with graceful degradation.
- Add post-generation validation hooks where appropriate.

### Phase 4

- Reuse the shared analytical chart contract in export flows where it reduces duplication.
- Expand comparison-oriented rendering and export polish.
- Tighten cross-surface chart and citation consistency.

## Decisions

- The implementation will converge existing systems rather than build parallel replacements.
- `/api/agent` remains the single assistant backend entrypoint.
- `recharts` will be the Phase 1 standard app chart renderer.
- React PDF remains the export stack during Phase 1.
- Placeholder data is allowed only when explicitly flagged and never presented as grounded evidence.
- NYC borough-specific routes are maintenance-only for now and should only be cleaned up when they block the Texas MVP, shared contracts, or a build path we still need to keep green.
- Phase 2 begins with market-vs-own-history prompts, but helper interfaces must be comparison-ready so market A vs market B can land as a later slice instead of a redesign.
- This worklog must be updated whenever related planning or implementation work changes.

## Concerns

- The current imported-data chart path uses a local bespoke model and SVG components, so migration needs a compatibility bridge.
- The current agent contract and persisted UI flow must remain backward-compatible while chart and citation fields are introduced.
- Available external data sources may lag behind integration work, so some Phase 1 contract paths may need temporary placeholders.
- The current `/api/agent` chart payload is intentionally placeholder-backed for trend-style prompts; the next pass needs router-backed real series before the feature should be treated as analyst-ready evidence.
- `/api/agent` now has grounded rent and unemployment/permit chart paths for active ZIP prompts, but unsupported trend requests still use the explicit placeholder fallback when there is no wired historical source or not enough stored data.
- Full `next build` verification is still surfacing unrelated TypeScript issues elsewhere in the worktree, so Phase 1 cannot be called fully closed until the build baseline is clean or the remaining blockers are explicitly scoped out.
- The current remaining full-build blockers follow a repeated pattern in older API routes: untyped Supabase query payloads collapse to `never` under stricter checking, so more legacy routes may still need explicit local row types before the build baseline is fully clean.
- Because the product focus is now Texas-first, not every legacy NYC-only route should be treated as a mandatory convergence blocker if it does not affect shared Texas workflows or deployment-critical validation.
- The targeted PDF adapter test still hits sandbox `spawn EPERM` in this environment even though the other targeted Phase 2 test files pass, so release-level verification should rerun that test outside this sandbox before treating the full targeted suite as environment-clean.
- The current peer-market path is still intentionally narrow: it expects two explicit markets in the prompt and keeps comparisons to matching subject kinds instead of inferring peers automatically.

## Open Questions

- Which exact router helper boundary is the cleanest fit for history-first prompts: one generic comparison helper, or a thinner history helper plus a later comparison wrapper?
- What should the default history windows be for rent, unemployment, and permits when the user does not specify one?

## Change Log

### 2026-04-18

- Created the initial convergence design spec in `docs/superpowers/specs/2026-04-18-agent-convergence-design.md`.
- Created this multi-phase worklog and recorded the current baseline, decisions, and open concerns.
- Added the Phase 1 implementation plan in `docs/superpowers/plans/2026-04-18-agent-convergence-phase1.md` and began inline execution in this worktree.
- Implemented the first Phase 1 vertical slice: shared chart contract, optional charted `/api/agent` responses, assistant-terminal chart rendering, and imported-data chart bridging.
- Verified the targeted Phase 1 tests for the chart contract, agent response shape, and imported-data bridge after installing dependencies in this worktree.
- Added and verified the first real router-backed chart response in `/api/agent` for active-ZIP unemployment or permit trend prompts.
- Added and verified a grounded Zillow monthly rent-trend chart response in `/api/agent` for active-ZIP rent prompts.
- Added and verified a report-side shared-chart adapter so the market PDF chart inputs now flow through `ScoutChartOutput` before React PDF rendering.
- Fixed the `metro-benchmark` route to guard nullable router submarket IDs while working through full-build verification for Phase 1.
- Hardened the shared chart card, router adapters, Texas ingest write types, and lazy Supabase client while pushing `next build` verification forward into older route files.
- Typed aggregate and analyze-route Supabase payloads during the ongoing full-build cleanup, leaving `app/api/borough/route.ts` as the next identified blocker in the same legacy inference pattern.
- Recorded the Texas-first priority decision: borough cleanup is now deferred unless it blocks shared convergence work or a build path that still matters to the Texas MVP.
- Marked Phase 1 complete for the Texas-first scope after a fresh verification pass: 11 targeted Phase 1 tests passed and lint reported 0 errors with only existing warnings.
- Wrote the first Phase 2 design slice in `docs/superpowers/specs/2026-04-18-agent-convergence-phase2-history-design.md`, covering router-first history prompts now and comparison-ready contracts for later market A vs market B support.
- Replaced the route-local Texas county / metro history parser shim in `/api/agent` with shared area-name normalization and canonical Texas area keys, while keeping explicit non-Texas prompts rejected.
- Tightened `/api/agent` history parsing so explicit Texas prompts like `Harris County, TX` and `Austin metro area, TX` resolve to canonical shared keys and labels, while space-delimited non-Texas prompts like `Cook County Illinois` and `Miami metro area Florida` are rejected instead of being coerced to Texas.
- Verified the first Phase 2 slice with passing router, agent-response, chart-contract, and imported-chart-bridge tests plus lint with 0 errors; the remaining PDF adapter test still hits sandbox `spawn EPERM` and needs an unsandboxed rerun for a fully clean targeted verification set.
- Added bounded peer-market execution on top of the same analytical contract, with passing router and agent-response tests for ZIP-vs-ZIP rent comparisons and Texas county-vs-county permit comparisons.
