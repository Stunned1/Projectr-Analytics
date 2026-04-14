# Scout - Agent Instructions

This file applies to all agents working anywhere in this repository.
For Next.js-specific rules, also read `projectr-analytics/AGENTS.md`.

---

## README Maintenance (Required)

After **any** of the following, you MUST update `README.md` at the repo root:
- Adding a new feature
- Fixing a bug
- Discovering a data gap or limitation
- Deferring something for later
- Changing setup steps or environment variables

---

## How to Update the Changelog

The changelog lives in `README.md` under `## Changelog`. It is in the **middle** of the file - not at the bottom. Always insert new entries inside the `## Changelog` section, under the correct category heading.

### CRITICAL: Where to insert
- Find `## Changelog` in the README
- Find the correct category block (e.g. `**Map & Visualization**`)
- Add a new date block under that category, or append to an existing date block for today
- **NEVER append to the bottom of the file** - the README has sections after the changelog (Known Bugs, Minor Gaps, Zillow CSVs, Deferred)

### Format

```
**Category**

_MM.DD.YYYY_
- Description of change
```

### Categories
Use one of these exactly:
- `**Data Pipeline**` - new data sources, fetchers, ingestion scripts, Supabase schema changes
- `**Infrastructure**` - API routes, caching, env vars, build config, scripts
- `**Map & Visualization**` - deck.gl layers, Google Maps, choropleth, tooltips, layer controls
- `**UI**` - page layout, stat cards, charts, search bar, sidebar
- `**Bug Fixes**` - anything that was broken and is now fixed

### Rules
- Date format is `MM.DD.YYYY` wrapped in `_italics_`
- Date goes on its own line directly below the category, with a blank line between the category and the date
- Each bullet is a single concise sentence
- If multiple things changed in one session, group them under the same date block
- If a category block for today already exists, append to it - don't create a duplicate
- Never delete existing changelog entries
- **Use `strReplace` to insert into the correct location - never use `fsAppend`**

### Example of correct insertion

If `**Map & Visualization**` already exists in the changelog with a `_4.8.2026_` block, and you need to add a `_4.9.2026_` entry, insert it like this:

```markdown
**Map & Visualization**

_4.8.2026_
- existing entry

_4.9.2026_
- your new entry
```

---

## How to Update Known Bugs

Add to `## Known Bugs` in `README.md`:

```markdown
- **Short title** - One sentence describing the bug, where it occurs, and what file/function is responsible. Include the fix approach if known.
```

Remove a bug entry once it is fixed and move it to the changelog as a bug fix.

---

## How to Update Minor Gaps

Add to `## Minor Gaps` in `README.md`:

```markdown
- **Short title** - What's missing, why it's missing, and what would be needed to fix it.
```

---

## How to Update Deferred Items

Add to `## Deferred` in `README.md`:

```markdown
- **Short title** - Why it was deferred, what the blocker is, and what conditions would allow it to be revisited.
```

---

## How to Update Setup

If you add a new environment variable, script, or required setup step, update `## Setup` in `README.md` accordingly. Keep the env var list and first-time setup steps accurate at all times.

---

## General Rules

- Always read `README.md` before starting work so you understand the current state of the project
- Never leave the README stale - if you touched the code, update the docs
- Keep entries concise - one sentence per bullet is the target
- Do not create separate markdown files to document your work - everything goes in `README.md`
=======
## Purpose
This file defines how AI coding agents (e.g., Codex) should operate within this repository.

---

## Mission
Build a performant, interactive spatial analysis application that integrates map rendering, geospatial queries, and AI-driven insights.

Priorities:
1. Correctness of spatial logic
2. Clear separation of frontend, backend, and AI responsibilities
3. Performance (large datasets, real-time rendering)
4. Minimal, targeted changes

---

## System Architecture

### Frontend (Next.js + deck.gl + Google Maps)
- Uses Next.js App Router
- deck.gl is layered on top of Google Maps (vector mode)
- Responsible for:
  - rendering parcels, heatmaps, and boundaries
  - handling user interaction
  - updating map state (camera, layers)

### Backend (Supabase + PostGIS)
- PostgreSQL with PostGIS extensions
- Responsible for:
  - spatial queries (distance, containment, nearest neighbor)
  - aggregations and caching
- Heavy computation MUST happen here, not in the frontend

### AI Layer (Gemini)
- Receives geographic context + user constraints
- Outputs decisions such as:
  - toggling layers
  - adjusting camera tilt/zoom
  - evaluating spatial metrics
- Does NOT directly manipulate UI or database

---

## Critical Rules

### Separation of Concerns
- Do NOT move spatial computations to the frontend
- Do NOT put business logic inside UI components
- Do NOT let AI directly access database or rendering logic

### Next.js Rules
- This is NOT standard Next.js behavior
- Always verify patterns using:
  node_modules/next/dist/docs/
- Do not assume App Router conventions without checking

### deck.gl + Maps
- Use deck.gl for rendering layers only
- Avoid unnecessary re-renders (performance critical)
- Keep map state minimal and controlled

### PostGIS
- Prefer SQL + PostGIS functions over JS implementations
- Reuse existing queries if possible
- Avoid duplicating spatial logic in multiple places

---

## Execution Strategy

When solving a task:

1. Identify which layer the task belongs to:
   - frontend / backend / AI

2. Locate relevant files BEFORE coding

3. If spatial logic is involved:
   - implement or modify in PostGIS (not JS)

4. If UI change:
   - update React components without breaking map performance

5. If AI-related:
   - modify prompt/context flow, not core system behavior

6. Make minimal, targeted changes

---

## AI Integration Rules

- Treat Gemini as a reasoning engine, not a controller
- Always pass structured context (geo data, constraints)
- Do NOT hardcode AI outputs into logic
- Ensure outputs are validated before affecting UI

---

## Validation

- Ensure map rendering remains performant (no unnecessary rerenders)
- Ensure spatial queries are correct and efficient
- Check edge cases (empty data, invalid coordinates)

---

## Avoid

- Mixing frontend and backend responsibilities
- Writing spatial math in JavaScript if PostGIS can handle it
- Large refactors unless explicitly requested
- Introducing new dependencies unnecessarily
- Assuming default Next.js or deck.gl behavior

---

## Communication

- Be concise and direct
- Explain reasoning when non-obvious
- Ask for clarification instead of guessing

---

## Commit Message Policy

When commiting changes or when a user prompts you to generate a commit message for them:

- Always generate a commit message automatically from the diff
- Commit messages must be informative and user-facing
- Include:
  - what changed
  - why it changed (if inferable)
  - impact or behavior change
- Prefer Conventional Commits format:
  feat:, fix:, refactor:, chore:, docs:
- Keep subject line <= 72 characters
- Write a short body if changes are non-trivial

Never commit with generic messages like "update files" or "misc changes".