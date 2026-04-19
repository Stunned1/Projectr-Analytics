import { getGoogleCloudAccessToken } from '@/lib/google-cloud-auth'

export type VertexAiGroundingMode = 'vertex_search' | 'google_search' | 'google_maps'

export type VertexAiConfig = {
  projectId: string
  location: string
  model: string
}

type VertexAiTextPart = {
  text?: string
}

type VertexAiCandidate = {
  content?: {
    parts?: VertexAiTextPart[]
  }
  groundingMetadata?: {
    groundingChunks?: Array<{
      retrievedContext?: {
        uri?: string
        title?: string
      }
      web?: {
        uri?: string
        title?: string
        domain?: string
      }
      maps?: {
        uri?: string
        title?: string
        placeId?: string
        placeAnswerSources?: {
          reviewSnippets?: Array<{
            googleMapsUri?: string
            title?: string
          }>
        }
      }
    }>
    groundingSupport?: Array<{
      segment?: {
        text?: string
      }
      groundingChunkIndices?: number[]
      confidenceScores?: number[]
    }>
    groundingSupports?: Array<{
      segment?: {
        text?: string
      }
      groundingChunkIndices?: number[]
      confidenceScores?: number[]
    }>
    retrievalQueries?: string[]
    webSearchQueries?: string[]
  }
}

export type VertexAiGenerateContentResponse = {
  candidates?: VertexAiCandidate[]
}

type VertexAiFetchDependencies = {
  fetchImpl?: typeof fetch
  getAccessToken?: (scopes?: string[]) => Promise<string>
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getVertexAiConfig(env: NodeJS.ProcessEnv = process.env): VertexAiConfig | null {
  const projectId = trimText(env.VERTEX_AI_PROJECT_ID) || trimText(env.GOOGLE_CLOUD_PROJECT) || trimText(env.BIGQUERY_PROJECT_ID)
  if (!projectId) return null

  return {
    projectId,
    location: trimText(env.VERTEX_AI_LOCATION) || 'global',
    model: trimText(env.VERTEX_AI_GEMINI_MODEL) || 'gemini-2.5-flash',
  }
}

export function isVertexAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getVertexAiConfig(env) !== null
}

export function buildVertexAiGenerateContentUrl(config: VertexAiConfig): string {
  const host =
    config.location.toLowerCase() === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${config.location}-aiplatform.googleapis.com`

  return `${host}/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`
}

export function extractVertexAiText(response: VertexAiGenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  return parts
    .map((part) => trimText(part.text))
    .filter((part) => part.length > 0)
    .join('\n')
    .trim()
}

export async function callVertexAiGenerateContent(
  body: Record<string, unknown>,
  dependencies: VertexAiFetchDependencies = {}
): Promise<VertexAiGenerateContentResponse> {
  const config = getVertexAiConfig()
  if (!config) {
    throw new Error('Vertex AI grounding is not configured.')
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch
  const getAccessToken = dependencies.getAccessToken ?? getGoogleCloudAccessToken
  const token = await getAccessToken([CLOUD_PLATFORM_SCOPE])
  const response = await fetchImpl(buildVertexAiGenerateContentUrl(config), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Vertex AI generateContent failed (${response.status}): ${text || response.statusText}`)
  }

  return (await response.json()) as VertexAiGenerateContentResponse
}
