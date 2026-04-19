import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCountyBoundaryQueryUrl } from '@/lib/county-boundary'

test('builds a Census TIGER county boundary query for the requested state and county FIPS', () => {
  const url = buildCountyBoundaryQueryUrl('TX', '201')

  assert.ok(url)
  assert.match(url ?? '', /State_County\/MapServer\/1\/query/)
  assert.match(url ?? '', /STATE%3D%2748%27/)
  assert.match(url ?? '', /COUNTY%3D%27201%27/)
})

test('returns null when the county fips is invalid', () => {
  assert.strictEqual(buildCountyBoundaryQueryUrl('TX', '20'), null)
  assert.strictEqual(buildCountyBoundaryQueryUrl('TX', ''), null)
})
