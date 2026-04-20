/**
 * Overture Maps POI API
 * Returns categorized points of interest for a lat/lng radius.
 * Uses the open Overture Maps API (DEMO key - no signup required).
 *
 * Two modes:
 * - mode=anchors  → named brand anchors (Whole Foods, Equinox, SoulCycle, etc.)
 * - mode=signals  → neighborhood signals (coffee, grocery, pharmacy, fitness, school)
 * - mode=all      → both (default)
 *
 * Used for ScatterplotLayer visualization - color by category group.
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const OVERTURE_URL = 'https://api.overturemapsapi.com/places'
const DEMO_KEY = 'DEMO-API-KEY'

// Anchor tenant brands - signal neighborhood gentrification / premium demand
const ANCHOR_BRANDS = [
  'Whole Foods', 'Whole Foods Market',
  'Equinox', 'SoulCycle', 'Barry\'s', 'Orangetheory',
  'Sweetgreen', 'Dig', 'Bluestone Lane',
  'Erewhon', 'Trader Joe\'s',
  'Apple Store', 'Apple',
  'Lululemon', 'Warby Parker', 'Glossier',
  'WeWork', 'Industrious', 'Regus',
  'Shake Shack', 'Dig Inn',
]

// Category groups for neighborhood signal scoring
const SIGNAL_CATEGORIES = [
  'coffee_shop', 'cafe',
  'grocery', 'supermarket',
  'pharmacy', 'drug_store',
  'fitness_center', 'gym',
  'school', 'university',
  'bar', 'restaurant',
  'park', 'playground',
  'bank',
]

// Color mapping by category group (RGB)
export const POI_COLORS: Record<string, [number, number, number]> = {
  anchor:       [215, 107, 61],   // orange - premium anchor
  coffee_shop:  [180, 120, 60],   // brown
  cafe:         [180, 120, 60],
  grocery:      [80, 180, 100],   // green
  supermarket:  [80, 180, 100],
  pharmacy:     [100, 160, 220],  // blue
  drug_store:   [100, 160, 220],
  fitness_center: [220, 80, 160], // pink
  gym:          [220, 80, 160],
  school:       [240, 200, 60],   // yellow
  university:   [240, 200, 60],
  bar:          [160, 100, 220],  // purple
  restaurant:   [220, 140, 80],   // light orange
  park:         [60, 200, 120],   // bright green
  bank:         [140, 180, 220],  // light blue
  default:      [160, 160, 160],  // gray
}

interface OverturePlace {
  id: string
  geometry: { type: string; coordinates: [number, number] }
  properties: {
    names: { primary: string }
    categories: { primary: string; alternate?: string[] }
    brand?: { names?: { primary?: string } }
    addresses?: Array<{ freeform?: string; locality?: string; postcode?: string }>
    confidence?: number
  }
}

interface POIPoint {
  id: string
  position: [number, number]
  name: string
  category: string
  group: string
  isAnchor: boolean
  address: string
  color: [number, number, number]
}

type OverturePlacesResponse = OverturePlace[] | { value?: OverturePlace[] | null }

function getOvertureApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OVERTURE_API_KEY?.trim()
  return configured && configured.length > 0 ? configured : DEMO_KEY
}

function normalizeOverturePlacesResponse(payload: OverturePlacesResponse | null | undefined): OverturePlace[] {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.value)) return payload.value
  return []
}

export function getOvertureApiKeyForTest(env: NodeJS.ProcessEnv = process.env): string {
  return getOvertureApiKey(env)
}

export function normalizeOverturePlacesResponseForTest(
  payload: OverturePlacesResponse | null | undefined
): OverturePlace[] {
  return normalizeOverturePlacesResponse(payload)
}

async function fetchOverturePlaces(lat: number, lng: number, radius: number, categories?: string, limit = 500): Promise<OverturePlace[]> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lng.toString(),
    radius: radius.toString(),
    limit: limit.toString(),
    format: 'json',
  })
  if (categories) params.set('categories', categories)

  const res = await fetch(`${OVERTURE_URL}?${params}`, {
    headers: { 'x-api-key': getOvertureApiKey() },
    next: { revalidate: 86400 * 7 }, // 7-day cache
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) return []
  return normalizeOverturePlacesResponse((await res.json()) as OverturePlacesResponse)
}

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')
  const radius = parseInt(request.nextUrl.searchParams.get('radius') ?? '1500') // meters
  const mode = request.nextUrl.searchParams.get('mode') ?? 'all'

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 })
  }

  try {
    const results: OverturePlace[] = []

    if (mode === 'all' || mode === 'signals') {
      const signalData = await fetchOverturePlaces(lat, lng, radius, SIGNAL_CATEGORIES.join(','), 400)
      results.push(...signalData)
    }

    if (mode === 'all' || mode === 'anchors') {
      // Fetch anchor brands in parallel (brand_name filter)
      const anchorBatches = await Promise.allSettled(
        ['Whole Foods', 'Equinox', 'SoulCycle', 'Sweetgreen', 'Trader Joe\'s', 'Lululemon', 'WeWork'].map((brand) =>
            fetchOverturePlaces(lat, lng, radius * 2, undefined, 20).then(() =>
              fetch(`${OVERTURE_URL}?lat=${lat}&lng=${lng}&radius=${radius * 2}&brand_name=${encodeURIComponent(brand)}&limit=20`, {
                headers: { 'x-api-key': getOvertureApiKey() },
                next: { revalidate: 86400 * 7 },
                signal: AbortSignal.timeout(8000),
              }).then(async (r) => (r.ok ? normalizeOverturePlacesResponse((await r.json()) as OverturePlacesResponse) : []))
            )
        )
      )
      for (const batch of anchorBatches) {
        if (batch.status === 'fulfilled') results.push(...(batch.value as OverturePlace[]))
      }
    }

    // Deduplicate by id
    const seen = new Set<string>()
    const unique = results.filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })

    // Transform to POI points
    const points: POIPoint[] = unique
      .filter((p) => p.geometry?.coordinates?.length === 2)
      .map((p) => {
        const name = p.properties.names?.primary ?? 'Unknown'
        const category = p.properties.categories?.primary ?? 'default'
        const brandName = p.properties.brand?.names?.primary ?? ''
        const isAnchor = ANCHOR_BRANDS.some((b) => name.toLowerCase().includes(b.toLowerCase()) || brandName.toLowerCase().includes(b.toLowerCase()))
        const address = p.properties.addresses?.[0]?.freeform ?? ''
        const color = isAnchor ? POI_COLORS.anchor : (POI_COLORS[category] ?? POI_COLORS.default)

        return {
          id: p.id,
          position: [p.geometry.coordinates[0], p.geometry.coordinates[1]] as [number, number],
          name,
          category,
          group: isAnchor ? 'anchor' : category,
          isAnchor,
          address,
          color,
        }
      })

    // Stats
    const anchorCount = points.filter((p) => p.isAnchor).length
    const byCategory = points.reduce((acc, p) => {
      acc[p.group] = (acc[p.group] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      count: points.length,
      anchor_count: anchorCount,
      by_category: byCategory,
      points,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
