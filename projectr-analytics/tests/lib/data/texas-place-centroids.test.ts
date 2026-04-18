import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTexasPlaceCentroidMaps,
  buildTexasPlaceKey,
  normalizeTexasCityToken,
} from '@/lib/data/texas-place-centroids'
import type { TexasZctaDimRow } from '@/lib/data/texas-zcta-dim'

function makeTexasZctaRow(
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

test('builds Texas place centroid maps from sparse lookup rows plus canonical statewide coverage', () => {
  const lookupRows = [
    { city: 'Houston', county_name: 'Harris County', lat: 29.75, lng: -95.35 },
    { city: 'Houston', county_name: 'Harris County', lat: 29.77, lng: -95.37 },
  ]

  const canonicalRows = [
    makeTexasZctaRow({ zcta5: '77546', city: 'Friendswood', county_name: 'Galveston County', lat: 29.5294, lng: -95.201 }),
    makeTexasZctaRow({ zcta5: '77002', city: 'Houston', county_name: 'Harris County', lat: 29.756, lng: -95.365 }),
  ]

  const { byCity, byCityCounty } = buildTexasPlaceCentroidMaps(lookupRows, canonicalRows)

  assert.deepStrictEqual(byCity.get('houston'), {
    lat: (29.75 + 29.77 + 29.756) / 3,
    lng: (-95.35 + -95.37 + -95.365) / 3,
    source: 'zip_lookup',
  })

  assert.deepStrictEqual(byCityCounty.get(buildTexasPlaceKey('Friendswood', 'Galveston County')), {
    lat: 29.5294,
    lng: -95.201,
    source: 'zip_lookup',
  })
})

test('normalizes Texas place keys consistently for city labels with prefixes and state suffixes', () => {
  assert.strictEqual(normalizeTexasCityToken('City of Houston, TX'), 'houston')
  assert.strictEqual(buildTexasPlaceKey('City of Houston, TX', 'Harris County'), 'houston|harris')
})
