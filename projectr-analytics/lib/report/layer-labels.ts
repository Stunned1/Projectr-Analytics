import type { MapLayersSnapshot } from './types'

const LABELS: Record<keyof Omit<MapLayersSnapshot, 'choroplethMetric'>, string> = {
  zipBoundary: 'ZIP boundaries',
  transitStops: 'Transit stops',
  rentChoropleth: 'Rent/value fill (choropleth)',
  blockGroups: 'Census block groups',
  parcels: 'NYC PLUTO parcels',
  tracts: 'Census tracts',
  amenityHeatmap: 'Amenity heatmap',
  floodRisk: 'FEMA flood zones',
  nycPermits: 'NYC building permits',
  permitH3: 'Austin permits H3 cells',
  clientData: 'Client upload markers',
}

export function formatActiveLayersList(layers: MapLayersSnapshot): string {
  const keys = Object.keys(LABELS) as (keyof typeof LABELS)[]
  const on = keys.filter((k) => layers[k]).map((k) => LABELS[k])
  if (layers.rentChoropleth) {
    const metric = layers.choroplethMetric === 'zhvi' ? 'ZHVI (home value)' : 'ZORI (rent)'
    on.push(`Fill: ${metric}`)
  }
  return on.join(' · ')
}
