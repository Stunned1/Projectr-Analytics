import test from 'node:test'
import assert from 'node:assert/strict'

import { GET } from '@/app/api/site-context/places/route'

test('GET returns 400 for invalid lat lng or radius', async () => {
  const response = await GET({
    nextUrl: new URL('http://localhost/api/site-context/places?lat=abc&lng=-97.7431&radius=750'),
  } as never)
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.match(body.error, /valid lat, lng, and radius/i)
})

test('GET returns 400 for blank or whitespace query params', async () => {
  const response = await GET({
    nextUrl: new URL('http://localhost/api/site-context/places?lat=%20&lng=&radius=750'),
  } as never)
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.match(body.error, /valid lat, lng, and radius/i)
})

test('GET defaults radius to 500 when omitted', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GOOGLE_PLACES_API_KEY

  process.env.GOOGLE_PLACES_API_KEY = 'places-test-key'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      locationRestriction?: {
        circle?: {
          radius?: number
        }
      }
    }

    assert.equal(String(input), 'https://places.googleapis.com/v1/places:searchNearby')
    assert.equal(init?.method, 'POST')
    assert.equal(body.locationRestriction?.circle?.radius, 500)

    return jsonResponse({
      places: [],
    })
  }) as typeof fetch

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/site-context/places?lat=30.2672&lng=-97.7431'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.radiusMeters, 500)
  } finally {
    globalThis.fetch = originalFetch
    process.env.GOOGLE_PLACES_API_KEY = originalKey
  }
})

test('GET returns 400 for blank radius even though omitted radius defaults', async () => {
  const response = await GET({
    nextUrl: new URL('http://localhost/api/site-context/places?lat=30.2672&lng=-97.7431&radius=%20'),
  } as never)
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.match(body.error, /valid lat, lng, and radius/i)
})

test('GET returns normalized site context for a mocked Places response', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GOOGLE_PLACES_API_KEY

  process.env.GOOGLE_PLACES_API_KEY = 'places-test-key'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://places.googleapis.com/v1/places:searchNearby')
    assert.equal(init?.method, 'POST')
    assert.equal((init?.headers as Record<string, string>)?.['X-Goog-Api-Key'], 'places-test-key')
    assert.equal((init?.headers as Record<string, string>)?.['X-Goog-FieldMask'], 'places.id,places.displayName,places.types,places.formattedAddress,places.location')

    const body = JSON.parse(String(init?.body ?? '{}')) as {
      includedTypes?: string[]
      maxResultCount?: number
      locationRestriction?: {
        circle?: {
          center?: { latitude?: number; longitude?: number }
          radius?: number
        }
      }
    }

    assert.deepEqual(body.includedTypes, ['restaurant', 'cafe', 'grocery_store', 'supermarket', 'pharmacy', 'gym', 'shopping_mall', 'store'])
    assert.equal(body.maxResultCount, 20)
    assert.equal(body.locationRestriction?.circle?.center?.latitude, 30.2672)
    assert.equal(body.locationRestriction?.circle?.center?.longitude, -97.7431)
    assert.equal(body.locationRestriction?.circle?.radius, 750)

    return jsonResponse({
      places: [
        placeFixture('one', 'Corner Bistro', ['restaurant']),
        placeFixture('two', 'Neighborhood Coffee', ['cafe']),
        placeFixture('three', 'Daily Grocer', ['grocery_store']),
        placeFixture('four', 'City Gym', ['gym']),
        placeFixture('five', 'Ignored Type', ['museum']),
      ],
    })
  }) as typeof fetch

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/site-context/places?lat=30.2672&lng=-97.7431&radius=750'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(body, {
      radiusMeters: 750,
      summary: 'Within 750m: 1 food & bev, 1 coffee & cafe, 1 essentials, 1 fitness.',
      countsByCategory: [
        { category: 'food_bev', label: 'Food & Bev', count: 1 },
        { category: 'coffee_cafe', label: 'Coffee & Cafe', count: 1 },
        { category: 'essentials', label: 'Essentials', count: 1 },
        { category: 'fitness', label: 'Fitness', count: 1 },
      ],
      topPlaces: [
        { name: 'Corner Bistro', categoryLabel: 'Food & Bev' },
        { name: 'Neighborhood Coffee', categoryLabel: 'Coffee & Cafe' },
        { name: 'Daily Grocer', categoryLabel: 'Essentials' },
        { name: 'City Gym', categoryLabel: 'Fitness' },
      ],
      source: { provider: 'google_places' },
    })
  } finally {
    globalThis.fetch = originalFetch
    process.env.GOOGLE_PLACES_API_KEY = originalKey
  }
})

test('GET returns an empty normalized site context when Places omits the places array', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GOOGLE_PLACES_API_KEY

  process.env.GOOGLE_PLACES_API_KEY = 'places-test-key'
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/site-context/places?lat=30.2672&lng=-97.7431&radius=750'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(body, {
      radiusMeters: 750,
      summary: 'No nearby place context found within 750m.',
      countsByCategory: [],
      topPlaces: [],
      source: { provider: 'google_places' },
    })
  } finally {
    globalThis.fetch = originalFetch
    process.env.GOOGLE_PLACES_API_KEY = originalKey
  }
})

test('GET converts upstream Places failures into bounded 503 errors', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GOOGLE_PLACES_API_KEY

  process.env.GOOGLE_PLACES_API_KEY = 'places-test-key'
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'Upstream exploded with a long internal message' } }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/site-context/places?lat=30.2672&lng=-97.7431&radius=750'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 503)
    assert.equal(body.error, 'Unable to fetch Google Places site context.')
  } finally {
    globalThis.fetch = originalFetch
    process.env.GOOGLE_PLACES_API_KEY = originalKey
  }
})

test('GET returns bounded 503 when the Places key is missing', async () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY
  const originalGeocodingKey = process.env.GOOGLE_GEOCODING_API_KEY

  delete process.env.GOOGLE_PLACES_API_KEY
  delete process.env.GOOGLE_GEOCODING_API_KEY

  try {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/site-context/places?lat=30.2672&lng=-97.7431&radius=750'),
    } as never)
    const body = await response.json()

    assert.equal(response.status, 503)
    assert.equal(body.error, 'Unable to fetch Google Places site context.')
  } finally {
    process.env.GOOGLE_PLACES_API_KEY = originalKey
    process.env.GOOGLE_GEOCODING_API_KEY = originalGeocodingKey
  }
})

function placeFixture(id: string, name: string, types: string[]) {
  return {
    id,
    displayName: { text: name },
    types,
    location: { latitude: 30.2672, longitude: -97.7431 },
    formattedAddress: 'Austin, TX',
  }
}

function jsonResponse(value: { places: unknown[] }) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
