import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildClientReportPayloadFromAggregate,
  buildClientReportPayloadFromZip,
} from '@/lib/report/build-client-payload'
import type { MapLayersSnapshot } from '@/lib/report/types'

const layers: MapLayersSnapshot = {
  zipBoundary: true,
  transitStops: false,
  rentChoropleth: true,
  blockGroups: false,
  parcels: false,
  tracts: false,
  amenityHeatmap: false,
  floodRisk: false,
  nycPermits: false,
  permitH3: false,
  clientData: false,
  choroplethMetric: 'zori',
}

test('zip report payload omits cycle analysis data', () => {
  const payload = buildClientReportPayloadFromZip({
    result: {
      zip: '77002',
      geo: { lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX' },
      data: [],
      zillow: {
        zori_latest: 1800,
        zori_growth_12m: 3.2,
        zhvi_latest: 325000,
        zhvi_growth_12m: 2.1,
        metro_name: 'Houston, TX',
        city: 'Houston',
      },
    },
    trends: {
      series: [{ date: '2026-01-01', value: 50 }],
      keyword_scope: 'Houston, TX',
    },
    layers,
    pins: [],
  })

  assert.equal('cycleAnalysis' in payload, false)
})

test('aggregate report payload omits cycle analysis data', () => {
  const payload = buildClientReportPayloadFromAggregate({
    aggregate: {
      label: 'Houston, TX',
      zip_count: 2,
      total_population: 1000,
      zillow: {
        avg_zori: 1800,
        avg_zhvi: 320000,
        zori_growth_12m: 3.2,
        zhvi_growth_12m: 2.1,
      },
      housing: {
        total_units: 500,
        vacancy_rate: 6.1,
        median_income: 75000,
        median_rent: 1600,
        migration_movers: 45,
      },
      permits: {
        total_units: 20,
        total_value: 1000000,
        by_year: [{ year: '2025', units: 20 }],
      },
      fred: [],
    },
    cityZips: [{ zip: '77002', lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX' }],
    layers,
    pins: [],
    trends: {
      series: [{ date: '2026-01-01', value: 50 }],
      keyword_scope: 'Houston, TX',
    },
  })

  assert.equal('cycleAnalysis' in payload, false)
})
