/**
 * FEMA Flood Zone data via NFHL ArcGIS REST API
 * Returns flood zone polygons for a bounding box
 * Zone types: A/AE = 100-year flood, X = minimal risk, etc.
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FEMA_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'

const ZONE_LABELS: Record<string, { label: string; risk: 'high' | 'moderate' | 'low' }> = {
  A: { label: '100-Year Flood Zone', risk: 'high' },
  AE: { label: '100-Year Flood Zone (detailed)', risk: 'high' },
  AH: { label: '100-Year Flood Zone (ponding)', risk: 'high' },
  AO: { label: '100-Year Flood Zone (sheet flow)', risk: 'high' },
  VE: { label: 'Coastal High Hazard', risk: 'high' },
  X: { label: 'Minimal Flood Risk', risk: 'low' },
  '0.2 PCT ANNUAL CHANCE FLOOD HAZARD': { label: '500-Year Flood Zone', risk: 'moderate' },
}

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')
  const radius = parseFloat(request.nextUrl.searchParams.get('radius') ?? '0.05')

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 })
  }

  const bbox = `${lng - radius},${lat - radius},${lng + radius},${lat + radius}`

  try {
    const url = `${FEMA_URL}?geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&f=geojson&resultRecordCount=200`
    const res = await fetch(url, { next: { revalidate: 86400 * 30 } })
    if (!res.ok) return NextResponse.json({ features: [], count: 0 })

    const geojson = await res.json()

    // Enrich with labels and risk levels
    for (const feature of geojson.features ?? []) {
      const zone = feature.properties?.FLD_ZONE ?? 'X'
      const info = ZONE_LABELS[zone] ?? { label: `Zone ${zone}`, risk: 'low' }
      feature.properties = { ...feature.properties, ...info }
    }

    // Filter to only high/moderate risk zones for the map (skip minimal risk)
    const riskZones = geojson.features?.filter(
      (f: { properties: { risk: string } }) => f.properties.risk !== 'low'
    ) ?? []

    return NextResponse.json({
      type: 'FeatureCollection',
      features: riskZones,
      count: riskZones.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message, features: [], count: 0 }, { status: 500 })
  }
}
