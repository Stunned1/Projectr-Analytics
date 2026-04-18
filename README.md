# Scout

A geospatial data engine, bounded EDA assistant, and automated reporting platform for real estate analytics. Scout unifies public market signals with proprietary analyst datasets so users can inspect loaded data quickly, control the map directly when needed, and generate briefs without relying on open-ended autonomous agent behavior.

## Core Features

* **Unified Pipeline:** Ingests and normalizes data from 8 public sources, including Zillow, Census ACS, FRED, HUD, Transitland, and NYC Open Data.
* **CSV Import + Normalization:** Drag-and-drop CSV uploads are automatically categorized, classified for mapability, and routed to map, chart, or table views.
* **EDA Assistant:** The default AI surface summarizes loaded markets and uploaded datasets, explains metrics, flags outliers, and calls out data-quality issues using deterministic workspace evidence.
* **Spatial Engine:** Renders dense datasets, including parcels and building permits, smoothly via WebGL.
* **Automated Reporting:** Generates structured, exportable PDF market briefs directly from the live map state.

## Architecture

* **Frontend:** Next.js, React, Tailwind CSS
* **Spatial:** deck.gl, Google Maps Platform (Vector Mode)
* **Database:** Supabase (PostgreSQL, PostGIS)
* **Intelligence:** Gemini 2.5 Flash over deterministic EDA summaries and explicit map-control guards
* **Reporting:** @react-pdf/renderer

## EDA Assistant Boundary

- **Default job:** descriptive statistics, outlier detection, comparisons, trend spotting, data-quality observations, metric explanations, and plain-language summaries of the currently loaded market or imported dataset.
- **Evidence sources:** active market snapshot, imported CSV session summaries, uploaded table/chart/map context, active geography/layer/metric state, and the shared metric glossary.
- **Map control:** still supported, but only for explicit direct requests such as loading a market, toggling layers, changing tilt, or opening a panel.
- **Non-goals:** speculative investment advice, open-ended market theses, uncontrolled tool orchestration, or vague reasoning detached from visible data.
- **Evidence rule:** if the assistant cannot ground an answer in the current workspace, it must say so instead of improvising.

### Current AI surface audit

| Surface | Disposition |
|---|---|
| `/api/agent` prompt + routing | Narrowed to a one-pass EDA contract with deterministic fallback summaries, a shared request-lane classifier, and context-aware upload-vs-market subject selection; explicit map controls remain available as a separate direct-action lane. |
| Multi-step `steps` / `run_analysis` defaults | Removed from the default assistant path; legacy NYC analysis tooling stays available elsewhere and remains geography-gated. |
| Starter prompts / placeholders / chips | Rewritten to emphasize summaries, outliers, trends, metric explanations, and explicit map controls instead of open-ended reasoning. |
| Right-panel “Thinking” UI | Reframed as **Notes** with methodology, key findings, evidence, caveats, and next questions. |
| Open-ended “tell me what matters” / strategy prompts | Blocked or redirected unless the request is grounded in visible market or uploaded-data context. |
| Map/search/layer control | Kept, but only for direct requests like search, layer toggles, 2D/3D tilt, and panel focus. |

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
| [TREC Housing Activity](https://trerc.tamu.edu/data/housing-activity/state/texas/) | Texas state / MSA / county | Monthly | Official TREC public JSON endpoint (`/wp-json/trerc-data/v1/housing-activity-table`) with manual export fallback | Texas-only | Normalize county + metro housing-activity series into `projectr_master_data`; raw exports remain optional | Precompute county / metro rows once; avoid runtime MLS rollups or broad joins |
| [TREC Building Permits](https://trerc.tamu.edu/data/building-permits/) | National data surfaced for Texas state / MSA / county / permit office | Monthly cumulative + annual | Official TREC public JSON endpoint (`/wp-json/trerc-data/v1/building-permit-table`) with export fallback | Reusable data, Texas-first MVP usage | Publish normalized county + metro permit metrics into `projectr_master_data`; raw permit-office extracts stay optional | Prefer pre-aggregated county / metro outputs; no raw permit-office joins on user requests |
| [Texas Demographic Center estimates](https://demographics.texas.gov/index/Census/Estimates) | Texas county / place / MSA / COG | Annual plus January snapshot | Official TDC totals API (`/api/Tpepp/Estimates/Totals/*`) with download fallback | Texas-only | Normalize county + metro population totals into `projectr_master_data` | Store per-vintage rows and latest aggregates; serve latest rows by geography key |
| [Texas Demographic Center projections](https://demographics.texas.gov/Projections/) | Texas county / MSA / COG | Annual 2020-2060 | Official TDC totals API (`/api/Tpepp/Projections/Totals/*`) with download fallback | Texas-only | Keep projected county + metro planning horizons in `projectr_master_data` via shared area keys | Precompute common horizons; do not join full projection matrices at runtime |
| [TxGIO land parcels](https://gio.texas.gov/stratmap/land-parcels.html) | Texas county parcel coverage varies | County refresh cadence varies; TxGIO attempts annual refreshes | DataHub shapefile / geodatabase download | Texas-only optional | Raw spatial source tables only when needed; not part of default MVP query path | Lazy county ingest only; never load statewide parcel payloads in the default map flow |
| [TxGIO address points](https://gio.texas.gov/stratmap/address-points.html) | Texas statewide aggregated address points | Iterative / ongoing updates | DataHub download | Texas-only optional | Optional raw geocoding / QA table, not a default end-user metric source | Keep offline or county-scoped; do not add to normal market-load payloads |

### Texas architecture note

- Shared core: keep `/api/market`, `/api/city`, `/api/aggregate`, shared map layers, and PDF/report payloads geography-neutral around ZIP / county / metro keys.
- Texas adapters: TREC and TDC ingestors should emit normalized metric rows into `projectr_master_data`, using Texas-specific raw/source tables only when the source shape cannot be represented cleanly as shared metrics.
- NYC gated features: PLUTO parcels, NYC DOB permits, borough search, and `run_analysis` stay intact, but appear only when the active geography is New York City.
- Expansion path: future states should add source adapters that map into the same shared geography keys instead of adding more state-specific UI branches.

### Texas performance note

- Do not fetch or render NYC-only parcel / DOB permit data outside NYC; keep those layers hard-gated by geography.
- Prefer precomputed county / metro aggregates from official Texas APIs / exports over runtime joins across raw MLS, permit-office, or demographic files.
- Reuse cached tract / block-group / metro lookup responses for common Texas geographies; keep Texas default loads to ZIP / city / metro payloads.
- Optional Texas parcel and address datasets should stay lazy and county-scoped so statewide MVP load time remains fast.
- Keep aggregate county / metro searches on a single shared resolver path, prefer obvious metro detection before city fallthrough, and load aggregate panel dependencies in parallel so Texas area searches stay responsive.
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
BIGQUERY_PROJECT_ID             # optional; overrides GOOGLE_CLOUD_PROJECT for server-side market-data router reads, but ADC-backed environments may omit it
BIGQUERY_DATASET_ID             # optional until BigQuery-backed historical reads are wired locally; adapters choose their own table names from the shared registry
BIGQUERY_LOCATION               # optional; defaults to US
MARKET_DATA_WARM_RETENTION_MONTHS # optional; defaults to 12 months
GOOGLE_APPLICATION_CREDENTIALS  # optional standard GCP service-account JSON path for server-side BigQuery auth; ADC also works
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # optional but recommended for ingest scripts that backfill new rows into `projectr_master_data`
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_GEOCODING_API_KEY         # optional server-only Geocoding API key; Client CSV / upload forward-geocode falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY if unset
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID   # must be a Vector map ID
GEMINI_API_KEY
GOOGLE_MAPS_STATIC_KEY           # optional; unused by current PDF exports (reserved if static map returns)
HUD_API_TOKEN                    # optional, falls back to Census ACS rent data
TRANSITLAND_API_KEY=             # free at transit.land/sign-up (Developer API, 10k queries/month)
```

BigQuery router reads use standard Google Cloud server credentials. If you want to exercise the helper locally, authenticate with Application Default Credentials or point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account JSON before calling it.
For a direct local probe, run `npm run check:bigquery` inside `projectr-analytics`; it prints the resolved dataset-scoped BigQuery config, the logical table identifiers, and performs a `LIMIT 1` query against the shared `master_data` table.

### First-time data setup
1. Download Zillow CSVs (see section below) into `zillow-csv's/` at repo root
2. `cd projectr-analytics && npm install`
3. In Supabase SQL Editor, run migrations under `projectr-analytics/supabase/migrations/`: `20260411120000_zip_geocode_cache.sql` (ZIP geocode cache), `20260411180000_zillow_zori_monthly.sql` (monthly ZORI for PDF charts), `20260411190000_saved_sites.sql` (analyst shortlist; requires Auth), and `20260411200000_saved_sites_aggregate.sql` (multi-area shortlist replay)
4. `npm run ingest:zillow` - loads Zillow data into Supabase
5. `npm run populate:centroids` - run 6-7 times until "All centroids already populated" (geocodes ~7,661 ZIPs)
6. `npm run ingest:permits` - ingests NYC DOB building permits into `nyc_permits` table (all 5 boroughs, NB/A1/A2/DM, 2022+); takes ~10-20 min
7. Optional Texas source loads: run the official-source fetchers directly with `npm run ingest:texas:housing -- --fetch [--scope county|metro|both] [--match houston,harris] [--limit 5]`, `npm run ingest:texas:permits -- --fetch [--scope county|metro|both]`, and `npm run ingest:texas:demographics -- --fetch [--dataset estimates|projections] [--scope county|metro|both] [--scenario High|Mid|Low]`; `--file <path>` still works as a manual fallback for local exports.
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
- `ingest:texas:housing`, `ingest:texas:permits`, and `ingest:texas:demographics` can now pull official TREC and Texas Demographic Center APIs directly, with `--scope`, `--match`, `--limit`, and projection-scenario flags for targeted Texas county / metro backfills and QA seeding.
- Added `lib/texas-raw-permits.ts` plus `/api/permits/texas/raw`, which maps Austin Open Data building permits into shared Texas raw permit records for new construction, major renovation, and demolition without changing the broader multi-state permit contract.

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

_04.17.2026_
- Fixed the market-data router scaffolding so `lib/data/types.ts` now exposes the router read row shape plus `normalizeBigQueryDateLike` and `warmMonthsRetention`, while `lib/data/bigquery.ts` is an explicit `server-only` BigQuery helper backed by `@google-cloud/bigquery` and the targeted Node test temporarily shims the module loader so it can import that helper safely.
- `normalizeBigQueryDateLike` now accepts BigQuery-style datetime strings with space separators and short UTC offsets such as `2026-04-17 15:30:00+00`.
- `normalizeBigQueryDateLike` now preserves the leading calendar date for BigQuery `DATE` and `DATETIME`-style strings without timezone drift, and BigQuery config now treats dataset/table plus ADC credentials as a valid configured state even when no explicit project env is set.
- Added `lib/data/postgres-master-data.ts` and `lib/data/bigquery-master-data.ts` as the shared market-data router adapter layer for latest submarket reads, area reads, metric series reads, BigQuery row normalization, and operational upserts.
- Added `lib/data/market-data-router.ts` as the central hot/warm/cold intent router, refactored the market, aggregate, area-metrics, momentum, metro-benchmark, cycle, normalize, ZIP-cache, and Texas ingest paths onto shared router reads/writes, and split older metric-series requests between BigQuery history and warm Postgres cache rows.
- The shared market-data router now preserves `ignoreDuplicates` behavior for `Client Upload` imports while leaving cache refreshes and source ingests on update semantics, and aggregate ZIP reads no longer destructure router results like Supabase responses or impose a synthetic hard cap when no limit is requested.
- Added `/api/county`, `/api/metro`, and `/api/area-metrics`, and wired aggregate search to fall through from city lookups to county / metro lookups for Texas-friendly county / ZIP / metro workflows.
- Texas-first demo warmups, slash help, and export/search messaging now use ZIP / county / metro wording instead of assuming city-or-borough-only flows.
- `/api/agent` now includes a shared county / metro Texas-style case-study example alongside the NYC-only parcel-model example so non-NYC briefs stay on the shared workflow instead of drifting toward borough logic.
- Aggregate area loads now run aggregate, cycle, transit, and trends fetches in parallel, and obvious metro-style searches try `/api/metro` before `/api/city` to avoid an unnecessary extra round trip on Texas-style metro queries.
- Added `/api/permits/texas`, which scopes official TREC place-level residential permit activity to Texas city / county / metro searches, caches hot responses, and resolves place centroids from `zip_metro_lookup` before falling back to Google geocoding.
- Added a shared CSV import decision-model contract in `lib/upload/import-decision-model.ts` and wired `/api/normalize` to request and parse richer Gemini interpretations, including mapability classification, detected schema, field mappings, confidence, fallback visualization, and user-facing explanation fields.

_04.18.2026_
- BigQuery config is now dataset-scoped instead of relying on one global `BIGQUERY_TABLE_ID`, and the shared table registry lets each adapter target its own BigQuery table while keeping the master-data router on `master_data`.
- Added `npm run check:bigquery`, a local BigQuery probe that prints the resolved config plus logical table identifiers and runs a cheap `LIMIT 1` reachability query against the shared `master_data` table.
- Cycle analysis and report generation now privately pull longer `Unemployment_Rate` and `Permit_Units` series through the shared market-data router when BigQuery history is configured, while preserving the existing behavior when the cold-history path is unavailable.
- Added a deterministic shared upload parser that now emits canonical headers, raw parsed rows, file metadata, sample rows, and early malformed-file rejection, and wired `/api/normalize` to consume that parser instead of reparsing uploads inline.
- `/api/normalize` now finalizes Gemini import triage against deterministic parser evidence, falls back to structural heuristics when Gemini is unavailable, and only geo-resolves uploads that actually expose mappable location fields.
- `/api/agent` is now a bounded EDA assistant with deterministic market/upload summaries, metric explanations, and a direct map-control lane for explicit search, layer, tilt, and panel requests instead of the old default multi-step reasoning flow.
- `/api/agent` now routes prompts through a shared intent classifier before choosing either the bounded EDA lane or the explicit map-control lane, keeping blocked/off-topic prompts, direct map commands, and analysis requests on one contract.
- Added the Phase 1 Scout chart and citation contract, extended `/api/agent` plus its NDJSON stream to return optional chart payloads with trace citations, and kept the response backward-compatible for text-only flows.
- `/api/agent` now uses the shared market-data router to return grounded unemployment or permit trend charts for active ZIP prompts, while unsupported trend requests still fall back to explicitly flagged placeholder series.
- `/api/agent` now also reuses the persisted `zillow_zori_monthly` history for grounded active-ZIP rent trend charts instead of treating rent trends as placeholder-only responses.
- Full-build verification now type-checks through the shared chart card, router adapters, Texas ingest helpers, and lazy Supabase client creation instead of failing earlier on eager client initialization or stale write-row aliases.

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
- The shared market page now reuses cached `/api/market`, `/api/aggregate`, `/api/transit`, `/api/cycle`, `/api/trends`, and area-lookup responses for repeated ZIP / county / metro loads so common Texas searches stop re-fetching the same payloads on replay.
- `/api/county` now falls back from broken Zillow county labels to TIGER county/ZCTA membership plus ZIP geocode validation, so thinner Texas counties like Brazos resolve without pulling adjacent-county ZIPs into the result.
- `/api/metro`, `/api/area-metrics`, and `/api/aggregate` now expand shared Houston metro aliases, so Zillow metro labels and TREC/TDC metro rows hit the same direct Texas fast path instead of dropping back to ZIP-derived aggregates.
- `/api/agent` now turns upstream Gemini overload and rate-limit failures into explicit retryable `503` / `429` responses instead of a generic `500`, so Texas-first agent flows fail more cleanly during provider spikes.
- `CommandMap` no longer re-runs multi-ZIP boundary fanouts on unrelated layer toggles, and stable map callbacks keep the memoized map surface from churning during high-frequency agent-thinking updates.
- `/api/market` now overlaps Zillow lookup with geocoding and live fetch work so single-ZIP Texas loads spend less time waiting on sequential server calls.
- Client CSV normalize no longer assigns the active market ZIP to non-spatial uploads, so sidebar-only imports stop masquerading as mapped market data or triggering unnecessary geocoding.
- Client CSV imports now commit the reviewed Gemini interpretation through import, preserve full parsed rows for sidebar/chart/normalize-for-map flows instead of truncating to the raw-table preview sample, and keep `map_normalizable` datasets marked as map-eligible even before markers resolve.
- Client CSV full-row datasets now persist outside `sessionStorage` in browser IndexedDB, imported row tables render in paged batches instead of mounting the full dataset at once, and reload fallback warnings stay explicit when durable row storage is unavailable.
- The default assistant path no longer runs the extra reasoning-stream pass or multi-step map-planning flow, which cuts duplicate Gemini work and removes high-frequency “thinking” updates from the main EDA workflow.
- Uploaded-dataset EDA profiles now cap live-row sampling before building workspace summaries, so large in-tab CSV sessions stop rescanning full imported row sets on every market-page render.
- The direct map-control lane now ignores analytical prompts such as trends, distributions, and top/bottom comparisons, so EDA requests stay in the analysis flow while explicit search and layer commands still work.
- Mixed market-plus-upload prompts now stay on the market snapshot when the request references market-only metrics like vacancy, while upload-focused prompts still stay on the imported dataset lane.
- “Why is this dataset not on the map?” style prompts now answer with the import’s actual fallback reason first instead of burying the mapability explanation behind a generic dataset summary.
- The assistant now supports hybrid prompts like “take me to Harris County, TX and explain this rent and vacancy snapshot” by executing the explicit map navigation first and deferring the analysis until the requested market is actually loaded.
- EDA fallback routing now normalizes partial workspace context instead of crashing on missing `uploadedDatasets`, `activeLayerKeys`, or market arrays, which keeps direct API calls and early UI states from failing with undefined `.length` errors.

_04.17.2026_
- Hybrid terminal navigation prompts now strip connector words and punctuation before the search query, so requests like `take me to Harris County Texas, and then explain rent and vacancy` no longer search for `harris county texas, and`.
- Hybrid map-control parsing now recognizes broader analytical follow-ups such as `walk me through` and `tell me about`, keeping navigation-plus-analysis prompts on the intended direct-search flow.
- `/api/agent` now uses a bounded Gemini fallback parser only when the deterministic direct-control parser cannot confidently resolve a map action, which keeps normal search/layer commands fast while rescuing messier terminal phrasing.

_04.18.2026_
- The shared chart card now accepts the full `recharts` tooltip and axis formatter value unions, fixing production type-check failures in the new Phase 1 visualization path.
- Shared router helpers and Texas ingest adapters now use explicit operational insert-row types instead of inheriting `geometry: unknown` from older Supabase row aliases.
- `lib/supabase.ts` now lazy-creates the client so builds no longer crash during module evaluation when local Supabase env vars are absent.
- The shared market search parser now recognizes trailing state names or USPS codes even without commas, so agent-driven searches like `harris county texas` route into the same county / metro / city resolution path as `Harris County, TX` instead of falling through to the city-only error path.
- Agent-driven search actions now canonicalize resolved geographies before dispatch, so the terminal emits queries like `Harris County, TX` and `Houston, TX` instead of lowercased raw prompt fragments that still need downstream cleanup.
- Natural-language terminal map controls now run through a bounded Gemini interpreter that can emit ordered actions like `search -> permits ON`, while slash-prefixed commands stay on the local deterministic fast path and filler like `please` no longer pollutes geography searches.

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
- Agent starter prompts, aggregate-search fallback errors, and internal agent search instructions now use ZIP / county / metro market language first so shared workflows stop reading like borough-first NYC flows.
- Intelligence terminal greetings, starter chips, and input placeholders now switch between Texas-first shared-market prompts and NYC borough-specific prompts based on the active geography, while export and save copy keep borough workflows secondary unless NYC is actually in play.
- The shared permit layer now renders Texas residential permit activity as a heatmap when zoomed out and 3D place columns when zoomed in, while NYC keeps the existing raw DOB permit points and type filters.
- Austin city searches now upgrade that shared permit layer to raw official permit records with category filters, detail cards, and source links, while unsupported Texas geographies still fall back to the cached aggregate permit activity layer.
- The CSV normalizer card now surfaces mapability status, fallback mode, confidence, and user-facing explanations so phase-2 import classification is visible without opening devtools.
- The left sidebar now includes an explicit `Upload` navigation item so the Client CSV workflow is reachable from the visible app shell instead of only by direct route or embedded panel access.
- The map-bottom assistant is now framed as an EDA assistant with Notes, evidence, caveats, and next-question UI instead of a generic “thinking” surface, while still honoring explicit map-control prompts.

_04.18.2026_
- Added a shared `recharts`-based Scout chart card with citation footer rendering in the live assistant terminal and bridged imported-data chart previews onto the same chart contract.
- The market report PDF now routes its rent, permit, and search-trends chart inputs through the shared Scout chart contract before rendering them with the existing React PDF chart components.

## Known Bugs

- **DC Metro velocity null** - Zips in the Washington-Arlington-Alexandria metro return `metro_velocity: null` because the metro name is too long to match the short name stored in `zillow_metro_snapshot`. The `getZillowData` function in `app/api/market/route.ts` needs smarter truncation logic for multi-city metro names.

- **ZHVF outlier values** - Some zips return extreme ZHVF forecast values (e.g. -50, -90, -10) from the Zillow CSV. These appear to be data artifacts. The UI currently caps display at ±50% and shows `-` for outliers, but the raw values are still stored in Supabase. The ingestion script should filter these on write.

- **Zillow `as_of_date` shows future date** - The ZHVF CSV uses forward-looking forecast dates (e.g. `2027-02-28`). This bleeds into the `as_of_date` field on the zip snapshot. The ingestion script should use the ZHVI or ZORI date as the canonical `as_of_date` instead.

- **Google Trends invalid JSON** - `lib/fetchTrends.ts` uses the unofficial `google-trends-api` client and assumes the upstream response is JSON; when Google returns an HTML throttle / anti-bot page instead, `queryTrends()` throws `Google Trends response was not valid JSON` and the dashboard interest section shows an error.

- **Transit lines missing but yellow circles remain** - When `TRANSITLAND_API_KEY` is absent or Transitland returns no drawable routes, `/api/transit` falls back to `lib/fetchGtfs.ts`; if that Overpass query fails and hits the smaller retry, the retry only requests stop nodes and no rail ways, so the map renders yellow subway entrance circles without PathLayer route lines.

- **EDA fallback still crashes on malformed profile entries** - `lib/eda-assistant.ts` now normalizes missing workspace arrays, but `/api/agent` can still throw if `uploadedDatasets` or `market.metrics` contain `null` entries; the fallback normalizer needs object-shape guards before it dereferences dataset and metric fields.
- **Full build still hits untyped Supabase route payloads** - `npm run build` now gets past the shared chart and router code, but older API routes like `app/api/borough/route.ts` still infer Supabase `data` payloads as `never[]`; each affected route needs explicit local row typing before the production build baseline is fully clean.

## Minor Gaps

- **Employment Rate (FRED)** - The FRED series search for "employed persons" at the county level doesn't reliably return a consistent series name across all markets. The computation (employed / labor force × 100) is built and ready, but the series lookup needs a more robust matching strategy. Revisit before demo.

- **FRED missing for large metros** - Zips in large counties (e.g. Prince William County, VA) sometimes return no FRED data because the search query times out or returns no match. Likely needs a fallback to a direct LAUCN series ID lookup using the county FIPS.

- **Population Growth 3yr is enrollment-sensitive** - For college towns, the 2019→2022 ACS population delta reflects COVID-era enrollment swings, not real migration. Consider adding a note in the UI or suppressing this metric for known university zip codes.

- **Metro detection still falls through city-first search** - Aggregate search still tries `/api/city` before `/api/metro` for non-county text queries, so obvious metro searches can pay an extra round trip before resolving. Add a narrow metro-query heuristic or a combined resolver if this shows up in real usage.

- **Building permits are county-level, not zip-level** - Census BPS data is aggregated at the county level. A zip like 22193 (Woodbridge) shares permit counts with all of Prince William County. This overstates activity for individual zip codes. Noted for the demo script.

- **Neighbor ZIPs only cover Zillow-tracked markets** - `zip_metro_lookup` is sourced from the ZORI CSV, which only covers ~7,700 ZIPs where Zillow has enough rental data. Rural ZIPs and non-rental markets won't have neighbor context on the map. This is acceptable for the target use case (active rental markets) but worth noting.

- **PDF rent sparkline** - After `zillow_zori_monthly` exists and `ingest:zillow` has run, the brief uses **real** monthly ZORI. If the table is empty or a ZIP has too few points, the PDF falls back to a modeled series (footnoted).
- **Cycle vacancy signal** - ACS vacancy in cache is a single vintage (level only); the classifier does not yet compute vacancy YoY until multi-year ACS rows exist in the pipeline.

- **Client CSV forward geocode limits** — After ZIP + explicit lat/lng handling, **non-ZIP** geo cells (street addresses, `City, ST`, etc.) are sent to the **Google Geocoding API** (up to **50** unique strings per upload). Enable **Geocoding API** on the GCP project; use `GOOGLE_GEOCODING_API_KEY` or the same key as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Ambiguous or non-US strings may return no pin; very large files need chunking or a higher cap (not implemented).

- **Large map payloads** - `transit`, `tracts`, and some permit views still return raw JSON / GeoJSON instead of viewport-tiled or binary map data, so very large markets need server-side tiling or stronger bbox filtering to stay smooth.

- **Reusable analyst workflow packaging** - Scout currently reads as a Projectr-specific consulting workspace; broadening it into a reusable product for other analyst teams would require templated workflows, sharable deliverables, and less client-specific framing in the UX.
- **EDA comparisons are workspace-bounded** - The assistant can compare loaded segments and whatever geography is already in context, but it does not yet fetch a second peer geography on demand; that still needs the later context-aware comparison phase.
- **Reloaded upload EDA can still fall back to sampled rows** - Imported datasets persist full rows in IndexedDB, but the assistant may still analyze the raw-table sample after a reload until the larger working-row payload is rehydrated into the current session.
- **County search still depends on available ZIP coverage for map overlays** - The county route now uses TIGER county/ZCTA fallback plus ZIP geocode validation, but counties with very thin Zillow or boundary coverage can still load the aggregate panel with only a small ZIP set on the map; fixing that cleanly would require a broader county-to-ZIP source or county polygon rendering as a first-class shared path.
- **Full Texas TREC backfills are network-heavy** - The new direct TREC fetch mode removes manual export prep, but statewide county + metro backfills still make hundreds of remote requests; use `--scope`, `--match`, and `--limit` for fast QA seeds until we add scheduled/background ingest orchestration.
- **Texas raw permits currently only work in Austin** - Austin is the only Texas market with a wired row-level permit feed in Scout today because the Austin Open Data source exposes usable permit records that can be normalized into the shared raw-permit schema for New Building, Demolition, and Major Renovation views. Dallas, Houston, San Antonio, Fort Worth, and the rest of Texas still fall back to TREC place-level monthly permit activity because they do not yet have shared, normalized raw permit adapters in this repo.

- **Read-heavy runtime** - Most user interactions fan out into repeated reads across market, transit, trends, cycle, parcel, tract, boundary, amenity, POI, and flood routes; writes are mostly limited to ingestion and saved-site mutations, so the current tooling is better at read-heavy workloads than write-heavy ones.

- **NoSQL is not the first fix** - The current scaling pressure is read fan-out and payload shape on top of Postgres/PostGIS, so the near-term fix is caching, tiling, and query-shape work rather than a datastore migration.

## Client CSV & AI session

- **Where it lives** — The **last normalize** triage + preview live in `sessionStorage` (`projectr-client-upload-session`); pin coordinates live in `projectr-client-upload-markers`. You can **ingest multiple CSVs in one drop** (up to 8); markers are **merged and deduped** by lat/lng/label, previews concatenated (capped), and each file still runs `POST /api/normalize` sequentially (separate Gemini triage + Supabase upserts per file). Rows only **upsert into Supabase** `projectr_master_data` when normalize can identify a real geography key or metric value, and `submarket_id` now comes from the row’s own resolved geography rather than the currently loaded market ZIP. The EDA assistant reads the combined snapshot via `mapContext.clientCsv` plus compact deterministic workspace summaries on every `/api/agent` call. **Pins:** explicit lat/lng columns, **5-digit ZIP** (Zippopotam/Census), then **address / place text** via Google Geocoding when a key is configured (`lib/google-forward-geocode.ts`, wired in `POST /api/normalize`).

- **No market loaded** — You can upload first, then chat with the EDA assistant: context still includes the CSV block; pins render when the **Client** layer is on (default **on**). If the CSV has mappable rows, the map auto-fits to those pins until you load a ZIP or city.
- **EDA + CSV** — Upload CSV(s) **before** asking for summaries, outliers, trends, or data-quality checks so `mapContext.clientCsv` and the workspace EDA summaries are populated; map-ready imports can still be surfaced on the Client layer, while non-map datasets stay in table/chart analysis mode. When both an upload and a market snapshot are active, the assistant now chooses between them from the prompt itself instead of always defaulting to the upload.
- **Clear local test data** — On the map, run **`/clear:workspace`** in the EDA assistant (confirm + reload) to remove session keys (`projectr-client-upload-session`, `projectr-client-upload-markers`, `projectr-agent-chat-v1`, `projectr_pending_nav`); does not delete Supabase rows or shortlist.

- **After you load a new location** — Session pins and the assistant CSV context **stay** until you upload another file or clear pins; they are **not** tied to the searched ZIP. Supabase ingested rows are keyed by **row geography + metric + period**, not by whatever ZIP is on screen—so changing markets does not delete prior uploads, but the **Data** tab metrics view is still filtered to the **current** market unless you query elsewhere.

- **Shortlist** — `saved_sites` stores label, ZIP/aggregate hint, geo, cycle snapshot, and notes only; it does **not** store CSV blobs or agent transcripts. Restoring a shortlist row reloads that market, not a prior upload or chat (see **Deferred**).
- **Reset local workspace (QA)** — Use **`/clear:workspace`** on the map EDA assistant to wipe this tab’s Client CSV session, pins, assistant chat, and pending sidebar→map navigation, then reload. Ingested **Client Upload** rows remain in Supabase until you remove them in the database.
- **EDA assistant** — Type **`/`** for suggestions; **`/help`** lists commands; **`/view`**, **`/tilt`**, **`/rotate`**, **`/go`**, **`/layers:`…**, **`/clear:`…** (see changelog); **`/clear:workspace`** runs **Clear local test data** (confirm + reload). **`/clear:terminal`** and **`/clear:memory`** replace the visible transcript with the default greeting only (no echo of the slash command); **`/restart`** clears to the y/n prompt the same way. Inputs starting with **`/`** are always local commands, and unknown commands return an error instead of reaching Gemini; natural-language prompts are screened for bounded EDA relevance or explicit map-control intent before `/api/agent` runs.

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

- **Client CSV inline command-center integration** — The sidebar now links to **Upload**, but the import workflow is still split between `/upload`, the imported-data panel, and the map Client layer. Unifying review, normalization, fallback views, and map activation into one command-center surface is still deferred.
- **CSV import review and non-map fallback UI** — Uploads now go through an explicit review step before commit, then land in an imported-data workspace that exposes the chosen rendering path. Map-ready datasets flow to the Client layer, while non-map datasets stay visible through summary cards, raw tables, and chart fallbacks on `/upload` and in the command-center sidebar.
- **Normalize for map follow-up** — `map_normalizable` imports now expose an explicit **Resolve geography** step inside **Imported Data**. Projectr previews how many rows have usable location clues, attempts ZIP/address normalization through the existing upload geocode path, updates per-dataset workflow state (`mapped`, `sidebar_only`, `errored`), and promotes successfully resolved rows onto the Client layer without requiring a re-upload.
- **Open-ended strategy mode** — The default assistant is intentionally EDA-only. If Scout ever brings back speculative investment or strategy guidance, it should ship as a separate gated surface with its own evidence rules and approval model rather than leaking back into the default map assistant.

- **Texas parcel polygons outside NYC-style workflows** — TxGIO parcel coverage is optional, county-scoped, and not normalized into the default MVP path. Wiring parcel polygons across Texas cleanly would require county-on-demand ingest, spatial tiling, and a separate shared parcel contract so statewide loads do not wreck latency.

- **Statewide raw Texas permit records** — Texas now has a live place-level permit activity layer, but Austin is the only city with parcel / filing-level raw permit records wired into the shared map flow. The broader statewide raw-permit pass is still deferred because the current TREC source is aggregated by place-month, and adding Dallas, Houston, San Antonio, Fort Worth, or county-on-demand raw records would require city-specific source validation plus new normalization adapters.

- **Shortlist attachments (CSV + agent chat)** — Would require `saved_sites` JSONB column(s) or a sibling table, size limits, and UI to “attach workspace” on save plus restore flow (rehydrate markers store + optional transcript). Blocked on schema/auth product decisions.

- **Travel-time accessibility scoring** - Adding Google routing-based catchments or commute-time scoring would strengthen site-selection analysis and the Google technology story, but it is deferred until scope, quota, and UX tradeoffs are defined.
