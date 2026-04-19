export type ReportTemplate = 'client' | 'internal'

export type ReportSectionKey =
  | 'executive_summary'
  | 'market_dossier'
  | 'market_data'
  | 'site_comparison'
  | 'methodology'

export interface ReportSectionSelection {
  executive_summary: boolean
  market_dossier: boolean
  market_data: boolean
  site_comparison: boolean
  methodology: boolean
}

export interface ReportConfig {
  template: ReportTemplate
  title: string | null
  subtitle: string | null
  preparedFor: string | null
  preparedBy: string | null
  analystNote: string | null
  sections: ReportSectionSelection
}

export function defaultReportSections(template: ReportTemplate): ReportSectionSelection {
  if (template === 'internal') {
    return {
      executive_summary: true,
      market_dossier: true,
      market_data: true,
      site_comparison: true,
      methodology: true,
    }
  }

  return {
    executive_summary: true,
    market_dossier: false,
    market_data: true,
    site_comparison: true,
    methodology: false,
  }
}

export function createDefaultReportConfig(
  args?: {
    template?: ReportTemplate
    title?: string | null
    subtitle?: string | null
  }
): ReportConfig {
  const template = args?.template ?? 'client'
  return {
    template,
    title: args?.title?.trim() || null,
    subtitle: args?.subtitle?.trim() || null,
    preparedFor: null,
    preparedBy: null,
    analystNote: null,
    sections: defaultReportSections(template),
  }
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeReportConfig(raw: unknown, defaults?: Partial<ReportConfig>): ReportConfig {
  const fallback = createDefaultReportConfig({
    template: defaults?.template ?? 'client',
    title: defaults?.title ?? null,
    subtitle: defaults?.subtitle ?? null,
  })
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const template = source.template === 'internal' ? 'internal' : source.template === 'client' ? 'client' : fallback.template

  const sectionDefaults = defaultReportSections(template)
  const sourceSections =
    source.sections && typeof source.sections === 'object'
      ? (source.sections as Record<string, unknown>)
      : {}

  return {
    template,
    title: cleanText(source.title) ?? defaults?.title ?? fallback.title,
    subtitle: cleanText(source.subtitle) ?? defaults?.subtitle ?? fallback.subtitle,
    preparedFor: cleanText(source.preparedFor) ?? defaults?.preparedFor ?? null,
    preparedBy: cleanText(source.preparedBy) ?? defaults?.preparedBy ?? null,
    analystNote: cleanText(source.analystNote) ?? defaults?.analystNote ?? null,
    sections: {
      executive_summary:
        typeof sourceSections.executive_summary === 'boolean'
          ? sourceSections.executive_summary
          : defaults?.sections?.executive_summary ?? sectionDefaults.executive_summary,
      market_dossier:
        typeof sourceSections.market_dossier === 'boolean'
          ? sourceSections.market_dossier
          : defaults?.sections?.market_dossier ?? sectionDefaults.market_dossier,
      market_data:
        typeof sourceSections.market_data === 'boolean'
          ? sourceSections.market_data
          : defaults?.sections?.market_data ?? sectionDefaults.market_data,
      site_comparison:
        typeof sourceSections.site_comparison === 'boolean'
          ? sourceSections.site_comparison
          : defaults?.sections?.site_comparison ?? sectionDefaults.site_comparison,
      methodology:
        typeof sourceSections.methodology === 'boolean'
          ? sourceSections.methodology
          : defaults?.sections?.methodology ?? sectionDefaults.methodology,
    },
  }
}
