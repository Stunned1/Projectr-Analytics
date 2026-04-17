import type { MapContext } from '@/lib/agent-types'
import { isNycBoroughName, isNycZip } from '@/lib/geography'

type SurfaceContext = MapContext

function normalizeLabel(label: string | null | undefined): string {
  return (label ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
}

function activeImportedVisualization(context: SurfaceContext): 'map' | 'chart' | 'table' | null {
  const datasets = context.clientCsv?.datasets ?? []
  if (datasets.some((dataset) => dataset.visualizationMode === 'map')) return 'map'
  if (datasets.some((dataset) => dataset.visualizationMode === 'chart')) return 'chart'
  if (datasets.some((dataset) => dataset.visualizationMode === 'table')) return 'table'
  return null
}

function dedupeSuggestions(lines: string[]): string[] {
  return [...new Set(lines)]
}

export function isNycActiveSurface(context: SurfaceContext): boolean {
  const label = normalizeLabel(context.label)
  return isNycBoroughName(label) || isNycZip(context.zip ?? null)
}

export function buildAgentGreeting(context: SurfaceContext): string {
  const uploadMode = activeImportedVisualization(context)
  if (uploadMode === 'map') {
    return 'EDA assistant ready. An imported dataset is active with mapped rows, so you can inspect the upload, compare it with the loaded market, or use explicit prompts for direct map controls.'
  }
  if (uploadMode === 'chart' || uploadMode === 'table') {
    return 'EDA assistant ready. An imported dataset is active in sidebar fallback mode, so ask for summaries, outliers, trends, or data-quality checks on that upload, and use explicit prompts if you want direct map controls.'
  }

  if (isNycActiveSurface(context)) {
    return 'EDA assistant ready. Analyze the loaded market or imported dataset, and use explicit prompts for direct map controls like parcels, permits, search, or panel changes.'
  }

  return 'EDA assistant ready. Ask for summaries, outliers, trends, comparisons, or data-quality checks on the loaded market or imported CSV. Direct map controls still work when you ask for them explicitly.'
}

export function buildAgentStarterSuggestions(context: SurfaceContext): string[] {
  const uploadMode = activeImportedVisualization(context)
  const uploadSuggestions =
    uploadMode === 'map'
      ? [
          'Summarize the imported dataset',
          'Find outliers in the mapped upload',
          'Explain why these rows map',
        ]
      : uploadMode === 'chart'
        ? [
            'Summarize the imported dataset',
            'Explain the trend in the uploaded chart',
            'Why is this dataset using a sidebar fallback?',
          ]
        : uploadMode === 'table'
          ? [
              'Summarize the imported dataset',
              'Check data quality in the uploaded table',
              'Why is this dataset not on the map?',
            ]
          : []

  if (isNycActiveSurface(context)) {
    return dedupeSuggestions([
      ...uploadSuggestions,
      '/help',
      '/go Brooklyn',
      '/layers:parcels,permits',
      '/save',
      'Summarize the loaded market',
      'Find outliers in the imported CSV',
      'Explain what parcels and permits are showing here',
      'Turn on parcels and permits',
    ])
  }

  return dedupeSuggestions([
    ...uploadSuggestions,
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
  ])
}

export function buildAgentInputPlaceholder(context: SurfaceContext, hasUserMessage: boolean, isRunningSequence: boolean): string {
  if (isRunningSequence) return 'Action running…'
  if (hasUserMessage) return '_'
  const uploadMode = activeImportedVisualization(context)
  if (uploadMode === 'map') {
    return 'Summarize the imported dataset · find outliers in the mapped rows · or use /help…'
  }
  if (uploadMode === 'chart' || uploadMode === 'table') {
    return 'Summarize the imported dataset · explain the sidebar/chart fallback · or use /help…'
  }
  if (isNycActiveSurface(context)) {
    return 'Summarize this market · find outliers in the upload · turn on parcels and permits · or use /help…'
  }
  return 'Summarize this market · explain a metric · find outliers in the upload · or use /help…'
}
