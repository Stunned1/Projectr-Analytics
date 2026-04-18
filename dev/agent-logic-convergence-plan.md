# Scout Agent Logic Convergence Plan

## Purpose

This document reframes the Phase 2 agentic workflow work as a convergence effort against the current Scout repository, not a greenfield architecture build. The repository already contains a bounded Gemini EDA assistant, a direct map-control lane, a hot/warm/cold market-data router, upload normalization, imported-data chart views, and React PDF export. The goal is to unify those existing systems into one cited, analyst-facing workflow without duplicating stacks or regressing the current UX.

## Current Repository Baseline

### Existing capabilities already in repo

- A bounded Gemini EDA assistant with strict non-goals, deterministic fallbacks, and NDJSON streaming lives in `projectr-analytics/app/api/agent/route.ts`.
- The client terminal already consumes streamed agent traces and step sequences in `projectr-analytics/lib/use-agent-intelligence.ts`.
- BigQuery-backed read helpers and a market-data router already exist in `projectr-analytics/lib/data/bigquery-master-data.ts` and `projectr-analytics/lib/data/market-data-router.ts`.
- CSV/XLSX uploads already parse, classify, normalize, geocode, and optionally persist via `projectr-analytics/app/api/normalize/route.ts`.
- Imported datasets already render chart/table/map-oriented views in `projectr-analytics/components/ImportedDataPanel.tsx`.
- PDF market export already exists with React PDF in `projectr-analytics/app/api/report/pdf/route.tsx`.
- The app already ships `recharts`, `@react-pdf/renderer`, and `@google-cloud/bigquery` in `projectr-analytics/package.json`.

### What this means

The plan should not introduce parallel agent, query, chart, or export systems unless there is a strong migration reason. Most work should extend and standardize existing pathways.

## Convergence Goals

- Keep Scout as a bounded analyst copilot, not an autonomous workflow engine.
- Preserve the current split between EDA reasoning and explicit map-control behavior.
- Make every quantitative claim traceable to source evidence.
- Reuse the market-data router as the canonical read path for historical and analytical data.
- Reuse the existing upload pipeline as the canonical landing zone for analyst-provided data.
- Standardize chart and export output so the same analytical payloads can drive on-screen views and exported deliverables.
- Add grounding and validation in layers, without forcing a full rewrite of the current assistant first.

## Non-Goals

- Replacing the bounded EDA assistant with a fully open-ended tool-calling agent.
- Building a second BigQuery query subsystem unrelated to `market-data-router`.
- Replacing React PDF with Puppeteer unless a concrete export limitation justifies migration.
- Replacing the existing Google Maps + deck.gl map shell.
- Expanding forecasting, autonomous site discovery, or recommendation workflows.

## Architecture Direction

### 1. Agent layer: converge, do not replace

Scout should continue to expose one analyst-facing assistant surface, but internally it should remain a routed system:

- `EDA lane`: bounded reasoning over workspace evidence and retrieved analytical data.
- `Direct action lane`: explicit navigation, layer toggles, panel focus, and other map-control requests.
- `Validation lane`: post-generation evidence checks and citation completeness checks before final output is returned.

The current `/api/agent` route is the correct integration point. The convergence work should expand the agent's evidence model and output schema rather than swap in a completely different orchestration model.

### 2. Data layer: market-data-router becomes the canonical analytical read interface

The BigQuery work already underway should be treated as the default analytical access layer for:

- latest market rows
- area-level reads
- historical metric series
- warm/cold routing between operational Postgres data and historical BigQuery data

New analytical tooling should call typed router functions instead of creating ad hoc BigQuery access from inside prompts or unrelated utility modules.

### 3. Upload layer: keep Supabase as operational landing zone, add async analytical sync

The current upload flow is optimized for immediate analyst feedback: parse, triage, normalize, preview, map, and persist. That should remain intact. If uploaded data also needs to power historical/queryable agent analysis, add an asynchronous sync path from operational storage into analytical storage rather than lengthening the request-response path in `/api/normalize`.

### 4. Visualization layer: standardize outputs over existing renderers

Scout already has multiple rendering surfaces:

- imported-data inline charts
- map overlays
- PDF report charts
- comparison/export flows

The convergence task is to define a shared analytical visualization payload, then adapt existing renderers to consume it where practical. This is a schema-standardization problem first, not a chart-library selection problem.

### 5. Export layer: extend existing PDF generation

The existing React PDF path should remain the default export mechanism unless specific rendering requirements prove it insufficient. The first convergence step is to feed it better structured chart/citation payloads, not to replace it with Puppeteer.

## Repository Change Areas

### Agent and evidence contract

Primary files:

- `projectr-analytics/app/api/agent/route.ts`
- `projectr-analytics/lib/agent-types.ts`
- `projectr-analytics/lib/agent-trace.ts`
- `projectr-analytics/lib/use-agent-intelligence.ts`
- `projectr-analytics/lib/eda-assistant.ts`

Expected changes:

- expand the agent response contract to include structured citations and source metadata
- preserve NDJSON streaming and current trace handling
- keep explicit map-control parsing separate from analytical reasoning
- add post-response validation hooks for citation completeness and evidence grounding

### Analytical data access

Primary files:

- `projectr-analytics/lib/data/market-data-router.ts`
- `projectr-analytics/lib/data/bigquery-master-data.ts`
- `projectr-analytics/lib/data/postgres-master-data.ts`
- `projectr-analytics/tests/lib/data/market-data-router.test.ts`

Expected changes:

- add agent-safe read helpers for common EDA intents
- avoid direct query scattering outside the router
- preserve warm/cold read behavior and typed normalization
- expand tests around citation-ready source descriptors and historical comparison reads

### Upload-to-analysis bridge

Primary files:

- `projectr-analytics/app/api/normalize/route.ts`
- `projectr-analytics/lib/upload/*`
- any new async sync/job module added under `projectr-analytics/lib/data/` or `projectr-analytics/scripts/`

Expected changes:

- keep synchronous upload UX intact
- introduce a deferred replication path for analytical indexing/storage
- track sync status separately from local preview/import success
- avoid making BigQuery availability a blocker for upload success

### Visualization and comparison output

Primary files:

- `projectr-analytics/components/ImportedDataPanel.tsx`
- `projectr-analytics/components/MarketReportExport.tsx`
- `projectr-analytics/lib/report/*`
- any new shared chart schema/types module

Expected changes:

- define a shared chart payload with explicit data source and citation fields
- map imported-data chart views and report charts onto that payload incrementally
- expand comparison views by reusing existing report/comparison concepts instead of inventing a separate subsystem

## Recommended Workstreams

### Workstream 1: Evidence and citation contract

Deliverables:

- add explicit citation objects to agent outputs
- define source descriptors for router reads, upload-derived evidence, and public-source grounding
- keep current message + trace shape backward-compatible where possible

Success criteria:

- the UI can render claims with source metadata
- analytical responses remain concise
- direct map-control behavior remains unchanged

### Workstream 2: Router-first analytical reads

Deliverables:

- expose EDA-oriented read helpers on top of `market-data-router`
- document which historical reads must come through BigQuery-backed paths
- remove incentives for new feature work to query BigQuery directly

Success criteria:

- historical comparison features use one typed path
- tests cover warm-window and cold-history behavior for agent use cases

### Workstream 3: Upload convergence

Deliverables:

- define operational-versus-analytical lifecycle for uploaded rows
- add background sync or replay mechanism for uploads that should appear in analytical search/query layers
- surface non-blocking sync state to the product if needed

Success criteria:

- uploads still return fast preview/map feedback
- analytical sync failures do not break import completion

### Workstream 4: Shared analytical rendering schema

Deliverables:

- define a chart payload that can drive both on-screen and export views
- adapt existing imported-data charts and report charts to the schema where it reduces duplication
- include citation fields directly in the payload contract

Success criteria:

- the same analytical result can drive UI charting and PDF export
- no second charting stack is introduced without necessity

### Workstream 5: Grounding integration

Deliverables:

- introduce grounding sources in an additive order: internal data evidence first, then external public grounding, then validation
- keep external services behind clear adapters
- treat experimental grounding services as optional augmentations, not hard runtime dependencies

Success criteria:

- Scout can cite internal and public claims distinctly
- upstream instability in experimental services degrades gracefully

## Phased Convergence Sequence

### Phase A: Normalize the contract

Focus:

- formalize agent citation/output schema
- formalize chart payload schema
- preserve current UX and route behavior

This phase should change interfaces before infrastructure.

### Phase B: Finish router convergence

Focus:

- make `market-data-router` the required read path for agent-facing analytical reads
- add any missing query helpers for comparisons, distributions, and historical series

This phase should eliminate duplicate data-access patterns.

### Phase C: Add upload replication

Focus:

- connect imported operational data to analytical storage/indexing asynchronously
- avoid slowing the current upload request path

This phase should improve analytical coverage without regressing import UX.

### Phase D: Add grounding and validation

Focus:

- internal evidence first
- public-source grounding second
- grounding validation third

This phase should improve credibility after the internal contract is stable.

### Phase E: Expand comparison and export polish

Focus:

- richer side-by-side comparison views
- stronger export formatting
- shared chart/citation rendering across app and PDF

This phase should build on the stabilized data and evidence contracts.

## Key Integration Risks

### Risk: duplicated agent architectures

If the team builds a new tool-calling agent beside the current `/api/agent` route, Scout will end up with two incompatible assistant contracts.

Mitigation:

- keep `/api/agent` as the single assistant backend entrypoint
- evolve internals behind that route

### Risk: duplicated BigQuery access patterns

If new features query BigQuery directly instead of extending `market-data-router`, analytical behavior will diverge and be harder to test.

Mitigation:

- require new analytical reads to land in router helpers
- review direct BigQuery imports as architectural exceptions

### Risk: upload latency regression

If BigQuery sync is added inline to `/api/normalize`, imports will become slower and more failure-prone.

Mitigation:

- separate analyst-facing import success from downstream analytical sync

### Risk: export stack fragmentation

If Puppeteer is introduced without replacing React PDF deliberately, the repo will carry two export systems.

Mitigation:

- prove a concrete React PDF limitation before adding a second export path

### Risk: external grounding instability

Experimental grounding services can introduce noisy failures or latency into an otherwise stable assistant flow.

Mitigation:

- keep external grounding adapters optional
- degrade back to internal evidence-only responses

## Definition of Done for Convergence

Scout can be considered converged when:

- the assistant still behaves like the current bounded EDA product surface
- every quantitative analytical response can expose source metadata
- historical reads flow through the router instead of scattered query code
- uploads remain fast and still support later analytical retrieval
- chart and PDF outputs share a common analytical payload model
- comparison workflows expand from the current report/export surface instead of introducing parallel UI systems

## Immediate Next Planning Questions

- What is the minimum citation object the current UI can render without a large redesign?
- Which EDA intents need new router helpers versus prompt-level reasoning over existing rows?
- What is the correct async replication mechanism for upload-derived analytical data in this repo?
- Which existing chart surfaces should be first adopters of a shared payload schema?
- Which external grounding service, if any, is mature enough to sit on the critical path?
