/**
 * Spatial Analysis API
 * Runs a backend spatial model to surface top N parcels for a given brief.
 *
 * For Manhattan high-density residential:
 * 1. Pull PLUTO parcels with FAR data (underutilized = built_far < 0.5 * max_allowed_far)
 * 2. Score by: air_rights_sqft (40%) + permit momentum proximity (30%) + ZORI growth (30%)
 * 3. Filter: residential/mixed zoning only, min lot area 2000 sqft, has transit nearby
 * 4. Return top N with full data for sidebar display
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json'

// Residential/mixed zoning prefixes that allow high-density residential
const RESIDENTIAL_ZONES = ['R6', 'R7', 'R8', 'R9', 'R10', 'C4', 'C6', 'MX', 'M1-6']

interface PlutoParcel {
  address: string
  latitude: string
  longitude: string
  assesstot: string
  builtfar: string
  residfar: string
  commfar: string
  facilfar: string
  lotarea: string
  bldgarea: string
  zonedist1: string
  landuse: string
  yearbuilt: string
  unitsres: string
  numfloors: string
}

interface ScoredSite {
  address: string
  lat: number
  lng: number
  zone: string
  built_far: number
  max_far: number
  air_rights_sqft: number
  far_utilization: number
  lot_area: number
  assessed_value: number
  year_built: number | null
  units_res: number
  floors: number
  score: number
  score_components: {
    far_score: number
    momentum_score: number
    zori_score: number
  }
  zori_growth: number | null
  momentum: number | null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const borough = (body.borough ?? 'manhattan').toLowerCase()
    const topN = Math.min(body.top_n ?? 5, 20)
    const minLotArea = body.min_lot_area ?? 2000
    const maxFarUtilization = body.max_far_utilization ?? 0.6

    // Map borough to PLUTO borocode
    const borocodes: Record<string, string> = {
      manhattan: '1', bronx: '2', brooklyn: '3', queens: '4', 'staten island': '5',
    }
    const borocode = borocodes[borough] ?? '1'

    // 1. Fetch PLUTO parcels — residential/mixed zones, underutilized
    const zoneFilter = RESIDENTIAL_ZONES.map((z) => `starts_with(zonedist1,'${z}')`).join(' OR ')
    const url = `${PLUTO_URL}?$limit=3000&borocode=${borocode}&$where=(${zoneFilter}) AND lotarea>${minLotArea} AND builtfar IS NOT NULL AND residfar>0&$select=address,latitude,longitude,assesstot,builtfar,residfar,commfar,facilfar,lotarea,bldgarea,zonedist1,landuse,yearbuilt,unitsres,numfloors&$order=lotarea DESC`

    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ error: 'PLUTO unavailable' }, { status: 503 })

    const raw: PlutoParcel[] = await res.json()

    // 2. Parse and filter
    const parcels = raw
      .filter((r) => r.latitude && r.longitude && r.assesstot && r.residfar)
      .map((r) => {
        const builtfar = parseFloat(r.builtfar) || 0
        const residfar = parseFloat(r.residfar) || 0
        const commfar = parseFloat(r.commfar) || 0
        const facilfar = parseFloat(r.facilfar) || 0
        const maxFar = Math.max(residfar, commfar, facilfar)
        const lotarea = parseFloat(r.lotarea) || 0
        const farUtilization = maxFar > 0 ? builtfar / maxFar : 1
        const airRightsSqft = maxFar > 0 ? Math.round(Math.max(maxFar - builtfar, 0) * lotarea) : 0

        return {
          address: r.address ?? '',
          lat: parseFloat(r.latitude),
          lng: parseFloat(r.longitude),
          zone: r.zonedist1 ?? '',
          built_far: builtfar,
          max_far: maxFar,
          air_rights_sqft: airRightsSqft,
          far_utilization: parseFloat(farUtilization.toFixed(3)),
          lot_area: lotarea,
          assessed_value: parseFloat(r.assesstot) || 0,
          year_built: parseInt(r.yearbuilt) || null,
          units_res: parseInt(r.unitsres) || 0,
          floors: parseFloat(r.numfloors) || 1,
        }
      })
      .filter((p) => p.far_utilization < maxFarUtilization && p.air_rights_sqft > 5000)

    if (!parcels.length) {
      return NextResponse.json({ error: 'No qualifying parcels found', sites: [] })
    }

    // 3. Get permit momentum — count NB+A1 permits near each parcel
    const { data: permits } = await supabase
      .from('nyc_permits')
      .select('lat, lng, job_type')
      .eq('borough', borough.toUpperCase())
      .in('job_type', ['NB', 'A1'])
      .not('lat', 'is', null)

    const permitPoints = (permits ?? []).map((p) => ({ lat: p.lat as number, lng: p.lng as number }))

    // 4. Get ZORI growth for Manhattan ZIPs
    const { data: zillowData } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_growth_12m')
      .gte('zip', '10001')
      .lte('zip', '10282')

    const avgZoriGrowth = zillowData?.length
      ? zillowData.reduce((s, r) => s + (r.zori_growth_12m ?? 0), 0) / zillowData.length
      : 0

    // 5. Score each parcel
    const maxAirRights = Math.max(...parcels.map((p) => p.air_rights_sqft))

    const scored: ScoredSite[] = parcels.map((p) => {
      // FAR score — normalized air rights (0–100)
      const farScore = maxAirRights > 0 ? (p.air_rights_sqft / maxAirRights) * 100 : 0

      // Momentum score — count permits within 0.005° (~500m)
      const nearbyPermits = permitPoints.filter(
        (pt) => Math.abs(pt.lat - p.lat) < 0.005 && Math.abs(pt.lng - p.lng) < 0.005
      ).length
      const momentumScore = Math.min(nearbyPermits * 10, 100)

      // ZORI score — use borough average (all parcels same market)
      const zoriScore = Math.min(Math.max(avgZoriGrowth * 10, 0), 100)

      const score = farScore * 0.4 + momentumScore * 0.3 + zoriScore * 0.3

      return {
        ...p,
        score: parseFloat(score.toFixed(1)),
        score_components: {
          far_score: parseFloat(farScore.toFixed(1)),
          momentum_score: parseFloat(momentumScore.toFixed(1)),
          zori_score: parseFloat(zoriScore.toFixed(1)),
        },
        zori_growth: avgZoriGrowth,
        momentum: nearbyPermits,
      }
    })

    // 6. Sort and return top N — deduplicate by proximity (no two sites within 200m)
    scored.sort((a, b) => b.score - a.score)

    const topSites: ScoredSite[] = []
    for (const site of scored) {
      if (topSites.length >= topN) break
      const tooClose = topSites.some(
        (s) => Math.abs(s.lat - site.lat) < 0.002 && Math.abs(s.lng - site.lng) < 0.002
      )
      if (!tooClose) topSites.push(site)
    }

    return NextResponse.json({
      borough,
      total_candidates: parcels.length,
      sites: topSites,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
