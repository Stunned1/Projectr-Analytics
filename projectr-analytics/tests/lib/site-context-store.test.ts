import test from 'node:test'
import assert from 'node:assert/strict'

const sessionStorageMock = (() => {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
})()

;(globalThis as typeof globalThis & { sessionStorage: typeof sessionStorageMock }).sessionStorage =
  sessionStorageMock as typeof sessionStorageMock

import {
  SITE_CONTEXT_STORAGE_KEY,
  buildSiteContextCacheKey,
  useSiteContextStore,
} from '@/lib/site-context-store'

const baseContext = {
  radiusMeters: 750,
  summary: 'Within 750m: 1 food & bev.',
  countsByCategory: [{ category: 'food_bev', label: 'Food & Bev', count: 1 }],
  topPlaces: [{ name: 'Corner Bistro', categoryLabel: 'Food & Bev' }],
  source: { provider: 'google_places' as const },
}

test('builds a stable cache key from rounded coordinates and radius', () => {
  assert.equal(
    buildSiteContextCacheKey({ lat: 30.2672349, lng: -97.7431451, radiusMeters: 750.49 }),
    'site-context:30.26723:-97.74315:750'
  )
  assert.equal(
    buildSiteContextCacheKey({ lat: 30.26723491, lng: -97.74314509, radiusMeters: 750.4 }),
    'site-context:30.26723:-97.74315:750'
  )
})

test('writes, reads, and clears a cached site-context entry', () => {
  useSiteContextStore.getState().resetForTests()

  const input = { lat: 30.2672349, lng: -97.7431451, radiusMeters: 750.49 }
  const key = buildSiteContextCacheKey(input)

  useSiteContextStore.getState().write(input, baseContext)

  const state = useSiteContextStore.getState()
  const storedPayload = JSON.parse(sessionStorage.getItem(SITE_CONTEXT_STORAGE_KEY) ?? 'null')

  assert.equal(state.read(input), baseContext)
  assert.deepEqual(state.entries[key], baseContext)
  assert.deepEqual(storedPayload.state.entries[key], baseContext)

  useSiteContextStore.getState().clear()

  assert.equal(useSiteContextStore.getState().read(input), null)
  assert.deepEqual(useSiteContextStore.getState().entries, {})
})

test('hydrates cached site-context entries from sessionStorage', () => {
  useSiteContextStore.getState().resetForTests()

  const input = { lat: 30.2672349, lng: -97.7431451, radiusMeters: 750.49 }
  const key = buildSiteContextCacheKey(input)

  sessionStorage.setItem(
    SITE_CONTEXT_STORAGE_KEY,
    JSON.stringify({
      state: {
        entries: {
          [key]: baseContext,
          'site-context:bad:entry': {
            radiusMeters: 'oops',
            summary: 'broken',
            countsByCategory: [],
            topPlaces: [],
            source: { provider: 'google_places' },
          },
        },
      },
      version: 0,
    })
  )

  const store = useSiteContextStore.getState()
  assert.deepEqual(store.read(input), baseContext)
  assert.deepEqual(useSiteContextStore.getState().entries, { [key]: baseContext })
})

test('rejects persisted site-context entries with malformed nested items', () => {
  useSiteContextStore.getState().resetForTests()

  const input = { lat: 30.2672349, lng: -97.7431451, radiusMeters: 750.49 }
  const key = buildSiteContextCacheKey(input)

  sessionStorage.setItem(
    SITE_CONTEXT_STORAGE_KEY,
    JSON.stringify({
      state: {
        entries: {
          [key]: {
            radiusMeters: 750,
            summary: 'Within 750m: 1 food & bev.',
            countsByCategory: [
              { category: 'food_bev', label: 'Food & Bev', count: 1 },
              { category: 'food_bev', label: 123, count: 1 },
            ],
            topPlaces: [
              { name: 'Corner Bistro', categoryLabel: 'Food & Bev' },
              { name: 'Missing category label' },
            ],
            source: { provider: 'google_places' },
          },
        },
      },
      version: 0,
    })
  )

  assert.equal(useSiteContextStore.getState().read(input), null)
  assert.deepEqual(useSiteContextStore.getState().entries, {})
})

test('rejects persisted site-context entries with non-finite radius values', () => {
  useSiteContextStore.getState().resetForTests()

  const input = { lat: 30.2672349, lng: -97.7431451, radiusMeters: 750.49 }
  const key = buildSiteContextCacheKey(input)

  sessionStorage.setItem(
    SITE_CONTEXT_STORAGE_KEY,
    JSON.stringify({
      state: {
        entries: {
          [key]: {
            radiusMeters: 1e309,
            summary: 'Within 750m: 1 food & bev.',
            countsByCategory: [{ category: 'food_bev', label: 'Food & Bev', count: 1 }],
            topPlaces: [{ name: 'Corner Bistro', categoryLabel: 'Food & Bev' }],
            source: { provider: 'google_places' },
          },
        },
      },
      version: 0,
    })
  )

  assert.equal(useSiteContextStore.getState().read(input), null)
  assert.deepEqual(useSiteContextStore.getState().entries, {})
})

test('resetForTests clears in-memory entries', () => {
  useSiteContextStore.getState().resetForTests()

  const input = { lat: 30.2672349, lng: -97.7431451, radiusMeters: 750.49 }
  useSiteContextStore.getState().write(input, baseContext)

  useSiteContextStore.getState().resetForTests()

  assert.equal(useSiteContextStore.getState().read(input), null)
  assert.deepEqual(useSiteContextStore.getState().entries, {})
})
