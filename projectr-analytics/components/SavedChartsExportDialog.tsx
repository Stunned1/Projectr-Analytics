'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScoutChartCard } from '@/components/ScoutChartCard'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSavedChartsStore } from '@/lib/saved-charts-store'

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return 'Saved recently'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

interface SavedChartsExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestedTitle: string
}

export default function SavedChartsExportDialog({
  open,
  onOpenChange,
  suggestedTitle,
}: SavedChartsExportDialogProps) {
  const charts = useSavedChartsStore((state) => state.charts)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [title, setTitle] = useState(suggestedTitle)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedIds(charts.map((chart) => chart.id))
    setTitle((current) => current.trim() || suggestedTitle)
    setError(null)
  }, [open, charts, suggestedTitle])

  const selectedCharts = useMemo(() => {
    const selected = new Set(selectedIds)
    return charts.filter((chart) => selected.has(chart.id))
  }, [charts, selectedIds])

  function toggleChart(id: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((value) => value !== id)
    })
  }

  async function handleExport() {
    setError(null)
    if (selectedCharts.length === 0) {
      setError('Choose at least one saved chart before exporting.')
      return
    }

    const cleanTitle = title.trim() || suggestedTitle
    setLoading(true)
    try {
      const res = await fetch('/api/report/charts/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          notes,
          generatedAt: new Date().toISOString(),
          charts: selectedCharts.map((chart) => ({
            id: chart.id,
            prompt: chart.prompt,
            marketLabel: chart.marketLabel ?? null,
            savedAt: chart.savedAt,
            chart: chart.chart,
          })),
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'PDF export failed.')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${cleanTitle.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'Scout-export'}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      onOpenChange(false)
    } catch {
      setError('Network error while building the PDF export.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[min(96vw,1320px)] max-w-[min(96vw,1320px)] flex-col overflow-hidden p-0 sm:max-w-[min(96vw,1320px)]"
        showCloseButton
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>Export saved charts</DialogTitle>
          <DialogDescription>
            Choose the saved charts you want to include, add reader notes, then download a PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-hidden gap-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
          <section className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-6 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Saved charts</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {charts.length === 0
                    ? 'No charts are saved in this session yet.'
                    : `${selectedCharts.length} of ${charts.length} charts selected`}
                </p>
              </div>
              {charts.length > 0 ? (
                <div className="flex gap-2">
                  <Button type="button" size="xs" variant="outline" onClick={() => setSelectedIds(charts.map((chart) => chart.id))}>
                    Select all
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setSelectedIds([])}>
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>

            <ScrollArea className="min-h-0 flex-1 px-6 pb-6">
              <div className="pr-4">
                {charts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
                    Save at least one terminal chart first, then run <span className="font-semibold text-foreground">/export</span>.
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {charts.map((chart) => {
                      const checked = selectedIds.includes(chart.id)
                      return (
                        <label
                          key={chart.id}
                          className={`flex h-full min-h-0 cursor-pointer flex-col rounded-xl border p-4 transition-colors ${
                            checked
                              ? 'border-primary/60 bg-primary/5'
                              : 'border-border/80 bg-card/40 hover:border-primary/40 hover:bg-muted/20'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox checked={checked} onCheckedChange={(value) => toggleChart(chart.id, value === true)} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold leading-snug text-foreground">{chart.chart.title}</p>
                                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{chart.prompt}</p>
                                </div>
                                <span className="rounded-full border border-border/80 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {chart.chart.kind === 'line' ? 'Trend chart' : 'Comparison chart'}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                <span>{formatSavedAt(chart.savedAt)}</span>
                                {chart.marketLabel?.trim() ? <span>Market: {chart.marketLabel.trim()}</span> : null}
                              </div>
                            </div>
                          </div>

                          <ScoutChartCard
                            chart={chart.chart}
                            className="mt-4 border-border/70 bg-[#111114]/80 p-3"
                            showHeader={false}
                            showSources={false}
                            chartHeightClass="h-44"
                          />
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-primary">
                  Report title
                </label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={suggestedTitle}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
                  maxLength={120}
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-primary">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add a short plain-English summary or instructions for whoever will read this PDF."
                  className="h-full min-h-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors focus:border-primary/50"
                  maxLength={4000}
                />
                <p className="mt-2 text-[10px] text-muted-foreground">
                  The PDF will use your notes as a reader-facing summary on the cover page.
                </p>
              </div>
            </div>
          </aside>
        </div>

        <DialogFooter
          className="mx-0 mb-0 shrink-0 rounded-none border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          showCloseButton={false}
        >
          <div className="min-w-0">
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pick the charts you want to include, then export a clean PDF for sharing.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleExport}
              disabled={loading || charts.length === 0 || selectedCharts.length === 0}
            >
              {loading ? 'Building PDF...' : 'Export PDF'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
