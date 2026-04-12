/** Cross-route navigation: `/upload` sidebar → `/` runs the same analyze flow. */

export const PENDING_NAV_KEY = 'scout_pending_nav'

export type PendingNav =
  | { type: 'zip'; zip: string }
  | { type: 'aggregate'; query: string }
  | { type: 'coords'; lat: number; lng: number }

export function stashPendingNav(nav: PendingNav) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(PENDING_NAV_KEY, JSON.stringify(nav))
}

export function takePendingNav(): PendingNav | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(PENDING_NAV_KEY)
  if (!raw) return null
  sessionStorage.removeItem(PENDING_NAV_KEY)
  try {
    const o = JSON.parse(raw) as PendingNav
    if (o?.type === 'zip' && typeof o.zip === 'string' && /^\d{5}$/.test(o.zip.trim())) {
      return { type: 'zip', zip: o.zip.trim() }
    }
    if (o?.type === 'aggregate' && typeof o.query === 'string' && o.query.trim()) {
      return { type: 'aggregate', query: o.query.trim() }
    }
    if (
      o?.type === 'coords' &&
      typeof o.lat === 'number' &&
      typeof o.lng === 'number' &&
      Number.isFinite(o.lat) &&
      Number.isFinite(o.lng)
    ) {
      return { type: 'coords', lat: o.lat, lng: o.lng }
    }
  } catch {
    /* ignore */
  }
  return null
}
