# Scout

A geospatial data engine and automated reporting platform for real estate analytics. Scout automates data aggregation for real estate analysts. By unifying public market signals with proprietary client site lists, it provides instant spatial context and data-driven market briefs.

## Core Features

* **Unified Pipeline:** Ingests and normalizes data from 8 public sources, including Zillow, Census ACS, FRED, HUD, Transitland, and NYC Open Data.
* **Agentic Normalization:** Drag-and-drop CSV uploads are automatically categorized, geocoded, and rendered onto the map via LLM integration.
* **Spatial Engine:** Renders dense datasets, including parcels and building permits, smoothly via WebGL.
* **Automated Reporting:** Generates structured, exportable PDF market briefs directly from the live map state.

## Architecture

* **Frontend:** Next.js, React, Tailwind CSS
* **Spatial:** deck.gl, Google Maps Platform (Vector Mode)
* **Database:** Supabase (PostgreSQL, PostGIS)
* **Intelligence:** Gemini 2.5 Flash
* **Reporting:** @react-pdf/renderer

## Texas MVP

Texas is the default MVP experience. NYC-specific parcel, permit, and borough-analysis workflows remain in the product, but they should stay geography-gated rather than drive the default story or shared architecture.

### Texas MVP source inventory

| Source | Coverage | Granularity | Access method | Reusable vs Texas-only | Scout schema mapping | Performance / storage plan |
|---|---|---|---|---|---|---|
| Zillow ZIP + metro CSVs | U.S. ZIPs + metros | Monthly snapshots + ZORI time series | Local CSV ingest via `npm run ingest:zillow` | National reusable | `zillow_zip_snapshot`, `zillow_metro_snapshot`, `zip_metro_lookup`, `zillow_zori_monthly` | Precompute snapshots and metro lookup once; serve cached tables only at runtime |
| Census ACS | U.S. ZIP / tract / block group | Annual / 5-year ACS vintages | Live API fetch, cached into `projectr_master_data` | National reusable | `projectr_master_data` tabular + tract / block-group responses | Cache normalized rows per ZIP; avoid repeated cold fetches |
| FRED | U.S. county | Monthly + annual | Live API fetch, cached into `projectr_master_data` | National reusable | `projectr_master_data` time series (`Unemployment_Rate`, `Employment_Rate`, `Real_GDP`) | Cache latest county series; avoid repeated county searches when aggregate views reopen |
| HUD | U.S. ZIP | Annual-ish benchmark rent | Live API with ACS fallback, cached into `projectr_master_data` | National reusable | `projectr_master_data` tabular `FMR_*BR` metrics | Store normalized bedroom rows; no runtime bedroom transforms |
| Google Trends | U.S. geo search interest | Weekly | Live API route | National reusable | Route payload only; report payload stores summarized series | Keep fetch deduped and scoped to anchor ZIP / city-state; do not persist large raw responses |
| Transitland / OSM | U.S. transit + amenities context | Current snapshot | Live API routes | National reusable | Route payloads only | Keep viewport / radius scoped; no raw persistence by default |
| Overture POIs | U.S. POIs | Current snapshot | Live API route | National reusable | Route payloads only | Keep radius-limited response; avoid global preload |
| Flood source already wired | U.S. where available | Current snapshot | Live API route | National reusable | Route payloads only | Keep radius-limited response; avoid heavy default layers |
| [TREC Housing Activity](https://trerc.tamu.edu/data/housing-activity/state/texas/) | Texas state / MSA / county | Monthly | Official site export / manual CSV-Excel capture from housing-activity pages | Texas-only | Normalize county + metro metrics into `projectr_master_data`; raw export stays source-side | Precompute county / metro rows from exports; avoid runtime MLS rollups or broad joins |
| [TREC Building Permits](https://trerc.tamu.edu/data/building-permits/) | National data surfaced for Texas state / MSA / county / permit office | Monthly cumulative + annual | Official custom query/export from Building Permits page | Reusable data, Texas-first MVP usage | Store Texas-specific raw/source extracts only if needed; publish normalized county + metro permit metrics into `projectr_master_data` | Prefer pre-aggregated county / metro outputs; no raw permit-office joins on user requests |
| [Texas Demographic Center estimates](https://demographics.texas.gov/index/Census/Estimates) | Texas county / place / MSA / COG | Annual plus January snapshot | Official download tool / file downloads | Texas-only | Normalize county + metro population totals / growth into `projectr_master_data` | Store per-vintage rows and latest aggregates; serve latest rows by geography key |
| [Texas Demographic Center projections](https://demographics.texas.gov/Projections/) | Texas county / MSA / COG | Annual 2020-2060 | Official custom download + downloadable files | Texas-only | Keep full projections in source/raw tables, publish selected planning metrics into `projectr_master_data` | Precompute common horizons; do not join full projection matrices at runtime |
| [TxGIO land parcels](https://gio.texas.gov/stratmap/land-parcels.html) | Texas county parcel coverage varies | County refresh cadence varies; TxGIO attempts annual refreshes | DataHub shapefile / geodatabase download | Texas-only optional | Raw spatial source tables only when needed; not part of default MVP query path | Lazy county ingest only; never load statewide parcel payloads in the default map flow |
| [TxGIO address points](https://gio.texas.gov/stratmap/address-points.html) | Texas statewide aggregated address points | Iterative / ongoing updates | DataHub download | Texas-only optional | Optional raw geocoding / QA table, not a default end-user metric source | Keep offline or county-scoped; do not add to normal market-load payloads |

### Texas architecture note

- Shared core: keep `/api/market`, `/api/city`, `/api/aggregate`, shared map layers, and PDF/report payloads geography-neutral around ZIP / county / metro keys.
- Texas adapters: TREC and TDC ingestors should emit normalized metric rows into `projectr_master_data`, using Texas-specific raw/source tables only when the source shape cannot be represented cleanly as shared metrics.
- NYC gated features: PLUTO parcels, NYC DOB permits, borough search, and `run_analysis` stay intact, but appear only when the active geography is New York City.
- Expansion path: future states should add source adapters that map into the same shared geography keys instead of adding more state-specific UI branches.

### Texas performance note

- Do not fetch or render NYC-only parcel / DOB permit data outside NYC; keep those layers hard-gated by geography.
- Prefer precomputed county / metro aggregates from Texas exports over runtime joins across raw MLS, permit-office, or demographic files.
- Reuse cached tract / block-group / metro lookup responses for common Texas geographies; keep Texas default loads to ZIP / city / metro payloads.
- Optional Texas parcel and address datasets should stay lazy and county-scoped so statewide MVP load time remains fast.
- Remaining hotspot: aggregate cold starts still backfill `projectr_master_data` per ZIP before returning; Texas adapters should pre-populate cached county / metro rows to remove that latency from common Texas workflows.

## Setup

### Prerequisites
- Node.js 18+
- A Supabase project with PostGIS enabled
- Google Maps API key + Vector Map ID (Google Cloud Console → Maps → Create Map ID, select Vector + enable tilt/rotation)
- Gemini API key (Google AI Studio)
- FRED API key (stlouisfed.org)
- Census API key (api.census.gov/data/key_signup.html)

### Environment Variables
Copy `.env.local` and fill in:
```
FRED_API_KEY
CENSUS_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_GEOCODING_API_KEY         # optional server-only Geocoding API key; Client CSV / upload forward-geocode falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY if unset
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID   # must be a Vector map ID
GEMINI_API_KEY
SCOUT_AGENT_SKIP_REASONING_PASS  # optional; set to 1 to skip the extra Gemini text pass that fills Thinking “Full reasoning” (faster, cheaper)
GOOGLE_MAPS_STATIC_KEY           # optional; unused by current PDF exports (reserved if static map returns)
HUD_API_TOKEN                    # optional, falls back to Census ACS rent data
TRANSITLAND_API_KEY=             # free at transit.land/sign-up (Developer API, 10k queries/month)
```

### First-time data setup
1. Download Zillow CSVs (see section below) into `zillow-csv's/` at repo root
2. `cd projectr-analytics && npm install`
3. In Supabase SQL Editor, run migrations under `projectr-analytics/supabase/migrations/`: `20260411120000_zip_geocode_cache.sql` (ZIP geocode cache), `20260411180000_zillow_zori_monthly.sql` (monthly ZORI for PDF charts), `20260411190000_saved_sites.sql` (analyst shortlist; requires Auth), and `20260411200000_saved_sites_aggregate.sql` (multi-area shortlist replay)
4. `npm run ingest:zillow` - loads Zillow data into Supabase
5. `npm run populate:centroids` - run 6-7 times until "All centroids already populated" (geocodes ~7,661 ZIPs)
6. `npm run ingest:permits` - ingests NYC DOB building permits into `nyc_permits` table (all 5 boroughs, NB/A1/A2/DM, 2022+); takes ~10-20 min
7. Optional Texas source loads after downloading official exports locally: `npm run ingest:texas:housing -- --file <path-to-trec-housing-export>`, `npm run ingest:texas:permits -- --file <path-to-trec-building-permits-export>`, and `npm run ingest:texas:demographics -- --file <path-to-tdc-export> [--dataset estimates|projections]`; each script normalizes county / metro rows into `projectr_master_data`.
8. `npm run dev`
9. Optional before demos/recordings: with `npm run dev` running, `npm run warm:demo` - warms cache for ZIPs 77002, 75201, and 78701 via market/transit/trends/cycle APIs (`WARM_BASE_URL` overrides default `http://127.0.0.1:3000`).

### Known setup issues
- **Shortlist / `saved_sites`** - enable **Anonymous sign-ins** under Supabase Authentication → Providers (or use email/OAuth); the app calls `signInAnonymously()` when there is no session so `saved_sites` inserts satisfy RLS.
- **Turbopack + Tailwind** - if you get `Can't resolve 'tailwindcss'`, kill any stale `next dev` processes and restart fresh. Stale processes hold onto old module resolution state.
- **Google Maps Map ID** - must be a Vector type map for deck.gl `interleaved: true` mode. Raster maps cause `fromLatLngToDivPixel` errors.
- **Zillow CSVs are gitignored** - ~they exceed GitHub's 100MB file limit. Each teammate needs to download them locally and run `ingest:zillow` once.~ You must download the CSV's locally and run ingest:zillow, OR just use a supabase with the zillow data already in.
- **`ingest:zillow` runtime** - writing every ZIP × month into `zillow_zori_monthly` adds many upsert batches; expect a longer first run than snapshot-only ingests (on the order of tens of minutes depending on network and Supabase rate limits).

## Changelog

Entries are **summarized by date and theme**; use git history for full per-change detail.

**Data Pipeline**

_4.8.2026_
- Supabase/PostGIS foundation (`projectr_master_data`, Zillow snapshots, `zip_metro_lookup`); FRED, ACS, HUD/B25031, BPS; Zillow CSV ingest (6 files); GTFS/OSM transit + Google Trends; `/api/boundaries`; ~7.6k ZIP centroids; `/api/neighbors`.

_4.9.2026_
- `/api/blockgroups`; market `geo` adds `stateFips` / `countyFips`.

_4.12.2026_
- `zillow_zori_monthly` + migration; full ZORI history in `ingest:zillow` for charts/PDFs.

_4.11.2026_
- `POST /api/normalize`: Google forward-geocode for non-ZIP place cells (≤50 strings/upload), `lib/google-forward-geocode.ts`.

_04.16.2026_
- Added shared Texas source adapters plus `ingest:texas:housing`, `ingest:texas:permits`, and `ingest:texas:demographics` so TREC and Texas Demographic Center exports normalize county / metro rows into `projectr_master_data`.

**Infrastructure**

_4.8.2026_
- Next.js scaffold; Supabase cache + cold fetch; `/api/market`, `/api/transit`, `/api/trends`, `/api/boundaries`, `/api/neighbors`, `/api/normalize`.

_4.9.2026_
- `/api/city` (ZIP lists, “City, ST”, zippopotam fallback).

_4.11.2026_
- `/api/city` state param: full names or USPS (`lib/us-state-abbr.ts`). Case study: `POST /api/agent/case-brief` + `/pdf` (`CaseBriefPdfDocument`, `lib/report/case-brief-shared.ts`). **APIs:** `/api/borough`, `/api/aggregate`, `/api/agent`, `/api/memo`, `/api/permits`, `ingest:permits` (Socrata NYC DOB), `/api/report/pdf` (market brief + Gemini dossier), `GET /api/cycle`, `GET /api/metro-benchmark`, `/api/pois` (Overture). ZIP geocode → TigerWeb + `zip_geocode_cache`. `@react-pdf/*` in `serverExternalPackages`. `saved_sites` migration + Zustand + anonymous auth. Agent: `nycPermits` naming, MODE A/B/C, multi-step `steps`, `mapContext.clientCsv`, `focus_data_panel`, multi-file CSV (≤8), Brooklyn TOD fixtures. `AgentChat` stays mounted; `scout-agent-chat-v1` session. Merge/reconcile housekeeping on page, sidebar, normalize, README.

_4.12.2026_
- `/api/trends`: optional `city` / `state` / `anchor_zip`, clearer JSON errors. Agent documents `set_heading`. `GEMINI_NO_EM_DASH_RULE` across Gemini prompts.
- `/api/agent` returns normalized **`trace`** (summary, detail, plan, eval, executionSteps derived from `steps`, optional `toolCalls`); `lib/agent-trace.ts`.
- `/api/agent` runs an optional first Gemini **text** pass for long-form `trace.thinking` (injected into the JSON pass for consistency); `SCOUT_AGENT_SKIP_REASONING_PASS=1` skips it.
- `/api/agent` with `stream: true` returns **`application/x-ndjson`**: `thinking_delta` lines (Gemini stream) then `status` + final `done` JSON; client `lib/consume-agent-ndjson-stream.ts`.
- Agent NDJSON stream sends **`ping` keepalives** during the silent JSON map-action call so idle proxies less often drop the connection; route `maxDuration` 120s for long runs.

_04.16.2026_
- Added shared geography gating and Texas MVP source / architecture / performance notes so Texas becomes the default product framing without deleting NYC-specific workflows.
- Added `/api/county`, `/api/metro`, and `/api/area-metrics`, and wired aggregate search to fall through from city lookups to county / metro lookups for Texas-friendly county / ZIP / metro workflows.
- Texas-first demo warmups, slash help, and export/search messaging now use ZIP / county / metro wording instead of assuming city-or-borough-only flows.

**Bug Fixes**

_4.11.2026_
- Agent keys: `permits` / `nycPermits` normalization; clear tracts/blockGroups after `run_analysis`; `FlyToController` uses `moveCamera` + easing; layer chrome layout; PDF cycle layout, arrows, wrapping, sanitizers; restore `sites-store`; normalize JSON from Gemini; split `AGENT_CHAT_STORAGE_KEY`; default ZIP boundary + choropleth on; `/clear:layers` + override resync + `overlayReady`; Transit `paths` / `color` + legacy `path` caps.

_4.12.2026_
- Deck `interleaved: true` (vector map); React 19 perf logging guard; PDF font/arrow fixes; `/api/aggregate` vacancy, BPS year bars, migration, cold ZIP fill; FRED NYC borough county names; remove bad `reservedRightPx`; `AgentTerminal` bottom anchor fix.

_04.16.2026_
- Non-NYC markets no longer keep NYC parcel / permit layers active or fetch PLUTO / DOB payloads, and single-ZIP tract loads now reuse the shared cached request path.
- `CommandMap` now uses keyed ZIP / city boundary snapshots and versioned layer resync state so market-mode switches stop rendering stale overlays without synchronous effect resets.
- Repo-blocking React 19 lint errors were removed from the PDF export routes, `AgentTerminal`, and `ShortlistPanel`; full lint now passes with warnings only.
- `/api/aggregate` now accepts shared county / metro `area_key` lookups, prefers direct precomputed area rows from `projectr_master_data`, and skips ZIP cold-fills on that fast path.
- `/api/aggregate` now fetches ZIP snapshots, metro lookup, and only the metric rows it actually needs in parallel, which trims county / metro payload size and avoids extra ZIP-weight lookups for large Texas areas.
- `/api/county` now falls back to Census county FIPS plus `zip_geocode_cache` when `zip_metro_lookup.county_name` is unusable for Texas rows, restoring live `Harris County, TX` and `Travis County, TX` searches in the running app.
- `CommandMap` now keeps the deck.gl overlay attached across layer updates so Texas county / metro searches stop losing visible map layers after navigation, and momentum scores are cached by ZIP set instead of re-fetching on unrelated layer toggles.
- Momentum lookups now use a shared client ZIP-set cache across the map, analysis panel, and save flows so typing or rerendering does not spam `/api/momentum`, and off-by-default tract / amenity / flood / POI layers no longer preload until the user actually enables them.
- NYC-only spatial analysis no longer falls back to Manhattan when the borough is missing, and the guide / export / upload / slash-help / agent prompt copy now defaults to ZIP / county / metro Texas workflows before mentioning borough-specific NYC paths.

**Map & Visualization**

_4.8.2026_
- Google Maps + deck.gl; ZIP choropleth; transit dots; neighbor boundaries; layer toggles; dev status sidebar (later removed); fitBounds; drag snap fix.

_4.9.2026_
- Removed OSM 3D buildings stack + `/api/buildings`. Transitland-primary transit (brand colors, PathLayer); block groups + parcels; tract choropleth; amenity heatmap; flood; `/api/tracts`, `/api/amenities`, `/api/floodrisk`; cached market `geo` fix.

_4.11.2026_
- Borough parcels; Overture POIs; momentum choropleth; NYC permits heatmap + 3D columns + type filters; layer pill UI; map tilt/sliders (later superseded by 3D toggle); defaults (ZIP outline + choropleth + transit); orange borough outline; agent layer merge; transit path normalization + caps; eased analysis `fly_to`; case-brief PDF visual upgrades; map fits client CSV pins when no ZIP loaded.

**UI**

_4.8.2026_
- Initial dashboard: stats, sparklines, transit table, Trends, ZIP search.

_4.11.2026_
- Command-center shell: collapsible sidebar, floating stats pill, 360px Analysis/Data panel, Scout branding, market PDF export, cycle + momentum + methodology tooltips, Saved/shortlist + aggregates, Client CSV + `/upload` + pending nav, shadcn + theme tokens, layers top-left, **AgentTerminal** (streaming, session, slash + `/restart`), `/guide` outline/search, layout/spacing iterations.

_4.12.2026_
- `/guide` canonical (`/Documentation` → 308); city/borough Trends wiring; guide search/content; Scout assets; slash palette; `/view`, `/tilt`, `/rotate`, `/clear:*`, `/go`, `/layers:`; terminal `/` shortcut, resize, collapse transition; remove executive memo panel (keep `/api/memo`); **`/saved`** nav; **`/save`** (ZIP, aggregate, or map bookmark via `MAP_VIEW_SAVE_ZIP` + coords handoff); **README changelog compressed** to summary bullets.
- Agent **Show thinking** opens the right panel **Thinking** tab (`AgentThinkingPanel`): **Full reasoning** (Cursor-style prose when the reasoning pass runs), then plan, self-check, and scheduled map actions; full trace when no market is loaded; opening thinking clears an open ranked-site detail so the panel can show the tab.
- Agent requests use **streaming** reasoning: the Thinking tab opens automatically and **Full reasoning** updates live (with a **Live** badge) until the JSON map-action model finishes.
- Thinking **Full reasoning** renders as **Markdown** (`react-markdown`, `AgentThinkingMarkdown`) for headings, lists, and emphasis.
- Thinking pane **auto-scrolls to the bottom** while streaming if you stay near the end; scroll up to read earlier text and auto-follow pauses until the next stream starts.

_4.15.2026_
- Browser tab icon now uses the Scout logo asset.
- Intelligence terminal and `/api/agent` now block off-topic prompts before Gemini runs, while every leading `/` input stays on the local slash-command path.

_04.16.2026_
- Search, guide, and agent copy now lead with Texas market examples while keeping NYC borough entry points available only when relevant.
- Aggregate county / metro views now label themselves by geography and surface supplemental precomputed area metrics without a second fetch.
- Sidebar search, terminal suggestions, slash-command help, and market export prompts now present Texas ZIP / county / metro workflows as the default visible examples.

## Known Bugs

- **DC Metro velocity null** - Zips in the Washington-Arlington-Alexandria metro return `metro_velocity: null` because the metro name is too long to match the short name stored in `zillow_metro_snapshot`. The `getZillowData` function in `app/api/market/route.ts` needs smarter truncation logic for multi-city metro names.

- **ZHVF outlier values** - Some zips return extreme ZHVF forecast values (e.g. -50, -90, -10) from the Zillow CSV. These appear to be data artifacts. The UI currently caps display at ±50% and shows `-` for outliers, but the raw values are still stored in Supabase. The ingestion script should filter these on write.

- **Zillow `as_of_date` shows future date** - The ZHVF CSV uses forward-looking forecast dates (e.g. `2027-02-28`). This bleeds into the `as_of_date` field on the zip snapshot. The ingestion script should use the ZHVI or ZORI date as the canonical `as_of_date` instead.

- **Google Trends invalid JSON** - `lib/fetchTrends.ts` uses the unofficial `google-trends-api` client and assumes the upstream response is JSON; when Google returns an HTML throttle / anti-bot page instead, `queryTrends()` throws `Google Trends response was not valid JSON` and the dashboard interest section shows an error.

- **Transit lines missing but yellow circles remain** - When `TRANSITLAND_API_KEY` is absent or Transitland returns no drawable routes, `/api/transit` falls back to `lib/fetchGtfs.ts`; if that Overpass query fails and hits the smaller retry, the retry only requests stop nodes and no rail ways, so the map renders yellow subway entrance circles without PathLayer route lines.

## Minor Gaps

- **Employment Rate (FRED)** - The FRED series search for "employed persons" at the county level doesn't reliably return a consistent series name across all markets. The computation (employed / labor force × 100) is built and ready, but the series lookup needs a more robust matching strategy. Revisit before demo.

- **FRED missing for large metros** - Zips in large counties (e.g. Prince William County, VA) sometimes return no FRED data because the search query times out or returns no match. Likely needs a fallback to a direct LAUCN series ID lookup using the county FIPS.

- **Population Growth 3yr is enrollment-sensitive** - For college towns, the 2019→2022 ACS population delta reflects COVID-era enrollment swings, not real migration. Consider adding a note in the UI or suppressing this metric for known university zip codes.

- **Building permits are county-level, not zip-level** - Census BPS data is aggregated at the county level. A zip like 22193 (Woodbridge) shares permit counts with all of Prince William County. This overstates activity for individual zip codes. Noted for the demo script.

- **Neighbor ZIPs only cover Zillow-tracked markets** - `zip_metro_lookup` is sourced from the ZORI CSV, which only covers ~7,700 ZIPs where Zillow has enough rental data. Rural ZIPs and non-rental markets won't have neighbor context on the map. This is acceptable for the target use case (active rental markets) but worth noting.

- **PDF rent sparkline** - After `zillow_zori_monthly` exists and `ingest:zillow` has run, the brief uses **real** monthly ZORI. If the table is empty or a ZIP has too few points, the PDF falls back to a modeled series (footnoted).
- **Cycle vacancy signal** - ACS vacancy in cache is a single vintage (level only); the classifier does not yet compute vacancy YoY until multi-year ACS rows exist in the pipeline.

- **Client CSV forward geocode limits** — After ZIP + explicit lat/lng handling, **non-ZIP** geo cells (street addresses, `City, ST`, etc.) are sent to the **Google Geocoding API** (up to **50** unique strings per upload). Enable **Geocoding API** on the GCP project; use `GOOGLE_GEOCODING_API_KEY` or the same key as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Ambiguous or non-US strings may return no pin; very large files need chunking or a higher cap (not implemented).

- **Large map payloads** - `transit`, `tracts`, and some permit views still return raw JSON / GeoJSON instead of viewport-tiled or binary map data, so very large markets need server-side tiling or stronger bbox filtering to stay smooth.

- **Agent stream rerenders** - Streaming `thinking_delta` updates still bubble through the top-level page state, so the map shell can rerender more than necessary until the agent panel is isolated from high-frequency stream updates.
- **Reusable analyst workflow packaging** - Scout currently reads as a Projectr-specific consulting workspace; broadening it into a reusable product for other analyst teams would require templated workflows, sharable deliverables, and less client-specific framing in the UX.
- **County search coverage still depends on Zillow-tracked ZIPs and ZIP centroids** - The county route now recovers major Texas counties via `zip_geocode_cache`, but counties whose tracked ZIP centroids fall into adjacent counties or have thin Zillow coverage can still return 404 or only a single ZIP; fixing that would require polygon-based ZIP membership or a broader county-to-ZIP source.
- **Texas direct area fast path needs loaded source exports** - In the current dev database, `/api/area-metrics` returns zero rows for tested Texas county / metro area keys, so the shared aggregate route falls back to ZIP-derived metrics instead of the new precomputed county / metro path until TREC / Texas Demographic Center exports are actually ingested.
- **Texas export fixtures** - The new TREC / Texas Demographic Center ingestors are header-alias based and compile cleanly, but there are no sample source exports checked into the repo; run them against real files before relying on every column mapping in production.

## Client CSV & AI session

- **Where it lives** — The **last normalize** triage + preview live in `sessionStorage` (`projectr-client-upload-session`); pin coordinates live in `projectr-client-upload-markers`. You can **ingest multiple CSVs in one drop** (up to 8); markers are **merged and deduped** by lat/lng/label, previews concatenated (capped), and each file still runs `POST /api/normalize` sequentially (separate Gemini triage + Supabase upserts per file). Rows also **upsert into Supabase** `projectr_master_data` with `data_source = Client Upload` and `submarket_id` from each row’s geography (or the optional form `zip` when the server was given a loaded market). The agent reads the combined snapshot via `mapContext.clientCsv` on every `/api/agent` call. **Pins:** explicit lat/lng columns, **5-digit ZIP** (Zippopotam/Census), then **address / place text** via Google Geocoding when a key is configured (`lib/google-forward-geocode.ts`, wired in `POST /api/normalize`).

- **No market loaded** — You can upload first, then chat with the agent: context still includes the CSV block; pins render when the **Client** layer is on (default **on**). If the CSV has mappable rows, the map auto-fits to those pins until you load a ZIP or city.
- **Case study + CSV** — Upload CSV(s) **before** pasting a ranking brief so `mapContext.clientCsv` is populated; `/api/agent` instructs Gemini (MODE B) to reference uploads, turn on **clientData** when pins exist, and use **focus_data_panel** for temporal-only ingests.
- **Clear local test data** — On the map, run **`/clear:workspace`** in the intelligence terminal (confirm + reload) to remove session keys (`projectr-client-upload-session`, `projectr-client-upload-markers`, `projectr-agent-chat-v1`, `projectr_pending_nav`); does not delete Supabase rows or shortlist.

- **After you load a new location** — Session pins and the agent CSV context **stay** until you upload another file or clear pins; they are **not** tied to the searched ZIP. Supabase ingested rows are keyed by **row geography + metric + period**, not by whatever ZIP is on screen—so changing markets does not delete prior uploads, but the **Data** tab metrics view is still filtered to the **current** market unless you query elsewhere.

- **Shortlist** — `saved_sites` stores label, ZIP/aggregate hint, geo, cycle snapshot, and notes only; it does **not** store CSV blobs or agent transcripts. Restoring a shortlist row reloads that market, not a prior upload or chat (see **Deferred**).
- **Reset local workspace (QA)** — Use **`/clear:workspace`** on the map intelligence terminal to wipe this tab’s Client CSV session, pins, agent chat, and pending sidebar→map navigation, then reload. Ingested **Client Upload** rows remain in Supabase until you remove them in the database.
- **Intelligence terminal** — Type **`/`** for suggestions; **`/help`** lists commands; **`/view`**, **`/tilt`**, **`/rotate`**, **`/go`**, **`/layers:`…**, **`/clear:`…** (see changelog); **`/clear:workspace`** runs **Clear local test data** (confirm + reload). **`/clear:terminal`** and **`/clear:memory`** replace the visible transcript with the default greeting only (no echo of the slash command); **`/restart`** clears to the y/n prompt the same way. Inputs starting with **`/`** are always local commands, and unknown commands return an error instead of reaching the AI agent; natural-language prompts are screened for Scout real estate, map, market, or uploaded-data relevance before Gemini runs, both in the terminal and at `/api/agent`.

## Zillow Research CSVs

The `zillow-csv's/` folder is gitignored due to file size. Before running `npm run ingest:zillow`, download the following files from [Zillow Research](https://www.zillow.com/research/data/) and place them in a `zillow-csv's/` folder at the repo root:

| File | Section on Zillow Research page | Geography |
|------|--------------------------------|-----------|
| `Zip_zori_uc_sfrcondomfr_sm_month.csv` | Rentals → ZORI (All Homes, Smoothed) | ZIP |
| `Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` | Home Values → ZHVI (All Homes, Mid-Tier, Smoothed SA) | ZIP |
| `Zip_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` | Home Value Forecasts → ZHVF (All Homes, Mid-Tier) | ZIP |
| `Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv` | Days on Market → Days to Pending (Mean, Smoothed) | Metro |
| `Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv` | Days on Market → Price Cuts (Share of Listings) | Metro |
| `Metro_invt_fs_uc_sfrcondo_sm_month.csv` | For-Sale Listings → Inventory (Smoothed) | Metro |

Once downloaded, run:

```bash
cd projectr-analytics
npm run ingest:zillow
```

## Deferred

- **Client CSV in the command-center sidebar** — The **Client CSV** nav item was removed; `/upload` and the normalize / Client layer pipeline remain for now while the upload workflow is redesigned for another surface (IA TBD). README **Client CSV & AI session** still describes session keys and behavior.

- **Multi-market permit comparison** — Permit visualization is currently NYC-only (Socrata DOB feed). Expanding to other cities would require per-jurisdiction ArcGIS FeatureServer URLs or a paid aggregator (Regrid, BuildZoom). Revisit if scoping to additional demo markets.

- **Shortlist attachments (CSV + agent chat)** — Would require `saved_sites` JSONB column(s) or a sibling table, size limits, and UI to “attach workspace” on save plus restore flow (rehydrate markers store + optional transcript). Blocked on schema/auth product decisions.

- **Travel-time accessibility scoring** - Adding Google routing-based catchments or commute-time scoring would strengthen site-selection analysis and the Google technology story, but it is deferred until scope, quota, and UX tradeoffs are defined.
