# Projectr-Analytics
um haha yes!!

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
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID   # must be a Vector map ID
GEMINI_API_KEY
HUD_API_TOKEN                    # optional, falls back to Census ACS rent data
```

### First-time data setup
1. Download Zillow CSVs (see section below) into `zillow-csv's/` at repo root
2. `cd projectr-analytics && npm install`
3. In Supabase SQL Editor, run `projectr-analytics/supabase/migrations/20260411120000_zip_geocode_cache.sql` to create `zip_geocode_cache` (persists ZIP geocodes across deploys)
4. `npm run ingest:zillow` — loads Zillow data into Supabase
5. `npm run populate:centroids` — run 6-7 times until "All centroids already populated" (geocodes ~7,661 ZIPs)
6. `npm run ingest:permits` — ingests NYC DOB building permits into `nyc_permits` table (all 5 boroughs, NB/A1/A2/DM, 2022+); takes ~10-20 min
7. `npm run dev`

### Known setup issues
- **Turbopack + Tailwind** — if you get `Can't resolve 'tailwindcss'`, kill any stale `next dev` processes and restart fresh. Stale processes hold onto old module resolution state.
- **Google Maps Map ID** — must be a Vector type map for deck.gl `interleaved: true` mode. Raster maps cause `fromLatLngToDivPixel` errors.
- **Zillow CSVs are gitignored** — they exceed GitHub's 100MB file limit. Each teammate needs to download them locally and run `ingest:zillow` once.

## Changelog

**Data Pipeline**

_4.8.2026_
- Set up Supabase project with PostGIS — universal `projectr_master_data` table, `zillow_zip_snapshot`, `zillow_metro_snapshot`, and `zip_metro_lookup` tables with RLS policies and upsert constraints
- FRED integration — monthly unemployment rate + real GDP via dynamic series search
- Census ACS integration — population, median income, gross rent, migration, housing units, vacancy rate, 3yr population growth (2019→2022)
- HUD/Census B25031 fallback — fair market rents by bedroom (studio through 4BR), with optional HUD API token upgrade path
- Census BPS integration — building permit counts, units, and construction value (2021–2023) via direct CSV download
- Zillow Research ingestion script (`npm run ingest:zillow`) — processes 6 CSVs into Supabase: ZORI, ZHVI, ZHVF (zip-level) + Days on Market, Price Cuts, Inventory (metro-level)
- `zip_metro_lookup` table with `metro_name_short` for metro velocity joins
- GTFS transit stop fetcher — Overpass API (OSM) for all markets with retry/backoff, direct BT GTFS zip fallback for Blacksburg
- Google Trends fetcher — city-level search interest with automatic state-level fallback for small markets
- Census TIGER ZIP boundary API (`/api/boundaries`) — returns GeoJSON polygon for any US zip, 30-day cache
- Populated lat/lng centroids for 7,661 ZIPs in `zip_metro_lookup` via zippopotam + Census 2020 ZCTA internal point (TigerWeb) when place lookup fails
- Neighbor proximity API (`/api/neighbors`) — returns 20 closest ZIPs in same metro sorted by geographic distance

_4.9.2026_
- Added Census block group API (`/api/blockgroups`) — sub-ZIP boundaries + population density from Census TIGER + ACS
- Added OSM buildings API (`/api/buildings`) — building footprints with floor count via Overpass
- Market API now returns `stateFips` and `countyFips` in geo object

**Infrastructure**

_4.8.2026_
- Scaffolded Next.js 16 app with TypeScript, Tailwind CSS, Recharts, Lucide Icons
- Built full data pipeline with 7-day Supabase cache and cold-start fetch logic
- API routes: `/api/market`, `/api/transit`, `/api/trends`, `/api/boundaries`, `/api/neighbors`, `/api/normalize` (Gemini triage)

_4.9.2026_
- Added `/api/city` — resolves city name to all ZIP codes with Zillow data; supports "City, ST" format with zippopotam fallback for smaller markets

_4.11.2026_
- Added `/api/borough` — resolves NYC borough name to all ZIPs + Census TIGER county boundary + Zillow aggregates
- Added `/api/aggregate` — POST endpoint that computes weighted-average stats (rent, income, vacancy, FRED, metro velocity) across a list of ZIPs for city/borough mode
- Added `/api/agent` — Gemini 2.5 Flash AI agent endpoint; returns structured JSON with `message`, `action`, and `insight` fields for map control
- Added `/api/memo` — server-side Gemini 2.5 Flash executive memo generation (fallback for client-side key errors)
- Added `/api/permits` — serves pre-ingested NYC DOB permit data from Supabase; supports borough, ZIP, and job-type filters
- Added `npm run ingest:permits` script — pulls NYC DOB job filings (Socrata `ic3t-wcy2`) for all 5 boroughs, job types NB/A1/A2/DM, 2022+; deduplicates within batches to avoid Supabase conflict errors
- Fixed `/api/agent` 500 error caused by corrupted template literal dollar-sign formatting in `contextStr`
- ZIP geocoding now falls back to Census TigerWeb 2020 ZCTA internal points instead of a synthetic `1 Main St` address match; successful lookups upsert into Supabase `zip_geocode_cache` (365-day refresh) so cold starts reuse coordinates

**Map & Visualization**

_4.9.2026_
- Removed OSM 3D Buildings layer — deleted `PolygonLayer`, `BuildingFeature`/`BuildingCollection` interfaces, `CameraSampler` component, all buildings fetch/debounce logic, and `/api/buildings` route

_4.11.2026_
- NYC PLUTO parcels now support borough mode — auto-detects borough from city ZIP range and fetches all parcels via `/api/parcels?borough=`
- NYC permits `ScatterplotLayer` added — colored by job type (NB=orange, A1=yellow, A2=blue, DM=red), clickable with detail panel showing address, cost, stories, units, filing date
- Permits layer fetched automatically on ZIP and borough search; toggle added to layer panel
- Layer panel redesigned as pill buttons with colored dot indicators — removed all emojis and default HTML styling
- Added map tilt and heading sliders to layer panel
- Disabled Google Maps default UI controls (map/satellite toggle, zoom buttons, fullscreen, street view)
- Removed Data Layer Status dev sidebar
- Borough boundary rendered as orange (`#D76B3D`) outline `GeoJsonLayer` on top of city ZIP choropleth
- AI agent layer overrides wired to map — `agentLayerOverrides` and `agentMetric` props merge into effective layer/metric state

_4.8.2026_
- Google Maps + deck.gl map with `GoogleMapsOverlay` (interleaved vector mode)
- ZIP boundary choropleth colored by ZORI rent, normalized across all loaded ZIPs for relative contrast
- Transit stop ScatterplotLayer (cyan dots) with hover tooltips
- Multi-ZIP metro context — loads 20 nearest ZIPs and renders their boundaries simultaneously for inter-ZIP color contrast
- Layer toggle controls (ZIP Boundaries, Transit Stops, Rent Choropleth) + metric selector (ZORI / ZHVI)
- Dev sidebar showing every data point with visualization status, layer type, and notes for non-mappable metrics
- Map auto-fits to ZIP boundary polygon on search using `fitBounds`
- Fixed Google Maps drag/movement snapping back to original position

_4.9.2026_
- Added Census block group sub-ZIP choropleth layer (population density, ~64 polygons per county)
- Added OSM building footprints — 3D extruded `PolygonLayer` colored by building type
- Layer panel now includes Block Groups and 3D Buildings toggles (off by default)
- Added NYC PLUTO parcel `ColumnLayer` — 3D columns per parcel, height = assessed value/sqft, color = land use (NYC ZIPs only)
- Block groups layer now auto-disables ZIP choropleth fill to prevent visual overlap
- Fixed cached market responses missing `geo`/`stateFips`/`countyFips` — buildings and block groups now load correctly from cache
- Added Census Tract choropleth layer — 23 tracts per county with rent/income/vacancy data, replaces block groups as primary sub-ZIP layer
- Added OSM Amenity `HeatmapLayer` — weighted by amenity type (transit > commercial > retail), shows walkability density
- Added FEMA Flood Risk zone layer — high/moderate risk polygons from NFHL
- New API routes: `/api/tracts`, `/api/amenities`, `/api/floodrisk`

**UI**

_4.8.2026_
- Basic data visualization page — stat cards, sparklines, transit stop table, Google Trends sparkline
- Search bar with zip validation

_4.11.2026_
- Full layout overhaul — fixed left sidebar (200px) with logo, search, and nav; map fills remaining space; sliding right data panel (300px); bottom stats bar (60px) with key market metrics
- Sidebar nav reduced to "Map" and "Case Studies" only — removed Analytics and AI Agent nav items
- Active market badge in sidebar bottom — shows city/ZIP name, state, ZIP count for city mode; click to toggle data panel
- Bottom stats bar shows contextual metrics: single-ZIP mode shows rent, home value, listings, days to pending, price cuts, transit, trends; city/borough mode shows aggregated equivalents
- Right data panel shows full market breakdown for single-ZIP and aggregated city/borough views including FRED sparklines
- Executive Memo component in right panel — Gemini 2.5 Flash generates 3-paragraph investment memo; print/PDF export via `window.open`
- Agentic Normalizer in right panel — drag-and-drop CSV upload, Gemini triage (GEOSPATIAL/TEMPORAL/TABULAR), ingests to Supabase, renders marker pins on map; in-memory hash cache prevents repeat Gemini calls for same file structure
- AI Agent chat — translucent glassmorphism panel (bottom-right), no header, floating × close button; agent messages plain text, user messages get orange bubble; suggestion chips on first open; dynamically offsets above stats bar via `hasStatsBar` prop
- Switched entire page font to Gill Sans with system fallbacks
- Projectr logo in sidebar with correct `width="auto"` aspect ratio and `loading="eager"` LCP optimization
- Google Maps custom dark vector map style via `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`
- NYC PLUTO parcel columns: height = total assessed value (log scale), color = land use type with distinct colors per type (residential, commercial, mixed, industrial, etc.)

## Known Bugs

- **DC Metro velocity null** — Zips in the Washington-Arlington-Alexandria metro return `metro_velocity: null` because the metro name is too long to match the short name stored in `zillow_metro_snapshot`. The `getZillowData` function in `app/api/market/route.ts` needs smarter truncation logic for multi-city metro names.

- **ZHVF outlier values** — Some zips return extreme ZHVF forecast values (e.g. -50, -90, -10) from the Zillow CSV. These appear to be data artifacts. The UI currently caps display at ±50% and shows `—` for outliers, but the raw values are still stored in Supabase. The ingestion script should filter these on write.

- **Zillow `as_of_date` shows future date** — The ZHVF CSV uses forward-looking forecast dates (e.g. `2027-02-28`). This bleeds into the `as_of_date` field on the zip snapshot. The ingestion script should use the ZHVI or ZORI date as the canonical `as_of_date` instead.

## Minor Gaps

- **Employment Rate (FRED)** — The FRED series search for "employed persons" at the county level doesn't reliably return a consistent series name across all markets. The computation (employed / labor force × 100) is built and ready, but the series lookup needs a more robust matching strategy. Revisit before demo.

- **FRED missing for large metros** — Zips in large counties (e.g. Prince William County, VA) sometimes return no FRED data because the search query times out or returns no match. Likely needs a fallback to a direct LAUCN series ID lookup using the county FIPS.

- **Population Growth 3yr is enrollment-sensitive** — For college towns, the 2019→2022 ACS population delta reflects COVID-era enrollment swings, not real migration. Consider adding a note in the UI or suppressing this metric for known university zip codes.

- **Building permits are county-level, not zip-level** — Census BPS data is aggregated at the county level. A zip like 22193 (Woodbridge) shares permit counts with all of Prince William County. This overstates activity for individual zip codes. Noted for the demo script.

- **Neighbor ZIPs only cover Zillow-tracked markets** — `zip_metro_lookup` is sourced from the ZORI CSV, which only covers ~7,700 ZIPs where Zillow has enough rental data. Rural ZIPs and non-rental markets won't have neighbor context on the map. This is acceptable for the target use case (active rental markets) but worth noting.

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
