# Projectr Analytics — Agent Instructions

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

The changelog lives in `README.md` under `## Changelog`. It is in the **middle** of the file — not at the bottom. Always insert new entries inside the `## Changelog` section, under the correct category heading.

### CRITICAL: Where to insert
- Find `## Changelog` in the README
- Find the correct category block (e.g. `**Map & Visualization**`)
- Add a new date block under that category, or append to an existing date block for today
- **NEVER append to the bottom of the file** — the README has sections after the changelog (Known Bugs, Minor Gaps, Zillow CSVs, Deferred)

### Format

```
**Category**

_MM.DD.YYYY_
- Description of change
```

### Categories
Use one of these exactly:
- `**Data Pipeline**` — new data sources, fetchers, ingestion scripts, Supabase schema changes
- `**Infrastructure**` — API routes, caching, env vars, build config, scripts
- `**Map & Visualization**` — deck.gl layers, Google Maps, choropleth, tooltips, layer controls
- `**UI**` — page layout, stat cards, charts, search bar, sidebar
- `**Bug Fixes**` — anything that was broken and is now fixed

### Rules
- Date format is `MM.DD.YYYY` wrapped in `_italics_`
- Date goes on its own line directly below the category, with a blank line between the category and the date
- Each bullet is a single concise sentence
- If multiple things changed in one session, group them under the same date block
- If a category block for today already exists, append to it — don't create a duplicate
- Never delete existing changelog entries
- **Use `strReplace` to insert into the correct location — never use `fsAppend`**

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
- **Short title** — One sentence describing the bug, where it occurs, and what file/function is responsible. Include the fix approach if known.
```

Remove a bug entry once it is fixed and move it to the changelog as a bug fix.

---

## How to Update Minor Gaps

Add to `## Minor Gaps` in `README.md`:

```markdown
- **Short title** — What's missing, why it's missing, and what would be needed to fix it.
```

---

## How to Update Deferred Items

Add to `## Deferred` in `README.md`:

```markdown
- **Short title** — Why it was deferred, what the blocker is, and what conditions would allow it to be revisited.
```

---

## How to Update Setup

If you add a new environment variable, script, or required setup step, update `## Setup` in `README.md` accordingly. Keep the env var list and first-time setup steps accurate at all times.

---

## General Rules

- Always read `README.md` before starting work so you understand the current state of the project
- Never leave the README stale — if you touched the code, update the docs
- Keep entries concise — one sentence per bullet is the target
- Do not create separate markdown files to document your work — everything goes in `README.md`
