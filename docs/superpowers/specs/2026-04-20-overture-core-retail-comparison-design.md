# Overture Core Retail Comparison Design

Date: 2026-04-20

## Goal

Add a bounded terminal comparison that lets Aidan compare the existing retail fabric of Austin's core against another Texas city's core, starting with Houston, using Overture POIs and rendering a chart through the same comparison surface used by the current rent, unemployment, and permit comparisons.

This feature is for demo storytelling, not autonomous market scoring. It should help Aidan say:

"Austin's core has a denser, more walkable retail context than Houston's core in the same downtown-sized radius. Now let's inspect where your candidate sites sit inside Austin."

## Why This Shape

The current agent comparison lane is history-oriented and grounded in router-backed metric series. That works well for rent, unemployment, and permits, but it does not fit the Overture use case directly because Overture provides current POI snapshots rather than historical time series.

For the demo, a fixed-radius core comparison is the best fit because it:

- matches the user-facing story about walkable urban retail pockets
- avoids unsupported citywide saturation claims
- keeps the comparison deterministic and bounded
- can be explained clearly in one sentence during a call

## Non-Goals

- No citywide per-capita saturation model in v1
- No generic "foot traffic" metric or claim
- No weighted composite score in v1
- No arbitrary free-form city-to-city comparisons outside the explicitly supported Texas core set
- No open-ended agent reasoning over raw Overture payloads

## User Experience

### Supported prompts

- `Compare core retail context for Austin and Houston`
- `Compare downtown retail context between Austin and Houston`
- `Compare Austin and Houston core retail`

### Initial supported city pairs

V1 should explicitly support only:

- Austin
- Houston

The route contract should be designed so Dallas or San Antonio can be added later by extending a centerpoint registry instead of changing prompt logic again.

### Assistant response shape

The assistant should return:

- a short grounded message summarizing the comparison
- a grouped bar chart
- citations showing Overture as the source
- trace notes that explain the radius, categories, and current-snapshot limitation

Example summary:

"Here is the current core retail context comparison for Austin and Houston. Austin's downtown-sized radius shows a denser food-and-beverage mix in this snapshot, while Houston's sample is sparser and more dispersed."

## Metric Definition

### Metric family

Add one new bounded comparison metric family:

- `core_retail_context`

This is not a single numeric saturation score. It is a fixed taxonomy of current POI counts inside the same radius around each city's registered core anchor.

### Comparison method

For each city:

1. Resolve a predefined centerpoint
2. Query Overture around that point using a fixed radius
3. Filter POIs into a bounded retail taxonomy
4. Aggregate counts by comparison bucket
5. Render the buckets side-by-side for both cities

### Fixed parameters

- Radius: 1200 meters
- Geography mode: city core anchor only
- Source: Overture live POI API
- Time interpretation: current snapshot, not history

### Buckets

V1 buckets:

- `food_bev`
- `coffee_cafe`
- `essentials`
- `fitness`

Definitions:

- `food_bev`: restaurant, bakery, bar, sandwich shop, burger restaurant, seafood restaurant, plus coffee and cafe
- `coffee_cafe`: coffee shop and cafe
- `essentials`: grocery store, supermarket, pharmacy, drug store
- `fitness`: fitness center and gym

### Category mapping

Match against `properties.categories.primary` from Overture payloads.

Initial included primary categories:

- `restaurant`
- `bakery`
- `bar`
- `sandwich_shop`
- `burger_restaurant`
- `seafood_restaurant`
- `coffee_shop`
- `cafe`
- `grocery_store`
- `supermarket`
- `pharmacy`
- `drug_store`
- `fitness_center`
- `gym`

V1 should keep the taxonomy explicit in code rather than trying to infer retail groupings dynamically.

## Core Anchors

V1 centerpoint registry:

- Austin: `30.2672, -97.7431`
- Houston: `29.7604, -95.3698`

These are demo-oriented downtown/core anchors, not claims about official municipal centers.

The registry should live in one small server-side module so additional Texas cities can be added later without reworking the agent path.

## Chart Contract

### Chart type

Use a grouped bar chart, not a line chart.

Reason:

- this is a current snapshot, not a trend
- grouped bars map cleanly to category comparisons
- the output feels like the existing bounded chart surface without misrepresenting time

### Suggested chart payload

- title: `Austin vs Houston core retail context`
- subtitle: explains the fixed-radius downtown comparison
- x-axis: bucket labels
- y-axis: count of Overture POIs
- series:
  - Austin
  - Houston

### Citation contract

Citations should name:

- Overture as the source
- the fixed radius
- the city core anchors
- the fact that counts come from current live POI snapshots

If the current chart citation UI remains plain text rather than clickable links, keep the copy concise and factual.

## Agent Routing Design

### New request lane behavior

Extend the bounded comparison recognizer so it can detect:

- `core retail`
- `downtown retail`
- `retail context`

when both supported city names are present.

This should route into a new comparison handler rather than trying to force the request through the historical market-data router.

### Why not use the existing history router directly

The current analytical comparison path expects history-capable series. Overture is a snapshot API, so trying to wedge it into that path would either:

- create fake time axes, or
- distort the chart contract

Instead, v1 should add a small parallel bounded comparison path that still returns the same high-level agent response shape:

- `message`
- `chart`
- `trace`
- `citations`

This keeps the user experience consistent without abusing the historical comparison router.

## Server-Side Components

### 1. Core retail comparison module

Add a small server-side helper responsible for:

- validating supported cities
- resolving centerpoints
- calling Overture
- filtering categories
- aggregating bucket counts
- returning a normalized comparison payload

Suggested location:

- `projectr-analytics/lib/overture-core-retail-comparison.ts`

### 2. Overture fetch reuse

Reuse the existing `/api/pois` category understanding where practical, but avoid coupling the comparison logic to map-layer response shape if that creates awkward transformations.

If needed, add a shared lower-level Overture fetch helper so both `/api/pois` and the new comparison logic can consume the same normalized payload format.

### 3. Agent route integration

In `/api/agent/route.ts`:

- detect supported prompts
- call the new comparison helper
- build a grouped bar chart payload
- return bounded trace/citation text

## Error Handling

### Unsupported city

If the prompt asks for a city outside the supported registry:

- do not guess
- explain that this comparison currently supports Austin and Houston only

### Empty or noisy Overture response

If one side returns too little usable data:

- return a bounded failure message
- explain that the live retail snapshot was insufficient
- suggest trying the supported pair again later or falling back to permit/unemployment comparisons

### Missing Overture key

If `OVERTURE_API_KEY` is not configured:

- fail explicitly
- do not silently render empty comparisons

## Demo Framing

This comparison should be presented as:

- existing retail context
- current neighborhood fabric
- walkable core density

It should not be presented as:

- literal foot traffic
- citywide saturation truth
- investment recommendation

The handoff line to the Austin site analysis is the point of the feature:

"That tells us Austin's core supports a denser storefront environment than Houston's. Now let's look at which Austin pockets are early but have real demand forming nearby."

## Testing

Add targeted tests for:

- prompt classification for supported phrases
- city registry resolution
- category-to-bucket aggregation
- grouped bar chart payload shape
- explicit failure on unsupported cities
- explicit failure when Overture data is empty or unavailable

Use deterministic fixture payloads for unit tests rather than live Overture calls.

## Risks and Limitations

- Overture POI quality is useful but still noisy, so the taxonomy must stay narrow
- The metric is demo-oriented and should not be overextended into formal market scoring
- The comparison is only defensible because the radius and anchors are fixed and explicit
- The feature adds a second bounded comparison path, so naming and routing need to stay clear to avoid confusing it with historical market-data comparisons

## Recommended V1 Scope

Ship only:

- Austin vs Houston
- one metric family: `core_retail_context`
- one grouped bar chart
- one explicit taxonomy
- one fixed radius

Defer:

- more cities
- citywide normalization
- weighted saturation scores
- site-level Overture scoring
- blended permit-plus-retail indexes

## Open Follow-On Work After V1

- Add Dallas and San Antonio core anchors
- Add category-specific variants such as coffee-only or essentials-only comparisons
- Add a map-side explainer showing which categories contributed to the chart
- Optionally reuse the same taxonomy for Austin site-level context cards near uploaded candidate sites
