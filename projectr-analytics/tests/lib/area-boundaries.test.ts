import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_MULTI_ZIP_BOUNDARIES,
  selectMultiZipBoundaryTargets,
} from '@/lib/area-boundaries'

test('keeps Houston-sized multi-ZIP boundary sets intact when they are under the cap', () => {
  const houstonSizedRows = Array.from({ length: 98 }, (_, index) => ({
    zip: String(77002 + index).padStart(5, '0'),
    lat: 29.5 + index / 1_000,
    lng: -95.7 + index / 1_000,
  }))

  const selected = selectMultiZipBoundaryTargets(houstonSizedRows)

  assert.strictEqual(selected.length, 98)
  assert.deepStrictEqual(selected.map((row) => row.zip), houstonSizedRows.map((row) => row.zip))
})

test('filters rows without coordinates and caps very large boundary sets', () => {
  const largeRows = [
    { zip: '00000', lat: null, lng: -95.4 },
    { zip: '00001', lat: 29.7, lng: null },
    ...Array.from({ length: MAX_MULTI_ZIP_BOUNDARIES + 25 }, (_, index) => ({
      zip: String(75000 + index).padStart(5, '0'),
      lat: 32.7 + index / 1_000,
      lng: -96.8 + index / 1_000,
    })),
  ]

  const selected = selectMultiZipBoundaryTargets(largeRows)

  assert.strictEqual(selected.length, MAX_MULTI_ZIP_BOUNDARIES)
  assert.ok(selected.every((row) => row.lat != null && row.lng != null))
  assert.strictEqual(selected[0]?.zip, '75000')
})
