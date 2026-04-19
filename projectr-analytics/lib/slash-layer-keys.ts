/**
 * Layer keys accepted by `/layers:…` and `/clear:layers` — mirrors `LayerState` in `CommandMap`.
 */
export const SLASH_LAYER_KEYS = [
  'zipBoundary',
  'transitStops',
  'rentChoropleth',
  'blockGroups',
  'parcels',
  'tracts',
  'amenityHeatmap',
  'floodRisk',
  'nycPermits',
  'permitH3',
  'pois',
  'momentum',
  'clientData',
] as const

export type SlashLayerKey = (typeof SLASH_LAYER_KEYS)[number]

export const ALL_LAYERS_OFF: Record<SlashLayerKey, false> = {
  zipBoundary: false,
  transitStops: false,
  rentChoropleth: false,
  blockGroups: false,
  parcels: false,
  tracts: false,
  amenityHeatmap: false,
  floodRisk: false,
  nycPermits: false,
  permitH3: false,
  pois: false,
  momentum: false,
  clientData: false,
}

/** Normalized token (lowercase, no spaces/underscores/hyphens) → canonical key */
const LAYER_SLASH_ALIASES: Record<string, SlashLayerKey> = {
  zipboundary: 'zipBoundary',
  zip: 'zipBoundary',
  boundary: 'zipBoundary',
  transitstops: 'transitStops',
  transit: 'transitStops',
  stops: 'transitStops',
  rentchoropleth: 'rentChoropleth',
  rent: 'rentChoropleth',
  fill: 'rentChoropleth',
  choropleth: 'rentChoropleth',
  zillow: 'rentChoropleth',
  zori: 'rentChoropleth',
  zhvi: 'rentChoropleth',
  parcels: 'parcels',
  parcel: 'parcels',
  pluto: 'parcels',
  tracts: 'tracts',
  tract: 'tracts',
  amenityheatmap: 'amenityHeatmap',
  amenity: 'amenityHeatmap',
  heatmap: 'amenityHeatmap',
  floodrisk: 'floodRisk',
  flood: 'floodRisk',
  nycpermits: 'nycPermits',
  permits: 'nycPermits',
  permit: 'nycPermits',
  dob: 'nycPermits',
  permith3: 'permitH3',
  permitsh3: 'permitH3',
  h3: 'permitH3',
  h3permits: 'permitH3',
  pois: 'pois',
  poi: 'pois',
  momentum: 'momentum',
  clientdata: 'clientData',
  client: 'clientData',
  markers: 'clientData',
  pins: 'clientData',
  upload: 'clientData',
  csv: 'clientData',
  blockgroups: 'blockGroups',
  blockgroup: 'blockGroups',
  blocks: 'blockGroups',
}

export function normalizeLayerSlashToken(token: string): SlashLayerKey | null {
  const raw = token.trim()
  if (!raw) return null
  const t = raw.toLowerCase().replace(/[\s_-]+/g, '')
  if (!t) return null
  const alias = LAYER_SLASH_ALIASES[t]
  if (alias) return alias
  const direct = SLASH_LAYER_KEYS.find((k) => k.toLowerCase() === t)
  return direct ?? null
}

export function layerSlashValidNamesHint(): string {
  return `Valid names (comma-separated): ${SLASH_LAYER_KEYS.join(', ')} — plus aliases like rent, permits, transit, parcels, client, …`
}
