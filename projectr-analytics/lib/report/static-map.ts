import type { ClientReportPin } from './types'

function mapsKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_STATIC_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    null
  )
}

/** Fetch PNG as data URL for @react-pdf Image. */
export async function fetchStaticMapPng(options: {
  centerLat: number
  centerLng: number
  zoom: number
  encodedPath: string | null
  pins: ClientReportPin[]
}): Promise<string | null> {
  const key = mapsKey()
  if (!key) return null

  const size = '640x360'
  const scale = '2'
  const base = new URL('https://maps.googleapis.com/maps/api/staticmap')
  base.searchParams.set('size', size)
  base.searchParams.set('scale', scale)
  base.searchParams.set('maptype', 'roadmap')
  base.searchParams.set('key', key)
  base.searchParams.set('center', `${options.centerLat},${options.centerLng}`)
  base.searchParams.set('zoom', String(options.zoom))

  const styleDark: [string, string][] = [
    ['style', 'feature:all|element:geometry|color:0x212121'],
    ['style', 'feature:all|element:labels.text.fill|color:0x9e9e9e'],
    ['style', 'feature:water|element:geometry|color:0x0c1a24'],
  ]
  for (const [k, v] of styleDark) {
    base.searchParams.append(k, v)
  }

  if (options.encodedPath) {
    base.searchParams.append(
      'path',
      `fillcolor:0xD76B3D33|color:0xD76B3Dff|weight:2|enc:${options.encodedPath}`
    )
  }

  options.pins.slice(0, 12).forEach((p) => {
    base.searchParams.append('markers', `scale:2|color:0xD76B3D|${p.lat},${p.lng}`)
  })

  try {
    const res = await fetch(base.toString(), { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
