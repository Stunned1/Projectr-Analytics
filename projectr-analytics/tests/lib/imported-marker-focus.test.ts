import assert from 'node:assert/strict'
import test from 'node:test'

import { planImportedMarkerFocus } from '@/lib/imported-marker-focus'

test('planImportedMarkerFocus clears focus when there are no imported markers', () => {
  assert.deepEqual(planImportedMarkerFocus([]), { mode: 'clear' })
  assert.deepEqual(planImportedMarkerFocus(null), { mode: 'clear' })
})

test('planImportedMarkerFocus flies directly to a single imported marker', () => {
  assert.deepEqual(planImportedMarkerFocus([{ lat: 30.2672, lng: -97.7431 }]), {
    mode: 'fly',
    target: { lat: 30.2672, lng: -97.7431 },
  })
})

test('planImportedMarkerFocus fits bounds when multiple imported markers are present', () => {
  assert.deepEqual(
    planImportedMarkerFocus([
      { lat: 30.2672, lng: -97.7431 },
      { lat: 30.2501, lng: -97.7494 },
    ]),
    { mode: 'fit' }
  )
})
