# Phase2 Deploy Judge Scope Design

Date: 2026-04-21
Branch target: `phase2-deploy`
Source branch: `phase2-demo`

## Goal

Prepare a judge-facing deployment that keeps the strongest capabilities shown in the recorded demo while reducing the chance that judges hit obviously brittle, misleading, or unfinished paths.

This deployment is not a production hardening pass. It is a curated public prototype optimized for judging. The app should still feel broad and exploratory, but its first-run experience and primary discovery paths should stay inside the most reliable product surface.

## Deployment Strategy

Recommended approach: broad but fenced.

This means:

- keep the core map/product experience live
- start every judge in a curated, known-good market state
- emphasize Texas-first workflows because that is the branch's strongest shared scope
- allow broader exploration when the existing code can support it
- remove or bury high-risk paths that can quickly undermine confidence

The deployment should avoid pretending the app is fully generalized when the codebase already contains explicit Texas-first, NYC-only, placeholder, and fallback-heavy restrictions.

## Product Scope

### Default experience

The deploy branch should open directly into Austin rather than a blank or search-only landing state.

Austin is the preferred first-run market because:

- it is already part of the warmed demo ZIP set
- it gives a visually rich map-centered first impression
- it supports the Texas-first framing of the product
- it keeps the initial flow aligned with what was already demonstrated in the recorded demo

### Primary supported scope

The primary supported judge-facing scope is:

- Texas ZIPs
- Texas cities
- Texas counties
- Texas metros

These should remain the intended exploration path after the default Austin landing state.

### Secondary scope

Non-Texas navigation should remain technically possible if the current code already supports it, but it should not be featured, advertised, or treated as equally reliable.

This avoids creating a hard product contradiction while still keeping the judge experience centered on the strongest coverage area.

### Specialized scope

NYC-specific parcel workflows and borough ranking workflows are specialized capabilities, not core product scope for the judge deployment. They may remain in code, but they should not be surfaced as a mainline capability in the deployed experience.

## Keep / Hide / Disable Matrix

### Keep prominent

These features should remain core to the judge deployment:

- map command center
- Austin default landing state
- Texas ZIP, city, county, and metro navigation
- right-side market data panel
- momentum and cycle outputs
- bounded terminal EDA flow
- report PDF generation
- stable Texas permit views already used in the recorded demo
- saved artifacts if session behavior remains predictable

### Keep but de-emphasize

These may remain available, but should not be primary first-run or top-priority discovery surfaces:

- upload workspace
- imported data panel
- Google Places context on uploaded pins
- transit overlays
- non-Texas search paths
- saved workspace as a secondary route rather than a hero feature

### Hide from primary discovery

These should remain non-primary and difficult to stumble into accidentally:

- NYC parcel workflow
- NYC borough spatial ranking workflow
- roadmap slash commands that are already marked as not wired yet
- placeholder or debug-like chart paths
- niche permit-source distinctions that require context to interpret

### Disable or cut for judge deploy

These should be removed from the judge-facing surface when practical:

- obvious entry points into NYC-only ranking flows
- visible placeholder analytical chart series
- UI hints that invite interaction with not-wired-yet commands
- any experimental surface known to fail unpredictably under cold use

Upload should be treated as conditional:

- keep it visible only if the team believes it can survive unscripted judge use
- otherwise retain the codepath but remove it from primary discovery

## Judge Deploy UX

### First load

The app should load directly into Austin with live map context and a populated data panel.

The judge should not need to guess what to search for or how to make the application look populated. The default view must feel complete and intentional on arrival.

### Navigation

Primary navigation should stay narrow:

- Map
- Saved
- Upload only if it is stable enough for cold-use exposure

The deploy branch should not expose niche or experimental flows as peer-level navigation choices.

### Terminal behavior

The terminal should stay in the product because it is part of the branch's value, but it must remain clearly bounded in behavior.

The deploy version should:

- keep direct map-control prompts
- keep bounded EDA prompts
- avoid starter suggestions that invite unsupported or edge-case actions
- steer prompt suggestions toward Texas market workflows

The terminal should not present itself as a broad autonomous agent. It should feel like an analyst assistant attached to the loaded market context.

## Curated Austin Default

The default Austin state should be selected using a warmed or already-demonstrated market from the current branch. If multiple Austin candidates exist, the chosen default should satisfy all of the following:

- reliable market data load
- visually meaningful map state
- stable right-panel metrics
- stable terminal context
- stable PDF generation

If Austin proves weaker than another warmed Texas market during verification, the team may substitute another Texas market while preserving the same Texas-first deploy philosophy.

## Risks

### High-risk areas

- Austin-specific permit/history caveats appearing during casual use
- upload normalization and geocoding edge cases
- placeholder historical series or modeled fallbacks appearing as if they were complete analytical outputs
- unsupported terminal prompts producing confusing responses
- non-Texas flows failing in a way that makes the whole app look broken

### Specific known risk patterns already visible in the repo

- placeholder chart paths exist and are explicitly marked for later replacement
- some aggregate metrics use fallback composition rather than direct area-native data
- Texas and NYC capabilities are unevenly specialized
- some command affordances are explicitly labeled as not wired yet
- some Google-backed grounding paths are config-dependent rather than universally available

## Phase2 Deploy Implementation Outline

The deploy branch should be implemented in this order:

1. Add a curated default Austin landing state.
2. Narrow primary navigation to the stable product core.
3. Tighten terminal starter prompts and visible affordances.
4. Hide or disable high-risk discovery paths.
5. Pre-warm and verify core Texas markets before public deployment.
6. Add a root `README.md` if still missing, including exact run steps and judge-facing scope guidance.

## Verification Requirements

Before calling the deploy branch ready, verify at minimum:

- first-load Austin rendering
- Texas ZIP search
- Texas city search
- Texas county search
- Texas metro search
- stable terminal response for bounded Texas prompts
- stable PDF generation on the default flow
- no visible entry point to not-wired-yet features
- no obvious placeholder chart appearing in the default judge path

Suggested smoke markets:

- Austin
- Houston
- Dallas
- one Texas county
- one Texas metro

## Out of Scope

This deploy branch should not attempt:

- a full national product hardening pass
- a broad refactor of data architecture
- elimination of every fallback path in the codebase
- redesigning the recorded demo

The branch exists to make the public judging surface safer and more intentional, not to rewrite the project.

## Decision Summary

- Deployment style: broad but fenced
- Default market: Austin
- Product posture: Texas-first, with broader exploration still technically possible
- NYC workflows: kept in code, removed from primary discovery
- Upload: secondary or hidden unless confidence is high
- Terminal: retained, but visibly bounded to strong product scope
