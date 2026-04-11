/**
 * NYC Building Permits API
 * Source: NYC Department of Buildings via NYC Open Data (Socrata)
 * Dataset: DOB Job Application Filings (ic3t-wcy2)
 *
 * Returns permit points with lat/lng for map rendering.
 * Supports borough and ZIP filtering.
 * Job types: NB=New Building, A1=Major Alteration, A2=Minor Alteration, DM=Demolition, A3=Minor Alt
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DOB_URL = 'https://data.cityofnewyork.us/resource/ic3t-wcy2.json'

const JOB_TYPE_LABELS: Record<string, string> = {
  NB: 'New Building',
  A1: 'Major Alteration',
  A2: 'Minor Alteration',
  A3: 'Minor Alteration',
  DM: 'Demolition',
  SG: 'Sign',
  FO: 'Foundation',
  BL: 'Boiler',
  EQ: 'Equipment',
  PL: 'Plumbing',
}

// Color per job type (RGB for deck.gl)
export const JOB_TYPE_COLORS: Record<string, [number, number, number]> = {
  NB: [215, 107, 61],   // orange — new building (most important)
  A1: [250, 204, 21],   // yellow — major alteration
  A2: [134, 239, 172],  // green — minor alteration
  A3: [134, 239, 172],  // green
  DM: [248, 113, 113],  // red — demolition
  default: [148, 163, 184], // grey
}

const BOROUGH_MAP: Record<string, string> = {
  manhattan: 'MANHATTAN',
  brooklyn: 'BROOKLYN',
  queens: 'QUEENS',
  bronx: 'BRONX',
  'staten island': 'STATEN ISLAND',
}

export async function GET(request: NextRequest) {
  const borough = request.nextUrl.searchParams.get('borough')?.toLowerCase()
  const zip = request.nextUrl.searchParams.get('zip')
  const jobTypes = request.nextUrl.searchParams.get('types') ?? 'NB,A1,DM' // default to most relevant
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '2000'), 5000)
  const since = request.nextUrl.searchParams.get('since') ?? '01/01/2020' // default last 5 years

  if (!borough && !zip) {
    return NextResponse.json({ error: 'Provide borough or zip parameter' }, { status: 400 })
  }

  try {
    const typeList = jobTypes.split(',').map((t) => `'${t.trim()}'`).join(',')
    let whereClause = `gis_latitude IS NOT NULL AND job_type IN (${typeList}) AND pre__filing_date > '${since}'`

    if (borough) {
      const boroughName = BOROUGH_MAP[borough]
      if (!boroughName) return NextResponse.json({ error: `Unknown borough: ${borough}` }, { status: 404 })
      whereClause += ` AND borough='${boroughName}'`
    } else if (zip) {
      whereClause += ` AND zip_code='${zip}'`
    }

    const url = `${DOB_URL}?$limit=${limit}&$where=${encodeURIComponent(whereClause)}&$select=job__,job_type,job_status,gis_latitude,gis_longitude,street_name,house__,zip_code,owner_s_business_name,initial_cost,pre__filing_date,job_description,proposed_no_of_stories,proposed_dwelling_units,building_type&$order=initial_cost DESC`

    const res = await fetch(url, { next: { revalidate: 3600 } }) // cache 1 hour
    if (!res.ok) return NextResponse.json({ error: 'NYC DOB API unavailable' }, { status: 503 })

    const raw: Record<string, string>[] = await res.json()

    const permits = raw
      .filter((r) => r.gis_latitude && r.gis_longitude)
      .map((r) => {
        const cost = parseFloat(r.initial_cost?.replace(/[$,]/g, '') ?? '0') || 0
        const jobType = r.job_type ?? 'A2'
        return {
          id: r.job__,
          lat: parseFloat(r.gis_latitude),
          lng: parseFloat(r.gis_longitude),
          job_type: jobType,
          job_type_label: JOB_TYPE_LABELS[jobType] ?? jobType,
          job_status: r.job_status ?? '',
          address: `${r.house__ ?? ''} ${r.street_name ?? ''}`.trim(),
          zip: r.zip_code ?? '',
          owner: r.owner_s_business_name ?? '',
          cost,
          cost_display: cost > 0 ? '$' + (cost >= 1_000_000 ? (cost / 1_000_000).toFixed(1) + 'M' : (cost / 1000).toFixed(0) + 'K') : null,
          filing_date: r.pre__filing_date ?? '',
          description: r.job_description ?? '',
          stories: parseInt(r.proposed_no_of_stories ?? '0') || null,
          units: parseInt(r.proposed_dwelling_units ?? '0') || null,
          building_type: r.building_type ?? '',
        }
      })

    // Compute stats
    const totalCost = permits.reduce((s, p) => s + p.cost, 0)
    const byType = permits.reduce((acc, p) => {
      acc[p.job_type] = (acc[p.job_type] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      count: permits.length,
      total_cost: totalCost,
      by_type: byType,
      permits,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
