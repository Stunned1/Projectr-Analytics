'use client'

import { useState, useCallback, useMemo } from 'react'
import type { CycleAnalysis } from '@/lib/cycle/types'
import type { ClientReportPayload, ClientReportPin, MapLayersSnapshot } from '@/lib/report/types'
import {
  buildClientReportPayloadFromAggregate,
  buildClientReportPayloadFromZip,
  type AggregateShape,
  type CityZipShape,
  type TrendsShape,
  type ZipMarketShape,
} from '@/lib/report/build-client-payload'
import {
  createDefaultReportConfig,
  defaultReportSections,
  type ReportConfig,
  type ReportTemplate,
} from '@/lib/report/config'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type BuildResult = { ok: true; payload: ClientReportPayload } | { ok: false; reason: string }

interface MarketReportExportProps {
  mapLayersSnapshot: MapLayersSnapshot
  uploadedMarkers: Array<{ lat: number; lng: number; label: string; value: number | null }> | null
  comparisonPins?: ClientReportPin[] | null
  result: ZipMarketShape | null
  aggregateData: AggregateShape | null
  cityZips: CityZipShape[] | null
  trends: TrendsShape | null
  cycleAnalysis?: CycleAnalysis | null
}

function ReportSectionToggle({
  id,
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (next: boolean) => void
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${disabled ? 'border-white/5 bg-white/5 opacity-50' : 'border-white/10 bg-white/5'}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onCheckedChange(Boolean(next))}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor={id} className="text-xs font-semibold text-white">
            {label}
          </Label>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{description}</p>
        </div>
      </div>
    </div>
  )
}

export default function MarketReportExport({
  mapLayersSnapshot,
  uploadedMarkers,
  comparisonPins = null,
  result,
  aggregateData,
  cityZips,
  trends,
  cycleAnalysis = null,
}: MarketReportExportProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reportConfig, setReportConfig] = useState<ReportConfig>(() =>
    createDefaultReportConfig({ template: 'client' })
  )

  const buildPayload = useCallback((): BuildResult => {
    const fromUpload = (uploadedMarkers ?? []).map((m) => ({
      lat: m.lat,
      lng: m.lng,
      label: m.label,
      value: m.value,
    }))
    const pins: ClientReportPin[] =
      comparisonPins && comparisonPins.length >= 2 ? comparisonPins : fromUpload

    if (result) {
      return {
        ok: true,
        payload: buildClientReportPayloadFromZip({
          result,
          trends,
          layers: mapLayersSnapshot,
          pins,
          cycleAnalysis,
        }),
      }
    }
    if (aggregateData) {
      return {
        ok: true,
        payload: buildClientReportPayloadFromAggregate({
          aggregate: aggregateData,
          cityZips,
          layers: mapLayersSnapshot,
          pins,
          trends,
          cycleAnalysis,
        }),
      }
    }
    return {
      ok: false,
      reason: 'Run a ZIP, county, metro, or city search first. NYC boroughs also work when you need borough-specific analysis.',
    }
  }, [aggregateData, cityZips, comparisonPins, cycleAnalysis, mapLayersSnapshot, result, trends, uploadedMarkers])

  const payloadPreview = useMemo(() => {
    const built = buildPayload()
    return built.ok ? built.payload : null
  }, [buildPayload])

  const comparisonAvailable = (payloadPreview?.pins.length ?? 0) >= 2
  const selectedSectionCount = Object.values(reportConfig.sections).filter(Boolean).length

  const openBuilder = useCallback(() => {
    setError(null)
    const built = buildPayload()
    if (!built.ok) {
      setError(built.reason)
      return
    }

    const base = built.payload.reportConfig
    setReportConfig((current) => ({
      ...base,
      template: current.template,
      title: current.title ?? base.title,
      subtitle: current.subtitle ?? base.subtitle,
      preparedFor: current.preparedFor,
      preparedBy: current.preparedBy,
      analystNote: current.analystNote,
      sections: {
        ...defaultReportSections(current.template),
        ...current.sections,
        site_comparison: comparisonAvailable ? current.sections.site_comparison : false,
      },
    }))
    setDialogOpen(true)
  }, [buildPayload, comparisonAvailable])

  const setTemplate = useCallback((template: ReportTemplate) => {
    setReportConfig((current) => ({
      ...current,
      template,
      sections: {
        ...defaultReportSections(template),
        site_comparison: comparisonAvailable ? current.sections.site_comparison : false,
      },
    }))
  }, [comparisonAvailable])

  const downloadPdf = useCallback(async () => {
    setError(null)
    if (selectedSectionCount === 0) {
      setError('Select at least one report section before exporting.')
      return
    }

    const built = buildPayload()
    if (!built.ok) {
      setError(built.reason)
      return
    }

    const payload: ClientReportPayload = {
      ...built.payload,
      reportConfig: {
        ...reportConfig,
        sections: {
          ...reportConfig.sections,
          site_comparison: comparisonAvailable ? reportConfig.sections.site_comparison : false,
        },
      },
    }

    setLoading(true)
    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(typeof j.error === 'string' ? j.error : 'PDF generation failed')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const label = payload.marketLabel.replace(/[^\w\s-]/g, '').trim().slice(0, 48) || 'brief'
      const templateLabel = payload.reportConfig.template === 'internal' ? 'Internal' : 'Client'
      a.download = `Scout-${templateLabel}-${label}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setDialogOpen(false)
    } catch {
      setError('Network error while generating PDF')
    } finally {
      setLoading(false)
    }
  }, [buildPayload, comparisonAvailable, reportConfig, selectedSectionCount])

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={openBuilder}
          disabled={loading || (!result && !aggregateData)}
          className="w-full flex items-center justify-center gap-2 bg-white/8 hover:bg-white/12 border border-white/12 text-white text-xs font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-40"
        >
          {loading ? (
            <>
              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              Building PDF...
            </>
          ) : (
            <>Build Report PDF</>
          )}
        </button>
        {error && <p className="text-red-400 text-[10px]">{error}</p>}
        <p className="text-zinc-600 text-[9px] leading-relaxed">
          Configure a client-facing brief or an internal memo, choose which sections to include, and then export the PDF.
        </p>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl border-white/10 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle>Build Report PDF</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Choose the audience, adjust the title block, and include only the pages this deliverable needs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Template</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  {
                    key: 'client',
                    label: 'Client Brief',
                    description: 'Cleaner presentation with fewer methodology pages by default.',
                  },
                  {
                    key: 'internal',
                    label: 'Internal Memo',
                    description: 'Deeper detail, dossier, methodology, and analyst-facing context.',
                  },
                ] as const).map((option) => {
                  const active = reportConfig.template === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setTemplate(option.key)}
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        active
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20'
                      }`}
                    >
                      <p className="text-sm font-semibold text-white">{option.label}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{option.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="report-title" className="text-[11px] text-zinc-300">Report title</Label>
                <Input
                  id="report-title"
                  value={reportConfig.title ?? ''}
                  onChange={(event) => setReportConfig((current) => ({ ...current, title: event.target.value || null }))}
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-subtitle" className="text-[11px] text-zinc-300">Subtitle</Label>
                <Input
                  id="report-subtitle"
                  value={reportConfig.subtitle ?? ''}
                  onChange={(event) => setReportConfig((current) => ({ ...current, subtitle: event.target.value || null }))}
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prepared-for" className="text-[11px] text-zinc-300">Prepared for</Label>
                <Input
                  id="prepared-for"
                  value={reportConfig.preparedFor ?? ''}
                  onChange={(event) => setReportConfig((current) => ({ ...current, preparedFor: event.target.value || null }))}
                  placeholder={reportConfig.template === 'client' ? 'Client name or deal team' : 'Investment committee'}
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prepared-by" className="text-[11px] text-zinc-300">Prepared by</Label>
                <Input
                  id="prepared-by"
                  value={reportConfig.preparedBy ?? ''}
                  onChange={(event) => setReportConfig((current) => ({ ...current, preparedBy: event.target.value || null }))}
                  placeholder="Analyst or team name"
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="analyst-note" className="text-[11px] text-zinc-300">Analyst note</Label>
              <textarea
                id="analyst-note"
                value={reportConfig.analystNote ?? ''}
                onChange={(event) => setReportConfig((current) => ({ ...current, analystNote: event.target.value || null }))}
                placeholder={
                  reportConfig.template === 'client'
                    ? 'Optional note to show on the cover or executive page.'
                    : 'Optional internal memo note, recommendation, or review comment.'
                }
                className="min-h-20 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Sections</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ReportSectionToggle
                  id="section-executive"
                  label="Executive Summary"
                  description="Opening page with cycle read, summary narrative, and key context."
                  checked={reportConfig.sections.executive_summary}
                  onCheckedChange={(next) =>
                    setReportConfig((current) => ({
                      ...current,
                      sections: { ...current.sections, executive_summary: next },
                    }))
                  }
                />
                <ReportSectionToggle
                  id="section-dossier"
                  label="Market Dossier"
                  description="Long-form AI narrative with peer read, risks, opportunities, and scenarios."
                  checked={reportConfig.sections.market_dossier}
                  onCheckedChange={(next) =>
                    setReportConfig((current) => ({
                      ...current,
                      sections: { ...current.sections, market_dossier: next },
                    }))
                  }
                />
                <ReportSectionToggle
                  id="section-data"
                  label="Market Data"
                  description="Benchmark table plus trend and permit charts."
                  checked={reportConfig.sections.market_data}
                  onCheckedChange={(next) =>
                    setReportConfig((current) => ({
                      ...current,
                      sections: { ...current.sections, market_data: next },
                    }))
                  }
                />
                <ReportSectionToggle
                  id="section-comparison"
                  label="Site Comparison"
                  description="Ranks saved or uploaded sites when at least two pins are available."
                  checked={reportConfig.sections.site_comparison}
                  disabled={!comparisonAvailable}
                  onCheckedChange={(next) =>
                    setReportConfig((current) => ({
                      ...current,
                      sections: { ...current.sections, site_comparison: next },
                    }))
                  }
                />
                <ReportSectionToggle
                  id="section-methodology"
                  label="Methodology"
                  description="Definitions, confidence, and source notes for internal review."
                  checked={reportConfig.sections.methodology}
                  onCheckedChange={(next) =>
                    setReportConfig((current) => ({
                      ...current,
                      sections: { ...current.sections, methodology: next },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter className="border-white/10 bg-white/5">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={loading}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Building...' : 'Export PDF'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
