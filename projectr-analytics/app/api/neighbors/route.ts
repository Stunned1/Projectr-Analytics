/**
 * Returns neighboring ZIP codes sorted by geographic proximity.
 * Uses lat/lng centroids in zip_metro_lookup to find the closest ZIPs
 * within the same metro area.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  if (!zip) return NextResponse.json({ error: 'Missing zip' }, { status: 400 })

  try {
    // Get the searched ZIP's centroid + metro
    const { data: origin } = await supabase
      .from('zip_metro_lookup')
      .select('lat, lng, metro_name_short')
      .eq('zip', zip)
      .single()

    if (!origin?.metro_name_short) {
      return NextResponse.json({ zips: [] })
    }

    // If we have coordinates, sort by distance
    if (origin.lat && origin.lng) {
      // Get all ZIPs in same metro with coordinates
      const { data: metroZips } = await supabase
        .from('zip_metro_lookup')
        .select('zip, lat, lng')
        .eq('metro_name_short', origin.metro_name_short)
        .neq('zip', zip)
        .not('lat', 'is', null)

      if (!metroZips?.length) return NextResponse.json({ zips: [] })

      // Sort by Euclidean distance (good enough for nearby ZIPs)
      const sorted = metroZips
        .map((z) => ({
          zip: z.zip,
          dist: Math.sqrt(
            Math.pow((z.lat - origin.lat) * 111, 2) +
            Math.pow((z.lng - origin.lng) * 111 * Math.cos((origin.lat * Math.PI) / 180), 2)
          ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20) // 20 closest

      const zipList = sorted.map((z) => z.zip)

      // Get Zillow snapshots
      const { data: snapshots } = await supabase
        .from('zillow_zip_snapshot')
        .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m')
        .in('zip', zipList)

      return NextResponse.json({
        metro: origin.metro_name_short,
        origin_coords: { lat: origin.lat, lng: origin.lng },
        zips: snapshots ?? [],
      })
    }

    // Fallback: no coordinates yet, return metro ZIPs without distance sort
    const { data: metroZips } = await supabase
      .from('zip_metro_lookup')
      .select('zip')
      .eq('metro_name_short', origin.metro_name_short)
      .neq('zip', zip)
      .limit(15)

    if (!metroZips?.length) return NextResponse.json({ zips: [] })

    const { data: snapshots } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m')
      .in('zip', metroZips.map((z) => z.zip))

    return NextResponse.json({ metro: origin.metro_name_short, zips: snapshots ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
