# Projectr Analytics

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
GOOGLE_MAPS_STATIC_KEY           # optional; Static Maps API for PDF brief (falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
HUD_API_TOKEN                    # optional, falls back to Census ACS rent data
TRANSITLAND_API_KEY=             # free at transit.land/sign-up (Developer API, 10k queries/month)
```

### First-time data setup
1. Download Zillow CSVs (see section below) into `zillow-csv's/` at repo root
2. `cd projectr-analytics && npm install`
3. In Supabase SQL Editor, run migrations under `projectr-analytics/supabase/migrations/`: `20260411120000_zip_geocode_cache.sql` (ZIP geocode cache), `20260411180000_zillow_zori_monthly.sql` (monthly ZORI for PDF charts), `20260411190000_saved_sites.sql` (analyst shortlist; requires Auth), and `20260411200000_saved_sites_aggregate.sql` (city/borough shortlist replay)
4. `npm run ingest:zillow` - loads Zillow data into Supabase
5. `npm run populate:centroids` - run 6-7 times until "All centroids already populated" (geocodes ~7,661 ZIPs)
6. `npm run ingest:permits` - ingests NYC DOB building permits into `nyc_permits` table (all 5 boroughs, NB/A1/A2/DM, 2022+); takes ~10-20 min
7. `npm run dev`
8. Optional before demos/recordings: with `npm run dev` running, `npm run warm:demo` - warms cache for ZIPs 11201, 10001, and 60614 via market/transit/trends/cycle APIs (`WARM_BASE_URL` overrides default `http://127.0.0.1:3000`).

### Known setup issues
- **Shortlist / `saved_sites`** - enable **Anonymous sign-ins** under Supabase Authentication → Providers (or use email/OAuth); the app calls `signInAnonymously()` when there is no session so `saved_sites` inserts satisfy RLS.
- **Turbopack + Tailwind** - if you get `Can't resolve 'tailwindcss'`, kill any stale `next dev` processes and restart fresh. Stale processes hold onto old module resolution state.
- **Google Maps Map ID** - must be a Vector type map for deck.gl `interleaved: true` mode. Raster maps cause `fromLatLngToDivPixel` errors.
- **Zillow CSVs are gitignored** - they exceed GitHub's 100MB file limit. Each teammate needs to download them locally and run `ingest:zillow` once.
- **`ingest:zillow` runtime** - writing every ZIP × month into `zillow_zori_monthly` adds many upsert batches; expect a longer first run than snapshot-only ingests (on the order of tens of minutes depending on network and Supabase rate limits).

## Changelog

**Data Pipeline**

_4.8.2026_
- Set up Supabase project with PostGIS - universal `projectr_master_data` table, `zillow_zip_snapshot`, `zillow_metro_snapshot`, and `zip_metro_lookup` tables with RLS policies and upsert constraints
- FRED integration - monthly unemployment rate + real GDP via dynamic series search
- Census ACS integration - population, median income, gross rent, migration, housing units, vacancy rate, 3yr population growth (2019→2022)
- HUD/Census B25031 fallback - fair market rents by bedroom (studio through 4BR), with optional HUD API token upgrade path
- Census BPS integration - building permit counts, units, and construction value (2021–2023) via direct CSV download
- Zillow Research ingestion script (`npm run ingest:zillow`) - processes 6 CSVs into Supabase: ZORI, ZHVI, ZHVF (zip-level) + Days on Market, Price Cuts, Inventory (metro-level)
- `zip_metro_lookup` table with `metro_name_short` for metro velocity joins
- GTFS transit stop fetcher - Overpass API (OSM) for all markets with retry/backoff, direct BT GTFS zip fallback for Blacksburg
- Google Trends fetcher - city-level search interest with automatic state-level fallback for small markets
- Census TIGER ZIP boundary API (`/api/boundaries`) - returns GeoJSON polygon for any US zip, 30-day cache
- Populated lat/lng centroids for 7,661 ZIPs in `zip_metro_lookup` via zippopotam + Census 2020 ZCTA internal point (TigerWeb) when place lookup fails
- Neighbor proximity API (`/api/neighbors`) - returns 20 closest ZIPs in same metro sorted by geographic distance

_4.9.2026_
- Added Census block group API (`/api/blockgroups`) - sub-ZIP boundaries + population density from Census TIGER + ACS
- Added OSM buildings API (`/api/buildings`) - building footprints with floor count via Overpass
- Market API now returns `stateFips` and `countyFips` in geo object

_4.12.2026_
- Added `zillow_zori_monthly` table (ZIP + month + ZORI value) and migration; `ingest:zillow` upserts every historical month from the ZORI CSV for chart-quality rent trends

_4.11.2026_
- `POST /api/normalize` forward-geocodes non-ZIP geography cells (street addresses, city+state, etc.) with the Google Geocoding API via `lib/google-forward-geocode.ts` (same key pattern as `/api/upload/geocode`), up to 50 unique strings per upload, after lat/lng and ZIP centroid resolution.

**Infrastructure**

_4.8.2026_
- Scaffolded Next.js 16 app with TypeScript, Tailwind CSS, Recharts, Lucide Icons
- Built full data pipeline with 7-day Supabase cache and cold-start fetch logic
- API routes: `/api/market`, `/api/transit`, `/api/trends`, `/api/boundaries`, `/api/neighbors`, `/api/normalize` (Gemini triage)

_4.9.2026_
- Added `/api/city` - resolves city name to all ZIP codes with Zillow data; supports "City, ST" format with zippopotam fallback for smaller markets

_4.11.2026_
- `/api/city` - `state` query param accepts full state names (e.g. New Jersey) or USPS codes; normalized via `lib/us-state-abbr.ts` and matched with `.eq` on `zip_metro_lookup.state`; unrecognized states return 400 with a clear message
- `POST /api/agent/case-brief` - Gemini 2.5 Flash returns structured JSON for a case-study brief (optional JSON clients)
- `POST /api/agent/case-brief/pdf` - same payload as case-brief; runs Gemini then renders `@react-pdf/renderer` `CaseBriefPdfDocument` and returns `application/pdf` with `Content-Disposition: attachment` (shared prompt/builder in `lib/report/case-brief-shared.ts`); PDF header uses `public/Projectr_Logo.png` when present, includes market snapshot from `mapContext`, composite score chart and site metrics table from raw sites, paginated per-site narratives with FAR bars, and expanded brief sections (findings, thesis, risks/mitigations, next steps, assumptions).
- Docked AI chat stays mounted when the sidebar panel closes (`AgentChat` receives `isOpen={agentOpen}` and a `hidden` wrapper) so the transcript survives close/reopen; `sessionStorage` key `projectr-agent-chat-v1` persists messages and the case-brief bundle for the same browser tab/session.

_4.11.2026_
- Added `/api/borough` - resolves NYC borough name to all ZIPs + Census TIGER county boundary + Zillow aggregates
- Added `/api/aggregate` - POST endpoint that computes weighted-average stats (rent, income, vacancy, FRED, metro velocity) across a list of ZIPs for city/borough mode
- Added `/api/agent` - Gemini 2.5 Flash AI agent endpoint; returns structured JSON with `message`, `action`, and `insight` fields for map control
- Added `/api/memo` - server-side Gemini 2.5 Flash executive memo generation (fallback for client-side key errors)
- Added `/api/permits` - serves pre-ingested NYC DOB permit data from Supabase; supports borough, ZIP, and job-type filters
- Added `npm run ingest:permits` script - pulls NYC DOB job filings (Socrata `ic3t-wcy2`) for all 5 boroughs, job types NB/A1/A2/DM, 2022+; deduplicates within batches to avoid Supabase conflict errors
- Fixed `/api/agent` 500 error caused by corrupted template literal dollar-sign formatting in `contextStr`
- ZIP geocoding now falls back to Census TigerWeb 2020 ZCTA internal points instead of a synthetic `1 Main St` address match; successful lookups upsert into Supabase `zip_geocode_cache` (365-day refresh) so cold starts reuse coordinates
- Multi-page **market brief PDF** - `POST /api/report/pdf` builds a designed analyst document with `@react-pdf/renderer` (cycle headline + Gemini narrative, four signal tiles, metrics vs metro, ZORI trend from `zillow_zori_monthly` when populated else modeled fallback, BPS bars, Trends line, Static Maps snapshot with ZIP polyline + pins, optional site comparison when 2+ client pins); city/borough exports average monthly ZORI across listed ZIPs when ≥2 peers
- Market brief PDF **Gemini dossier** (`lib/report/gemini-market-dossier.ts`) - after page 1, two additional structured pages for the whole submarket (ZIP, city aggregate, or borough): geography framing, long executive summary, four themed deep-dive cards, peer/benchmark narrative, risks vs opportunities, underwriting scenarios, monitoring checklist, and limitations; fed by full report JSON, cycle classifier, metro benchmark, and signals (separate from the short cycle-headline pass in `gemini-brief.ts`).
- Added `GET /api/metro-benchmark` - metro peer average ZORI/ZHVI from `zip_metro_lookup` + `zillow_zip_snapshot`; also returns peer simple means for ACS vacancy, ACS migration (movers / ZIP), and latest FRED unemployment per peer ZIP when `projectr_master_data` has rows (PDF “Metro peer avg” column)
- `next.config.js` lists `@react-pdf/*` in `serverExternalPackages` for reliable server PDF rendering
- Added `GET /api/cycle` - deterministic market-cycle classifier using only cached Supabase data (ZORI 3-month slope when `zillow_zori_monthly` has enough months else snapshot YoY, ACS vacancy level, county BPS permit YoY and acceleration, FRED unemployment ~6-month change); returns position, stage, confidence, four scored signals with transparent `source` strings, data-quality flag, and Gemini narrative; PDF `POST /api/report/pdf` uses client-supplied `cycleAnalysis` or recomputes from `primaryZip`; site comparison adds a cycle column via the same classifier (`skipGemini` for peers); PDF page 1 adds `lib/report/pdf-cycle-visual.tsx` (200×200pt quadrant wheel with dot + trajectory stroke, then four horizontal tiles with green/gray/red backgrounds and Unicode trend arrows).
- PDF market brief layout refresh: 260pt tinted quadrant wheel; cycle map + caption beside wheel, then full-width horizontal signal row; Unicode ↑/↓/→ on tiles and in the metrics “Signal” column; permit bars show unit counts plus Y-scale caption; sparklines show min/max hints; map snapshot `640×420` / 515×420pt with a single caption line; `gemini-cycle-narrative` passes explicit signal lines; null-safe `sanitizeCycleSignalText` + `wrap` on narrative and tile text to avoid clipped or blank bodies; Page 2 signal column coerces stringified scores before drawing arrows.
- `20260411190000_saved_sites.sql` adds `saved_sites` (ZIP, geo, cycle/momentum snapshot, notes, `user_id`) with RLS; the client uses Zustand (`lib/sites-store.ts`) and attempts `signInAnonymously()` when unauthenticated so rows can be written after Anonymous Auth is enabled in Supabase.
- `/api/agent` system prompt lists `nycPermits` (not `permits`) so Gemini layer toggles match `CommandMap` layer keys.
- `npm run warm:demo` - `scripts/warm-demo-zips.ts` warms `/api/market`, `/api/transit`, `/api/trends`, and `/api/cycle` for demo ZIPs 11201, 10001, and 60614; run with dev server up; optional `WARM_BASE_URL` override.
- Added `/api/pois` - Overture Maps POI endpoint; returns categorized places (coffee, grocery, pharmacy, fitness, schools) + named anchor tenants (Whole Foods, Equinox, SoulCycle, etc.) by lat/lng radius; 7-day cache; nationwide coverage
- `/api/agent` system prompt: multi-step `steps` for case studies; `permits` vs `nycPermits` vocabulary aligned; explicit post-`run_analysis` client behavior (auto-off parcels/permits, pins); infer geography from the brief (no Manhattan default); NYC-only `run_analysis` boundary called out.
- `/api/agent` prompt adds MODE A (exploration / “what to visualize” → single `action`, no `steps`, no `run_analysis`) vs MODE B (full case study) vs MODE C (follow-up when `hasRankedSites`); agent `contextStr` includes ranked-site pin state from the map page.
- `/api/agent` receives **CLIENT CSV (last upload)** in `mapContext.clientCsv` (triage, row count, pin count, reasoning); new action `focus_data_panel` opens the sidebar Data tab; prompt instructs Gemini to turn on `clientData` when pins exist and otherwise steer users to Data.
- Mock **Brooklyn workforce TOD** case study + two sample CSVs (`fixtures/brooklyn-workforce-housing-case-study/`) — one address-based file for map pins, one quarterly borough trend file for temporal/Data-tab testing.
- **Client CSV** normalizer accepts **multiple files per drop** (up to 8); merges map pins + session metadata; legacy single-file sessions still hydrate from `sessionStorage` via `aggregateClientUploadSession`.
- `/api/agent` MODE B ties pasted case studies to **CLIENT CSV** context when `rowsIngested > 0` (narrate uploads, toggle `clientData`, `focus_data_panel` for non-pin data).
- Resolved merge with `origin/aidan-branch`: `page.tsx` passes both `layerStateResync` and `map3DActive` / `onToggleMap3D` to `CommandMap`; `CommandCenterSidebar` keeps collapsible nav (Map / Client CSV / Guide), **Testing** + clear-local, and primary-tint search spinner; `/upload` uses the shared header + Documentation link with merged Client CSV / cone-pin copy; `POST /api/normalize` triage prompt appends `GEMINI_NO_EM_DASH_RULE`; dropped conflicted `tsconfig.tsbuildinfo` (rebuild with `tsc --build` if you use project references).

_4.12.2026_
- `/api/trends` — optional `city` + `state` (USPS 2-letter) and `anchor_zip` (5 digits) skip ZIP geocoding and build the same keyword/geo flow; JSON adds `geo_note`, `empty_message`, and a soft `error` (HTTP 200) when Google Trends fails or returns no series; `fetchTrends` surfaces errors instead of failing silently
- `/api/agent` system prompt documents **`set_heading`** (map bearing, clockwise from north) alongside existing actions.
- `lib/gemini-text-rules.ts` exports `GEMINI_NO_EM_DASH_RULE` appended to Gemini prompts (including `/api/agent`, `/api/memo`, `/api/normalize`, `case-brief-shared`, `gemini-brief`, `gemini-market-dossier`, `gemini-cycle-narrative`, `ExecutiveMemo`, `suggest-location-column`) so model copy avoids Unicode em dash (U+2014).
- Merged `origin/main` into this branch; `README.md` conflict under **Map & Visualization** resolved by keeping the full changelog here (main currently carries a short stub README only).

**Bug Fixes**

_4.11.2026_
- Agent layer JSON uses `permits` but `CommandMap` state uses `nycPermits`; overrides never cleared the permits layer after analysis - `lib/agent-map-layers.ts` normalizes keys in `page.tsx`, context denormalizes for Gemini, `CommandMap` treats `permits` as an alias; post-`run_analysis` flow clears agent permit filter; `/api/agent` prompt documents auto hide of parcels/permits after crunch and generic case-study parsing (NYC `run_analysis` only).
- After `run_analysis`, `AgentChat` only cleared parcels and permits, so census **tracts** (and **block groups**) stayed on when Gemini had turned them on for demographics; cleanup now sets `tracts` and `blockGroups` off before `show_sites`, and the agent system prompt documents the same.
- Agent `fly_to` from analysis cards: fixed camera animation failing or zooming out endlessly (React Strict Mode + per-frame `setCenter`/`setZoom`); `FlyToController` now uses `moveCamera`, linear eased zoom, and `[lat, lng]` effect deps.
- Map layers chrome used `flex` inside an absolutely positioned box, so the row stretched across the full map width and left a large empty gap between the layers sheet and the dots/toggle; fixed with `w-max`, `left: auto`, and `flex-row-reverse` so dots/toggle are first in DOM and sit flush to `right`, with the sheet immediately to their left.
- PDF cycle classifier tiles and Page 2 metrics “Signal” column again use Unicode arrows (↑/↓/→) instead of ASCII `+` / `-` / `~` now that Standard font rendering is verified in `@react-pdf`.
- PDF brief signal tiles could render as label-only boxes (narrow column + missing string fields); reverted to horizontal signal row, added `wrap` on narrative and tile lines, and hardened sanitizer / score coercion so direction/value/source and table arrows render reliably.
- PDF `parseCycleAnalysisField` now coerces JSON round-trips (string scores `"1"`, numeric ZIP `10001`, string confidence counts) so client-supplied `cycleAnalysis` is not dropped; signal tiles use fixed column widths (`23.5%`) because `flex:1` rows often give Text zero width in `@react-pdf`; Page 1 headline and body sit in a full-width column with `wrap`, explicit width, and disabled hyphenation to stop mid-sentence clipping.
- PDF brief trend indicators use **SVG stroke arrows** (`lib/report/pdf-trend-arrow.tsx`) instead of Unicode ↑/↓/→ - Standard Helvetica in PDF has no those code points and viewers substitute junk (`"`, `,`); narrative uses a fixed **515pt** content column, paragraph split on newlines, and curly-apostrophe normalization for reliable `@react-pdf` wrapping.
- PDF narrative `Text` uses **numeric 515pt width** (not `%`) and optional **sentence splitting** so long summaries don’t clip as a single truncated line; cycle Gemini narrative uses **2048 max output tokens** and falls back to the deterministic paragraph if the model stops with `MAX_TOKENS` (avoids endings like “confidence (9”).
- Restored `lib/sites-store.ts` (shortlist Zustand + `saved_sites` + `signInAnonymously`) after it was missing from the tree, which broke imports from `page.tsx`, `ShortlistPanel`, and `SitesBootstrap`.
- `POST /api/normalize` Gemini triage sometimes returned JSON wrapped in markdown or leading prose — now uses `responseMimeType: 'application/json'`, brace-balanced extraction, and field validation so temporal CSVs (e.g. quarterly borough series) no longer fail with “invalid JSON”.
- Fixed **ReferenceError: Cannot access AGENT_CHAT_STORAGE_KEY before initialization** — `local-workspace-reset` no longer imports from `use-agent-intelligence` (cycle); shared key lives in `lib/agent-chat-storage-key.ts`.
- Map showed **no ZIP choropleth or borough outline** with defaults because **`zipBoundary` defaulted to false** while **`rentChoropleth` was true** (deck layers only draw fills on ZIP polygons when boundaries are on); defaults now enable **ZIP boundaries** in `CommandMap` and `DEFAULT_MAP_LAYERS` on `page.tsx`, and the borough outline no longer waits on `cityBoundaries.length`.
- **`/clear:layers` (and agent `toggle_layers` with every layer off)** wrote **`false` into `agentLayerOverrides`**, which **overrode** `CommandMap`’s internal toggles — layers stayed off until every override was cleared; **all-off patches** now **clear overrides** and **resync** map state via `layerStateResync` + `patchTurnsEveryLayerOff` in `agent-map-layers.ts`. **Layer pill clicks** now flip from **effective** visibility (`!effectiveLayers[key]`) so one click recovers after overrides. **DeckGlOverlay** used `setProps` before the overlay finished attaching — **`overlayReady` state** ensures the first non-empty `layers` array is applied.
- **Transit OSM fallback vs `PathLayer`** — Overpass routes used **`path`** while the map expected **`paths`** (Transitland); **`lib/fetchGtfs.ts`** now emits **`paths`** + **`color`**, caps ways/points, and **`CommandMap`** normalizes legacy **`path`** and caps segment count for performance.

_4.12.2026_
- `GoogleMapsOverlay` in `CommandMap` used `interleaved: false` while the app targets a **Vector** Map ID; current Maps JS can call `deck.getViewports()[0].project` before a non-interleaved deck has viewports — switched to **`interleaved: true`** (matches README’s deck.gl vector guidance).
- `CommandMap` optional perf logging (`NEXT_PUBLIC_PERF_DEBUG=1`) used `useEffect` without a dependency array; React 19 rejected an inconsistent inferred dependency list — logging now runs as a guarded render counter (client-only) before return.
- PDF market brief signal tiles used Unicode arrows that Helvetica cannot render in `@react-pdf`; replaced with ASCII direction marks (`+` / `-` / `~`).
- Analytical cycle PDF tiles use the same ASCII arrows; `sanitizeCycleSignalText` + `sanitizeCycleAnalysisForDisplay` strip Gemini/JSON quote wrappers and `\\"` artifacts from signal lines, narrative, and confidence text on `/api/cycle`, PDF payload parse, and tile render.
- `/api/aggregate` city/borough vacancy returned null when `Total_Housing_Units` / `Vacant_Units` were missing from `projectr_master_data` even though ACS `Vacancy_Rate` existed; aggregate now falls back to population-weighted (or simple average) per-ZIP vacancy rates.
- `/api/aggregate` BPS permits: PDF bar chart was empty because multiple `Permit_Units` years overwrote each other in cache and multi-ZIP sums were wrong; aggregate now returns `permits.by_year` from one anchor ZIP’s county-level BPS rows and sums `Moved_From_Different_State` for migration on the PDF.
- `/api/aggregate` cold-fills up to 16 ZIPs (parallel batches of 4) with the same Census/BPS/FRED/HUD fetch as `/api/market` when no `projectr_master_data` exists for the area - borough/city searches no longer require a prior single-ZIP load for PDF metrics.
- FRED county search uses NYC borough county names (e.g. Richmond County for Staten Island) so unemployment/employment series resolve instead of `Staten Island County NY`-style mismatches.
- Map layer chrome drifted into the map (read as “top-center”) when the right data panel was open - `reservedRightPx={300}` was wrong for the current layout (panel is a flex sibling, not overlaying the map), so the stack was offset an extra 300px left; removed `reservedRightPx`; later IA pass moved controls to **top-left** of the map (`left-4 top-4`) with `[dots][sheet]` order.

**Map & Visualization**

_4.9.2026_
- Removed OSM 3D Buildings layer - deleted `PolygonLayer`, `BuildingFeature`/`BuildingCollection` interfaces, `CameraSampler` component, all buildings fetch/debounce logic, and `/api/buildings` route

_4.11.2026_
- NYC PLUTO parcels now support borough mode - auto-detects borough from city ZIP range and fetches all parcels via `/api/parcels?borough=`
- Overture Maps POI `ScatterplotLayer` - color-coded by category (anchors=orange with white outline, coffee=brown, grocery=green, pharmacy=blue, fitness=pink, school=yellow); anchor tenants rendered larger (10px) vs signals (5px); nationwide coverage via Overture Maps API
- NYC PLUTO parcels now include FAR/air rights data - `builtfar`, `residfar`, `commfar`, `facilfar`, `air_rights_sqft` ((max_far - built_far) × lot_area), `far_utilization`; parcel color mode toggle in layer panel switches between Land Use and Air Rights (green=low potential → red=high); top underbuilt lots surfaced in stats
- Momentum score layer - `/api/momentum` upgraded to use Zillow ZORI 12m growth + population growth alongside FRED unemployment and Census BPS permits; renders as ZIP choropleth (purple=weak → orange=strong); separate layer toggle; fetches on toggle, scores all loaded ZIPs at once
- NYC permits zoom-adaptive visualization - `HeatmapLayer` (zoom < 15, NB+A1 weighted, orange gradient), `ColumnLayer` 3D columns (zoom ≥ 15, height = log cost, NB=orange/A1=blue/DM=red); all filtering is client-side from a single upfront fetch - no API calls on pan/zoom; multi-select type filter pills (New Bldg/Major Reno/Demo) in layer panel; clickable 3D columns open detail panel with address, cost, stories, units, filing date- Layer panel redesigned as pill buttons with colored dot indicators - removed all emojis and default HTML styling
- Added map tilt and heading sliders to layer panel
- Disabled Google Maps default UI controls (map/satellite toggle, zoom buttons, fullscreen, street view)
- Removed Data Layer Status dev sidebar
- Borough boundary rendered as orange (`#D76B3D`) outline `GeoJsonLayer` on top of city ZIP choropleth
- AI agent layer overrides wired to map — `agentLayerOverrides` and `agentMetric` props merge into effective layer/metric state
- Default layer preset: **ZIP boundaries** and **rent/value fill** and transit on (ZIP outlines are required to draw the choropleth); client pins, permits, tracts, blocks, amenities, flood, and parcels off until enabled (`CommandMap` + `MapLayersSnapshot` on the home page).
- Borough orange outline draws whenever `boroughBoundary` is set — no longer waits for all per-ZIP boundary fetches to finish.
- **Transit OSM fallback** (`lib/fetchGtfs.ts`) now emits **`paths`** + **`color`** like Transitland so `PathLayer` draws route lines (the old singular **`path`** was ignored by `CommandMap`); longest ways are kept first, capped at **100** with **160** max points per polyline to limit deck.gl load; **`CommandMap`** still accepts legacy **`path`** and caps total path segments at **400** for dense markets.
- Case-study analysis site cards (`fly_to`): map camera eases ~1.6s via `moveCamera` (center + zoom + preserved tilt/heading); effect keys on lat/lng only and avoids Strict Mode skip / runaway zoom from the prior `setCenter`+`setZoom` loop.
- Case brief PDF (`CaseBriefPdfDocument`): key findings as bordered cards with accent stripe, index, optional stat pills; Gemini schema asks for structured `keyFindings` objects (legacy string bullets still normalize); dedicated page with paired charts — composite score + air rights (horizontal M sqft), FAR % + permit counts, optional ZORI YoY bars when all site values are non-negative and vary; market signal tiles get a light tinted panel; `HorizontalBarChartPdf` + `formatValue` in `lib/report/pdf-charts.tsx`.
- With no ZIP or city ZIP list loaded, the map **fitBounds** (or centers) on **client CSV pins** so a cold start → upload → Map path is not stuck on the default Virginia center.

_4.8.2026_
- Google Maps + deck.gl map with `GoogleMapsOverlay` (interleaved vector mode)
- ZIP boundary choropleth colored by ZORI rent, normalized across all loaded ZIPs for relative contrast
- Transit stop ScatterplotLayer (cyan dots) with hover tooltips
- Multi-ZIP metro context - loads 20 nearest ZIPs and renders their boundaries simultaneously for inter-ZIP color contrast
- Layer toggle controls (ZIP Boundaries, Transit Stops, Rent Choropleth) + metric selector (ZORI / ZHVI)
- Dev sidebar showing every data point with visualization status, layer type, and notes for non-mappable metrics
- Map auto-fits to ZIP boundary polygon on search using `fitBounds`
- Fixed Google Maps drag/movement snapping back to original position

_4.9.2026_
- Transit layer upgraded to Transitland REST API (primary) - returns routes with actual brand colors (A train blue, 1 train red, etc.), `MultiLineString` geometry flattened to `PathLayer` segments, stops from Transitland; Overpass OSM remains as fallback; 10k queries/month free tier; `TRANSITLAND_API_KEY` required in `.env.local`
- Added OSM building footprints - 3D extruded `PolygonLayer` colored by building type
- Layer panel now includes Block Groups and 3D Buildings toggles (off by default)
- Added NYC PLUTO parcel `ColumnLayer` - 3D columns per parcel, height = assessed value/sqft, color = land use (NYC ZIPs only)
- Block groups layer now auto-disables ZIP choropleth fill to prevent visual overlap
- Fixed cached market responses missing `geo`/`stateFips`/`countyFips` - buildings and block groups now load correctly from cache
- Added Census Tract choropleth layer - 23 tracts per county with rent/income/vacancy data, replaces block groups as primary sub-ZIP layer
- Added OSM Amenity `HeatmapLayer` - weighted by amenity type (transit > commercial > retail), shows walkability density
- Added FEMA Flood Risk zone layer - high/moderate risk polygons from NFHL
- New API routes: `/api/tracts`, `/api/amenities`, `/api/floodrisk`

**UI**

_4.8.2026_
- Basic data visualization page - stat cards, sparklines, transit stop table, Google Trends sparkline
- Search bar with zip validation

_4.11.2026_
- Full layout overhaul - fixed left sidebar (200px) with logo, search, and nav; map fills remaining space; sliding right data panel (300px); bottom stats bar (60px) with key market metrics
- Sidebar nav reduced to "Map" and "Upload CSV" only - removed Analytics and AI Agent nav items
- Active market badge in sidebar bottom - shows city/ZIP name, state, ZIP count for city mode; click to toggle data panel
- Bottom stats bar shows contextual metrics: single-ZIP mode shows rent, home value, listings, days to pending, price cuts, transit, trends; city/borough mode shows aggregated equivalents
- Right data panel shows full market breakdown for single-ZIP and aggregated city/borough views including FRED sparklines
- Executive Memo component in right panel - Gemini 2.5 Flash generates 3-paragraph investment memo; print/PDF export via `window.open`
- Agentic Normalizer on dedicated `/upload` page - drag-and-drop CSV upload, Gemini triage (GEOSPATIAL/TEMPORAL/TABULAR), ingests to Supabase, geospatial lat/lng rows render as map pins when **Client** layer is on; in-memory hash cache on `/api/normalize` prevents repeat Gemini calls for same file structure; markers persist in session for the command center map
- AI Agent chat - translucent glassmorphism panel (bottom-right), no header, floating × close button; agent messages plain text, user messages get orange bubble; suggestion chips on first open; dynamically offsets above stats bar via `hasStatsBar` prop
- Switched entire page font to Gill Sans with system fallbacks
- Projectr logo in sidebar with correct `width="auto"` aspect ratio and `loading="eager"` LCP optimization
- Google Maps custom dark vector map style via `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`
- NYC PLUTO parcel columns: height = total assessed value (log scale), color = land use type with distinct colors per type (residential, commercial, mixed, industrial, etc.)
- **Download market brief (PDF)** in the right panel - syncs live map layer toggles via `onLayersChange` on `CommandMap` for the PDF legend
- ZIP search fetches `/api/cycle` in parallel with market, transit, and trends; live **Market cycle** headline card sits directly above Executive Memo (`{place} is in {stage} {position}`); city/borough uses the same card with an anchor-ZIP footnote; PDF page 1 adds a quadrant **cycle map** (260pt tinted wheel + confidence-colored dot and trajectory) with caption, then a horizontal row of four score-colored signal tiles (↑/↓/→ with direction, value, source) when `cycleAnalysis` is present.
- **Shortlist** - collapsible list in the left nav loads `saved_sites` on mount; rows support notes (blur save), comparison checkboxes (2+ drive PDF site-comparison pins), remove, and click-to-open that ZIP; **Add to shortlist** under the cycle card toggles the current ZIP (snapshots cycle stage/position and `/api/momentum` score on add); map shows shortlist pins via `ScatterplotLayer` (green Expansion, amber Recovery, red otherwise) across markets.
- Shortlist **site names** default from geocode/Zillow place (not the ZIP), editable inline (blur → `saved_sites.label`); ZIP is secondary (“Load market data · ZIP …”); analyst notes use a **pencil → inline input** (blur saves); PDF/map use the human `label`.
- **City / borough shortlist** — “+ Add area to shortlist” on aggregated market view stores `is_aggregate` + `saved_search` (the same search box text) so “Austin, TX”, “manhattan”, etc. reopen via `runAggregateSearch`; map pin uses an anchor ZIP’s coordinates; ZIP-only rows stay separate from area rows (no `hasZip` collision).
- **Metric methodology layer** — `lib/metric-definitions.ts` is the single source of truth; `MetricTooltip` on data panel and bottom-bar labels (hover for definition + source); **Market cycle** card expands to show all four classifier signals (+/−/~) with direction, value, and source; **Momentum score** block loads `/api/momentum` (metro peer ZIPs for single-ZIP, up to 40 ZIPs for city/borough) and expands to default weights plus per-ZIP components; market brief PDF page 1 adds a compact three-column methodology table (Metric / Definition / Source) under the confidence line.
- **Client CSV** — `/upload` shares `CommandCenterSidebar` with the map; analyze/shortlist stash `lib/pending-navigation` in `sessionStorage` then resume on `/`; replaces Case Studies.
- **Client CSV + agent** — last normalize ingest is stored in `projectr-client-upload-session`; command-center Data tab shows a **Client CSV (last upload)** preview table; geospatial rows render as low-poly **ColumnLayer** pins (cone/pyramid silhouette) when the Client layer is on; the Gemini agent uses the same snapshot to toggle pins or open Data.
- **Methodology first in panel** — Momentum and Market cycle explain blocks sit directly under the panel header (single-ZIP and aggregate); cycle card defaults expanded; momentum loads on mount when ZIP context exists.
- **shadcn/ui experiment** — Initialized Radix Nova preset (Tailwind v4): `components.json`, `lib/utils.ts`, `components/ui/*` (button, input, card, badge, checkbox, collapsible, label, scroll-area); root `html` uses `dark` plus Geist font variables; Command Center sidebar search/submit and Shortlist panel use these primitives while keeping the existing charcoal/orange styling.
- **Visible theme refresh** — Dark mode tokens in `app/globals.css` use a cool graphite base, elevated `card`/`popover` surfaces, Projectr orange as `--primary` (plus `--primary-deep` and `bg-gradient-primary` utility); sidebar uses `bg-sidebar` tokens; shell, stats bubble, data panel, map layer stack, agent chat, cycle/memo/upload accents, and shortlist use semantic `primary` / `border` / `muted` classes instead of flat `#0a0a0a` / `#D76B3D` hex everywhere.
- Left sidebar now collapsible — collapses to 48px icon strip, expands to **200px**; top zone = logo, search, Map / Client CSV / Guide nav; scrollable middle = shortlist only; **Active market** card (or collapsed map icon) sits in the **footer** and toggles the right data panel; intelligence terminal opens only from the map-bottom bar (no sidebar AI button).
- Bottom stats bar replaced with floating pill bubble (bottom-center, glassmorphism) — scrollable stats with dividers; ↗ button opens data panel
- Right data panel is **360px** with **Analysis** / **Data** tabs — Analysis = momentum, market cycle, PDF brief, executive memo; Data = pricing, velocity, demographics, FRED, trends, transit, shortlist add, **All metrics** (`<details>` flat table), Agentic Normalizer; former **Overview / All Data** split removed.
- Map layer pill **Rent/value fill** (was labeled Rent) toggles the Zillow-sourced ZIP choropleth; **Fill metric** (ZORI / ZHVI) only appears when that layer is on; PDF active-layer line uses the same naming and omits fill metric when the choropleth is off.
- **Layers UI** — map layer **dots + Layers** button anchor **top-left** of the map (`left-4 top-4`); **sheet** opens to the right of the toggle; up to **five** active dots shown then **+N**; dots turn layers off on click; no `reservedRightPx` offset.
- **Agent site selection** — spatial-analysis **site detail** moved from a map overlay card into the **right panel** with a **Back** control; `fly_to` with `site` opens the panel; new ZIP/area search clears the selected site.
- **Shortlist analyst note** — always-visible note field replaced by a **pencil** control per row; click opens an inline input (blur saves, Esc cancels).
- **AI agent (integrated terminal)** — map-bottom **AgentTerminal** only (DM Mono via `next/font`); collapsed 32px bar shows last status + chevron; compact (~200px) / expanded panel, maximize, click-outside to collapse; agent text streams line-by-line; actions log as emerald `→` lines; insights in a highlighted block; same `/api/agent` + `AgentAction` pipeline via `useAgentIntelligence` and `lib/agent-types.ts`; **sessionStorage** (`projectr-agent-chat-v1`) restores messages and case-study bundle across reloads; unread dot on collapsed terminal bar when new output arrived while collapsed; floating stats pill shifts up with terminal height.
- **Themed scrollbars** — dark mode uses **achromatic** OKLCH grays (`chroma: 0`) in `globals.css` so thumbs/tracks never pick up the UI’s cool (265°) graphite tint that read as purple; shadcn **ScrollArea** thumbs use the same neutral OKLCH grays; `.scrollbar-none` keeps the stats pill chromeless.
- **Unified command sidebar** — `/`, `/upload`, and `/guide` share `CommandCenterSidebar` (`components/CommandCenterSidebar.tsx`): `bg-sidebar` tokens, shadcn search field, Map / Client CSV / Guide links, collapsible 48px strip, shortlist, and Active Market footer; map passes cycle stage/position into the footer when loaded.
- **Intelligence terminal legibility** — user commands use Projectr orange `>` + white text + optional `ts` time (`#4b5563`); agent narrative is indented `#c9d1d9` with a muted `·` on the first line; system confirmations use a green status dot (`#10b981`) + matching text (pulsing dot while analyzing / awaiting model); insight callout uses a thicker left border; exchanges separated by `#2d3342` rules; prompt `>` pulses while loading (`terminal-prompt-wait` / `terminal-dot-pulse` in `globals.css`).
- **Case brief PDF** — after ranked sites appear in the terminal, **Download case brief (PDF)** calls `/api/agent/case-brief/pdf` (Gemini + `@react-pdf`); browser downloads `Projectr-Case-Brief-{market}.pdf` with structured sections aligned to the market PDF.
- **City search** — non-ZIP queries accept full state names (`Newark, New Jersey`) or abbreviations (`Newark, NJ`); map sidebar placeholder still prompts **Enter** to submit.
- **3D** — tilt/rotation sliders removed from the map; **3D** toggle stacks under the **Layers** control (top-left on the map, same chrome as the layer button) and sets 45° perspective when on; agent `set_tilt` still overrides until cleared.
- Sidebar market search — removed **Analyze Market** button; **Enter** submits; small spinner in the field while the request runs (map page + `/upload` sidebar).
- Sidebar **Active market** control moved to the **footer** (full card when expanded, map icon when collapsed); legacy **AI** footer button removed — use the map-bottom intelligence terminal bar to open the agent.
- Command center + **Client CSV** sidebar expanded width tightened from **240px** to **200px** for more map room.
- **Clear local test data** — sidebar **Testing** strip + `/upload` footer; clears `projectr-client-upload-session`, `projectr-client-upload-markers`, `projectr-agent-chat-v1`, `projectr_pending_nav` and reloads the tab (`lib/local-workspace-reset.ts`).
- **Slash commands** — colon forms (`/clear:…`, `/layers:…`), `/go`, view/tilt/rotate, etc.; see **`/help`** and `lib/slash-commands.ts` + `lib/slash-layer-keys.ts`.
- **`/restart`** — clears the transcript to **Are you sure? y/n** only (no `/restart` echo); plain **`y`** / **`n`** reloads or resets to default greeting; **`/restart y`** / **`/restart n`** one-liners; **`/help`**, **`/clear:memory`**, **`/clear:terminal`**, or **`/clear:layers`** clears pending restart; `clearProjectrBrowserCachesAndReload` wipes every `projectr-*` key on confirm; broader than `/clear:workspace`; no `window.confirm`.
- **`/clear:terminal`** / **`/clear:memory`** — **clean canvas**: transcript becomes the default greeting only (slash not shown); memory also clears the case-brief bundle; terminal keeps the bundle.
- **`/guide` doc polish** — Onboarding is a collapsible **FOR NEW USERS** block (default expanded) with primary-tint chrome; **What you can use** uses feature cards and section kickers; **Metric reference** uses accented category rules and metric tiles; copy avoids em dashes where flagged for UI.
- **`/guide` outline** — Permanent **On this page** rail with anchors for onboarding, each capability card, and each metric category (`lib/Documentation-content.ts`); jump clears the doc filter and smooth-scrolls; active section tracks scroll while not filtering.
- **`/guide` search** — `parseDocumentationSearchQuery` tokenizes with punctuation stripped and stop words dropped; features filter per card; metric glossary phrases match via `Documentation_METRICS_INTRO_SEARCH_BLOB`; `metricSearchBlob` includes calculation strings where defined.
- **`/upload` header** — Same top bar chrome as **`/guide`** (`border-b`, `bg-muted/20`, **Client CSV** title + **Projectr** subtitle); right side links to **`/guide`**.

_4.12.2026_
- **`/Documentation` → `/guide`** - `app/Documentation/page.tsx` **308** redirects to **`/guide`** (canonical); sidebar and upload use **`/guide`** directly.
- City and borough search loads Google Trends (keyword from borough name or city query via `/api/trends?city=&state=`); stats bar shows metro name plus keyword scope; panel surfaces Trends errors/empty data before PDF export; aggregate PDF includes Trends when loaded
- **Analyst guide** — **`/guide`** shares **`CommandCenterSidebar`** with map/upload; scrollable doc column with in-page outline, collapsible **FOR NEW USERS** onboarding, feature overview + **Metric reference**, shadcn **Input** search (`textMatchesDocumentationSearch`, `parseDocumentationSearchQuery`, `lib/guide-content.ts`, `lib/analyst-guide.ts`); right map panel stays data-only (**360px**).
- Intelligence terminal **slash palette** — typing **`/`** opens command suggestions (filter as you type, ↑↓ + Enter or Tab to complete, Esc clears input); **`/help`** prints live commands and roadmap ideas without calling the API; unknown **`/token`** gets a short hint instead of **`/api/agent`**.
- **`/view 3d`** / **`/view 2d`** — sets map tilt via the same `set_tilt` path as the agent (45° vs flat); parsed in `lib/slash-commands.ts`, handled in `use-agent-intelligence.ts`.
- **`/tilt <0–100>`** — percent of max camera tilt (0°–67.5°, same cap as `CommandMap`); clamping, `%` suffix, and validation in `parseTiltSlashCommand`; `/help` includes a dedicated bounds / edge-case block.
- **`/rotate <degrees>`** — map **bearing** (clockwise from north); `set_heading` + `mapHeading` state on `page.tsx`; values wrap to **[0, 360)** via `normalizeHeadingDegrees` in `lib/slash-commands.ts`; `/help` lists rules; Gemini may emit `set_heading` per `/api/agent` prompt.
- **`/clear:<target>`** — `layers` (all layers off + permit filter cleared), `terminal` (clean canvas — default greeting only, command not echoed; case bundle kept), `memory` / `mem` (clean canvas + clear case bundle; map/CSV unchanged), `workspace` (same as **Testing → Clear local test data**, confirm + reload); malformed or unknown targets get explicit terminal errors.
- **`/go <query>`** — runs sidebar-style search (ZIP, city, borough); dispatches map page form submit after `search` action; empty/oversized query errors.
- **`/layers:a,b,…`** — comma-separated names/aliases turn **on** layers via `toggle_layers` merge; unknown tokens listed in the error; keys aligned with `LayerState` in `lib/slash-layer-keys.ts`.

## Known Bugs

- **DC Metro velocity null** - Zips in the Washington-Arlington-Alexandria metro return `metro_velocity: null` because the metro name is too long to match the short name stored in `zillow_metro_snapshot`. The `getZillowData` function in `app/api/market/route.ts` needs smarter truncation logic for multi-city metro names.

- **ZHVF outlier values** - Some zips return extreme ZHVF forecast values (e.g. -50, -90, -10) from the Zillow CSV. These appear to be data artifacts. The UI currently caps display at ±50% and shows `-` for outliers, but the raw values are still stored in Supabase. The ingestion script should filter these on write.

- **Zillow `as_of_date` shows future date** - The ZHVF CSV uses forward-looking forecast dates (e.g. `2027-02-28`). This bleeds into the `as_of_date` field on the zip snapshot. The ingestion script should use the ZHVI or ZORI date as the canonical `as_of_date` instead.

## Minor Gaps

- **Employment Rate (FRED)** - The FRED series search for "employed persons" at the county level doesn't reliably return a consistent series name across all markets. The computation (employed / labor force × 100) is built and ready, but the series lookup needs a more robust matching strategy. Revisit before demo.

- **FRED missing for large metros** - Zips in large counties (e.g. Prince William County, VA) sometimes return no FRED data because the search query times out or returns no match. Likely needs a fallback to a direct LAUCN series ID lookup using the county FIPS.

- **Population Growth 3yr is enrollment-sensitive** - For college towns, the 2019→2022 ACS population delta reflects COVID-era enrollment swings, not real migration. Consider adding a note in the UI or suppressing this metric for known university zip codes.

- **Building permits are county-level, not zip-level** - Census BPS data is aggregated at the county level. A zip like 22193 (Woodbridge) shares permit counts with all of Prince William County. This overstates activity for individual zip codes. Noted for the demo script.

- **Neighbor ZIPs only cover Zillow-tracked markets** - `zip_metro_lookup` is sourced from the ZORI CSV, which only covers ~7,700 ZIPs where Zillow has enough rental data. Rural ZIPs and non-rental markets won't have neighbor context on the map. This is acceptable for the target use case (active rental markets) but worth noting.

- **PDF rent sparkline** - After `zillow_zori_monthly` exists and `ingest:zillow` has run, the brief uses **real** monthly ZORI. If the table is empty or a ZIP has too few points, the PDF falls back to a modeled series (footnoted).
- **Cycle vacancy signal** - ACS vacancy in cache is a single vintage (level only); the classifier does not yet compute vacancy YoY until multi-year ACS rows exist in the pipeline.

- **Client CSV forward geocode limits** — After ZIP + explicit lat/lng handling, **non-ZIP** geo cells (street addresses, `City, ST`, etc.) are sent to the **Google Geocoding API** (up to **50** unique strings per upload). Enable **Geocoding API** on the GCP project; use `GOOGLE_GEOCODING_API_KEY` or the same key as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Ambiguous or non-US strings may return no pin; very large files need chunking or a higher cap (not implemented).

## Client CSV & AI session

- **Where it lives** — The **last normalize** triage + preview live in `sessionStorage` (`projectr-client-upload-session`); pin coordinates live in `projectr-client-upload-markers`. You can **ingest multiple CSVs in one drop** (up to 8); markers are **merged and deduped** by lat/lng/label, previews concatenated (capped), and each file still runs `POST /api/normalize` sequentially (separate Gemini triage + Supabase upserts per file). Rows also **upsert into Supabase** `projectr_master_data` with `data_source = Client Upload` and `submarket_id` from each row’s geography (or the optional form `zip` when the server was given a loaded market). The agent reads the combined snapshot via `mapContext.clientCsv` on every `/api/agent` call. **Pins:** explicit lat/lng columns, **5-digit ZIP** (Zippopotam/Census), then **address / place text** via Google Geocoding when a key is configured (`lib/google-forward-geocode.ts`, wired in `POST /api/normalize`).

- **No market loaded** — You can upload first, then chat with the agent: context still includes the CSV block; pins render when the **Client** layer is on (default **on**). If the CSV has mappable rows, the map auto-fits to those pins until you load a ZIP or city.
- **Case study + CSV** — Upload CSV(s) **before** pasting a ranking brief so `mapContext.clientCsv` is populated; `/api/agent` instructs Gemini (MODE B) to reference uploads, turn on **clientData** when pins exist, and use **focus_data_panel** for temporal-only ingests.
- **Clear local test data** — Left sidebar **Testing** section and Client CSV page footer button remove session keys (`projectr-client-upload-session`, `projectr-client-upload-markers`, `projectr-agent-chat-v1`, `projectr_pending_nav`) and **reload the tab**; does not delete Supabase rows or shortlist.

- **After you load a new location** — Session pins and the agent CSV context **stay** until you upload another file or clear pins; they are **not** tied to the searched ZIP. Supabase ingested rows are keyed by **row geography + metric + period**, not by whatever ZIP is on screen—so changing markets does not delete prior uploads, but the **Data** tab metrics view is still filtered to the **current** market unless you query elsewhere.

- **Shortlist** — `saved_sites` stores label, ZIP/aggregate hint, geo, cycle snapshot, and notes only; it does **not** store CSV blobs or agent transcripts. Restoring a shortlist row reloads that market, not a prior upload or chat (see **Deferred**).
- **Reset local workspace (QA)** — Use **Clear local test data** in the sidebar (under **Testing**) or on `/upload` to wipe this tab’s Client CSV session, pins, agent chat, and pending sidebar→map navigation, then reload. Ingested **Client Upload** rows remain in Supabase until you remove them in the database.
- **Intelligence terminal** — Type **`/`** for suggestions; **`/help`** lists commands; **`/view`**, **`/tilt`**, **`/rotate`**, **`/go`**, **`/layers:`…**, **`/clear:`…** (see changelog); **`/clear:workspace`** matches **Testing → Clear local test data** (confirm + reload). **`/clear:terminal`** and **`/clear:memory`** replace the visible transcript with the default greeting only (no echo of the slash command); **`/restart`** clears to the y/n prompt the same way.

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

- **Multi-market permit comparison** — Permit visualization is currently NYC-only (Socrata DOB feed). Expanding to other cities would require per-jurisdiction ArcGIS FeatureServer URLs or a paid aggregator (Regrid, BuildZoom). Revisit if scoping to additional demo markets.

- **Shortlist attachments (CSV + agent chat)** — Would require `saved_sites` JSONB column(s) or a sibling table, size limits, and UI to “attach workspace” on save plus restore flow (rehydrate markers store + optional transcript). Blocked on schema/auth product decisions.
