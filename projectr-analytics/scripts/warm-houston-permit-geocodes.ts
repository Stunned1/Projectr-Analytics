import * as dotenv from 'dotenv'
import { createRequire } from 'node:module'

dotenv.config({ path: '.env.local' })

type WarmHoustonPermitGeocodesResult = {
  requested: number
  cached: number
  attempted: number
  resolved: number
  missed: number
}

type WarmHoustonPermitGeocodesFn = (
  options: { limit?: number | null }
) => Promise<WarmHoustonPermitGeocodesResult>

function parseCliFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const [key, inlineValue] = token.split('=', 2)
    if (inlineValue != null) {
      flags.set(key, inlineValue)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, 'true')
    }
  }
  return flags
}

function parseLimit(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function loadWarmHoustonPermitGeocodes(): Promise<WarmHoustonPermitGeocodesFn> {
  const require = createRequire(import.meta.url)
  const NodeModule = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown
  }
  const originalModuleLoad = NodeModule._load

  NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === 'server-only') {
      return {}
    }

    return originalModuleLoad.call(this, request, parent, isMain)
  }

  try {
    const module = await import('../lib/texas-raw-permits')
    const warmHoustonPermitGeocodes =
      typeof module.warmHoustonPermitGeocodes === 'function'
        ? module.warmHoustonPermitGeocodes
        : null

    if (!warmHoustonPermitGeocodes) {
      throw new Error('warmHoustonPermitGeocodes export was not found')
    }

    return warmHoustonPermitGeocodes
  } finally {
    NodeModule._load = originalModuleLoad
  }
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2))
  const limit = parseLimit(flags.get('--limit'))
  const warmHoustonPermitGeocodes = await loadWarmHoustonPermitGeocodes()

  console.log('=== Houston Permit Geocode Warm ===')
  if (limit != null) {
    console.log(`Limit: ${limit}`)
  } else {
    console.log('Limit: all unresolved address queries')
  }

  const result = await warmHoustonPermitGeocodes({ limit })

  console.log(`Unique address queries: ${result.requested}`)
  console.log(`Already cached: ${result.cached}`)
  console.log(`Attempted live geocodes: ${result.attempted}`)
  console.log(`Resolved this run: ${result.resolved}`)
  console.log(`Missed this run: ${result.missed}`)
  console.log('=== Done ===')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
