import type { AgentAction, AgentTrace, MapContext } from '@/lib/agent-types'
import {
  ANALYTICAL_PROMPT_PATTERN_SOURCE,
  hasExplicitMapControlIntent,
  looksAnalyticalPrompt,
} from '@/lib/agent-intent'
import { looksLikeCountyQuery } from '@/lib/area-keys'
import { splitTrailingUsState } from '@/lib/us-state-abbr'

type LayerAlias = {
  key: string
  patterns: RegExp[]
  metric?: 'zori' | 'zhvi'
}

const LAYER_ALIASES: LayerAlias[] = [
  { key: 'rentChoropleth', metric: 'zori', patterns: [/\brent\b/i, /\brents\b/i, /\bzori\b/i] },
  { key: 'rentChoropleth', metric: 'zhvi', patterns: [/\bhome value\b/i, /\bhome values\b/i, /\bzhvi\b/i, /\bvalue layer\b/i] },
  { key: 'transitStops', patterns: [/\btransit\b/i, /\bstops\b/i] },
  { key: 'tracts', patterns: [/\btracts\b/i, /\bdemographics?\b/i] },
  { key: 'parcels', patterns: [/\bparcels?\b/i, /\blots?\b/i, /\bpluto\b/i] },
  { key: 'permits', patterns: [/\bpermits?\b/i, /\bbuilding permits?\b/i, /\bconstruction permits?\b/i] },
  { key: 'floodRisk', patterns: [/\bflood\b/i, /\bflood risk\b/i] },
  { key: 'momentum', patterns: [/\bmomentum\b/i] },
  { key: 'pois', patterns: [/\bpois?\b/i, /\bamenities\b/i, /\bamenity\b/i] },
  { key: 'amenityHeatmap', patterns: [/\bheatmap\b/i, /\bamenity heatmap\b/i] },
  { key: 'clientData', patterns: [/\bclient data\b/i, /\bimported data\b/i, /\buploaded data\b/i, /\bcsv\b/i] },
  { key: 'zipBoundary', patterns: [/\bboundary\b/i, /\bzip boundary\b/i] },
]

export const MAP_CONTROL_LAYER_KEYS = [...new Set(LAYER_ALIASES.map((alias) => alias.key))]

const STRONG_LAYER_CONTROL_PATTERN = /\b(turn on|turn off|hide|disable|enable)\b/i
const WEAK_LAYER_CONTROL_PATTERN = /\b(show|display|open)\b/i
const SEARCH_CONTROL_PATTERN = new RegExp(
  String.raw`\b(?:take me to|go to|load|search(?: for)?|navigate to|fly to|zoom to|center on)\s+(.+?)(?=(?:\s*[,;:!?-]?\s*(?:and\s+then|then|and)\s+|\s*[,;:!?-]\s*|\s+)(?:${ANALYTICAL_PROMPT_PATTERN_SOURCE})\b|$)`,
  'i'
)
const TRAILING_SEARCH_CONNECTOR_PATTERN = /(?:\s*[,;:!?-]?\s*(?:and\s+then|then|and))$/i
const LEADING_SEARCH_NOISE_PATTERN = /^(?:please\s+|pls\s+|can you\s+|could you\s+|would you\s+|let's\s+|lets\s+)/i
const TRAILING_SEARCH_NOISE_PATTERN = /(?:\s+(?:please|pls|thanks|thank you|for me|if you can|when you can|right now))+$/

export function humanizeLayerKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bpois\b/i, 'POIs')
    .replace(/\bzip\b/i, 'ZIP')
    .toLowerCase()
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

export function normalizeMapSearchQuery(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[.,;:!?]+$/g, '')
    .replace(LEADING_SEARCH_NOISE_PATTERN, '')
    .replace(TRAILING_SEARCH_NOISE_PATTERN, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!cleaned) return ''
  if (/^\d{5}(?:-\d{4})?$/.test(cleaned)) return cleaned

  const parsed = splitTrailingUsState(cleaned)
  const baseName = (parsed.name || cleaned).trim().replace(/[,\s]+$/g, '')
  const normalizedPlace = looksLikeCountyQuery(baseName)
    ? titleCaseWords(baseName.replace(/\s+county$/i, '')) + ' County'
    : titleCaseWords(baseName)

  return parsed.stateAbbr ? `${normalizedPlace}, ${parsed.stateAbbr}` : normalizedPlace
}

function buildControlTrace(summary: string, evidence: string): AgentTrace {
  return {
    summary,
    methodology: 'Matched the prompt against Scout’s bounded map-control commands. No autonomous planning or open-ended agent loop was used.',
    keyFindings: [summary],
    evidence: [evidence],
    caveats: ['This map-control lane only handles direct actions like search, layer toggles, view changes, or opening a panel.'],
    nextQuestions: ['Ask for EDA on the loaded market or imported dataset if you want interpretation instead of a UI action.'],
  }
}

function actionWithMetric(action: AgentAction, metric?: 'zori' | 'zhvi'): AgentAction {
  if (!metric) return action
  return { ...action, metric }
}

function extractSearchQuery(prompt: string): string | null {
  const match = prompt.match(SEARCH_CONTROL_PATTERN)
  if (!match) return null
  const query = (match[1] ?? '')
    .trim()
    .replace(TRAILING_SEARCH_CONNECTOR_PATTERN, '')
    .replace(TRAILING_SEARCH_NOISE_PATTERN, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim()
  return query || null
}

function layerControlResponse(prompt: string): { message: string; action: AgentAction; trace: AgentTrace } | null {
  const turnOff = /\b(turn off|hide|disable|remove)\b/i.test(prompt)
  const turnOn = /\b(turn on|show|enable|display|open)\b/i.test(prompt)
  if (!turnOff && !turnOn) return null

  const matches = LAYER_ALIASES.filter((alias) => alias.patterns.some((pattern) => pattern.test(prompt)))
  if (matches.length === 0) return null
  const hasStrongControlVerb = STRONG_LAYER_CONTROL_PATTERN.test(prompt)
  if (!hasStrongControlVerb && looksAnalyticalPrompt(prompt)) return null
  if (!hasStrongControlVerb && !WEAK_LAYER_CONTROL_PATTERN.test(prompt)) return null

  const layers = Object.fromEntries(matches.map((alias) => [alias.key, turnOff ? false : true]))
  const metric = matches.find((alias) => alias.metric)?.metric
  const layerNames = Object.keys(layers).join(', ')
  const humanLayerNames = Object.keys(layers).map((key) => humanizeLayerKey(key)).join(', ')

  return {
    message: `${turnOff ? 'Turning off' : 'Turning on'} ${humanLayerNames}.`,
    action: actionWithMetric({ type: 'toggle_layers', layers }, metric),
    trace: buildControlTrace(
      `${turnOff ? 'Hide' : 'Show'} ${humanLayerNames}`,
      `Matched layer aliases: ${layerNames}${metric ? ` with ${metric.toUpperCase()} as the fill metric.` : '.'}`
    ),
  }
}

function panelControlResponse(prompt: string): { message: string; action: AgentAction; trace: AgentTrace } | null {
  if (/\bdata panel\b/i.test(prompt) || /\bopen data\b/i.test(prompt)) {
    return {
      message: 'Opening the data panel.',
      action: { type: 'focus_data_panel' },
      trace: buildControlTrace('Open data panel', 'Matched a direct request to open the market/data panel.'),
    }
  }

  if (/\banalysis panel\b/i.test(prompt) || /\bopen analysis\b/i.test(prompt)) {
    return {
      message: 'Opening the analysis panel.',
      action: { type: 'generate_memo' },
      trace: buildControlTrace('Open analysis panel', 'Matched a direct request to open the analysis panel.'),
    }
  }

  return null
}

function viewControlResponse(prompt: string): { message: string; action: AgentAction; trace: AgentTrace } | null {
  const tiltMatch = prompt.match(/\btilt\s+(\d{1,2})\b/i)
  if (tiltMatch) {
    const tilt = Math.max(0, Math.min(60, Number(tiltMatch[1])))
    return {
      message: `Setting map tilt to ${tilt}°.`,
      action: { type: 'set_tilt', tilt },
      trace: buildControlTrace('Set map tilt', `Matched explicit tilt control at ${tilt}°.`),
    }
  }

  if (/\b3d\b/i.test(prompt) || /\btilt\b/i.test(prompt)) {
    return {
      message: 'Switching the map to a 3D tilt.',
      action: { type: 'set_tilt', tilt: 45 },
      trace: buildControlTrace('Switch to 3D view', 'Matched a direct request for 3D map tilt.'),
    }
  }

  if (/\b2d\b/i.test(prompt) || /\bflat map\b/i.test(prompt)) {
    return {
      message: 'Flattening the map to 2D.',
      action: { type: 'set_tilt', tilt: 0 },
      trace: buildControlTrace('Switch to 2D view', 'Matched a direct request for a flat 2D map view.'),
    }
  }

  return null
}

function searchControlResponse(prompt: string, context: MapContext | null | undefined): { message: string; action: AgentAction; trace: AgentTrace } | null {
  const query = normalizeMapSearchQuery(extractSearchQuery(prompt) ?? '')
  if (!query || looksAnalyticalPrompt(query)) return null

  const activeLabel = context?.label?.trim().toLowerCase() ?? ''
  if (activeLabel && activeLabel === query.toLowerCase()) {
    return {
      message: `${query} is already the active market.`,
      action: { type: 'none' },
      trace: buildControlTrace('Active market already loaded', `The prompt requested ${query}, which matches the current active geography.`),
    }
  }

  return {
    message: `Navigating to ${query}.`,
    action: { type: 'search', query },
    trace: buildControlTrace('Navigate to market', `Matched an explicit search/navigation request for ${query}.`),
  }
}

export function inferDirectMapControl(
  prompt: string,
  context: MapContext | null | undefined
): { message: string; action: AgentAction; trace: AgentTrace } | null {
  if (!hasExplicitMapControlIntent(prompt)) return null

  return (
    panelControlResponse(prompt) ??
    viewControlResponse(prompt) ??
    layerControlResponse(prompt) ??
    searchControlResponse(prompt, context)
  )
}

export function inferNavigationTarget(prompt: string): string | null {
  return extractSearchQuery(prompt)
}
