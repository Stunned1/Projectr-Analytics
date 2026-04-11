/**
 * NYC Building Permits API
 * Source: NYC Department of Buildings via NYC Open Data (Socrata)
 * Dataset: DOB Job Application Filings (ic3t-wcy2)
 *
 * Returns permit points with lat/lng, job type, cost, description for map rendering.
 * Supports borough and ZIP-level queries.
 *
 * Job types:
 * NB = New Building
 * A1 = Major Alteration
 * A2 = Minor Alteration
 * A3 = Minor Alteration (no plans)
 * DM = Demolition
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DOB_URL = 'https://data.cityofnewyork.us/resource/ic3t-wcy2.json'

const BOROUGH_MAP: Record<string, string> = {
  manhattan: 'MANHATTAN',
  brooklyn: 'BROOKLYN',
  queens: 'QUEENS',
  bronx: 'BRONX',
  'staten island': 'STATEN ISLAND',
}

const JOB_TYPE_LABELS: Record<string, string> = {
  NB: 'New Building',
  A1: 'Major Alteration',
  A2: 'Minor Alteration',
  A3: 'Minor Alteration',
  DM: 'Demolition',
  SG: 'Sign',
  FO: 'Foundation',
}

export async function GET(request: NextRequest) {
  const borough = request.nextUrl.searchParams.get('borough')?.toLowerCase()
  const zip = request.nextUrl.searchParams.get('zip')
  const jobTypes = request.nextUrl.searchParams.get('types') ?? 'NB,A1,DM'
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '2000')
  const since = request.nextUrl.searchParams.get('since') ?? '01/01/2020'

  if (!borough && !zip) {
    return NextResponse.json({ error: 'Provide borough or zip parameter' }, { status: 400 })
  }

  try {
    const boroughFilter = borough
      ? `borough='${BOROUGH_MAP[borough] ?? borough.toUpperCase()}'`
      : `zip_code='${zip}'`

    const types = jobTypes.split(',').map((t) => t.trim())
    // Build OR conditions for job types instead of IN() which can be slow
    const typeFilter = types.map((t) => `job_type='${t}'`).join(' OR ')
    const dateFilter = `pre__filing_date>'${since}'`
    const coordFilter = `gis_latitude IS NOT NULL`

    const where = `${boroughFilter} AND (${typeFilter}) AND ${coordFilter}`
    const select = [
      'job__', 'job_type', 'job_status', 'job_status_descrp',
      'gis_latitude', 'gis_longitude',
      'house__', 'street_name', 'zip_code', 'borough',
      'owner_s_business_name', 'owner_s_first_name', 'owner_s_last_name',
      'initial_cost', 'total_est__fee',
      'pre__filing_date', 'approved', 'fully_permitted',
      'job_description',
      'proposed_no_of_stories', 'proposed_dwelling_units',
      'existing_no_of_stories', 'proposed_height',
      'building_type', 'zoning_dist1',
    ].join(',')

    const url = `${DOB_URL}?$limit=${limit}&$where=${encodeURIComponent(where)}&$select=${encodeURIComponent(select)}`

    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return NextResponse.json({ error: 'DOB API unavailable' }, { status: 503 })

    const raw = await res.json()

    const permits = raw
      .filter((r: Record<string, string>) => r.gis_latitude && r.gis_longitude)
      .map((r: Record<string, string>) => {
        const cost = parseFloat(r.initial_cost?.replace(/[$,]/g, '') ?? '0') || 0
        return {
          id: r.job__,
          lat: parseFloat(r.gis_latitude),
          lng: parseFloat(r.gis_longitude),
          job_type: r.job_type,
          job_type_label: JOB_TYPE_LABELS[r.job_type] ?? r.job_type,
          status: r.job_status_descrp ?? r.job_status,
          address: `${r.house__ ?? ''} ${r.street_name ?? ''}`.trim(),
          zip: r.zip_code,
          borough: r.borough,
          owner: r.owner_s_business_name || `${r.owner_s_first_name ?? ''} ${r.owner_s_last_name ?? ''}`.trim() || null,
          cost,
          cost_display: cost > 0 ? '$' + (cost >= 1e6 ? (cost / 1e6).toFixed(1) + 'M' : (cost / 1e3).toFixed(0) + 'K') : null,
          filing_date: r.pre__filing_date,
          approved_date: r.approved,
          permitted_date: r.fully_permitted,
          description: r.job_description,
          proposed_stories: r.proposed_no_of_stories ? parseInt(r.proposed_no_of_stories) : null,
          proposed_units: r.proposed_dwelling_units ? parseInt(r.proposed_dwelling_units) : null,
          proposed_height: r.proposed_height ? parseFloat(r.proposed_height) : null,
          building_type: r.building_type,
          zoning: r.zoning_dist1,
        }
      })

    // Stats
    const costs = permits.map((p: { cost: number }) => p.cost).filter((c: number) => c > 0)
    const byType = permits.reduce((acc: Record<string, number>, p: { job_type: string }) => {
      acc[p.job_type] = (acc[p.job_type] || 0) + 1
      return acc
    }, {})

    return NextResponse.json({
      count: permits.length,
      stats: {
        total_cost: costs.reduce((s: number, c: number) => s + c, 0),
        max_cost: costs.length ? Math.max(...costs) : 0,
        by_type: byType,
      },
      permits,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
