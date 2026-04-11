/**
 * Documentation copy and search index for `/Documentation`. Single source for feature bodies + outline anchors.
 */

import { ANALYST_REFERENCE_CATEGORIES } from '@/lib/analyst-guide'

export type DocumentationFeatureBlock = {
  id: string
  title: string
  /** Visible paragraph(s) in the Documentation. */
  body: string
  /** Extra tokens for search only (synonyms, acronyms). */
  searchAliases?: string
}

export type DocumentationOutlineNode = {
  id: string
  label: string
  children?: DocumentationOutlineNode[]
}

/** Plain text for onboarding search (matches visible copy + common queries). */
export const Documentation_ONBOARDING_SEARCH_TEXT = `
FOR NEW USERS new users onboarding orientation quick command center product features metrics UI
Load a market sidebar ZIP city state Austin borough NYC Enter map data panel Analysis Data tabs
cycle momentum PDF brief memo tables trends exports Layers map layer control top-left choropleth
transit tracts permits CSV Upload pins Intelligence terminal bottom agent natural language shortcuts
CSV Upload sidebar upload geocoded spreadsheets Client layer map pins Shortlist areas comparison market brief PDF exported
`.trim()

export const Documentation_FEATURES: DocumentationFeatureBlock[] = [
  {
    id: 'feature-map-search',
    title: 'Map & search',
    body: `Load a single ZIP, a city and state, or an NYC borough from the sidebar. The map shows the market footprint,
optional ZIP outline, and context ZIPs where applicable. Choropleth fill can display rent (ZORI) or home
value (ZHVI) when enabled in the layer panel.`,
    searchAliases: 'neighbors boundary footprint geocode place state',
  },
  {
    id: 'feature-layer-panel',
    title: 'Layer panel',
    body: `Toggle vector layers: transit (routes and stops), Census tracts, block groups, NYC parcels, NYC building
permits, flood zones, amenity heatmap, and client-uploaded CSV pins. Layer availability can depend on
geography (for example borough-level behavior in NYC).`,
    searchAliases: 'DOB FEMA NFHL OSM GTFS PLUTO routes stops heatmap',
  },
  {
    id: 'feature-data-panel',
    title: 'Right data panel',
    body: `Analysis: Market cycle explanation, momentum vs peers, downloadable market brief PDF, and an AI-generated executive memo.
Data: Pricing, demographics, metro velocity, economic indicators, Google Trends, transit counts, shortlist
actions, and the full metrics table where exposed.`,
    searchAliases: 'Analysis Data tabs classifier listings inventory velocity Gemini executive memo',
  },
  {
    id: 'feature-terminal',
    title: 'Intelligence terminal',
    body: `Docked at the bottom of the map: ask questions in natural language, trigger layer changes, and run
agent-driven actions. Session can persist across reloads in the browser.`,
    searchAliases: 'AI agent chat command',
  },
  {
    id: 'feature-client-csv',
    title: 'CSV Upload',
    body: `Dedicated upload page (sidebar) parses spreadsheets with Gemini triage; rows with latitude and longitude can
appear as map pins when the Client layer is on. Pins can persist for your session when returning to the map.`,
    searchAliases: 'normalize upload spreadsheet lat lng coordinates pins',
  },
  {
    id: 'feature-shortlist-pdf',
    title: 'Shortlist & PDF',
    body: `Save ZIPs or whole city/borough areas to the shortlist with optional notes and comparison checkboxes. When two
or more sites are selected for comparison, the market brief PDF can include a comparison layout.`,
    searchAliases: 'saved sites comparison checkboxes notes aggregate borough',
  },
  {
    id: 'feature-map-view',
    title: 'Map view',
    body: `Optional 3D tilt from the data panel; floating stats summarize key metrics above the map. Site-level
analysis from the agent can open detail in the right panel instead of a map popover.`,
    searchAliases: 'stats bubble perspective tilt popover',
  },
]

/** Section-level keywords so "what you can use" / "capabilities" still matches the whole block. */
export const Documentation_FEATURES_SECTION_SEARCH_BLOB = `
what you can use capabilities features command center related pages walkthroughs scripts product
documentation
`.trim()

/** Matches metric reference intro (category titles + metric keys still filter rows). */
export const Documentation_METRICS_INTRO_SEARCH_BLOB = `
metric reference glossary tooltips definitions source cadence update field same in-app
`.trim()

export const Documentation_NEW_USERS_SEARCH_BLOB = Documentation_ONBOARDING_SEARCH_TEXT

export function metricCategoryAnchorId(title: string): string {
  return `metrics-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
}

export function getDocumentationDocOutline(): DocumentationOutlineNode[] {
  return [
    { id: 'new-users', label: 'FOR NEW USERS' },
    {
      id: 'features',
      label: 'Available Features',
      children: Documentation_FEATURES.map((f) => ({ id: f.id, label: f.title })),
    },
    {
      id: 'metrics',
      label: 'Metric Reference',
      children: ANALYST_REFERENCE_CATEGORIES.map((c) => ({
        id: metricCategoryAnchorId(c.title),
        label: c.title,
      })),
    },
  ]
}
