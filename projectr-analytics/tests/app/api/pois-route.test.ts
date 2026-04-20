import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GET,
  getOvertureApiKeyForTest,
  normalizeOverturePlacesResponseForTest,
} from '@/app/api/pois/route'

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

test('GET classifies anchors by exact normalized brand match only', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const brandName = url.searchParams.get('brand_name')

    if (brandName === 'Apple') {
      return jsonResponse([
        fixturePlace('apple-1', 'Apple', 'coffee_shop'),
      ])
    }

    if (brandName === 'Dig') {
      return jsonResponse([
        fixturePlace('dig-1', 'Diggity Bagels', 'restaurant'),
      ])
    }

    return jsonResponse([])
  }) as typeof fetch

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/pois?lat=30.2672&lng=-97.7431&mode=anchors'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.count, 1)
    assert.equal(body.anchor_count, 1)
    assert.equal(body.by_category.anchor, 1)
    assert.equal(body.by_category.restaurant, undefined)
    assert.deepEqual(body.points.map((point: { id: string }) => point.id), ['apple-1'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GET surfaces upstream Overture failures instead of returning empty results', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => jsonErrorResponse(429, 'Too Many Requests')) as typeof fetch

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/pois?lat=30.2672&lng=-97.7431&mode=signals'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 429)
    assert.match(body.error, /429|Too Many Requests/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

function fixturePlace(id: string, name: string, category: string, brand?: string) {
  return {
    id,
    geometry: { type: 'Point', coordinates: [-97.7431, 30.2672] as [number, number] },
    properties: {
      names: { primary: name },
      categories: { primary: category },
      brand: brand ? { names: { primary: brand } } : undefined,
      addresses: [{ freeform: '500 Congress Ave' }],
      confidence: 0.77,
    },
  }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify({ value }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonErrorResponse(status: number, statusText: string) {
  return new Response(JSON.stringify({ error: statusText }), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  })
}
