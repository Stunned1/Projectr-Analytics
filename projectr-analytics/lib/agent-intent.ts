import type { MapContext } from '@/lib/agent-types'

export type AgentIntentLane = 'eda' | 'direct_map_control' | 'blocked'
export type AgentBlockedReason = 'empty' | 'slash_command' | 'arithmetic' | 'off_topic'

export type AgentIntentClassification =
  | { lane: 'eda' }
  | { lane: 'direct_map_control' }
  | { lane: 'blocked'; reason: AgentBlockedReason; message: string }

const BLOCKED_DEFAULT_MESSAGE =
  'Scout now routes bounded EDA requests and explicit map controls here. Ask for a dataset summary, outliers, distributions, comparisons, trend changes, metric explanations, data-quality checks, or direct actions like loading a market or toggling a layer.'

const BLOCKED_SHORT_MESSAGE =
  'Scout only routes bounded EDA requests here. I did not run analysis for this prompt.'

const OFF_TOPIC_CATEGORY_MESSAGE =
  'That looks outside Scout EDA and direct map control. Ask about the loaded market, an imported dataset, outliers, distributions, trend changes, metric explanations, data quality, or explicit map actions.'

const ARITHMETIC_ONLY_PATTERN = /^(?:what(?:'s| is)\s+)?[\d\s+\-*/().=%]+(?:\?)?$/i

const REAL_ESTATE_DOMAIN_PATTERN =
  /\b(real estate|property|properties|parcel|parcels|site|sites|zoning|far|air rights|tax lots?|pluto|rent|rents|rental|zori|zhvi|zillow|housing|home values?|apartments?|multifamily|permit|permits|construction|development|vacancy|occupancy|absorption|demographics?|population|income|employment|labor|census|acs|fred|hud|noi|cap rate|lease|tenant|acquisition|underwriting|feasibility|comps|transit|amenit(?:y|ies)|pois?|flood|tracts?|block groups?|shortlist|saved sites?)\b/i

const SCOUT_PRODUCT_CONTEXT_PATTERN =
  /\b(current map|loaded market|loaded data|selected site|selected sites|uploaded|upload|uploads|csv|client data|imported data|map layer|map layers|layers|dashboard|shortlist|saved|data panel|analysis panel|brief|report|pdf|metrics|trend|trends|forecast|score|scoring|ranked sites?)\b/i

const EDA_INTENT_PATTERN =
  /\b(compare|analy[sz]e|find|summari[sz]e|explain|describe|inspect|review|check|spot|detect|outlier|anomal|trend|quality|missing|top|bottom|what is|why|what matters|stands out|overview|takeaway|walk me through)\b/i

export const ANALYTICAL_PROMPT_PATTERN_SOURCE =
  'trend|trends|distribution|outlier|outliers|anomal(?:y|ies)|quality|compare|comparison|versus|vs\\.?|top|bottom|rank|ranking|summary|summarize|average|mean|median|percentile|change|changed|delta|growth|decline|increase|decrease|over time|explain|missing|duplicate|null|why|what matters|stands out|overview|takeaway|walk me through|tell(?: me)?(?: about)?'

const ANALYTICAL_PROMPT_PATTERN = new RegExp(`\\b(?:${ANALYTICAL_PROMPT_PATTERN_SOURCE})\\b`, 'i')

const STRONG_LAYER_CONTROL_PATTERN = /\b(turn on|turn off|hide|disable|enable)\b/i
const WEAK_LAYER_CONTROL_PATTERN = /\b(show|display|open)\b/i
const EXPLICIT_LAYER_OBJECT_PATTERN =
  /\b(layer|layers|overlay|overlays|parcels?|pluto|permits?|building permits?|transit|stops|tracts|demographics?|flood|flood risk|momentum|pois?|amenit(?:y|ies)|heatmap|client data|imported data|uploaded data|csv|boundary|zip boundary)\b/i
const PANEL_CONTROL_PATTERN = /\b(open|focus)\s+(?:the\s+)?(?:data|analysis)\s+panel\b/i
const VIEW_CONTROL_PATTERN = /\b(?:3d|2d|flat map|tilt(?:\s+\d{1,2})?|rotate(?:\s+\d{1,3})?)\b/i
const SEARCH_CONTROL_PATTERN = /\b(?:take me to|go to|load|search(?: for)?|navigate to|fly to|zoom to|center on)\b/i

const CONTEXTUAL_REAL_ESTATE_TASK_PATTERN =
  /\b(compare|analy[sz]e|summari[sz]e|find|explain|describe|inspect|check|spot|detect|outlier|anomal|trend|quality|missing|top|bottom|why|what matters|stands out|overview|takeaway|walk me through)\b.*\b(this|these|those|current|loaded|selected|upload|uploaded|csv|markets?|areas?|locations?|zips?|layers?|data|dataset|here)\b/i

const REFERENTIAL_WORKSPACE_PATTERN =
  /\b(this|these|that|those|it|loaded|current|selected|active|uploaded|imported|dataset|csv|market|map)\b/i

const ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/
const COORDINATE_PATTERN = /\b-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/
const CITY_STATE_PATTERN = /\b[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/

const PLACE_ANALYSIS_PATTERN =
  /\b(?:compare|analy[sz]e|summari[sz]e|explain|inspect|review)\s+(?:me\s+)?(.{2,140})$/i

const CAPITALIZED_PLACE_TOKEN_PATTERN = /\b[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)*\b/

const KNOWN_PLACE_TOKEN_PATTERN =
  /\b(nyc|new york|brooklyn|queens|manhattan|bronx|staten island|soho|chelsea|dallas|austin|raleigh|chicago|boston|miami|seattle|denver|atlanta|los angeles|san francisco|washington dc|philadelphia|phoenix|houston|harris county|travis county|dallas-fort worth)\b/i

const OBVIOUS_GENERAL_FINANCE_PATTERN =
  /\b(stocks?|crypto|bitcoin|ethereum|bonds?|options?|earnings|nasdaq|dow jones|s&p 500)\b/i

const OBVIOUS_PROGRAMMING_PATTERN =
  /\b(javascript|typescript|python|react|next\.?js|node\.?js|css|html|data structures?|algorithm|function|class|array|object|map object|code|coding)\b/i

const OBVIOUS_CASUAL_OR_GENERAL_PATTERN =
  /\b(joke|poem|song|recipe|weather|sports?|movie|game|trivia|translate|grammar|dating|medical|doctor|legal advice)\b/i

function hasVisibleWorkspaceContext(context: MapContext | null | undefined): boolean {
  return Boolean(
    context?.label ||
      context?.zip ||
      context?.clientCsv ||
      context?.eda?.market ||
      (context?.eda?.uploadedDatasetCount ?? 0) > 0
  )
}

function hasPlaceAnalysisIntent(prompt: string): boolean {
  const match = prompt.match(PLACE_ANALYSIS_PATTERN)
  if (!match) return false

  const target = (match[1] ?? '').trim()
  if (!target) return false
  if (/^(?:of|about|for)\b/i.test(target)) return false
  if (OBVIOUS_CASUAL_OR_GENERAL_PATTERN.test(target) || OBVIOUS_PROGRAMMING_PATTERN.test(target)) return false

  return (
    ZIP_PATTERN.test(target) ||
    COORDINATE_PATTERN.test(target) ||
    CITY_STATE_PATTERN.test(target) ||
    KNOWN_PLACE_TOKEN_PATTERN.test(target) ||
    CAPITALIZED_PLACE_TOKEN_PATTERN.test(target)
  )
}

export function looksAnalyticalPrompt(prompt: string): boolean {
  return ANALYTICAL_PROMPT_PATTERN.test(prompt)
}

export function hasExplicitMapControlIntent(prompt: string): boolean {
  const normalized = prompt.trim()
  if (!normalized) return false

  if (PANEL_CONTROL_PATTERN.test(normalized) || VIEW_CONTROL_PATTERN.test(normalized) || SEARCH_CONTROL_PATTERN.test(normalized)) {
    return true
  }

  if (STRONG_LAYER_CONTROL_PATTERN.test(normalized) && EXPLICIT_LAYER_OBJECT_PATTERN.test(normalized)) {
    return true
  }

  return WEAK_LAYER_CONTROL_PATTERN.test(normalized) &&
    EXPLICIT_LAYER_OBJECT_PATTERN.test(normalized) &&
    !looksAnalyticalPrompt(normalized)
}

export function classifyAgentRequestIntent(
  prompt: string,
  context: MapContext | null | undefined
): AgentIntentClassification {
  const normalized = prompt.trim()
  if (!normalized) {
    return { lane: 'blocked', reason: 'empty', message: BLOCKED_SHORT_MESSAGE }
  }

  if (normalized.startsWith('/')) {
    return {
      lane: 'blocked',
      reason: 'slash_command',
      message:
        'Slash commands are handled locally in the Scout terminal. Unknown slash commands are not sent to the AI agent.',
    }
  }

  if (ARITHMETIC_ONLY_PATTERN.test(normalized)) {
    return { lane: 'blocked', reason: 'arithmetic', message: BLOCKED_SHORT_MESSAGE }
  }

  const hasRealEstateDomain = REAL_ESTATE_DOMAIN_PATTERN.test(normalized)
  const hasScoutProductContext = SCOUT_PRODUCT_CONTEXT_PATTERN.test(normalized)
  const hasTaskIntent = EDA_INTENT_PATTERN.test(normalized) || looksAnalyticalPrompt(normalized)
  const hasContextualTask = CONTEXTUAL_REAL_ESTATE_TASK_PATTERN.test(normalized)
  const hasLocationToken =
    ZIP_PATTERN.test(normalized) || COORDINATE_PATTERN.test(normalized) || CITY_STATE_PATTERN.test(normalized)
  const hasReferentialWorkspace = hasVisibleWorkspaceContext(context) && REFERENTIAL_WORKSPACE_PATTERN.test(normalized)

  if (
    (OBVIOUS_GENERAL_FINANCE_PATTERN.test(normalized) ||
      OBVIOUS_PROGRAMMING_PATTERN.test(normalized) ||
      OBVIOUS_CASUAL_OR_GENERAL_PATTERN.test(normalized)) &&
    !hasRealEstateDomain &&
    !hasScoutProductContext
  ) {
    return { lane: 'blocked', reason: 'off_topic', message: OFF_TOPIC_CATEGORY_MESSAGE }
  }

  if (hasExplicitMapControlIntent(normalized)) return { lane: 'direct_map_control' }

  if (hasRealEstateDomain && hasTaskIntent) return { lane: 'eda' }
  if (hasScoutProductContext && (hasTaskIntent || hasContextualTask)) return { lane: 'eda' }
  if (hasReferentialWorkspace && (hasTaskIntent || /\b(why|how)\b/i.test(normalized))) return { lane: 'eda' }
  if (hasContextualTask) return { lane: 'eda' }
  if (hasLocationToken && hasTaskIntent) return { lane: 'eda' }
  if (hasPlaceAnalysisIntent(normalized)) return { lane: 'eda' }

  return { lane: 'blocked', reason: 'off_topic', message: BLOCKED_DEFAULT_MESSAGE }
}
