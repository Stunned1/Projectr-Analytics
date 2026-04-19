const COUNTY_SUFFIX_PATTERN = /\s+county$/i

export function normalizeTexasCountyName(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return COUNTY_SUFFIX_PATTERN.test(trimmed) ? trimmed : `${trimmed} County`
}

function normalizeTexasCountyBase(value: string | null): string | null {
  const normalized = normalizeTexasCountyName(value)
  if (!normalized) return null

  const base = normalized.replace(COUNTY_SUFFIX_PATTERN, '').trim()
  return base || null
}

export function isPollutedTexasCountyName(value: string | null): boolean {
  const base = normalizeTexasCountyBase(value)
  if (!base) return false

  return /^tx$/i.test(base) || /^texas$/i.test(base)
}

export function resolveTexasCountyName(
  canonicalCountyName: string | null,
  lookupCountyName: string | null
): string | null {
  const canonical = normalizeTexasCountyName(canonicalCountyName)
  if (canonical) return canonical

  const lookup = normalizeTexasCountyName(lookupCountyName)
  if (!lookup || isPollutedTexasCountyName(lookup)) return null

  return lookup
}
