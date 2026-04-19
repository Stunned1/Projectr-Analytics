type Position = [number, number]

interface BoundsAccumulator {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

function visitCoordinateTree(node: unknown, bounds: BoundsAccumulator): void {
  if (!Array.isArray(node)) return
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    const [lng, lat] = node as Position
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    if (lat < bounds.minLat) bounds.minLat = lat
    if (lat > bounds.maxLat) bounds.maxLat = lat
    if (lng < bounds.minLng) bounds.minLng = lng
    if (lng > bounds.maxLng) bounds.maxLng = lng
    return
  }

  for (const child of node) {
    visitCoordinateTree(child, bounds)
  }
}

export function getGeoJsonBounds(geojson: {
  features?: Array<{ geometry?: { coordinates?: unknown } | null }>
} | null): BoundsAccumulator | null {
  if (!geojson?.features?.length) return null

  const bounds: BoundsAccumulator = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  }

  for (const feature of geojson.features) {
    visitCoordinateTree(feature.geometry?.coordinates, bounds)
  }

  if (!Number.isFinite(bounds.minLat)) return null
  return bounds
}
