import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeTexasCityCoverageRows,
  shouldMergeTexasCityCoverage,
  type CityZipCoverageRow,
} from '@/lib/data/texas-city-coverage'
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

test('merges Texas lookup rows with canonical coverage without dropping existing metrics', () => {
  const lookupRows: CityZipCoverageRow[] = [
    {
      zip: '77003',
      city: 'Houston',
      state: 'tx',
      metro_name: null,
      lat: 29.749,
      lng: -95.352,
      zori_latest: 1_525,
      zhvi_latest: null,
      zori_growth_12m: null,
      zhvi_growth_12m: null,
    },
  ]

  const merged = mergeTexasCityCoverageRows(
    lookupRows,
    [
      makeTexasCoverageRow({ zcta5: '77002', zori_latest: 1_900 }),
      makeTexasCoverageRow({ zcta5: '77003', zori_latest: 1_610, metro_name: 'Houston Metro' }),
    ],
    'Houston'
  )

  assert.strictEqual(merged.length, 2)
  assert.deepStrictEqual(
    merged.map((row) => row.zip),
    ['77003', '77002']
  )

  const existingZip = merged.find((row) => row.zip === '77003')
  assert.deepStrictEqual(existingZip, {
    zip: '77003',
    city: 'Houston',
    state: 'TX',
    metro_name: 'Houston Metro',
    lat: 29.749,
    lng: -95.352,
    zori_latest: 1_525,
    zhvi_latest: 325_000,
    zori_growth_12m: 2.1,
    zhvi_growth_12m: -0.5,
  })

  const appendedZip = merged.find((row) => row.zip === '77002')
  assert.deepStrictEqual(appendedZip, {
    zip: '77002',
    city: 'Houston',
    state: 'TX',
    metro_name: 'Houston-The Woodlands-Sugar Land, TX',
    lat: 29.7604,
    lng: -95.3698,
    zori_latest: 1_900,
    zhvi_latest: 325_000,
    zori_growth_12m: 2.1,
    zhvi_growth_12m: -0.5,
  })
})

test('only auto-merges Texas city coverage for explicit or clearly Texas searches', () => {
  assert.strictEqual(shouldMergeTexasCityCoverage('TX', []), true)

  assert.strictEqual(
    shouldMergeTexasCityCoverage(undefined, [
      { zip: '77002', city: 'Houston', state: 'TX', metro_name: null, lat: 29.76, lng: -95.37 },
      { zip: '77003', city: 'Houston', state: 'TX', metro_name: null, lat: 29.75, lng: -95.35 },
    ]),
    true
  )

  assert.strictEqual(
    shouldMergeTexasCityCoverage(undefined, [
      { zip: '77002', city: 'Houston', state: 'TX', metro_name: null, lat: 29.76, lng: -95.37 },
      { zip: '65483', city: 'Houston', state: 'MO', metro_name: null, lat: 37.33, lng: -91.95 },
    ]),
    false
  )

  assert.strictEqual(
    shouldMergeTexasCityCoverage('CA', [
      { zip: '90001', city: 'Los Angeles', state: 'CA', metro_name: null, lat: 33.97, lng: -118.25 },
    ]),
    false
  )
})
