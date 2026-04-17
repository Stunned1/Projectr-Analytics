import { stripTrailingStateSuffix } from '@/lib/area-keys'

type TexasRawPermitScope = {
  city: string
  state?: string | null
}

type RawPermitCategory = 'new_construction' | 'major_renovation' | 'demolition'

type AustinPermitRow = {
  permit_number?: string | null
  permit_type_desc?: string | null
  permit_class_mapped?: string | null
  work_class?: string | null
  description?: string | null
  issue_date?: string | null
  original_address1?: string | null
  original_zip?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  total_job_valuation?: string | number | null
  total_valuation_remodel?: string | number | null
  total_new_add_sqft?: string | number | null
  remodel_repair_sqft?: string | number | null
  housing_units?: string | number | null
  link?: string | { url?: string | null } | null
}

export interface TexasRawPermit {
  id: string
  source_city: string
  source_name: string
  category: RawPermitCategory
  category_label: string
  permit_number: string | null
  permit_type_desc: string | null
  permit_class_mapped: string | null
  work_class: string | null
  description: string | null
  address: string | null
  zip_code: string | null
  issue_date: string | null
  lat: number
  lng: number
  valuation: number | null
  square_feet: number | null
  housing_units: number | null
  source_url: string | null
}

export interface TexasRawPermitResult {
  city: string
  state: string
  source: string
  categories: Record<RawPermitCategory, number>
  permits: TexasRawPermit[]
}

const AUSTIN_PERMITS_RESOURCE = 'https://data.austintexas.gov/resource/3syk-w9eu.json'
const RAW_TEXAS_PERMIT_CACHE_TTL_MS = 15 * 60 * 1000
const RAW_TEXAS_PERMIT_LIMIT = 5000
const RAW_TEXAS_START_DATE = '2024-01-01T00:00:00.000'
const AUSTIN_RENOVATION_WORK_CLASSES = new Set([
  'Remodel',
  'Addition and Remodel',
  'Addition',
  'Interior Demo Non-Structural',
  'Modification',
  'Upgrade',
])
const AUSTIN_DEMOLITION_WORK_CLASSES = new Set(['Demolition', 'Demo'])

const resultCache = new Map<string, { expiresAt: number; value: TexasRawPermitResult | null }>()
const inflightCache = new Map<string, Promise<TexasRawPermitResult | null>>()

function normalizeCity(value: string): string {
  return stripTrailingStateSuffix(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

function cacheKey(scope: TexasRawPermitScope): string {
  return `${normalizeCity(scope.city)}|${(scope.state ?? 'TX').trim().toUpperCase()}`
}

function toNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value.replace(/[$,%]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function categoryLabel(category: RawPermitCategory): string {
  switch (category) {
    case 'new_construction':
      return 'New Construction'
    case 'major_renovation':
      return 'Major Renovation'
    case 'demolition':
      return 'Demolition'
  }
}

function normalizeAustinSourceUrl(
  value: string | { url?: string | null } | null | undefined
): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value && typeof value === 'object' && typeof value.url === 'string') {
    const trimmed = value.url.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function classifyAustinPermit(row: AustinPermitRow): RawPermitCategory | null {
  const workClass = row.work_class?.trim() ?? ''
  const permitClass = row.permit_class_mapped?.trim() ?? ''
  const valuation = Math.max(
    toNumber(row.total_job_valuation) ?? 0,
    toNumber(row.total_valuation_remodel) ?? 0
  )
  const squareFeet = Math.max(
    toNumber(row.total_new_add_sqft) ?? 0,
    toNumber(row.remodel_repair_sqft) ?? 0
  )
  const housingUnits = toNumber(row.housing_units) ?? 0

  if (AUSTIN_DEMOLITION_WORK_CLASSES.has(workClass)) {
    return 'demolition'
  }

  if (workClass === 'New') {
    if (
      permitClass === 'Residential' ||
      squareFeet >= 500 ||
      housingUnits >= 1 ||
      valuation >= 100_000
    ) {
      return 'new_construction'
    }
    return null
  }

  if (AUSTIN_RENOVATION_WORK_CLASSES.has(workClass)) {
    if (squareFeet >= 500 || valuation >= 100_000 || housingUnits >= 1) {
      return 'major_renovation'
    }
  }

  return null
}

function normalizeAustinPermit(row: AustinPermitRow): TexasRawPermit | null {
  const lat = toNumber(row.latitude)
  const lng = toNumber(row.longitude)
  if (lat == null || lng == null) return null

  const category = classifyAustinPermit(row)
  if (!category) return null

  const valuation = Math.max(
    toNumber(row.total_job_valuation) ?? 0,
    toNumber(row.total_valuation_remodel) ?? 0
  )
  const squareFeet = Math.max(
    toNumber(row.total_new_add_sqft) ?? 0,
    toNumber(row.remodel_repair_sqft) ?? 0
  )

  return {
    id: row.permit_number?.trim() || `${category}:${lat}:${lng}:${row.issue_date ?? ''}`,
    source_city: 'Austin',
    source_name: 'City of Austin Open Data',
    category,
    category_label: categoryLabel(category),
    permit_number: row.permit_number?.trim() ?? null,
    permit_type_desc: row.permit_type_desc?.trim() ?? null,
    permit_class_mapped: row.permit_class_mapped?.trim() ?? null,
    work_class: row.work_class?.trim() ?? null,
    description: row.description?.trim() ?? null,
    address: row.original_address1?.trim() ?? null,
    zip_code: row.original_zip?.trim() ?? null,
    issue_date: row.issue_date ?? null,
    lat,
    lng,
    valuation: valuation > 0 ? valuation : null,
    square_feet: squareFeet > 0 ? squareFeet : null,
    housing_units: toNumber(row.housing_units),
    source_url: normalizeAustinSourceUrl(row.link),
  }
}

async function fetchAustinRawPermits(): Promise<TexasRawPermitResult> {
  const params = new URLSearchParams({
    $select: [
      'permit_number',
      'permit_type_desc',
      'permit_class_mapped',
      'work_class',
      'description',
      'issue_date',
      'original_address1',
      'original_zip',
      'latitude',
      'longitude',
      'total_job_valuation',
      'total_valuation_remodel',
      'total_new_add_sqft',
      'remodel_repair_sqft',
      'housing_units',
      'link',
    ].join(','),
    $where: [
      "permit_type_desc = 'Building Permit'",
      `issue_date >= '${RAW_TEXAS_START_DATE}'`,
      "work_class in ('New','Demolition','Demo','Interior Demo Non-Structural','Remodel','Addition and Remodel','Addition','Modification','Upgrade')",
      'latitude IS NOT NULL',
      'longitude IS NOT NULL',
    ].join(' AND '),
    $order: 'issue_date DESC',
    $limit: String(RAW_TEXAS_PERMIT_LIMIT),
  })

  const response = await fetch(`${AUSTIN_PERMITS_RESOURCE}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Austin raw permit request failed (${response.status})`)
  }

  const rows = (await response.json()) as AustinPermitRow[]
  const permits = rows
    .map(normalizeAustinPermit)
    .filter((permit): permit is TexasRawPermit => permit !== null)

  const categories: Record<RawPermitCategory, number> = {
    new_construction: 0,
    major_renovation: 0,
    demolition: 0,
  }
  for (const permit of permits) {
    categories[permit.category] += 1
  }

  return {
    city: 'Austin',
    state: 'TX',
    source: 'City of Austin Open Data',
    categories,
    permits,
  }
}

async function loadTexasRawPermits(scope: TexasRawPermitScope): Promise<TexasRawPermitResult | null> {
  const city = normalizeCity(scope.city)
  const state = (scope.state ?? 'TX').trim().toUpperCase()
  if (state !== 'TX') return null

  if (city === 'austin') {
    return fetchAustinRawPermits()
  }

  return null
}

export async function getTexasRawPermits(scope: TexasRawPermitScope): Promise<TexasRawPermitResult | null> {
  const key = cacheKey(scope)
  const cached = resultCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const inflight = inflightCache.get(key)
  if (inflight) {
    return inflight
  }

  const request = loadTexasRawPermits(scope)
    .then((result) => {
      resultCache.set(key, {
        expiresAt: Date.now() + RAW_TEXAS_PERMIT_CACHE_TTL_MS,
        value: result,
      })
      return result
    })
    .finally(() => {
      inflightCache.delete(key)
    })

  inflightCache.set(key, request)
  return request
}
