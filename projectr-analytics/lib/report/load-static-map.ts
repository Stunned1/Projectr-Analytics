import type { ClientReportPayload } from '@/lib/report/types'

export interface StaticMapSnapshot {
  dataUri: string
  caption: string
}

type Point = { lat: number; lng: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function anchorPoints(payload: ClientReportPayload): Point[] {
  if (payload.pins.length > 0) return payload.pins.slice(0, 4).map((pin) => ({ lat: pin.lat, lng: pin.lng }))
  if (payload.geo) return [{ lat: payload.geo.lat, lng: payload.geo.lng }]
  return []
}

function chooseZoom(points: Point[], fallbackLat: number): number {
  if (points.length <= 1) return 14
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const latSpan = Math.max(...lats) - Math.min(...lats)
  const lngSpan = Math.max(...lngs) - Math.min(...lngs)
  const normalizedLngSpan = lngSpan * Math.cos((fallbackLat * Math.PI) / 180)
  const span = Math.max(latSpan, normalizedLngSpan)
  if (span < 0.01) return 14
  if (span < 0.025) return 13
  if (span < 0.06) return 12
  return 11
}

function chooseRadiusMiles(points: Point[]): number {
  if (points.length <= 1) return 1.2
  return 1.8
}

function buildCirclePath(center: Point, radiusMiles: number): string {
  const steps = 14
  const latRadius = radiusMiles / 69
  const lngRadius = radiusMiles / (69 * Math.cos((center.lat * Math.PI) / 180))
  const coords: string[] = []
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    const lat = center.lat + latRadius * Math.sin(angle)
    const lng = center.lng + lngRadius * Math.cos(angle)
    coords.push(`${lat.toFixed(6)},${lng.toFixed(6)}`)
  }
  return `fillcolor:0xD76B3D22|color:0xD76B3DCC|weight:3|${coords.join('|')}`
}

function buildCaption(payload: ClientReportPayload, radiusMiles: number): string {
  const label = payload.geo?.city && payload.geo?.state ? `${payload.geo.city}, ${payload.geo.state}` : payload.marketLabel
  return `Approx. ${radiusMiles.toFixed(1)}-mile context around the report anchor in ${label}, shown to orient the surrounding street grid and nearby area context.`
}

export async function loadStaticMapDataUri(payload: ClientReportPayload): Promise<StaticMapSnapshot | null> {
  const key = process.env.GOOGLE_MAPS_STATIC_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null
  if (!key || !payload.geo) return null

  const points = anchorPoints(payload)
  const center = { lat: payload.geo.lat, lng: payload.geo.lng }
  const zoom = clamp(chooseZoom(points, center.lat), 11, 15)
  const radiusMiles = chooseRadiusMiles(points)

  const params = new URLSearchParams({
    size: '640x360',
    scale: '2',
    maptype: 'roadmap',
    center: `${center.lat},${center.lng}`,
    zoom: String(zoom),
    key,
  })

  ;[
    'feature:all|element:labels.text.fill|color:0xf5f1eb',
    'feature:all|element:labels.text.stroke|color:0x161616',
    'feature:administrative|element:geometry|color:0x2b2b2b',
    'feature:landscape|element:geometry|color:0x171717',
    'feature:poi|element:geometry|color:0x202020',
    'feature:road|element:geometry|color:0x303030',
    'feature:road.arterial|element:geometry|color:0x444444',
    'feature:road.highway|element:geometry|color:0x5b5b5b',
    'feature:transit|element:geometry|color:0x252525',
    'feature:water|element:geometry|color:0x0f2d38',
  ].forEach((styleRule) => params.append('style', styleRule))

  params.append('path', buildCirclePath(center, radiusMiles))

  const markerSet = points.length > 0 ? points : [center]
  markerSet.forEach((pin, index) => {
    const color = index === 0 ? '0xd76b3d' : '0xf7f3ef'
    const label = String.fromCharCode(65 + index)
    params.append('markers', `size:mid|color:${color}|label:${label}|${pin.lat},${pin.lng}`)
  })

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) return null

    const contentType = response.headers.get('content-type') ?? 'image/png'
    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      dataUri: `data:${contentType};base64,${buffer.toString('base64')}`,
      caption: buildCaption(payload, radiusMiles),
    }
  } catch {
    return null
  }
}
