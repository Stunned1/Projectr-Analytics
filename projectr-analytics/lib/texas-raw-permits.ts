import * as XLSX from 'xlsx'
import { stripTrailingStateSuffix } from '@/lib/area-keys'
import { geocodeZip } from '@/lib/geocoder'
import {
  normalizeForwardGeocodeQuery,
  readCachedForwardGeocodes,
  warmForwardGeocodes,
  type ForwardGeocodeResult,
} from '@/lib/google-forward-geocode'

type TexasRawPermitScope = {
  city: string
  state?: string | null
}

type RawPermitCategory = 'new_construction' | 'major_renovation' | 'demolition'
type TexasRawPermitLocationPrecision = 'source_coordinates' | 'zip_centroid'

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

type HoustonPermitWorksheetRow = {
  zip_code: string | null
  permit_date: string | null
  permit_type: string | null
  project_no: string | null
  address: string | null
  comments: string | null
}

type HoustonPermitSourceRow = {
  row: HoustonPermitWorksheetRow
  sourceUrl: string
  addressQuery: string | null
}

type TexasRawPermitLoadOptions = {
  houstonLiveGeocodeLimit?: number | null
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
  location_precision?: TexasRawPermitLocationPrecision
}

export interface TexasRawPermitResult {
  city: string
  state: string
  source: string
  categories: Record<RawPermitCategory, number>
  permits: TexasRawPermit[]
}

export interface WarmHoustonPermitGeocodesResult {
  requested: number
  cached: number
  attempted: number
  resolved: number
  missed: number
}

const AUSTIN_PERMITS_RESOURCE = 'https://data.austintexas.gov/resource/3syk-w9eu.json'
const HOUSTON_REPORTS_PAGE = 'https://www.houstonpermittingcenter.org/sold-permits-search'
const HOUSTON_REPORT_LINK_LIMIT = 8
const HOUSTON_ROUTE_LIVE_GEOCODE_LIMIT = 40
const HOUSTON_GEOCODE_CONCURRENCY = 6
const HOUSTON_RAW_PERMIT_CACHE_TTL_MS = 60 * 1000
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

function normalizeWorksheetHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function asString(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
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

function buildCategoryCounts(permits: TexasRawPermit[]): Record<RawPermitCategory, number> {
  const categories: Record<RawPermitCategory, number> = {
    new_construction: 0,
    major_renovation: 0,
    demolition: 0,
  }
  for (const permit of permits) {
    categories[permit.category] += 1
  }
  return categories
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
    location_precision: 'source_coordinates',
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

  return {
    city: 'Austin',
    state: 'TX',
    source: 'City of Austin Open Data',
    categories: buildCategoryCounts(permits),
    permits,
  }
}

export function extractHoustonReportUrlsFromHtml(html: string): string[] {
  const matches = html.matchAll(/https?:\/\/www\.houstonpermittingcenter\.org\/sites\/g\/files\/[^"'\s)]+\.xlsx/gi)
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of matches) {
    const url = match[0]
    if (!seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }

  return urls.slice(-HOUSTON_REPORT_LINK_LIMIT)
}

function findHoustonHeaderRow(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeWorksheetHeader)
    return (
      normalized[0] === 'zip code' &&
      normalized[1] === 'permit date' &&
      normalized[2] === 'permit type' &&
      normalized[3] === 'project no' &&
      normalized[4] === 'address' &&
      normalized[5] === 'comments'
    )
  })
}

export function parseHoustonPermitWorksheetRows(rows: unknown[][]): HoustonPermitWorksheetRow[] {
  const headerRowIndex = findHoustonHeaderRow(rows)
  if (headerRowIndex < 0) {
    throw new Error('Houston permit workbook is missing the expected header row')
  }

  const parsed: HoustonPermitWorksheetRow[] = []
  for (const row of rows.slice(headerRowIndex + 1)) {
    const zipCode = asString(row[0])
    const permitDate = asString(row[1])
    const permitType = asString(row[2])
    const projectNo = asString(row[3])
    const address = asString(row[4])
    const comments = asString(row[5])

    if (!zipCode && !permitDate && !permitType && !projectNo && !address && !comments) continue

    parsed.push({
      zip_code: zipCode,
      permit_date: permitDate,
      permit_type: permitType,
      project_no: projectNo,
      address,
      comments,
    })
  }

  return parsed
}

function normalizeHoustonDate(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/\//g, '-')
  const parsed = new Date(`${normalized}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export function classifyHoustonPermitRow(row: Pick<HoustonPermitWorksheetRow, 'permit_type' | 'comments'>): RawPermitCategory | null {
  const permitType = row.permit_type?.trim() ?? ''
  const comments = row.comments?.trim() ?? ''
  const haystack = `${permitType} ${comments}`.toLowerCase()

  if (/\bdemo(?:lition)?\b/.test(haystack)) {
    return 'demolition'
  }

  if (
    /\bnew\b/.test(haystack) ||
    /\bnc\/|\bnc\b/.test(haystack) ||
    /\bs\.?f\.?\s*res\b/.test(haystack) ||
    /\bshell\b/.test(haystack)
  ) {
    return 'new_construction'
  }

  if (permitType || comments) {
    return 'major_renovation'
  }

  return null
}

function buildHoustonAddressQuery(row: HoustonPermitWorksheetRow): string | null {
  const address = row.address?.trim()
  const zipCode = row.zip_code?.trim()
  if (!address || !zipCode) return null
  return `${address}, Houston, TX ${zipCode}`
}

function parseHoustonWorkbook(buffer: Buffer): HoustonPermitWorksheetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []

  const sheet = workbook.Sheets[firstSheetName]
  if (!sheet) return []

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  })
  return parseHoustonPermitWorksheetRows(rows)
}

async function fetchHoustonReportWorkbook(url: string): Promise<HoustonPermitWorksheetRow[]> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Houston permit workbook request failed (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return parseHoustonWorkbook(buffer)
}

async function fetchHoustonReportUrls(): Promise<string[]> {
  const response = await fetch(HOUSTON_REPORTS_PAGE, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Houston permit index request failed (${response.status})`)
  }

  const html = await response.text()
  const urls = extractHoustonReportUrlsFromHtml(html)
  if (urls.length === 0) {
    throw new Error('Houston permit index did not expose any workbook links')
  }
  return urls
}

async function fetchHoustonPermitSourceRows(): Promise<HoustonPermitSourceRow[]> {
  const reportUrls = await fetchHoustonReportUrls()
  const workbookRows = await Promise.all(reportUrls.map(fetchHoustonReportWorkbook))
  const dedupedRows = new Map<string, HoustonPermitSourceRow>()

  workbookRows.forEach((rows, index) => {
    const sourceUrl = reportUrls[index]
    for (const row of rows) {
      const dedupeKey = [
        row.zip_code ?? '',
        row.permit_date ?? '',
        row.project_no ?? '',
        row.address ?? '',
        row.comments ?? '',
      ].join('|')
      if (!dedupedRows.has(dedupeKey)) {
        dedupedRows.set(dedupeKey, {
          row,
          sourceUrl,
          addressQuery: buildHoustonAddressQuery(row),
        })
      }
    }
  })

  return Array.from(dedupedRows.values())
}

async function loadHoustonZipCentroids(zips: Iterable<string>): Promise<Map<string, { lat: number; lng: number }>> {
  const needed = new Set(
    Array.from(zips).filter((zip) => /^\d{5}$/.test(zip))
  )
  const byZip = new Map<string, { lat: number; lng: number }>()

  try {
    const { fetchTexasZctaRowsByCity } = await import('@/lib/data/bigquery-texas-zcta')
    const cityRows = await fetchTexasZctaRowsByCity('Houston', 'TX')
    for (const row of cityRows) {
      if (!needed.has(row.zcta5)) continue
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue
      byZip.set(row.zcta5, { lat: Number(row.lat), lng: Number(row.lng) })
    }
  } catch {
    // BigQuery-backed city centroids are optional; ZIP geocoder fallback covers local-only setups.
  }

  const unresolved = Array.from(needed).filter((zip) => !byZip.has(zip))
  const geocoded = await Promise.all(
    unresolved.map(async (zip) => [zip, await geocodeZip(zip)] as const)
  )

  for (const [zip, geo] of geocoded) {
    if (!geo) continue
    byZip.set(zip, { lat: geo.lat, lng: geo.lng })
  }

  return byZip
}

async function resolveHoustonAddressPoints(
  rows: HoustonPermitSourceRow[],
  liveGeocodeLimit: number | null
): Promise<Map<string, ForwardGeocodeResult>> {
  const addressQueries = Array.from(
    new Set(rows.map((entry) => entry.addressQuery).filter((value): value is string => Boolean(value)))
  )
  if (addressQueries.length === 0) return new Map()

  const cached = await readCachedForwardGeocodes(addressQueries)
  const unresolved = addressQueries.filter((query) => {
    const normalizedQuery = normalizeForwardGeocodeQuery(query)
    return normalizedQuery ? !cached.has(normalizedQuery) : false
  })

  const limit =
    liveGeocodeLimit == null ? unresolved.length : Math.max(0, Math.floor(liveGeocodeLimit))
  if (limit > 0 && unresolved.length > 0) {
    await warmForwardGeocodes(unresolved, {
      limit,
      concurrency: HOUSTON_GEOCODE_CONCURRENCY,
    })
  }

  const finalCache =
    limit > 0 && unresolved.length > 0
      ? await readCachedForwardGeocodes(addressQueries)
      : cached
  const resolved = new Map<string, ForwardGeocodeResult>()

  for (const query of addressQueries) {
    const normalizedQuery = normalizeForwardGeocodeQuery(query)
    if (!normalizedQuery) continue
    const value = finalCache.get(normalizedQuery)
    if (value) {
      resolved.set(normalizedQuery, value)
    }
  }

  return resolved
}

async function fetchHoustonRawPermits(
  options: TexasRawPermitLoadOptions = {}
): Promise<TexasRawPermitResult> {
  const sourceRows = await fetchHoustonPermitSourceRows()
  const centroidByZip = await loadHoustonZipCentroids(
    sourceRows.map(({ row }) => row.zip_code ?? '').filter(Boolean)
  )
  const addressPoints = await resolveHoustonAddressPoints(
    sourceRows,
    options.houstonLiveGeocodeLimit ?? HOUSTON_ROUTE_LIVE_GEOCODE_LIMIT
  )

  const permits: TexasRawPermit[] = []
  for (const { row, sourceUrl, addressQuery } of sourceRows) {
    const zipCode = row.zip_code?.trim() ?? null
    if (!zipCode) continue

    const category = classifyHoustonPermitRow(row)
    if (!category) continue

    const issueDate = normalizeHoustonDate(row.permit_date)
    const normalizedQuery = addressQuery ? normalizeForwardGeocodeQuery(addressQuery) : null
    const addressPoint = normalizedQuery ? addressPoints.get(normalizedQuery) ?? null : null
    const centroid = centroidByZip.get(zipCode)
    if (!addressPoint && !centroid) continue

    permits.push({
      id: row.project_no?.trim() || `${zipCode}:${issueDate ?? ''}:${category}:${row.address ?? ''}`,
      source_city: 'Houston',
      source_name: 'Houston Permitting Center Weekly Permit Activity',
      category,
      category_label: categoryLabel(category),
      permit_number: row.project_no?.trim() ?? null,
      permit_type_desc: row.permit_type?.trim() ?? null,
      permit_class_mapped: null,
      work_class: row.permit_type?.trim() ?? null,
      description: row.comments?.trim() ?? null,
      address: row.address?.trim() ?? null,
      zip_code: zipCode,
      issue_date: issueDate,
      lat: addressPoint?.lat ?? centroid!.lat,
      lng: addressPoint?.lng ?? centroid!.lng,
      valuation: null,
      square_feet: null,
      housing_units: null,
      source_url: sourceUrl,
      location_precision: addressPoint ? 'source_coordinates' : 'zip_centroid',
    })
  }

  permits.sort((a, b) => {
    const aDate = a.issue_date ?? ''
    const bDate = b.issue_date ?? ''
    if (aDate === bDate) return (a.address ?? '').localeCompare(b.address ?? '')
    return bDate.localeCompare(aDate)
  })

  return {
    city: 'Houston',
    state: 'TX',
    source: 'Houston Permitting Center Weekly Permit Activity',
    categories: buildCategoryCounts(permits),
    permits,
  }
}

async function loadTexasRawPermits(
  scope: TexasRawPermitScope,
  options: TexasRawPermitLoadOptions = {}
): Promise<TexasRawPermitResult | null> {
  const city = normalizeCity(scope.city)
  const state = (scope.state ?? 'TX').trim().toUpperCase()
  if (state !== 'TX') return null

  if (city === 'austin') {
    return fetchAustinRawPermits()
  }

  if (city === 'houston') {
    return fetchHoustonRawPermits(options)
  }

  return null
}

export async function warmHoustonPermitGeocodes(
  options: { limit?: number | null } = {}
): Promise<WarmHoustonPermitGeocodesResult> {
  const sourceRows = await fetchHoustonPermitSourceRows()
  const addressQueries = sourceRows
    .map((entry) => entry.addressQuery)
    .filter((value): value is string => Boolean(value))

  return warmForwardGeocodes(addressQueries, {
    limit: options.limit ?? null,
    concurrency: HOUSTON_GEOCODE_CONCURRENCY,
  })
}

export async function getTexasRawPermits(
  scope: TexasRawPermitScope,
  options: TexasRawPermitLoadOptions = {}
): Promise<TexasRawPermitResult | null> {
  const normalizedCity = normalizeCity(scope.city)
  const key = cacheKey(scope)
  const cached = resultCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const inflight = inflightCache.get(key)
  if (inflight) {
    return inflight
  }

  const request = loadTexasRawPermits(scope, options)
    .then((result) => {
      const ttlMs =
        normalizedCity === 'houston' ? HOUSTON_RAW_PERMIT_CACHE_TTL_MS : RAW_TEXAS_PERMIT_CACHE_TTL_MS
      resultCache.set(key, {
        expiresAt: Date.now() + ttlMs,
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
