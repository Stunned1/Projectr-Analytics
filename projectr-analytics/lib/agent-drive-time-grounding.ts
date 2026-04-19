import type {
  AgentDriveTimeEvidenceResult,
  AgentDriveTimeQuery,
  AgentDriveTimeRecord,
  AgentDriveTimeSourceType,
  AgentDriveTimeValue,
  AgentPlaceGroundingEvidenceResult,
  AgentPlaceGroundingQuery,
} from '@/lib/agent-types'
import type { ScoutChartCitation } from '@/lib/scout-chart-output'
import { retrievePlaceGrounding } from '@/lib/agent-place-grounding'
import { getGoogleCloudAccessToken } from '@/lib/google-cloud-auth'

type PlaceGroundingFetcher = (query: AgentPlaceGroundingQuery) => Promise<AgentPlaceGroundingEvidenceResult>

type DriveTimeDependencies = {
  fetchPlaceGrounding?: PlaceGroundingFetcher
  fetchLiveRoute?: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) => Promise<{
    driveMinutes: number
    distanceMiles: number
    note: string
    periodLabel: string
  }>
}

const ALLOWED_SOURCE_TYPES = new Set<AgentDriveTimeSourceType>([
  'internal_dataset',
  'public_dataset',
  'workspace_upload',
  'derived',
  'placeholder',
])

const ROUTE_NOTE =
  'Estimated from bounded Texas place coordinates with a conservative road-distance factor; this is not turn-by-turn routing.'
const ROUTE_PERIOD_LABEL = 'Current route context'
const ROAD_DISTANCE_FACTOR = 1.2
const AVERAGE_DRIVE_SPEED_MPH = 60

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isAllowedSourceType(value: string): value is AgentDriveTimeSourceType {
  return ALLOWED_SOURCE_TYPES.has(value as AgentDriveTimeSourceType)
}

function normalizeDriveTimeSourceType(value: unknown): AgentDriveTimeSourceType {
  const normalized = trimText(value)
  return isAllowedSourceType(normalized) ? normalized : 'derived'
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function haversineMiles(
  originLat: number,
  originLng: number,
  destinationLat: number,
  destinationLng: number
): number {
  const earthRadiusMiles = 3958.8
  const latDelta = toRadians(destinationLat - originLat)
  const lngDelta = toRadians(destinationLng - originLng)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(originLat)) * Math.cos(toRadians(destinationLat)) * Math.sin(lngDelta / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMiles * c
}

function formatDriveMinutes(minutes: number): string {
  if (minutes <= 0) return 'about 0 min'

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) return `about ${remainingMinutes} min`
  if (remainingMinutes === 0) return `about ${hours} hr`
  return `about ${hours} hr ${remainingMinutes} min`
}

function buildRouteRecord(
  query: AgentDriveTimeQuery,
  driveMinutes: number,
  distanceMiles: number
): AgentDriveTimeRecord {
  const originId = trimText(query.origin?.id) || 'unknown-origin'
  const destinationId = trimText(query.destination?.id) || 'unknown-destination'

  return {
    id: `drive_time:${originId}:${destinationId}`,
    label: 'Bounded Texas route estimate',
    sourceType: 'derived',
    scope: `${trimText(query.origin?.label) || originId} to ${trimText(query.destination?.label) || destinationId}`,
    note: ROUTE_NOTE,
    periodLabel: ROUTE_PERIOD_LABEL,
    driveMinutes,
    distanceMiles,
  }
}

function recordToCitation(record: AgentDriveTimeRecord): ScoutChartCitation {
  return {
    id: record.id,
    label: record.label,
    sourceType: record.sourceType,
    scope: record.scope ?? null,
    note: record.note ?? null,
    periodLabel: record.periodLabel ?? null,
  }
}

function isLiveRoutesConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    trimText(env.GOOGLE_MAPS_ROUTES_API_KEY).length > 0 ||
    trimText(env.GOOGLE_MAPS_ROUTES_PREFERRED_API_KEY).length > 0 ||
    trimText(env.ENABLE_GOOGLE_MAPS_COMPUTE_ROUTES) === '1' ||
    trimText(env.ENABLE_GOOGLE_MAPS_COMPUTE_ROUTES).toLowerCase() === 'true'
  )
}

async function defaultFetchLiveRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<{
  driveMinutes: number
  distanceMiles: number
  note: string
  periodLabel: string
}> {
  if (!isLiveRoutesConfigured()) {
    throw new Error('Google Maps computeRoutes is not configured.')
  }

  const apiKey = trimText(process.env.GOOGLE_MAPS_ROUTES_API_KEY) || trimText(process.env.GOOGLE_MAPS_ROUTES_PREFERRED_API_KEY)
  const useApiKey = apiKey.length > 0
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
  }

  if (useApiKey) {
    headers['X-Goog-Api-Key'] = apiKey
  } else {
    const token = await getGoogleCloudAccessToken(['https://www.googleapis.com/auth/maps-platform.routespreferred'])
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.lat,
            longitude: destination.lng,
          },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'en-US',
      units: 'IMPERIAL',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`computeRoutes failed (${response.status}): ${text || response.statusText}`)
  }

  const payload = (await response.json()) as {
    routes?: Array<{
      duration?: string
      distanceMeters?: number
    }>
  }

  const route = payload.routes?.[0]
  const durationSeconds = route?.duration ? Number.parseInt(route.duration.replace(/s$/, ''), 10) : Number.NaN
  const distanceMeters = route?.distanceMeters ?? Number.NaN
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)) {
    throw new Error('computeRoutes returned an invalid route payload.')
  }

  return {
    driveMinutes: Math.max(0, Math.round(durationSeconds / 60)),
    distanceMiles: Number((distanceMeters / 1609.344).toFixed(1)),
    note: 'Computed with Google Maps Routes API computeRoutes.',
    periodLabel: 'Current Google Maps route',
  }
}

function normalizeQuery(query: AgentDriveTimeQuery): AgentDriveTimeQuery {
  const prompt = trimText(query.prompt)
  const origin = query.origin
  const destination = query.destination

  if (!prompt) {
    throw new Error('Drive-time grounding requires a prompt.')
  }

  if (!origin || !destination) {
    throw new Error('Drive-time grounding requires two resolved subjects.')
  }

  if (!trimText(origin.id) || !trimText(origin.label) || !trimText(destination.id) || !trimText(destination.label)) {
    throw new Error('Drive-time grounding requires two resolved subjects.')
  }

  return {
    prompt,
    origin: {
      kind: origin.kind,
      id: trimText(origin.id),
      label: trimText(origin.label),
    },
    destination: {
      kind: destination.kind,
      id: trimText(destination.id),
      label: trimText(destination.label),
    },
  }
}

function validateGroundingResult(
  result: AgentDriveTimeEvidenceResult,
  query: AgentDriveTimeQuery
): AgentDriveTimeEvidenceResult {
  if (!result || typeof result !== 'object') {
    throw new Error('Drive-time grounding returned an invalid result.')
  }

  if (!result.value || typeof result.value !== 'object') {
    throw new Error('Drive-time grounding returned an invalid value payload.')
  }

  if (!Array.isArray(result.records) || result.records.length === 0) {
    throw new Error('Drive-time grounding returned no evidence records.')
  }

  if (!Array.isArray(result.citations) || result.citations.length === 0) {
    throw new Error('Drive-time grounding returned no citations.')
  }

  if (!Number.isFinite(result.value.driveMinutes) || result.value.driveMinutes < 0) {
    throw new Error('Drive-time grounding returned an invalid duration.')
  }

  if (!Number.isFinite(result.value.distanceMiles) || (result.value.distanceMiles ?? 0) < 0) {
    throw new Error('Drive-time grounding returned an invalid distance.')
  }

  if (trimText(result.value.scope).length === 0 || trimText(result.value.displayValue).length === 0) {
    throw new Error('Drive-time grounding returned incomplete route evidence.')
  }

  if (!isAllowedSourceType(trimText(result.value.sourceType))) {
    throw new Error('Drive-time grounding returned an unsupported source type.')
  }

  const expectedScope = `${trimText(query.origin?.label)} to ${trimText(query.destination?.label)}`
  const routeCitation = result.citations.find((citation) => trimText(citation.id).startsWith('drive_time:'))

  if (!routeCitation || trimText(routeCitation.scope) !== expectedScope) {
    throw new Error('Drive-time grounding returned evidence for the wrong route.')
  }

  return {
    query,
    value: {
      ...result.value,
      label: trimText(result.value.label),
      scope: trimText(result.value.scope),
      sourceType: normalizeDriveTimeSourceType(result.value.sourceType),
      driveMinutes: Number(result.value.driveMinutes),
      displayValue: trimText(result.value.displayValue),
      distanceMiles: Number(result.value.distanceMiles),
      note: trimText(result.value.note) || null,
      periodLabel: trimText(result.value.periodLabel) || null,
    },
    records: result.records.map((record) => ({
      ...record,
      id: trimText(record.id),
      label: trimText(record.label),
      sourceType: normalizeDriveTimeSourceType(record.sourceType),
      scope: trimText(record.scope) || null,
      note: trimText(record.note) || null,
      periodLabel: trimText(record.periodLabel) || null,
      driveMinutes:
        record.driveMinutes == null || Number.isFinite(record.driveMinutes) ? (record.driveMinutes ?? null) : null,
      distanceMiles:
        record.distanceMiles == null || Number.isFinite(record.distanceMiles) ? (record.distanceMiles ?? null) : null,
    })),
    citations: result.citations.map((citation) => ({
      ...citation,
      id: trimText(citation.id),
      label: trimText(citation.label),
      sourceType: normalizeDriveTimeSourceType(citation.sourceType),
      scope: trimText(citation.scope) || null,
      note: trimText(citation.note) || null,
      periodLabel: trimText(citation.periodLabel) || null,
    })),
  }
}

export async function retrieveDriveTimeGrounding(
  query: AgentDriveTimeQuery,
  dependencies: DriveTimeDependencies = {}
): Promise<AgentDriveTimeEvidenceResult> {
  const normalizedQuery = normalizeQuery(query)
  const fetchPlaceGrounding = dependencies.fetchPlaceGrounding ?? retrievePlaceGrounding
  const fetchLiveRoute = dependencies.fetchLiveRoute ?? defaultFetchLiveRoute

  const [originPlace, destinationPlace] = await Promise.all([
    fetchPlaceGrounding({
      prompt: normalizedQuery.prompt,
      subject: normalizedQuery.origin,
      requestType: 'place',
    }),
    fetchPlaceGrounding({
      prompt: normalizedQuery.prompt,
      subject: normalizedQuery.destination,
      requestType: 'place',
    }),
  ])

  const originLat = originPlace.value.lat
  const originLng = originPlace.value.lng
  const destinationLat = destinationPlace.value.lat
  const destinationLng = destinationPlace.value.lng

  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    throw new Error('Drive-time grounding requires valid place coordinates.')
  }

  let distanceMiles: number
  let driveMinutes: number
  let routeNote = ROUTE_NOTE
  let routePeriodLabel = ROUTE_PERIOD_LABEL

  try {
    const liveRoute = await fetchLiveRoute(
      { lat: originLat!, lng: originLng! },
      { lat: destinationLat!, lng: destinationLng! }
    )
    distanceMiles = liveRoute.distanceMiles
    driveMinutes = liveRoute.driveMinutes
    routeNote = liveRoute.note
    routePeriodLabel = liveRoute.periodLabel
  } catch {
    const straightLineMiles = haversineMiles(originLat!, originLng!, destinationLat!, destinationLng!)
    distanceMiles = Number((straightLineMiles * ROAD_DISTANCE_FACTOR).toFixed(1))
    driveMinutes =
      distanceMiles === 0 ? 0 : Math.max(1, Math.round((distanceMiles / AVERAGE_DRIVE_SPEED_MPH) * 60))
  }

  const displayValue = formatDriveMinutes(driveMinutes)
  const scope = `${normalizedQuery.origin!.label} to ${normalizedQuery.destination!.label}`
  const routeRecord = buildRouteRecord(normalizedQuery, driveMinutes, distanceMiles)
  routeRecord.label = routeNote.includes('Google Maps Routes API') ? 'Google Maps computeRoutes' : routeRecord.label
  routeRecord.note = routeNote
  routeRecord.periodLabel = routePeriodLabel

  const value: AgentDriveTimeValue = {
    label: 'Estimated drive time',
    scope,
    sourceType: 'derived',
    driveMinutes,
    displayValue,
    distanceMiles,
    note: routeNote,
    periodLabel: routePeriodLabel,
  }

  return validateGroundingResult(
    {
      query: normalizedQuery,
      value,
      records: [
        ...originPlace.records,
        ...destinationPlace.records,
        routeRecord,
      ],
      citations: [
        ...originPlace.citations,
        ...destinationPlace.citations,
        recordToCitation(routeRecord),
      ],
    },
    normalizedQuery
  )
}
