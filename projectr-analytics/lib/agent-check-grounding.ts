import { getGoogleCloudAccessToken } from '@/lib/google-cloud-auth'

type GroundingFact = {
  factText: string
  attributes?: Record<string, string>
}

type CheckGroundingDependencies = {
  fetchImpl?: typeof fetch
  getAccessToken?: (scopes?: string[]) => Promise<string>
}

export type CheckGroundingResult = {
  supportScore: number
  claims: Array<{
    text: string
    groundingCheckRequired: boolean
    citationIndices: number[]
    supportScore?: number | null
  }>
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getProjectId(env: NodeJS.ProcessEnv = process.env): string | null {
  return trimText(env.CHECK_GROUNDING_PROJECT_ID) || trimText(env.GOOGLE_CLOUD_PROJECT) || trimText(env.BIGQUERY_PROJECT_ID) || null
}

export function isCheckGroundingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getProjectId(env) !== null && (trimText(env.ENABLE_CHECK_GROUNDING_API) === '1' || trimText(env.ENABLE_CHECK_GROUNDING_API).toLowerCase() === 'true')
}

export function buildCheckGroundingUrl(projectId: string): string {
  return `https://discoveryengine.googleapis.com/v1/projects/${projectId}/locations/global/groundingConfigs/default_grounding_config:check`
}

export async function checkGroundingCandidate(
  answerCandidate: string,
  facts: GroundingFact[],
  citationThreshold = 0.6,
  dependencies: CheckGroundingDependencies = {}
): Promise<CheckGroundingResult> {
  const projectId = getProjectId()
  if (!projectId) {
    throw new Error('Check Grounding API is not configured.')
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch
  const getAccessToken = dependencies.getAccessToken ?? getGoogleCloudAccessToken
  const token = await getAccessToken([CLOUD_PLATFORM_SCOPE])
  const response = await fetchImpl(buildCheckGroundingUrl(projectId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({
      answerCandidate,
      facts,
      groundingSpec: {
        citationThreshold,
        enableClaimLevelScore: true,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Check Grounding API failed (${response.status}): ${text || response.statusText}`)
  }

  const payload = (await response.json()) as {
    supportScore?: number
    claims?: Array<{
      claimText?: string
      text?: string
      groundingCheckRequired?: boolean
      citationIndices?: number[]
      supportScore?: number
    }>
  }

  return {
    supportScore: Number(payload.supportScore ?? 0),
    claims: (payload.claims ?? []).map((claim) => ({
      text: trimText(claim.claimText) || trimText(claim.text),
      groundingCheckRequired: claim.groundingCheckRequired !== false,
      citationIndices: Array.isArray(claim.citationIndices) ? claim.citationIndices.filter((value) => Number.isInteger(value)) : [],
      supportScore: typeof claim.supportScore === 'number' ? claim.supportScore : null,
    })),
  }
}
