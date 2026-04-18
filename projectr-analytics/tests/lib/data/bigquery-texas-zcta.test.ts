import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

type BigQueryTexasZctaModuleExports = typeof import('@/lib/data/bigquery-texas-zcta')

const require = createRequire(import.meta.url)
const NodeModule = require('node:module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalModuleLoad = NodeModule._load

let modulePromise: Promise<BigQueryTexasZctaModuleExports> | null = null

async function loadModule(): Promise<BigQueryTexasZctaModuleExports> {
  if (!modulePromise) {
    NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'server-only') {
        return {}
      }

      return originalModuleLoad.call(this, request, parent, isMain)
    }
    modulePromise = import('@/lib/data/bigquery-texas-zcta').finally(() => {
      NodeModule._load = originalModuleLoad
    })
  }

  return modulePromise
}

test('normalizes texas ZCTA BigQuery rows into typed coverage records', async () => {
  const { normalizeTexasZctaRows } = await loadModule()

  const rows = normalizeTexasZctaRows([
    {
      zcta5: '78701',
      city: 'Austin',
      state_abbr: 'TX',
      state_fips: '48',
      county_fips: '453',
      county_name: 'Travis County',
      metro_name: 'Austin-Round Rock-San Marcos, TX',
      metro_name_short: 'Austin',
      lat: '30.2711',
      lng: '-97.7437',
      land_area_sq_m: '3957462',
      water_area_sq_m: '12484',
      zillow_covered: 'true',
      coverage_tier: 'zillow_enhanced',
      zori_latest: '1895.2',
      zhvi_latest: '615233.8',
      zori_growth_12m: '4.2',
      zhvi_growth_12m: '-1.1',
      as_of_date: '2026-04-01',
      source_year: '2024',
      updated_at: '2026-04-18T18:20:00Z',
    },
  ])

  assert.strictEqual(rows.length, 1)
  assert.deepStrictEqual(rows[0], {
    zcta5: '78701',
    city: 'Austin',
    state_abbr: 'TX',
    state_fips: '48',
    county_fips: '453',
    county_name: 'Travis County',
    metro_name: 'Austin-Round Rock-San Marcos, TX',
    metro_name_short: 'Austin',
    lat: 30.2711,
    lng: -97.7437,
    land_area_sq_m: 3957462,
    water_area_sq_m: 12484,
    zillow_covered: true,
    coverage_tier: 'zillow_enhanced',
    zori_latest: 1895.2,
    zhvi_latest: 615233.8,
    zori_growth_12m: 4.2,
    zhvi_growth_12m: -1.1,
    as_of_date: '2026-04-01',
    source_year: 2024,
    updated_at: '2026-04-18T18:20:00.000Z',
  })
})

test('queries texas_zcta_dim for Texas city fallback rows', async () => {
  const { fetchTexasZctaRowsByCity } = await loadModule()
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID
  const originalLocation = process.env.BIGQUERY_LOCATION

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev'
    process.env.BIGQUERY_DATASET_ID = 'market_router'
    process.env.BIGQUERY_LOCATION = 'US'

    const queries: string[] = []
    const client = {
      query: async (options: unknown) => {
        const payload = options as { query: string; params: Record<string, unknown> }
        queries.push(payload.query)
        assert.strictEqual(payload.params.city, 'Austin')
        assert.strictEqual(payload.params.stateAbbr, 'TX')
        return [[{
          zcta5: '78701',
          city: 'Austin',
          state_abbr: 'TX',
          state_fips: '48',
          county_fips: '453',
          county_name: 'Travis County',
          metro_name: 'Austin-Round Rock-San Marcos, TX',
          metro_name_short: 'Austin',
          lat: 30.2711,
          lng: -97.7437,
          land_area_sq_m: 3957462,
          water_area_sq_m: 12484,
          zillow_covered: true,
          coverage_tier: 'zillow_enhanced',
          zori_latest: 1895.2,
          zhvi_latest: 615233.8,
          zori_growth_12m: 4.2,
          zhvi_growth_12m: -1.1,
          as_of_date: '2026-04-01',
          source_year: 2024,
          updated_at: '2026-04-18T18:20:00Z',
        }]]
      },
    }

    const rows = await fetchTexasZctaRowsByCity('Austin', 'TX', { client })
    assert.strictEqual(rows.length, 1)
    assert.match(queries[0], /market_router\.texas_zcta_dim/)
    assert.strictEqual(rows[0]?.zcta5, '78701')
    assert.strictEqual(rows[0]?.coverage_tier, 'zillow_enhanced')
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId

    if (originalLocation === undefined) delete process.env.BIGQUERY_LOCATION
    else process.env.BIGQUERY_LOCATION = originalLocation
  }
})

test('queries texas_zcta_dim for statewide Texas coverage rows', async () => {
  const { fetchTexasZctaRowsByState } = await loadModule()
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID
  const originalLocation = process.env.BIGQUERY_LOCATION

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev'
    process.env.BIGQUERY_DATASET_ID = 'market_router'
    process.env.BIGQUERY_LOCATION = 'US'

    const queries: string[] = []
    const client = {
      query: async (options: unknown) => {
        const payload = options as { query: string; params: Record<string, unknown> }
        queries.push(payload.query)
        assert.strictEqual(payload.params.stateAbbr, 'TX')
        return [[{
          zcta5: '77002',
          city: 'Houston',
          state_abbr: 'TX',
          state_fips: '48',
          county_fips: '201',
          county_name: 'Harris County',
          metro_name: 'Houston-The Woodlands-Sugar Land, TX',
          metro_name_short: 'Houston',
          lat: 29.756,
          lng: -95.365,
          land_area_sq_m: 3957462,
          water_area_sq_m: 12484,
          zillow_covered: true,
          coverage_tier: 'zillow_enhanced',
          zori_latest: 1725.8,
          zhvi_latest: 315233.8,
          zori_growth_12m: 2.4,
          zhvi_growth_12m: -0.6,
          as_of_date: '2026-04-01',
          source_year: 2024,
          updated_at: '2026-04-18T18:20:00Z',
        }]]
      },
    }

    const rows = await fetchTexasZctaRowsByState('TX', { client })
    assert.strictEqual(rows.length, 1)
    assert.match(queries[0], /WHERE state_abbr = @stateAbbr/)
    assert.match(queries[0], /market_router\.texas_zcta_dim/)
    assert.strictEqual(rows[0]?.zcta5, '77002')
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId

    if (originalLocation === undefined) delete process.env.BIGQUERY_LOCATION
    else process.env.BIGQUERY_LOCATION = originalLocation
  }
})

test('queries texas_zcta_dim for Texas metro fallback rows', async () => {
  const { fetchTexasZctaRowsByMetro } = await loadModule()
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID
  const originalLocation = process.env.BIGQUERY_LOCATION

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev'
    process.env.BIGQUERY_DATASET_ID = 'market_router'
    process.env.BIGQUERY_LOCATION = 'US'

    const queries: string[] = []
    const client = {
      query: async (options: unknown) => {
        const payload = options as { query: string; params: Record<string, unknown> }
        queries.push(payload.query)
        assert.strictEqual(payload.params.metroName, 'Houston')
        assert.strictEqual(payload.params.stateAbbr, 'TX')
        return [[{
          zcta5: '77002',
          city: 'Houston',
          state_abbr: 'TX',
          state_fips: '48',
          county_fips: '201',
          county_name: 'Harris County',
          metro_name: 'Houston-The Woodlands-Sugar Land, TX',
          metro_name_short: 'Houston',
          lat: 29.756,
          lng: -95.365,
          land_area_sq_m: 3957462,
          water_area_sq_m: 12484,
          zillow_covered: true,
          coverage_tier: 'zillow_enhanced',
          zori_latest: 1725.8,
          zhvi_latest: 315233.8,
          zori_growth_12m: 2.4,
          zhvi_growth_12m: -0.6,
          as_of_date: '2026-04-01',
          source_year: 2024,
          updated_at: '2026-04-18T18:20:00Z',
        }]]
      },
    }

    const rows = await fetchTexasZctaRowsByMetro('Houston', 'TX', { client })
    assert.strictEqual(rows.length, 1)
    assert.match(queries[0], /metro_name_short IS NOT NULL/)
    assert.match(queries[0], /market_router\.texas_zcta_dim/)
    assert.strictEqual(rows[0]?.metro_name_short, 'Houston')
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId

    if (originalLocation === undefined) delete process.env.BIGQUERY_LOCATION
    else process.env.BIGQUERY_LOCATION = originalLocation
  }
})

test('queries texas_zcta_dim for Texas county fallback rows', async () => {
  const { fetchTexasZctaRowsByCounty } = await loadModule()
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID
  const originalLocation = process.env.BIGQUERY_LOCATION

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev'
    process.env.BIGQUERY_DATASET_ID = 'market_router'
    process.env.BIGQUERY_LOCATION = 'US'

    const queries: string[] = []
    const client = {
      query: async (options: unknown) => {
        const payload = options as { query: string; params: Record<string, unknown> }
        queries.push(payload.query)
        assert.strictEqual(payload.params.countyName, 'Travis County')
        assert.strictEqual(payload.params.stateAbbr, 'TX')
        return [[{
          zcta5: '78701',
          city: 'Austin',
          state_abbr: 'TX',
          state_fips: '48',
          county_fips: '453',
          county_name: 'Travis County',
          metro_name: 'Austin-Round Rock-San Marcos, TX',
          metro_name_short: 'Austin',
          lat: 30.2711,
          lng: -97.7437,
          land_area_sq_m: 3957462,
          water_area_sq_m: 12484,
          zillow_covered: true,
          coverage_tier: 'zillow_enhanced',
          zori_latest: 1895.2,
          zhvi_latest: 615233.8,
          zori_growth_12m: 4.2,
          zhvi_growth_12m: -1.1,
          as_of_date: '2026-04-01',
          source_year: 2024,
          updated_at: '2026-04-18T18:20:00Z',
        }]]
      },
    }

    const rows = await fetchTexasZctaRowsByCounty('Travis County', 'TX', { client })
    assert.strictEqual(rows.length, 1)
    assert.match(queries[0], /county_name IS NOT NULL/)
    assert.match(queries[0], /market_router\.texas_zcta_dim/)
    assert.strictEqual(rows[0]?.county_name, 'Travis County')
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId

    if (originalLocation === undefined) delete process.env.BIGQUERY_LOCATION
    else process.env.BIGQUERY_LOCATION = originalLocation
  }
})
