import type { MapContext } from '@/lib/agent-types'
import { isNycBoroughName, isNycZip } from '@/lib/geography'

type SurfaceContext = Pick<MapContext, 'label' | 'zip'>

function normalizeLabel(label: string | null | undefined): string {
  return (label ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
}

export function isNycActiveSurface(context: SurfaceContext): boolean {
  const label = normalizeLabel(context.label)
  return isNycBoroughName(label) || isNycZip(context.zip ?? null)
}

export function buildAgentGreeting(context: SurfaceContext): string {
  if (isNycActiveSurface(context)) {
    return 'Engine ready. NYC parcel workflows are available in this market. Ask for parcels, permits, or the spatial model here, or switch back to ZIP / county / metro workflows at any time.'
  }

  return 'Engine ready. Load a ZIP, county, metro, or Texas city, or paste an analyst brief. Texas-first market workflows are the default, and NYC parcel workflows appear only when the market is in New York City.'
}

export function buildAgentStarterSuggestions(context: SurfaceContext): string[] {
  if (isNycActiveSurface(context)) {
    return [
      '/help',
      '/go Brooklyn',
      '/layers:parcels,permits',
      '/save',
      'Show parcels and permits in Brooklyn',
      'Run the spatial model for this borough',
      'Compare transit access and momentum across these ranked sites',
    ]
  }

  return [
    '/help',
    '/go 77002',
    '/go Harris County, TX',
    '/save',
    '/layers:transit,rent',
    '/clear:terminal',
    '/clear:workspace',
    'Show flood risk in Harris County, TX',
    'Transit + amenities on in Houston',
    'Compare Dallas-Fort Worth and Austin momentum',
  ]
}

export function buildAgentInputPlaceholder(context: SurfaceContext, hasUserMessage: boolean, isRunningSequence: boolean): string {
  if (isRunningSequence) return 'Sequence running…'
  if (hasUserMessage) return '_'
  if (isNycActiveSurface(context)) {
    return '/help · /go Brooklyn · /layers:parcels,permits · /restart · /clear:terminal · or ask…'
  }
  return '/help · /go 77002 · /layers:rent · /restart · /clear:terminal · or ask…'
}
