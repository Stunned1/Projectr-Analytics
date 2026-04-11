/**
 * Analyst-facing Documentation: metric glossary layout, search helpers, and shared layout constants.
 */

import { METRIC_DEFINITIONS, type MetricKey } from '@/lib/metric-definitions'

/** Right data panel width on the map (`app/page.tsx`). */
export const RIGHT_PANEL_WIDTH_PX = 360

/** Stop words stripped from Documentation search so phrases like "what is ZORI" match on "zori". */
const Documentation_SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'need',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'what',
  'which',
  'who',
  'whom',
  'this',
  'that',
  'these',
  'those',
  'am',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'its',
  'our',
  'their',
  'and',
  'but',
  'if',
  'or',
  'because',
  'until',
  'while',
  'although',
  'though',
  'about',
  'against',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'also',
  'any',
  'both',
  'per',
  'via',
])

/**
 * Tokens used for Documentation search: punctuation-insensitive, stop words removed when possible.
 * Falls back to unstopped tokens if the query would otherwise be empty (e.g. only "to").
 */
export function parseDocumentationSearchQuery(query: string): string[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return []
  const tokens = raw.match(/[\p{L}\p{N}]+/gu)
  if (!tokens?.length) return []

  const significant = tokens.filter((t) => t.length >= 2 && !Documentation_SEARCH_STOP_WORDS.has(t))
  if (significant.length > 0) return significant

  const shortOk = tokens.filter((t) => t.length >= 2)
  if (shortOk.length > 0) return shortOk

  return tokens
}

/** True if every search token appears in `text` (case-insensitive). */
export function textMatchesDocumentationSearch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const blob = text.toLowerCase()
  const terms = parseDocumentationSearchQuery(query)
  if (terms.length === 0) return true
  return terms.every((t) => blob.includes(t))
}

/** Analyst-readable update cadence (not technical pipeline detail). */
export const ANALYST_METRIC_CADENCE: Record<MetricKey, string> = {
  zori: 'Monthly Zillow Research release',
  zhvi: 'Monthly Zillow Research release',
  zhvf: 'Monthly Zillow Research release',
  vacancy: 'ACS 5-year estimate; new vintages yearly, typically ~2-year lag vs today',
  medianGrossRent: 'ACS 5-year estimate; new vintages yearly, typically ~2-year lag',
  fmr: 'HUD Fair Market Rent annual; may fall back to ACS where noted',
  migration: 'ACS 5-year estimate; new vintages yearly',
  permits: 'Census BPS county annual; subject to revision',
  permitBuildings: 'Census BPS county annual; subject to revision',
  permitValue: 'Census BPS county annual; subject to revision',
  population: 'ACS 5-year estimate; new vintages yearly',
  income: 'ACS 5-year estimate; new vintages yearly',
  housingUnits: 'ACS 5-year estimate; new vintages yearly',
  vacantUnits: 'ACS 5-year estimate; new vintages yearly',
  popGrowth3yr: 'Derived from ACS population across vintages (see tooltip for caveats)',
  employmentRate: 'FRED county series; monthly when both series align',
  unemploymentRate: 'FRED county series; monthly',
  gdp: 'FRED county real GDP; annual',
  dozPending: 'Zillow metro velocity; monthly',
  priceCuts: 'Zillow metro velocity; monthly',
  inventory: 'Zillow metro velocity; monthly',
  trends: 'Google Trends; weekly relative index (0–100)',
  transit: 'Fetched when you load a market (OSM / GTFS context)',
  momentum: 'Computed when you expand Momentum (peers depend on market context)',
  cycleClassifier: 'Computed when you load a market from cached rent, vacancy, permits, jobs signals',
  cycleRecovery: 'Same cadence as cycle position (classifier output)',
  cycleExpansion: 'Same cadence as cycle position (classifier output)',
  cycleHypersupply: 'Same cadence as cycle position (classifier output)',
  cycleRecession: 'Same cadence as cycle position (classifier output)',
}

export function metricSearchBlob(key: MetricKey): string {
  const d = METRIC_DEFINITIONS[key]
  const cadence = ANALYST_METRIC_CADENCE[key]
  const extra = d.calculation ? ` ${d.calculation}` : ''
  return [d.label, d.short, d.long, d.source, cadence, extra].join(' ')
}

export const ANALYST_REFERENCE_CATEGORIES: { title: string; keys: MetricKey[] }[] = [
  {
    title: 'Market Pricing',
    keys: ['zori', 'zhvi', 'zhvf', 'dozPending', 'priceCuts', 'inventory'],
  },
  {
    title: 'Demographics',
    keys: [
      'population',
      'income',
      'housingUnits',
      'vacantUnits',
      'vacancy',
      'medianGrossRent',
      'migration',
      'popGrowth3yr',
      'fmr',
    ],
  },
  {
    title: 'Economic Indicators',
    keys: ['unemploymentRate', 'employmentRate', 'gdp', 'permits', 'permitBuildings', 'permitValue', 'transit', 'trends'],
  },
  {
    title: 'Cycle Signals',
    keys: ['cycleClassifier', 'cycleRecovery', 'cycleExpansion', 'cycleHypersupply', 'cycleRecession', 'momentum'],
  },
]
