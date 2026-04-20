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
  const charts = useSavedChartsStore((state) => state.charts)
  const removeChart = useSavedChartsStore((state) => state.removeChart)

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border/80 bg-card/30">
        <div className="space-y-3 p-3 pr-4">
          {charts.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              No charts saved yet. Generate a terminal chart, click <strong className="text-foreground">Save chart</strong>, and it will appear here in this session.
            </p>
          ) : (
            charts.map((record) => (
              <div key={record.id} className="space-y-2 rounded-lg border border-border bg-muted/20 p-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Saved chart</p>
                    <p className="text-sm leading-snug text-foreground">{record.prompt}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>{formatSavedAt(record.savedAt)}</span>
                      {record.marketLabel?.trim() ? <span>Market: {record.marketLabel.trim()}</span> : null}
                    </div>
                  </div>
                </div>

                <ScoutChartCard
                  chart={record.chart}
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeChart(record.id)}
                      aria-label="Remove saved chart"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={2} />
                    </Button>
                  }
                />
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
