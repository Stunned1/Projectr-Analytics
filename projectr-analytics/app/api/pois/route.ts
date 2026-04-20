/**
 * Overture Maps POI API
 * Returns categorized points of interest for a lat/lng radius.
 * Uses the shared Overture client and current API key configuration.
 *
 * Two modes:
 * - mode=anchors  → named brand anchors (Whole Foods, Equinox, SoulCycle, etc.)
 * - mode=signals  → neighborhood signals (coffee, grocery, pharmacy, fitness, school)
 * - mode=all      → both (default)
 *
 * Used for ScatterplotLayer visualization - color by category group.
 */
import { type NextRequest, NextResponse } from 'next/server'
import {
  fetchOverturePlaces,
  type OverturePlace,
} from '@/lib/overture-client'
import {
  OVERTURE_ANCHOR_BRANDS,
  OVERTURE_SIGNAL_CATEGORY_FILTER,
  isOvertureAnchorBrandValue,
} from '@/lib/overture-core-retail-taxonomy'

export const dynamic = 'force-dynamic'

// Color mapping by category group (RGB)
export const POI_COLORS: Record<string, [number, number, number]> = {
  anchor:       [215, 107, 61],   // orange - premium anchor
  coffee_shop:  [180, 120, 60],   // brown
  cafe:         [180, 120, 60],
  grocery_store:[80, 180, 100],   // green
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

export { getOvertureApiKeyForTest } from '@/lib/overture-client'
export { normalizeOverturePlacesResponseForTest } from '@/lib/overture-client'

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
      const signalData = await fetchOverturePlaces(lat, lng, radius, OVERTURE_SIGNAL_CATEGORY_FILTER, 400, undefined, {
        throwOnHttpError: true,
      })
      results.push(...signalData)
    }

    if (mode === 'all' || mode === 'anchors') {
      // Fetch anchor brands in parallel (brand_name filter)
      const anchorBatches = await Promise.all(
        [...OVERTURE_ANCHOR_BRANDS].map((brand) =>
          fetchOverturePlaces(lat, lng, radius * 2, undefined, 20, { brand_name: brand }, {
            throwOnHttpError: true,
          })
        )
      )
      results.push(...anchorBatches.flat())
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
        const isAnchor = isOvertureAnchorBrandValue(name) || isOvertureAnchorBrandValue(brandName)
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

    const filteredPoints = mode === 'anchors' ? points.filter((point) => point.isAnchor) : points

    // Stats
    const anchorCount = filteredPoints.filter((p) => p.isAnchor).length
    const byCategory = filteredPoints.reduce((acc, p) => {
      acc[p.group] = (acc[p.group] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      count: filteredPoints.length,
      anchor_count: anchorCount,
      by_category: byCategory,
      points: filteredPoints,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    const status = typeof err === 'object' && err && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500
    return NextResponse.json({ error: message }, { status })
  }
}
