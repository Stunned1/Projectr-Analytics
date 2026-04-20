import test from 'node:test'
import assert from 'node:assert/strict'

import { getOvertureApiKeyForTest, normalizeOverturePlacesResponseForTest } from '@/app/api/pois/route'

test('getOvertureApiKeyForTest prefers a configured OVERTURE_API_KEY', () => {
  assert.equal(
    getOvertureApiKeyForTest({
      OVERTURE_API_KEY: 'live-test-key',
    } as NodeJS.ProcessEnv),
    'live-test-key'
  )
})

test('getOvertureApiKeyForTest falls back to the demo key when no env key exists', () => {
  assert.equal(
    getOvertureApiKeyForTest({} as NodeJS.ProcessEnv),
    'DEMO-API-KEY'
  )
})

test('normalizeOverturePlacesResponseForTest unwraps value arrays from the live API shape', () => {
  const response = {
    value: [
      { id: 'one' },
      { id: 'two' },
    ],
    Count: 2,
  }

  assert.deepEqual(normalizeOverturePlacesResponseForTest(response), [
    { id: 'one' },
    { id: 'two' },
  ])
})

test('normalizeOverturePlacesResponseForTest accepts bare arrays unchanged', () => {
  const response = [{ id: 'one' }]

  assert.deepEqual(normalizeOverturePlacesResponseForTest(response), response)
})
