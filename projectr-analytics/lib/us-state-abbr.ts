/**
 * Normalize user-typed US state (full name, "N.J.", or 2-letter) to USPS abbreviation.
 */

const NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
}

const VALID_USPS_STATE = new Set(Object.values(NAME_TO_ABBR))

/**
 * Returns a 2-letter USPS code, or null if the string is not a recognizable US state.
 */
export function normalizeUsStateToAbbr(raw: string): string | null {
  const t = raw.trim().replace(/\./g, '').replace(/\s+/g, ' ')
  if (!t) return null
  if (/^[a-z]{2}$/i.test(t)) {
    const u = t.toUpperCase()
    return VALID_USPS_STATE.has(u) ? u : null
  }
  const key = t.toLowerCase()
  return NAME_TO_ABBR[key] ?? null
}
