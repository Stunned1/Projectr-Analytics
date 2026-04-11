# Case study (mock): Brooklyn — workforce TOD & underbuilt parcels

**Brief (paste into the agent)**

A mid-market real estate developer is looking to shift capital out of fully priced Williamsburg and boutique North Brooklyn product into **Downtown Brooklyn, the Atlantic Terminal corridor, and the Navy Yard adjacency**, where **compressed land basis is harder to find but institutional rail access and job anchors already exist**. They are targeting **transit-oriented workforce housing**: parcels within a short walk of **heavy subway or LIRR** where **current zoning allows significantly higher residential density than what is built today**, and where **early indicators** (multifamily permit velocity, rent trajectory, population pressure) suggest the corridor is **re-pricing before the broader market prices in the same story**.

Traditional feasibility screens miss **block-level variation in unused FAR**, **walk time to multiple transit modes**, and **momentum that is not yet in trailing rent comps**. We need a **geospatial site analysis** that combines **zoning / built-form gap**, **infrastructure access**, and **development momentum** to surface locations with strong long-term potential and clearer basis risk control.

**Goal:** Build a spatial model to surface and rank the **top five underutilized parcels in Brooklyn** that offer the best balance of **unused FAR headroom**, **immediate transit access**, and **early neighborhood development momentum**.

## How to test with bundled CSVs

| File | Intent |
|------|--------|
| `brooklyn_candidate_sites_mappable.csv` | **Geospatial** — street addresses + scores; should produce **map pins** (ZIP + Google forward geocode) when Client layer is on. |
| `brooklyn_borough_rent_permit_trend_not_mappable.csv` | **Temporal** — quarter + borough-wide metrics, **no row-level geography**; **no map pins**. After ingest, open the map command center, load a market (e.g. a Brooklyn ZIP), open the right panel **Data** tab, scroll to **Client CSV (last upload)** — the **preview table** (Geo / Metric / Value / Period) is where this file is shown in-app (not a separate chart yet). |

**Full path (repo):** `projectr-analytics/fixtures/brooklyn-workforce-housing-case-study/` — both CSVs live next to this file.

### Order matters (agent + CSV)

1. **Upload first** — On **Client CSV** (`/upload`) or the **Data** tab normalizer, drop **both** CSVs in one selection (or one at a time; last batch wins as “last upload”). Wait until normalize finishes.
2. **Search Brooklyn** (optional but helpful) — e.g. load a Brooklyn ZIP or `Brooklyn, NY` so map context matches the brief.
3. **Paste the brief** into the agent. The API always sends **CLIENT CSV** context with every message while your session has an upload; the system prompt instructs the model to **tie the case study to those files** (turn on **Client** pins when `mapPinCount > 0`, open **Data** when only temporal/tabular).

You do not have to type “use my CSV” — if the CLIENT CSV block is non-empty, the agent is required to reference it. If that block is empty, upload first, then re-send or paste the brief again.
