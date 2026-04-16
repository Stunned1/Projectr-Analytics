export type AreaKind = 'county' | 'metro'

function normalizeAreaSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function stripTrailingStateSuffix(value: string): string {
  return value.replace(/\s*,\s*[A-Z]{2}$/i, '').trim()
}

export function normalizeCountyDisplayName(value: string): string {
  const trimmed = stripTrailingStateSuffix(value).replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return /county$/i.test(trimmed) ? trimmed : `${trimmed} County`
}

export function normalizeMetroDisplayName(value: string): string {
  return stripTrailingStateSuffix(value)
    .replace(/\s+metro(?:\s+area)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildCountyAreaKey(countyName: string, stateAbbr: string): string {
  const county = normalizeAreaSegment(normalizeCountyDisplayName(countyName))
  const state = stateAbbr.trim().toUpperCase().slice(0, 2)
  return `county:${state}:${county}`
}

export function buildMetroAreaKey(metroName: string, stateAbbr?: string | null): string {
  const metro = normalizeAreaSegment(normalizeMetroDisplayName(metroName))
  const state = stateAbbr?.trim().toUpperCase().slice(0, 2)
  return state ? `metro:${state}:${metro}` : `metro:${metro}`
}

export function looksLikeCountyQuery(value: string): boolean {
  return /\bcounty\b/i.test(value)
}
