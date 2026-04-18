import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeTexasMetroCoverageRows,
  mergeTexasPeerZipLists,
  shouldMergeTexasMetroCoverage,
  type MetroZipCoverageRow,
} from '@/lib/data/texas-metro-coverage'
import type { TexasZctaDimRow } from '@/lib/data/texas-zcta-dim'

function makeTexasMetroRow(
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

test('merges partial metro lookup rows with canonical Texas coverage', () => {
  const lookupRows: MetroZipCoverageRow[] = [
    {
      zip: '77003',
      city: 'Houston',
      state: 'TX',
      metro_name: null,
      metro_name_short: 'Houston',
      lat: 29.749,
      lng: -95.352,
    },
  ]

  const merged = mergeTexasMetroCoverageRows(lookupRows, [
    makeTexasMetroRow({ zcta5: '77002' }),
    makeTexasMetroRow({ zcta5: '77003', metro_name: 'Houston Metro' }),
  ])

  assert.strictEqual(merged.length, 2)
  assert.deepStrictEqual(merged.map((row) => row.zip), ['77003', '77002'])
  assert.deepStrictEqual(merged[0], {
    zip: '77003',
    city: 'Houston',
    state: 'TX',
    metro_name: 'Houston Metro',
    metro_name_short: 'Houston',
    lat: 29.749,
    lng: -95.352,
    zori_latest: 1_600,
    zhvi_latest: 325_000,
    zori_growth_12m: 2.1,
    zhvi_growth_12m: -0.5,
  })
})

test('dedupes metro peer ZIP lists while excluding the origin ZIP', () => {
  const merged = mergeTexasPeerZipLists(
    ['77002', '77003', '77003'],
    [makeTexasMetroRow({ zcta5: '77003' }), makeTexasMetroRow({ zcta5: '77004' })],
    { excludeZip: '77002' }
  )

  assert.deepStrictEqual(merged, ['77003', '77004'])
})

test('uses the same Texas-only merge heuristic for metro cutover decisions', () => {
  assert.strictEqual(shouldMergeTexasMetroCoverage('TX', []), true)
  assert.strictEqual(
    shouldMergeTexasMetroCoverage(undefined, [
      { zip: '77002', city: 'Houston', state: 'TX', metro_name: 'Houston', metro_name_short: 'Houston', lat: 29.76, lng: -95.37 },
    ]),
    true
  )
  assert.strictEqual(
    shouldMergeTexasMetroCoverage(undefined, [
      { zip: '65801', city: 'Springfield', state: 'MO', metro_name: 'Springfield', metro_name_short: 'Springfield', lat: 37.2, lng: -93.3 },
    ]),
    false
  )
})
