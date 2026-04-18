# Agent Convergence Design

> Scope: converge the existing Scout repository toward the multi-phase agentic workflow described in `dev/agent-planning.md`, using the repository-aware constraints in `dev/agent-logic-convergence-plan.md`.

## Summary

Scout should not implement the planning document as a greenfield rebuild. The repository already has a bounded Gemini EDA assistant, streamed `/api/agent` responses, imported-data chart rendering, React PDF export, a market-data router, and a Google Maps plus deck.gl shell. The correct design is to converge those existing systems into a single cited analytical workflow, starting with a Phase 1 vertical slice that adds a shared chart-and-citation contract and makes `/api/agent` able to emit structured chart output.

## Goals

- Keep `/api/agent` as the single analyst-facing assistant backend entrypoint.
- Preserve the current split between bounded EDA behavior and explicit map-control behavior.
- Introduce one shared analytical visualization contract that can drive live UI rendering first and PDF/export surfaces later.
- Add structured citations to analytical outputs without breaking the current terminal and Notes flow.
- Allow placeholder data where necessary during Phase 1 integration, but never present placeholders as grounded facts.
- Track the full multi-phase convergence process in a worktree-local worklog that is updated with every related change.

## Non-Goals

- Replacing the current assistant with a separate open-ended orchestration system.
- Introducing a second export stack beside React PDF during Phase 1.
- Adding a second charting system beside the existing `recharts` dependency.
- Rebuilding the imported-data workflow from scratch.
- Blocking implementation on complete upstream data-source availability.

## Current Repository Baseline

The current repository already includes:

- A bounded Gemini EDA assistant and map-control routing in `projectr-analytics/app/api/agent/route.ts`.
- Agent trace and streaming consumption in `projectr-analytics/lib/use-agent-intelligence.ts`.
- Existing imported-data chart rendering in `projectr-analytics/components/ImportedDataPanel.tsx` and `projectr-analytics/lib/client-upload-presentation.ts`.
- Existing React PDF export in `projectr-analytics/app/api/report/pdf/route.tsx` and `projectr-analytics/lib/report/pdf-document.tsx`.
- `recharts` already installed in `projectr-analytics/package.json`.
- Google Maps plus deck.gl already integrated in the main app.

This means the planning work should extend current contracts and rendering paths rather than introduce parallel systems.

## Phase Structure

### Phase 1: Visualization Contract and Agent Chart Output

Phase 1 delivers the first end-to-end convergence slice:

- define a shared chart contract
- define a structured citation contract
- build a reusable chart renderer for app surfaces
- make `/api/agent` optionally emit chart output and citations
- render agent-produced charts in the client assistant UI
- adapt at least one existing chart surface to the shared contract

This phase is considered done when an analytical agent response can produce a rendered chart with visible citation/footer metadata in the live app.

### Phase 2: Data Pipeline and Router-First EDA Reads

Phase 2 should expand router-backed analytical reads and add any missing helper paths for historical comparisons, distributions, and similar EDA requests. The work must extend `market-data-router` rather than bypass it with direct BigQuery usage scattered across the codebase.

### Phase 3: Grounding and Validation

Phase 3 should add layered source grounding and validation on top of the stabilized internal evidence contract. Internal Projectr evidence should remain the primary source of truth. External grounding services should be additive and degradable, not hard dependencies for the main assistant path.

### Phase 4: Export and Comparison Polish

Phase 4 should expand comparison UX, export reuse, and cross-surface chart/citation consistency. React PDF remains the default export stack unless a concrete rendering limitation justifies a deliberate migration.

## Recommended Architecture

### Assistant Contract

`/api/agent` remains the single backend entrypoint. The analytical response contract should gain optional structured visualization output rather than creating a second route or agent mode. Direct map-control behavior remains separate, using the existing routing split.

Recommended response direction:

- existing `message`
- existing `trace`
- optional `chart`
- optional `citations`

The contract should remain backward-compatible so the current client can keep rendering text-only responses during the transition.

### Shared Chart Contract

Phase 1 should define a `ScoutChartOutput` type under `projectr-analytics/lib/` as the canonical analytical chart payload for assistant-driven charts and eventually other chart surfaces.

The payload should include:

- chart kind
- title
- subtitle
- x-axis descriptor
- y-axis descriptor
- series list
- optional summary line
- citation list
- placeholder and confidence markers
- render hints that are safe for both app and export surfaces

This is a standardization task first. It should normalize existing chart-producing pathways rather than introduce new bespoke chart shapes for each feature.

### Citation Contract

Phase 1 also needs a minimal citation object that the UI can render without a major redesign. That citation object should support:

- source label
- source type
- metric or claim scope
- provenance note
- optional freshness or period label
- explicit placeholder flag

The key rule is that placeholders must be machine-visible in the contract and user-visible in the rendering layer where appropriate.

### Renderer Strategy

The app renderer should use `recharts`, since the dependency already exists and the imported-data surface is the closest current chart surface to the new contract. The initial renderer only needs to support the smallest useful set of chart kinds required for Phase 1, likely line and bar.

The PDF layer should not be fully migrated during Phase 1. Instead, the contract should be designed so React PDF adapters can consume it later in Phase 4 without requiring another schema rewrite.

## Placeholder Policy

Placeholder data is allowed during Phase 1 only when:

- it is necessary to finish the integration slice
- it is marked as placeholder in the data contract
- it is not presented as factual market evidence

Acceptable examples:

- synthetic series used to prove renderer wiring
- temporary citation rows marked as placeholder
- provisional agent chart payloads for prompts whose data connector is not yet ready

Unacceptable examples:

- synthetic numbers described as current market facts
- missing citations disguised as grounded evidence
- placeholder historical comparisons without a clear placeholder flag

## File Boundaries

Likely Phase 1 change areas:

- `projectr-analytics/lib/agent-types.ts`
- `projectr-analytics/app/api/agent/route.ts`
- `projectr-analytics/lib/use-agent-intelligence.ts`
- `projectr-analytics/components/ImportedDataPanel.tsx`
- `projectr-analytics/lib/client-upload-presentation.ts`
- new shared chart schema and renderer modules under `projectr-analytics/lib/` and `projectr-analytics/components/`

The work should keep responsibilities separated:

- schema and normalization in `lib`
- rendering in `components`
- response construction in `/api/agent`
- client consumption in the assistant hook/UI

## Design Decisions

1. Use additive convergence, not greenfield replacement.
2. Keep React PDF in place during Phase 1.
3. Use the existing `recharts` dependency as the standard app chart renderer.
4. Keep `/api/agent` as the single assistant backend integration point.
5. Permit placeholders only when explicitly flagged in both data and UI semantics.
6. Maintain a persistent worktree-local convergence worklog under `dev/`.

## Risks

- The imported-data panel currently uses a bespoke chart model and local SVG chart components, so Phase 1 needs a compatibility bridge instead of a forced rewrite.
- The current agent response contract has no structured citation or chart fields, so TypeScript changes must stay backward-compatible with persisted session and streamed UI behavior.
- The PDF layer currently consumes report-specific payloads, so Phase 1 should avoid prematurely forcing report export onto a half-designed chart schema.
- Some charted responses may need placeholder data until source availability is confirmed externally.

## Testing Direction

Phase 1 should add:

- type and normalization tests for the chart and citation contracts
- response-shape tests for `/api/agent`
- renderer tests for the initial supported chart types
- at least one integration path proving that the agent can emit a charted analytical response without breaking the existing streamed terminal flow

## Definition of Done

Phase 1 is done when:

- `/api/agent` can return a structured chart payload plus citations for at least one bounded analytical request
- the client assistant surface can render that chart
- citation/footer data is visible with the chart
- at least one existing non-agent chart path has been mapped or bridged onto the shared contract
- the convergence worklog reflects the current state and open concerns

## Implementation Recommendation

Start with the minimum viable schema and renderer that can support one agent-generated line chart and one existing imported-data chart path. Once the contract is proven in the live UI, expand it carefully instead of over-designing for every future chart case up front.
