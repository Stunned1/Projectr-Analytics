import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeZipAreaContext,
  normalizeZipAreaLookupRow,
  resolveZipAreaContext,
  shouldFetchTexasZipCoverage,
} from '@/lib/data/zip-area-context'
import type { TexasZctaDimRow } from '@/lib/data/texas-zcta-dim'

function makeTexasCoverageRow(
  overrides: Partial<TexasZctaDimRow> & Pick<TexasZctaDimRow, 'zcta5'>
): TexasZctaDimRow {
  return {
    zcta5: overrides.zcta5,
    city: overrides.city ?? 'Houston',
    state_abbr: overrides.state_abbr ?? 'TX',
    state_fips: overrides.state_fips ?? '48',
    county_fips: overrides.county_fips ?? '201',
    county_name: overrides.county_name ?? 'Harris County',
    metro_name: overrides.metro_name ?? 'Houston-The Woodlands-Sugar Land, TX',
    metro_name_short: overrides.metro_name_short ?? 'Houston',
    lat: overrides.lat ?? 29.7604,
    lng: overrides.lng ?? -95.3698,
    land_area_sq_m: overrides.land_area_sq_m ?? 1_000_000,
    water_area_sq_m: overrides.water_area_sq_m ?? 0,
    zillow_covered: overrides.zillow_covered ?? true,
    coverage_tier: overrides.coverage_tier ?? 'zillow_enhanced',
    zori_latest: overrides.zori_latest ?? 1_600,
    zhvi_latest: overrides.zhvi_latest ?? 325_000,
    zori_growth_12m: overrides.zori_growth_12m ?? 2.1,
    zhvi_growth_12m: overrides.zhvi_growth_12m ?? -0.5,
    as_of_date: overrides.as_of_date ?? '2026-04-01',
    source_year: overrides.source_year ?? 2024,
    updated_at: overrides.updated_at ?? '2026-04-18T18:20:00.000Z',
  }
}

test('normalizes lookup rows into a stable ZIP context shape', () => {
  assert.deepStrictEqual(
    normalizeZipAreaLookupRow({
      zip: '77002',
      city: ' Houston ',
      state: 'tx',
      county_name: ' Harris County ',
      metro_name: 'Houston-The Woodlands-Sugar Land, TX',
      metro_name_short: ' Houston ',
      lat: 29.756,
      lng: -95.365,
    }),
    {
      zip: '77002',
      city: 'Houston',
      state: 'TX',
      county_name: 'Harris County',
      metro_name: 'Houston-The Woodlands-Sugar Land, TX',
      metro_name_short: 'Houston',
      lat: 29.756,
      lng: -95.365,
    }
  )
})

test('marks missing or Texas lookup rows for canonical coverage fetches', () => {
  assert.strictEqual(shouldFetchTexasZipCoverage(null), true)
  assert.strictEqual(
    shouldFetchTexasZipCoverage({
      zip: '77002',
      city: 'Houston',
      state: 'TX',
      county_name: 'Harris County',
      metro_name: 'Houston-The Woodlands-Sugar Land, TX',
      metro_name_short: 'Houston',
      lat: 29.756,
      lng: -95.365,
    }),
    true
  )
  assert.strictEqual(
    shouldFetchTexasZipCoverage({
      zip: '80202',
      city: 'Denver',
      state: 'CO',
      county_name: 'Denver County',
      metro_name: 'Denver-Aurora-Centennial, CO',
      metro_name_short: 'Denver',
      lat: 39.752,
      lng: -104.999,
    }),
    false
  )
})

test('canonical Texas coverage overrides sparse or stale lookup metadata', () => {
  const merged = mergeZipAreaContext(
    {
      zip: '77002',
      city: null,
      state: 'TX',
      county_name: 'TX County',
      metro_name: null,
      metro_name_short: null,
      lat: null,
      lng: null,
    },
    makeTexasCoverageRow({ zcta5: '77002' })
  )

  assert.deepStrictEqual(merged, {
    zip: '77002',
    city: 'Houston',
    state: 'TX',
    county_name: 'Harris County',
    metro_name: 'Houston-The Woodlands-Sugar Land, TX',
    metro_name_short: 'Houston',
    lat: 29.7604,
    lng: -95.3698,
    isTexas: true,
  })
})

test('resolveZipAreaContext skips canonical coverage for complete non-Texas lookup rows', async () => {
  let coverageCalls = 0

  const resolved = await resolveZipAreaContext('80202', {
    fetchLookupRow: async () => ({
      zip: '80202',
      city: 'Denver',
      state: 'CO',
      county_name: 'Denver County',
      metro_name: 'Denver-Aurora-Centennial, CO',
      metro_name_short: 'Denver',
      lat: 39.752,
      lng: -104.999,
    }),
    fetchCoverageRow: async () => {
      coverageCalls += 1
      return null
    },
  })

  assert.strictEqual(coverageCalls, 0)
  assert.deepStrictEqual(resolved, {
    zip: '80202',
    city: 'Denver',
    state: 'CO',
    county_name: 'Denver County',
    metro_name: 'Denver-Aurora-Centennial, CO',
    metro_name_short: 'Denver',
    lat: 39.752,
    lng: -104.999,
    isTexas: false,
  })
})

test('resolveZipAreaContext hydrates Texas ZIP metadata from canonical coverage when needed', async () => {
  let coverageCalls = 0

  const resolved = await resolveZipAreaContext('77064', {
    fetchLookupRow: async () => ({
      zip: '77064',
      city: 'Houston',
      state: 'TX',
      county_name: null,
      metro_name: null,
      metro_name_short: null,
      lat: null,
      lng: null,
    }),
    fetchCoverageRow: async () => {
      coverageCalls += 1
      return makeTexasCoverageRow({ zcta5: '77064' })
    },
  })

  assert.strictEqual(coverageCalls, 1)
  assert.deepStrictEqual(resolved, {
    zip: '77064',
    city: 'Houston',
    state: 'TX',
    county_name: 'Harris County',
    metro_name: 'Houston-The Woodlands-Sugar Land, TX',
    metro_name_short: 'Houston',
    lat: 29.7604,
    lng: -95.3698,
    isTexas: true,
  })
})
