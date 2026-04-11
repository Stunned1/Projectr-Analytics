import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
  // Force debug logs for this process so request-cache emits NEW/DEDUPED/CACHED.
  process.env.NEXT_PUBLIC_PERF_DEBUG = '1'
  const { dedupedFetchJson } = await import('../lib/request-cache')

  const baseUrl = process.env.PERF_BASE_URL ?? 'http://localhost:3000'
  const countyUrl = `${baseUrl}/api/blockgroups?state=06&county=037`
  const boundariesUrl = `${baseUrl}/api/boundaries?zip=90001`
  const buildingsLowZoomUrl = `${baseUrl}/api/buildings?lat=33.9731&lng=-118.2479&radius=0.02&zoom=11`
  const buildingsHighZoomUrl = `${baseUrl}/api/buildings?lat=33.9731&lng=-118.2479&radius=0.02&zoom=15`

  const startedAt = Date.now()
  const step = (label: string) => {
    const ms = Date.now() - startedAt
    console.log(`\n=== [${ms}ms] ${label} ===`)
  }

  step('Concurrent same-URL dedupe test (boundaries x3)')
  await Promise.all([
    dedupedFetchJson(boundariesUrl, { cacheKey: 'boundaries:90001', ttlMs: 120000 }),
    dedupedFetchJson(boundariesUrl, { cacheKey: 'boundaries:90001', ttlMs: 120000 }),
    dedupedFetchJson(boundariesUrl, { cacheKey: 'boundaries:90001', ttlMs: 120000 }),
  ])
  console.log('boundaries concurrent calls complete')

  step('Sequential cache hit test (boundaries)')
  await dedupedFetchJson(boundariesUrl, { cacheKey: 'boundaries:90001', ttlMs: 120000 })
  console.log('boundaries sequential cache call complete')

  step('Blockgroups dedupe/cache test (same county key)')
  await Promise.all([
    dedupedFetchJson(countyUrl, { cacheKey: 'blockgroups:06-037', ttlMs: 1800000 }),
    dedupedFetchJson(countyUrl, { cacheKey: 'blockgroups:06-037', ttlMs: 1800000 }),
  ])
  await dedupedFetchJson(countyUrl, { cacheKey: 'blockgroups:06-037', ttlMs: 1800000 })
  console.log('blockgroups calls complete')

  step('Buildings low/high zoom behavior')
  const low = await dedupedFetchJson<{ meta?: { count?: number; mode?: string }; features?: unknown[] }>(buildingsLowZoomUrl, {
    cacheKey: 'buildings:la:low',
    ttlMs: 60000,
  })
  const high = await dedupedFetchJson<{ meta?: { count?: number; mode?: string }; features?: unknown[] }>(buildingsHighZoomUrl, {
    cacheKey: 'buildings:la:high',
    ttlMs: 60000,
  })
  console.log('low zoom meta:', JSON.stringify(low.meta ?? null))
  console.log('high zoom meta:', JSON.stringify(high.meta ?? null))
  console.log('high zoom features length:', Array.isArray(high.features) ? high.features.length : 0)

  step('Done')
}

main().catch((err) => {
  console.error('perf-debug-smoke failed:', err)
  process.exit(1)
})
