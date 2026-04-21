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

  return 'EDA assistant ready. Ask for summaries, outliers, trends, comparisons, or data-quality checks on the loaded market or imported CSV.'
}

export function buildAgentStarterSuggestions(context: SurfaceContext): string[] {
  const label = context.label?.trim() || context.zip?.trim() || 'this market'
  return dedupeSuggestions([
    '/help',
    `Summarize ${label} and highlight rent, vacancy, and income`,
    'Analyze rent and vacancy in Harris County, TX',
  ])
}

// export function buildAgentInputPlaceholder(context: SurfaceContext, hasUserMessage: boolean, isRunningSequence: boolean): string {
//   if (isRunningSequence) return 'Action running…'
//   if (hasUserMessage) return '_'
//   const uploadMode = activeImportedVisualization(context)
//   if (uploadMode === 'map') {
//     return 'Summarize the imported dataset · find outliers in the mapped rows · or use /help…'
//   }
//   if (uploadMode === 'chart' || uploadMode === 'table') {
//     return 'Summarize the imported dataset · explain the sidebar/chart fallback · or use /help…'
//   }
//   if (isNycActiveSurface(context)) {
//     return 'Summarize this market · find outliers in the upload · turn on parcels and permits · or use /help…'
//   }
//   return 'Summarize this market · explain a metric · find outliers in the upload · or use /help…'
// }
