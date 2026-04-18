import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeTexasCountyCoverageRows,
  shouldMergeTexasCountyCoverage,
  type CountyZipCoverageRow,
} from '@/lib/data/texas-county-coverage'
import type { TexasZctaDimRow } from '@/lib/data/texas-zcta-dim'

function makeTexasCountyRow(
  overrides: Partial<TexasZctaDimRow> & Pick<TexasZctaDimRow, 'zcta5'>
): TexasZctaDimRow {
  return {
    zcta5: overrides.zcta5,
    city: overrides.city ?? 'Bryan',
    state_abbr: overrides.state_abbr ?? 'TX',
    state_fips: overrides.state_fips ?? '48',
    county_fips: overrides.county_fips ?? '041',
    county_name: overrides.county_name ?? 'Brazos County',
    metro_name: overrides.metro_name ?? 'College Station-Bryan, TX',
    metro_name_short: overrides.metro_name_short ?? 'College Station',
    lat: overrides.lat ?? 30.674,
    lng: overrides.lng ?? -96.369,
    land_area_sq_m: overrides.land_area_sq_m ?? 1_000_000,
    water_area_sq_m: overrides.water_area_sq_m ?? 0,
    zillow_covered: overrides.zillow_covered ?? true,
    coverage_tier: overrides.coverage_tier ?? 'zillow_enhanced',
    zori_latest: overrides.zori_latest ?? 1_450,
    zhvi_latest: overrides.zhvi_latest ?? 285_000,
    zori_growth_12m: overrides.zori_growth_12m ?? 1.9,
    zhvi_growth_12m: overrides.zhvi_growth_12m ?? -0.4,
    as_of_date: overrides.as_of_date ?? '2026-04-01',
    source_year: overrides.source_year ?? 2024,
    updated_at: overrides.updated_at ?? '2026-04-18T18:20:00.000Z',
  }
}

test('merges partial county lookup rows with canonical Texas coverage', () => {
  const lookupRows: CountyZipCoverageRow[] = [
    {
      zip: '77803',
      city: 'Bryan',
      state: 'TX',
      metro_name: null,
      county_name: 'Brazos County',
      lat: 30.674,
      lng: -96.369,
      zori_latest: 1_410,
    },
  ]

  const merged = mergeTexasCountyCoverageRows(lookupRows, [
    makeTexasCountyRow({ zcta5: '77803', metro_name: 'College Station-Bryan, TX' }),
    makeTexasCountyRow({ zcta5: '77807', city: 'College Station', lat: 30.61, lng: -96.31 }),
  ])

  assert.strictEqual(merged.length, 2)
  assert.deepStrictEqual(merged.map((row) => row.zip), ['77803', '77807'])
  assert.deepStrictEqual(merged[0], {
    zip: '77803',
    city: 'Bryan',
    state: 'TX',
    metro_name: 'College Station-Bryan, TX',
    county_name: 'Brazos County',
    lat: 30.674,
    lng: -96.369,
    zori_latest: 1_410,
    zhvi_latest: 285_000,
    zori_growth_12m: 1.9,
    zhvi_growth_12m: -0.4,
  })
})

test('uses the same Texas-only merge heuristic for county cutover decisions', () => {
  assert.strictEqual(shouldMergeTexasCountyCoverage('TX', []), true)
  assert.strictEqual(
    shouldMergeTexasCountyCoverage(undefined, [
      { zip: '77803', city: 'Bryan', state: 'TX', metro_name: null, county_name: 'Brazos County', lat: 30.674, lng: -96.369 },
    ]),
    true
  )
  assert.strictEqual(
    shouldMergeTexasCountyCoverage(undefined, [
      { zip: '77803', city: 'Bryan', state: 'TX', metro_name: null, county_name: 'Brazos County', lat: 30.674, lng: -96.369 },
      { zip: '61036', city: 'Galena', state: 'IL', metro_name: null, county_name: 'Jo Daviess County', lat: 42.416, lng: -90.429 },
    ]),
    false
  )
})
