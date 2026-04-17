export type AreaKind = 'county' | 'metro'

const AREA_KEY_ALIASES: Record<string, string[]> = {
  'metro:TX:houston-the-woodlands-sugar-land': ['metro:TX:houston-pasadena-the-woodlands'],
  'metro:TX:houston-pasadena-the-woodlands': ['metro:TX:houston-the-woodlands-sugar-land'],
}

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

export function expandAreaKeyCandidates(areaKey: string): string[] {
  const trimmed = areaKey.trim()
  if (!trimmed) return []
  return Array.from(new Set([trimmed, ...(AREA_KEY_ALIASES[trimmed] ?? [])]))
}

export function looksLikeCountyQuery(value: string): boolean {
  return /\bcounty\b/i.test(value)
}

/**
 * Narrow heuristic to avoid an extra `/api/city` round trip for obvious metro queries.
 * We intentionally keep this conservative: if we guess wrong, the client still falls back to city.
 */
export function looksLikeMetroQuery(value: string): boolean {
  const normalized = normalizeMetroDisplayName(value)
  if (!normalized) return false
  if (/\bmetro(?:\s+area)?\b/i.test(value)) return true
  const segments = normalized
    .split(/[-/]|(?:\s+and\s+)/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
  return segments.length >= 2
}
