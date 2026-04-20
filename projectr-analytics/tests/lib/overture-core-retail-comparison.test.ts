import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bucketCategoryForTest,
  buildCoreRetailComparisonForTest,
  resolveCoreRetailCityForTest,
} from '@/lib/overture-core-retail-comparison'

test('resolves supported core retail cities', () => {
  assert.deepEqual(resolveCoreRetailCityForTest('Austin'), {
    key: 'austin',
    label: 'Austin',
    latitude: 30.2672,
    longitude: -97.7431,
  })
  assert.deepEqual(resolveCoreRetailCityForTest('Houston'), {
    key: 'houston',
    label: 'Houston',
    latitude: 29.7604,
    longitude: -95.3698,
  })
  assert.deepEqual(resolveCoreRetailCityForTest('Dallas'), {
    key: 'dallas',
    label: 'Dallas',
    latitude: 32.7767,
    longitude: -96.797,
  })
  assert.equal(resolveCoreRetailCityForTest('El Paso'), null)
})

test('aggregates an Austin vs Dallas core retail comparison', async () => {
  const result = await buildCoreRetailComparisonForTest(
    { cityA: 'Austin', cityB: 'Dallas' },
    async ({ cityKey }) =>
      cityKey === 'austin'
        ? [
            fixturePlace('a1', 'Haraz Coffee House', 'coffee_shop'),
            fixturePlace('a2', 'Thundercloud Subs', 'restaurant'),
          ]
        : [
            fixturePlace('d1', 'K-Sha Coffee', 'coffee_shop'),
            fixturePlace('d2', 'Big Deal Burger', 'burger_restaurant'),
            fixturePlace('d3', 'CVS Pharmacy', 'pharmacy'),
          ]
  )

  assert.equal(result.cityA.label, 'Austin')
  assert.equal(result.cityB.label, 'Dallas')
  assert.deepEqual(result.buckets, [
    { key: 'food_bev', label: 'Food & Bev', cityAValue: 1, cityBValue: 1 },
    { key: 'coffee_cafe', label: 'Coffee & Cafe', cityAValue: 1, cityBValue: 1 },
    { key: 'essentials', label: 'Essentials', cityAValue: 0, cityBValue: 1 },
    { key: 'fitness', label: 'Fitness', cityAValue: 0, cityBValue: 0 },
  ])
})

test('maps Overture categories into bounded retail buckets', () => {
  assert.equal(bucketCategoryForTest('  COFFEE_SHOP  '), 'coffee_cafe')
  assert.equal(bucketCategoryForTest('coffee_shop'), 'coffee_cafe')
  assert.equal(bucketCategoryForTest('restaurant'), 'food_bev')
  assert.equal(bucketCategoryForTest('pharmacy'), 'essentials')
  assert.equal(bucketCategoryForTest('gym'), 'fitness')
  assert.equal(bucketCategoryForTest('software_development'), null)
})

test('aggregates two city cores into grouped comparison buckets', async () => {
  const contexts: Array<{ cityKey: string; radiusMeters: number; latitude: number; longitude: number }> = []
  const result = await buildCoreRetailComparisonForTest(
    { cityA: '  AuStIn  ', cityB: '  hOuStOn  ' },
    async ({ cityKey, city, radiusMeters }) => {
      contexts.push({
        cityKey,
        radiusMeters,
        latitude: city.latitude,
        longitude: city.longitude,
      })

      return cityKey === 'austin'
        ? [
            fixturePlace('a1', 'Haraz Coffee House', 'coffee_shop'),
            fixturePlace('a2', 'Thundercloud Subs', 'restaurant'),
            fixturePlace('a3', 'CVS Pharmacy', 'pharmacy'),
            fixturePlace('a4', 'Shark Fitness', 'gym'),
          ]
        : [
            fixturePlace('h1', 'Starbucks', 'coffee_shop'),
            fixturePlace('h2', 'Pupuseria La Fuente', 'restaurant'),
          ]
    }
  )

  assert.equal(result.cityA.label, 'Austin')
  assert.equal(result.cityB.label, 'Houston')
  assert.equal(result.radiusMeters, 1200)
  assert.deepEqual(contexts, [
    { cityKey: 'austin', radiusMeters: 1200, latitude: 30.2672, longitude: -97.7431 },
    { cityKey: 'houston', radiusMeters: 1200, latitude: 29.7604, longitude: -95.3698 },
  ])
  assert.deepEqual(result.buckets, [
    { key: 'food_bev', label: 'Food & Bev', cityAValue: 1, cityBValue: 1 },
    { key: 'coffee_cafe', label: 'Coffee & Cafe', cityAValue: 1, cityBValue: 1 },
    { key: 'essentials', label: 'Essentials', cityAValue: 1, cityBValue: 0 },
    { key: 'fitness', label: 'Fitness', cityAValue: 1, cityBValue: 0 },
  ])
})

test('rejects unsupported public helper inputs explicitly', async () => {
  await assert.rejects(
    buildCoreRetailComparisonForTest({ cityA: '  Austin  ', cityB: ' El Paso ' }),
    /supports Austin compared with Houston or Dallas only/i
  )
})

test('fails explicitly when a supported city has no usable retail points', async () => {
  await assert.rejects(
    buildCoreRetailComparisonForTest({ cityA: 'Austin', cityB: 'Houston' }, async ({ cityKey }) =>
      cityKey === 'austin' ? [fixturePlace('a1', 'Haraz Coffee House', 'coffee_shop')] : []
    ),
    /insufficient overture retail context/i
  )
})

function fixturePlace(id: string, name: string, category: string) {
  return {
    id,
    geometry: { type: 'Point', coordinates: [-97.7431, 30.2672] as [number, number] },
    properties: {
      names: { primary: name },
      categories: { primary: category },
      addresses: [{ freeform: '500 Congress Ave' }],
      confidence: 0.77,
    },
  }
}
