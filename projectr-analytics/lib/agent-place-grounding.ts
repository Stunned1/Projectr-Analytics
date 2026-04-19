import type {
  AgentHistorySubject,
  AgentPlaceGroundingEvidenceResult,
  AgentPlaceGroundingQuery,
  AgentPlaceGroundingRecord,
  AgentPlaceGroundingSourceType,
  AgentPlaceGroundingValue,
} from '@/lib/agent-types'
import type { ScoutChartCitation } from '@/lib/scout-chart-output'

type PlaceGroundingFetcher = (query: AgentPlaceGroundingQuery) => Promise<AgentPlaceGroundingEvidenceResult>

type PlaceGroundingDependencies = {
  fetchPlaceEvidence?: PlaceGroundingFetcher
}

type CuratedPlaceDescriptor = {
  key: string
  label: string
  lat: number
  lng: number
  note: string
  periodLabel: string
}

const ALLOWED_SOURCE_TYPES = new Set<AgentPlaceGroundingSourceType>([
  'internal_dataset',
  'public_dataset',
  'workspace_upload',
  'derived',
  'placeholder',
])

const DRIVE_TIME_PATTERN = /\b(?:drive\s*time|travel\s*time|routing|route|directions?|commute)\b/i
const TEXAS_ZIP_PATTERN = /^(?:zip:tx:)?(\d{5})$/i
const TEXAS_COUNTY_PATTERN = /^county:tx:[a-z0-9-]+$/i
const TEXAS_METRO_PATTERN = /^metro:tx:[a-z0-9-]+$/i

const PLACE_NOTE = 'Resolved from bounded Texas place grounding.'
const PLACE_PERIOD_LABEL = 'Current place context'

const CURATED_TEXAS_PLACES: readonly CuratedPlaceDescriptor[] = [
  {
    key: 'zip:TX:78701',
    label: '78701',
    lat: 30.2711,
    lng: -97.7437,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'zip:TX:77002',
    label: '77002',
    lat: 29.7562,
    lng: -95.3677,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'zip:TX:75201',
    label: '75201',
    lat: 32.7876,
    lng: -96.797,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'zip:TX:78205',
    label: '78205',
    lat: 29.4249,
    lng: -98.4936,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'county:TX:harris-county',
    label: 'Harris County, TX',
    lat: 29.7752,
    lng: -95.3103,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'county:TX:travis-county',
    label: 'Travis County, TX',
    lat: 30.2672,
    lng: -97.7431,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'county:TX:dallas-county',
    label: 'Dallas County, TX',
    lat: 32.7767,
    lng: -96.797,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'county:TX:bexar-county',
    label: 'Bexar County, TX',
    lat: 29.4241,
    lng: -98.4936,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'metro:TX:austin',
    label: 'Austin metro, TX',
    lat: 30.2672,
    lng: -97.7431,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'metro:TX:houston',
    label: 'Houston metro, TX',
    lat: 29.7604,
    lng: -95.3698,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'metro:TX:dallas',
    label: 'Dallas metro, TX',
    lat: 32.7767,
    lng: -96.797,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
  {
    key: 'metro:TX:san-antonio',
    label: 'San Antonio metro, TX',
    lat: 29.4241,
    lng: -98.4936,
    note: PLACE_NOTE,
    periodLabel: PLACE_PERIOD_LABEL,
  },
]

const PLACE_REGISTRY = new Map<string, CuratedPlaceDescriptor>(
  CURATED_TEXAS_PLACES.map((descriptor) => [descriptor.key.toLowerCase(), descriptor])
)

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isAllowedSourceType(value: string): value is AgentPlaceGroundingSourceType {
  return ALLOWED_SOURCE_TYPES.has(value as AgentPlaceGroundingSourceType)
}

function normalizePlaceSourceType(value: unknown): AgentPlaceGroundingSourceType {
  const normalized = trimText(value)
  return isAllowedSourceType(normalized) ? normalized : 'derived'
}

function isTexasZipId(id: string): boolean {
  const normalized = id.trim()
  const bareZip = normalized.match(TEXAS_ZIP_PATTERN)?.[1] ?? null
  if (!bareZip) return false

  const prefix = Number.parseInt(bareZip.slice(0, 2), 10)
  return prefix >= 75 && prefix <= 79
}

function normalizePlaceRegistryKey(subject: AgentHistorySubject): string {
  if (subject.kind === 'zip') {
    const bareZip = subject.id.trim().match(TEXAS_ZIP_PATTERN)?.[1]
    return bareZip ? `zip:TX:${bareZip}`.toLowerCase() : ''
  }

  const id = subject.id.trim().toLowerCase()
  if (subject.kind === 'county' && TEXAS_COUNTY_PATTERN.test(id)) {
    return id
  }
  if (subject.kind === 'metro' && TEXAS_METRO_PATTERN.test(id)) {
    return id
  }
  return ''
}

function normalizeSubject(subject: AgentPlaceGroundingQuery['subject']): AgentHistorySubject {
  if (!subject) {
    throw new Error('Place grounding requires a resolved subject.')
  }

  if (subject.kind !== 'zip' && subject.kind !== 'county' && subject.kind !== 'metro') {
    throw new Error(`Unsupported place grounding subject kind: ${String(subject.kind)}`)
  }

  const id = trimText(subject.id)
  const label = trimText(subject.label) || id
  if (!id || !label) {
    throw new Error('Place grounding requires a resolved subject.')
  }

  const normalized = {
    kind: subject.kind,
    id,
    label,
  } satisfies AgentHistorySubject

  if (normalized.kind === 'zip' && !isTexasZipId(normalized.id)) {
    throw new Error('Place grounding is currently limited to Texas ZIP, county, and metro subjects.')
  }

  if (
    normalized.kind === 'county' &&
    !TEXAS_COUNTY_PATTERN.test(normalized.id.toLowerCase())
  ) {
    throw new Error('Place grounding is currently limited to Texas ZIP, county, and metro subjects.')
  }

  if (
    normalized.kind === 'metro' &&
    !TEXAS_METRO_PATTERN.test(normalized.id.toLowerCase())
  ) {
    throw new Error('Place grounding is currently limited to Texas ZIP, county, and metro subjects.')
  }

  return normalized
}

function looksLikeDriveTimeRequest(prompt: string): boolean {
  return DRIVE_TIME_PATTERN.test(prompt)
}

function buildCitationId(subject: AgentHistorySubject): string {
  return `place:${normalizePlaceRegistryKey(subject) || `${subject.kind}:${subject.id.trim()}`}`
}

function buildRecord(
  subject: AgentHistorySubject,
  descriptor: CuratedPlaceDescriptor
): AgentPlaceGroundingRecord {
  return {
    id: buildCitationId(subject),
    label: descriptor.label,
    sourceType: 'derived',
    scope: subject.label,
    note: descriptor.note,
    periodLabel: descriptor.periodLabel,
    lat: descriptor.lat,
    lng: descriptor.lng,
  }
}

function recordToCitation(record: AgentPlaceGroundingRecord): ScoutChartCitation {
  return {
    id: record.id,
    label: record.label,
    sourceType: record.sourceType,
    scope: record.scope ?? null,
    note: record.note ?? null,
    periodLabel: record.periodLabel ?? null,
  }
}

function buildPlaceEvidence(
  query: AgentPlaceGroundingQuery,
  subject: AgentHistorySubject
): AgentPlaceGroundingEvidenceResult {
  const key = normalizePlaceRegistryKey(subject)
  const descriptor = PLACE_REGISTRY.get(key)
  if (!descriptor) {
    throw new Error(`No bounded place grounding available for ${subject.label}.`)
  }

  const record = buildRecord(subject, descriptor)
  const value: AgentPlaceGroundingValue = {
    label: descriptor.label,
    scope: subject.label,
    sourceType: record.sourceType,
    note: record.note,
    periodLabel: record.periodLabel,
    lat: record.lat,
    lng: record.lng,
  }

  return {
    query,
    value,
    records: [record],
    citations: [recordToCitation(record)],
  }
}

function validateGroundingResult(
  result: AgentPlaceGroundingEvidenceResult,
  normalizedQuery: AgentPlaceGroundingQuery
): AgentPlaceGroundingEvidenceResult {
  if (!result || typeof result !== 'object') {
    throw new Error('Place grounding returned an invalid result.')
  }

  if (!result.value || typeof result.value !== 'object') {
    throw new Error('Place grounding returned an invalid result.')
  }

  if (!Array.isArray(result.records) || result.records.length === 0) {
    throw new Error('Place grounding returned no evidence records.')
  }

  if (!Array.isArray(result.citations) || result.citations.length === 0) {
    throw new Error('Place grounding returned no citations.')
  }

  if (trimText(result.value.label).length === 0 || trimText(result.value.scope).length === 0) {
    throw new Error('Place grounding returned incomplete place evidence.')
  }

  if (!isAllowedSourceType(trimText(result.value.sourceType))) {
    throw new Error('Place grounding returned an unsupported source type.')
  }

  if (!Number.isFinite(result.value.lat ?? Number.NaN) || !Number.isFinite(result.value.lng ?? Number.NaN)) {
    throw new Error('Place grounding returned invalid coordinates.')
  }

  const requestedScope = trimText(normalizedQuery.subject?.label)
  if (!requestedScope) {
    throw new Error('Place grounding requires a resolved subject.')
  }

  if (
    result.records.some((record) => trimText(record.scope) !== requestedScope) ||
    result.citations.some((citation) => trimText(citation.scope) !== requestedScope)
  ) {
    throw new Error('Place grounding returned evidence for the wrong subject.')
  }

  if (
    result.records.some((record) => !Number.isFinite(record.lat ?? Number.NaN) || !Number.isFinite(record.lng ?? Number.NaN))
  ) {
    throw new Error('Place grounding returned invalid coordinates.')
  }

  if (
    result.records.some((record) => trimText(record.label).length === 0) ||
    result.citations.some((citation) => trimText(citation.label).length === 0)
  ) {
    throw new Error('Place grounding returned incomplete place evidence.')
  }

  return {
    query: normalizedQuery,
    value: {
      ...result.value,
      label: trimText(result.value.label),
      scope: trimText(result.value.scope),
      sourceType: normalizePlaceSourceType(result.value.sourceType),
      note: trimText(result.value.note) || null,
      periodLabel: trimText(result.value.periodLabel) || null,
      lat: Number(result.value.lat),
      lng: Number(result.value.lng),
    },
    records: result.records.map((record) => ({
      ...record,
      label: trimText(record.label),
      sourceType: normalizePlaceSourceType(record.sourceType),
      scope: trimText(record.scope) || null,
      note: trimText(record.note) || null,
      periodLabel: trimText(record.periodLabel) || null,
      lat: Number(record.lat),
      lng: Number(record.lng),
    })),
    citations: result.citations.map((citation) => ({
      ...citation,
      label: trimText(citation.label),
      sourceType: normalizePlaceSourceType(citation.sourceType),
      scope: trimText(citation.scope) || null,
      note: trimText(citation.note) || null,
      periodLabel: trimText(citation.periodLabel) || null,
    })),
  }
}

export async function retrievePlaceGrounding(
  query: AgentPlaceGroundingQuery,
  dependencies: PlaceGroundingDependencies = {}
): Promise<AgentPlaceGroundingEvidenceResult> {
  const prompt = trimText(query.prompt)
  if (!prompt) {
    throw new Error('Place grounding requires a prompt.')
  }

  if (query.requestType === 'drive_time' || looksLikeDriveTimeRequest(prompt)) {
    throw new Error('Place grounding does not support drive-time or routing requests yet.')
  }

  const subject = normalizeSubject(query.subject)
  const normalizedQuery: AgentPlaceGroundingQuery = {
    prompt: query.prompt,
    subject,
    ...(query.requestType ? { requestType: query.requestType } : {}),
  }

  const fetchPlaceEvidence = dependencies.fetchPlaceEvidence ?? (async (request) => buildPlaceEvidence(request, subject))
  const result = await fetchPlaceEvidence(normalizedQuery)
  return validateGroundingResult(result, normalizedQuery)
}
