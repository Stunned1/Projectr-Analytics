# Scout Architecture Audit

Scope: Next.js App Router, deck.gl, Supabase/PostGIS, and the Gemini agent pipeline.

## Critical Bottlenecks

1. `app/api/transit/route.ts` and `app/api/tracts/route.ts` still return large raw JSON / GeoJSON payloads to the browser.
   - `transit` fetches Transitland route geometry and stop arrays around a ZIP center and serializes the full response back to the client.
   - `tracts` fetches every tract polygon for a county and merges ACS properties in the route before sending the whole FeatureCollection to the map.
   - Solution: move these layers to viewport-tiled delivery in PostGIS with `ST_AsMVT` / `ST_AsMVTGeom`, or at minimum return bbox-constrained geometries and binary point buffers for deck.gl instead of full JSON objects.

2. `app/api/permits/route.ts` is only bbox-aware at the highest zoom level and still over-fetches at low and mid zoom.
   - Heatmap mode loads up to 5,000 permit points, and scatter mode can return up to 2,000 rows per permit type before any viewport clipping is applied.
   - Solution: query permits against the current viewport in every mode, aggregate low-zoom output into grid cells or H3 buckets, and reserve raw rows for a small high-zoom viewport slice.

3. The top-level page state in `app/page.tsx` invalidates the memoized map shell during agent streaming and other frequent UI updates.
   - `agentThinkingStreaming`, `agentSidebarTrace`, `agentLayerOverrides`, `agentFlyTo`, and inline callbacks such as `onClearAgentOverride` and `handleMap3DToggle` cause fresh prop identities on each render.
   - Because `CommandMap` depends on those props, the memo boundary is partially defeated and the map can rerender while the agent stream is still emitting tokens.
   - Solution: memoize all map callbacks, isolate agent-thinking state in a sibling store or child subtree, and batch or defer stream-driven state updates so the deck.gl tree is not rebuilt on every NDJSON delta.

## High Priority

4. `app/api/market/route.ts`, `app/api/aggregate/route.ts`, and `lib/ensure-zip-cache.ts` do not have an N+1 bug in the classic sense, but they do create avoidable sequential round trips.
   - `getZillowData` makes three Supabase lookups in sequence, then the route performs a separate geocode call and a separate live-data fan-out.
   - `ensureAreaMasterDataCached` can cold-fill up to 16 ZIPs with per-ZIP geocode + FRED + HUD + Census + permits work before `aggregate` returns.
   - Solution: run independent Supabase reads in `Promise.all`, collapse lookup tables into fewer joins or an RPC, and move cold-fill work to a background job or warm-up path instead of doing it on the request path.

5. `scripts/ingest-zillow.ts` is batch-oriented but still expensive enough to become a deployment bottleneck as data volume grows.
   - The script parses whole CSVs in memory, builds large snapshot arrays, and repeatedly upserts in batches with sleep-based throttling.
   - Solution: load into staging tables with bulk insert / `COPY`, then merge once in SQL; keep the monthly ZORI table, but move the heavy write path out of row-by-row client upserts.

## UX / Polish

6. The app does not currently prefetch likely next requests when the user hovers or focuses a saved site.
   - The saved-site and shortlist flows are reactive, but there is no hover-driven warm cache for `/api/market`, `/api/trends`, `/api/cycle`, or `/api/transit`.
   - Solution: prefetch those routes when a saved site card is hovered or focused, and feed them through the existing client request cache so navigation feels instant.

## Notes

- ZIP geocoding is already cached in `lib/geocoder.ts` with both a Supabase cache table and an in-process LRU, so the main scaling risk is not centroid lookup spam.
- Client-side request de-duplication already exists in `lib/request-cache.ts`, but several expensive routes still bypass it or return too much data for the current viewport.

## Workload Profile

- The app is read-heavy at runtime: a market load fans out into multiple read paths (`/api/market`, `/api/transit`, `/api/trends`, `/api/cycle`) plus several follow-up map reads for parcels, tracts, boundaries, amenities, POIs, and flood risk.
- The write-heavy paths are concentrated in ingestion and persistence (`scripts/ingest-zillow.ts`, `scripts/ingest-permits.ts`, and saved-site mutations), so the main scalability issue is read amplification and payload size rather than user-generated writes.
- That means the tooling choice is part of the issue: the current mix of raw JSON APIs, third-party web fetches, and client-side rerendering works for light usage, but it becomes the bottleneck under repeated reads because the app is paying network and serialization cost over and over instead of amortizing it in tiles, cached joins, or binary payloads.

## System Design Call

- This is not primarily a horizontal-scaling problem yet; the weak point is inefficient read fan-out and payload shape, so throwing more app servers at it will mostly scale the wrong layer.
- Vertical scaling helps only up to the point where a single request can stay in memory and the database can answer faster, but it does not fix repeated third-party fetches, oversized GeoJSON, or client-side rerender churn.
- A NoSQL migration is not the right first move because the core workload depends on geospatial joins, filtered aggregates, and transactional persistence for saved sites and cached market state.
- ACID is still important for the parts of the app that mutate shared state: saved sites, ingest upserts, cache rows, and any future derived tables that need deterministic writes and conflict handling.
- Postgres/PostGIS is the right system of record for the spatial core, with read optimization through materialized/cache tables, MVT tiles, denormalized lookup tables, and background warming rather than a document-store rewrite.
- If scale becomes the next ceiling, the right sequence is: optimize query shape, reduce payloads, isolate the hot reads behind caching or tiles, and only then consider horizontal scale at the API edge or read replicas.
