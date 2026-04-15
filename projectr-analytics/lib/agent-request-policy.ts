export type AgentRequestPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: 'empty' | 'slash_command' | 'arithmetic' | 'off_topic'; message: string }

const BLOCKED_DEFAULT_MESSAGE =
  'I can only route Scout real estate, map, market, and uploaded-data requests to the AI agent. Try asking about a ZIP/city, sites, rents, permits, transit, demographics, layers, the current map, or uploaded CSV data.'

const BLOCKED_SHORT_MESSAGE =
  'I can only route Scout real estate, map, market, and uploaded-data requests to the AI agent. I did not run the model for this prompt.'

const OFF_TOPIC_CATEGORY_MESSAGE =
  'That looks outside Scout real estate analytics. Ask about a real estate market, site, ZIP, map layer, or uploaded dataset and I will route it to the agent.'

const ARITHMETIC_ONLY_PATTERN = /^(?:what(?:'s| is)\s+)?[\d\s+\-*/().=%]+(?:\?)?$/i

const REAL_ESTATE_DOMAIN_PATTERN =
  /\b(real estate|property|properties|parcel|parcels|site|sites|zoning|far|air rights|tax lots?|pluto|rent|rents|rental|zori|zhvi|zillow|housing|home values?|apartments?|multifamily|permit|permits|construction|development|vacancy|occupancy|absorption|demographics?|population|income|employment|labor|census|acs|fred|hud|noi|cap rate|lease|tenant|acquisition|underwriting|feasibility|comps|transit|amenit(?:y|ies)|pois?|flood|tracts?|block groups?|shortlist|saved sites?)\b/i

const SCOUT_PRODUCT_CONTEXT_PATTERN =
  /\b(current map|loaded market|loaded data|selected site|selected sites|uploaded|upload|uploads|csv|client data|map layer|map layers|layers|dashboard|shortlist|saved|data panel|analysis panel|brief|report|pdf|metrics|trend|trends|forecast|score|scoring|ranked sites?)\b/i

const TASK_INTENT_PATTERN =
  /\b(go to|load|search|navigate|fly to|show|map|plot|compare|analy[sz]e|rank|score|screen|evaluate|recommend|find|summari[sz]e|explain|visuali[sz]e|turn on|open)\b/i

const CONTEXTUAL_REAL_ESTATE_TASK_PATTERN =
  /\b(rank|score|compare|analy[sz]e|summari[sz]e|show|map|plot|find|recommend|evaluate|explain|visuali[sz]e)\b.*\b(this|these|those|current|loaded|selected|upload|uploaded|csv|sites?|markets?|areas?|locations?|zips?|layers?|data)\b/i

const ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/
const COORDINATE_PATTERN = /\b-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/
const CITY_STATE_PATTERN = /\b[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/

const PLACE_NAVIGATION_PATTERN =
  /\b(?:go to|load|search|navigate to|fly to|show|map|plot|compare|analy[sz]e|rank|score|evaluate|recommend)\s+(?:me\s+)?(.{2,140})$/i

const CAPITALIZED_PLACE_TOKEN_PATTERN = /\b[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)*\b/

const KNOWN_PLACE_TOKEN_PATTERN =
  /\b(nyc|new york|brooklyn|queens|manhattan|bronx|staten island|soho|chelsea|dallas|austin|raleigh|chicago|boston|miami|seattle|denver|atlanta|los angeles|san francisco|washington dc|philadelphia|phoenix|houston)\b/i

const OBVIOUS_GENERAL_FINANCE_PATTERN =
  /\b(stocks?|crypto|bitcoin|ethereum|bonds?|options?|earnings|nasdaq|dow jones|s&p 500)\b/i

const OBVIOUS_PROGRAMMING_PATTERN =
  /\b(javascript|typescript|python|react|next\.?js|node\.?js|css|html|data structures?|algorithm|function|class|array|object|map object|code|coding)\b/i

const OBVIOUS_CASUAL_OR_GENERAL_PATTERN =
  /\b(joke|poem|song|recipe|weather|sports?|movie|game|trivia|translate|grammar|dating|medical|doctor|legal advice)\b/i

function hasPlaceNavigationIntent(prompt: string): boolean {
  const match = prompt.match(PLACE_NAVIGATION_PATTERN)
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

export function evaluateAgentRequestPolicy(prompt: string): AgentRequestPolicyDecision {
  const normalized = prompt.trim()
  if (!normalized) {
    return { allowed: false, reason: 'empty', message: BLOCKED_SHORT_MESSAGE }
  }

  if (normalized.startsWith('/')) {
    return {
      allowed: false,
      reason: 'slash_command',
      message:
        'Slash commands are handled locally in the Scout terminal. Unknown slash commands are not sent to the AI agent.',
    }
  }

  if (ARITHMETIC_ONLY_PATTERN.test(normalized)) {
    return { allowed: false, reason: 'arithmetic', message: BLOCKED_SHORT_MESSAGE }
  }

  const hasRealEstateDomain = REAL_ESTATE_DOMAIN_PATTERN.test(normalized)
  const hasScoutProductContext = SCOUT_PRODUCT_CONTEXT_PATTERN.test(normalized)
  const hasTaskIntent = TASK_INTENT_PATTERN.test(normalized)
  const hasContextualTask = CONTEXTUAL_REAL_ESTATE_TASK_PATTERN.test(normalized)
  const hasLocationToken =
    ZIP_PATTERN.test(normalized) || COORDINATE_PATTERN.test(normalized) || CITY_STATE_PATTERN.test(normalized)

  if (
    (OBVIOUS_GENERAL_FINANCE_PATTERN.test(normalized) ||
      OBVIOUS_PROGRAMMING_PATTERN.test(normalized) ||
      OBVIOUS_CASUAL_OR_GENERAL_PATTERN.test(normalized)) &&
    !hasRealEstateDomain
  ) {
    return { allowed: false, reason: 'off_topic', message: OFF_TOPIC_CATEGORY_MESSAGE }
  }

  if (hasRealEstateDomain) return { allowed: true }
  if (hasScoutProductContext && (hasTaskIntent || hasContextualTask)) return { allowed: true }
  if (hasContextualTask) return { allowed: true }
  if (hasLocationToken && hasTaskIntent) return { allowed: true }
  if (ZIP_PATTERN.test(normalized) && normalized.length <= 10) return { allowed: true }
  if (hasPlaceNavigationIntent(normalized)) return { allowed: true }

  return { allowed: false, reason: 'off_topic', message: BLOCKED_DEFAULT_MESSAGE }
}
