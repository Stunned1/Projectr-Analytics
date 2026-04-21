'use client'

import { Trash2 } from 'lucide-react'

import { ScoutChartCard } from '@/components/ScoutChartCard'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSavedChartsStore } from '@/lib/saved-charts-store'

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return 'Saved recently'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function SavedChartsPanel({ className }: { className?: string }) {
  const outputs = useSavedChartsStore((state) => state.outputs)
  const removeOutput = useSavedChartsStore((state) => state.removeOutput)

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border/80 bg-card/30">
        <div className="space-y-3 p-3 pr-4">
          {outputs.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              No outputs saved yet. Save a terminal chart, companion card, or imported site snapshot and it will appear here in this session.
            </p>
          ) : (
            outputs.map((record) => (
              <div key={record.id} className="space-y-2 rounded-lg border border-border bg-muted/20 p-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                      {record.kind === 'chart'
                        ? 'Saved chart'
                        : record.kind === 'stat_card'
                          ? 'Saved companion'
                          : record.kind === 'places_context'
                            ? 'Saved nearby context'
                            : 'Saved site snapshot'}
                    </p>
                    <p className="text-sm leading-snug text-foreground">
                      {record.kind === 'chart'
                        ? record.payload.title
                        : record.kind === 'stat_card'
                          ? record.payload.title
                          : record.kind === 'permit_detail'
                            ? record.payload.title
                            : record.payload.siteLabel}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>{formatSavedAt(record.savedAt)}</span>
                      {record.marketLabel?.trim() ? <span>Market: {record.marketLabel.trim()}</span> : null}
                    </div>
                  </div>
                </div>

                {record.kind === 'chart' ? (
                  <ScoutChartCard
                    chart={record.payload}
                    actions={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeOutput(record.id)}
                        aria-label="Remove saved output"
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={2} />
                      </Button>
                    }
                  />
                ) : (
                  <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                    {record.kind === 'stat_card' ? (
                      <>
                        {record.payload.summary ? <p className="text-xs text-muted-foreground">{record.payload.summary}</p> : null}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {record.payload.stats.map((stat) => (
                            <div key={stat.label} className="rounded-md bg-muted/50 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                              <p className="text-sm font-semibold text-foreground">{stat.value}</p>
                              {stat.sublabel ? <p className="text-[10px] text-muted-foreground">{stat.sublabel}</p> : null}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {record.kind === 'uploaded_pin' ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {record.payload.lat.toFixed(5)}, {record.payload.lng.toFixed(5)}
                        </p>
                        {record.payload.sourceLabel ? <p className="mt-1 text-xs text-muted-foreground">Source: {record.payload.sourceLabel}</p> : null}
                      </>
                    ) : null}
                    {record.kind === 'places_context' ? (
                      <p className="text-xs text-muted-foreground">{record.payload.summary}</p>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeOutput(record.id)}
                        aria-label="Remove saved output"
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={2} />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
