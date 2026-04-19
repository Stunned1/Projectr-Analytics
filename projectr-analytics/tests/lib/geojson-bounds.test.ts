import test from 'node:test'
import assert from 'node:assert/strict'

import { getGeoJsonBounds } from '@/lib/geojson-bounds'

test('computes bounds for polygon feature collections', () => {
  const bounds = getGeoJsonBounds({
    features: [
      {
        geometry: {
          coordinates: [[
            [-97.8, 30.2],
            [-97.7, 30.2],
            [-97.7, 30.3],
            [-97.8, 30.3],
            [-97.8, 30.2],
          ]],
        },
      },
    ],
  })

  assert.deepStrictEqual(bounds, {
    minLat: 30.2,
    maxLat: 30.3,
    minLng: -97.8,
    maxLng: -97.7,
  })
})

test('computes bounds for multipolygon feature collections', () => {
  const bounds = getGeoJsonBounds({
    features: [
      {
        geometry: {
          coordinates: [
            [[
              [-97.9, 30.1],
              [-97.8, 30.1],
              [-97.8, 30.2],
              [-97.9, 30.2],
              [-97.9, 30.1],
            ]],
            [[
              [-97.6, 30.4],
              [-97.5, 30.4],
              [-97.5, 30.5],
              [-97.6, 30.5],
              [-97.6, 30.4],
            ]],
          ],
        },
      },
    ],
  })

  assert.deepStrictEqual(bounds, {
    minLat: 30.1,
    maxLat: 30.5,
    minLng: -97.9,
    maxLng: -97.5,
  })
})
