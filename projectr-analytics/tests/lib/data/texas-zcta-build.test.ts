import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isPollutedTexasCountyName,
  normalizeTexasCountyName,
  resolveTexasCountyName,
} from '@/lib/data/texas-zcta-build'

test('normalizes Texas county labels consistently', () => {
  assert.strictEqual(normalizeTexasCountyName('Harris'), 'Harris County')
  assert.strictEqual(normalizeTexasCountyName('Harris County'), 'Harris County')
  assert.strictEqual(normalizeTexasCountyName('   '), null)
})

test('prefers canonical Census county names over lookup metadata', () => {
  assert.strictEqual(resolveTexasCountyName('Harris County', 'TX'), 'Harris County')
  assert.strictEqual(resolveTexasCountyName('Travis County', 'TX County'), 'Travis County')
})

test('rejects polluted Texas lookup county labels when no canonical county is available', () => {
  assert.strictEqual(isPollutedTexasCountyName('TX'), true)
  assert.strictEqual(isPollutedTexasCountyName('Texas County'), true)
  assert.strictEqual(resolveTexasCountyName(null, 'TX'), null)
  assert.strictEqual(resolveTexasCountyName(null, 'Texas'), null)
  assert.strictEqual(resolveTexasCountyName(null, 'Brazos County'), 'Brazos County')
})
