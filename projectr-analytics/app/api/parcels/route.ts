/**
 * NYC PLUTO Parcel Data
 * Supports both ZIP-level and borough-level queries.
 * Used for ColumnLayer 3D visualization — height = assessed value per sqft, color = land use.
 *
 * Query modes:
 * - ?zip=10001         → single ZIP, up to 1000 parcels
 * - ?borough=manhattan → full borough, top 5000 by assessed value
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json'

const LAND_USE: Record<string, string> = {
  '1': 'One & Two Family',
  '2': 'Multi-Family Walkup',
  '3': 'Multi-Family Elevator',
  '4': 'Mixed Residential/Commercial',
  '5': 'Commercial/Office',
  '6': 'Industrial',
  '7': 'Transportation/Utility',
  '8': 'Public Facilities',
  '9': 'Open Space',
  '10': 'Parking',
  '11': 'Vacant Land',
}

// Borough name → PLUTO borocode
const BOROUGH_CODES: Record<string, string> = {
  manhattan: '1',
  bronx: '2',
  brooklyn: '3',
  queens: '4',
  'staten island': '5',
}

const NYC_ZIPS = new Set([
  '10001','10002','10003','10004','10005','10006','10007','10009','10010','10011',
  '10012','10013','10014','10016','10017','10018','10019','10020','10021','10022',
  '10023','10024','10025','10026','10027','10028','10029','10030','10031','10032',
  '10033','10034','10035','10036','10037','10038','10039','10040','10044','10065',
  '10069','10075','10103','10110','10111','10112','10115','10119','10128','10162',
  '10165','10167','10168','10169','10170','10171','10172','10173','10174','10177',
  '10199','10271','10278','10279','10280','10282',
  '11201','11203','11204','11205','11206','11207','11208','11209','11210','11211',
  '11212','11213','11214','11215','11216','11217','11218','11219','11220','11221',
  '11222','11223','11224','11225','11226','11228','11229','11230','11231','11232',
  '11233','11234','11235','11236','11237','11238','11239',
  '11101','11102','11103','11104','11105','11106','11354','11355','11356','11357',
  '11358','11360','11361','11362','11363','11364','11365','11366','11367','11368',
  '11369','11370','11371','11372','11373','11374','11375','11377','11378','11379',
  '11385','11411','11412','11413','11414','11415','11416','11417','11418','11419',
  '11420','11421','11422','11423','11424','11425','11426','11427','11428','11429',
  '11430','11432','11433','11434','11435','11436','11691','11692','11693','11694','11697',
  '10451','10452','10453','10454','10455','10456','10457','10458','10459','10460',
  '10461','10462','10463','10464','10465','10466','10467','10468','10469','10470',
  '10471','10472','10473','10474','10475',
  '10301','10302','10303','10304','10305','10306','10307','10308','10309','10310',
  '10311','10312','10314',
])

function parseParcels(raw: Record<string, string>[]) {
  return raw
    .filter((r) => r.latitude && r.longitude && r.assesstot)
    .map((r) => {
      const assesstot = parseFloat(r.assesstot) || 0
      const bldgarea = parseFloat(r.bldgarea) || 1
      return {
        lat: parseFloat(r.latitude),
        lng: parseFloat(r.longitude),
        address: r.address ?? '',
        assessed_value: assesstot,
        assessed_per_sqft: bldgarea > 0 ? Math.round(assesstot / bldgarea) : 0,
        floors: parseFloat(r.numfloors) || 1,
        year_built: parseInt(r.yearbuilt) || null,
        land_use: r.landuse ?? null,
        land_use_label: LAND_USE[r.landuse ?? ''] ?? 'Other',
        bldg_area: bldgarea,
      }
    })
}

function computeStats(parcels: { assessed_per_sqft: number }[]) {
  const values = parcels.map((p) => p.assessed_per_sqft).filter((v) => v > 0).sort((a, b) => a - b)
  return {
    p25_per_sqft: values[Math.floor(values.length * 0.25)] ?? 0,
    p75_per_sqft: values[Math.floor(values.length * 0.75)] ?? 1,
  }
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')
  const borough = request.nextUrl.searchParams.get('borough')?.toLowerCase()

  try {
    // Borough mode — top 5000 parcels by assessed value
    if (borough) {
      const borocode = BOROUGH_CODES[borough]
      if (!borocode) {
        return NextResponse.json({ error: `Unknown borough "${borough}"` }, { status: 404 })
      }

      const url = `${PLUTO_URL}?$limit=5000&borocode=${borocode}&$select=address,assesstot,numfloors,yearbuilt,landuse,latitude,longitude,bldgarea&$order=assesstot+DESC`
      const res = await fetch(url, { next: { revalidate: 86400 } })
      if (!res.ok) return NextResponse.json({ error: 'PLUTO API unavailable' }, { status: 503 })

      const raw = await res.json()
      const parcels = parseParcels(raw)

      return NextResponse.json({
        borough,
        count: parcels.length,
        stats: computeStats(parcels),
        parcels,
      })
    }

    // ZIP mode
    if (!zip || !/^\d{5}$/.test(zip)) {
      return NextResponse.json({ error: 'Provide zip or borough parameter' }, { status: 400 })
    }
    if (!NYC_ZIPS.has(zip)) {
      return NextResponse.json({ error: 'Parcel data only available for NYC ZIPs', nyc_only: true }, { status: 404 })
    }

    const url = `${PLUTO_URL}?$limit=1000&$where=zipcode='${zip}'&$select=address,assesstot,numfloors,yearbuilt,landuse,latitude,longitude,lotarea,bldgarea`
    const res = await fetch(url, { next: { revalidate: 86400 * 7 } })
    if (!res.ok) return NextResponse.json({ error: 'PLUTO API unavailable' }, { status: 503 })

    const raw = await res.json()
    const parcels = parseParcels(raw)

    return NextResponse.json({
      zip,
      count: parcels.length,
      stats: computeStats(parcels),
      parcels,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
