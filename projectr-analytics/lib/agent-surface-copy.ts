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
    return 'EDA assistant ready. Analyze the loaded market or imported dataset, and use explicit prompts for direct map controls like parcels, permits, search, or panel changes.'
  }

  return 'EDA assistant ready. Ask for summaries, outliers, trends, comparisons, or data-quality checks on the loaded market or imported CSV. Direct map controls still work when you ask for them explicitly.'
}

export function buildAgentStarterSuggestions(context: SurfaceContext): string[] {
  if (isNycActiveSurface(context)) {
    return [
      '/help',
      '/go Brooklyn',
      '/layers:parcels,permits',
      '/save',
      'Summarize the loaded market',
      'Find outliers in the imported CSV',
      'Explain what parcels and permits are showing here',
      'Turn on parcels and permits',
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
    'Summarize the loaded market',
    'Find outliers in the imported CSV',
    'Explain this rent and vacancy snapshot',
    'Turn on flood risk and transit',
    'Open the data panel',
  ]
}

export function buildAgentInputPlaceholder(context: SurfaceContext, hasUserMessage: boolean, isRunningSequence: boolean): string {
  if (isRunningSequence) return 'Action running…'
  if (hasUserMessage) return '_'
  if (isNycActiveSurface(context)) {
    return 'Summarize this market · find outliers in the upload · turn on parcels and permits · or use /help…'
  }
  return 'Summarize this market · explain a metric · find outliers in the upload · or use /help…'
}
