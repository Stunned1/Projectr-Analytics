import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeForwardGeocodeQuery } from '@/lib/google-forward-geocode'

test('normalizeForwardGeocodeQuery trims, lowercases, and collapses whitespace', () => {
  assert.equal(
    normalizeForwardGeocodeQuery('  701 JEFFERSON ST   FLR FL 4,   Houston, TX 77002  '),
    '701 jefferson st flr fl 4, houston, tx 77002'
  )
})

test('normalizeForwardGeocodeQuery rejects too-short inputs', () => {
  assert.equal(normalizeForwardGeocodeQuery('  '), null)
  assert.equal(normalizeForwardGeocodeQuery('x '), null)
})
