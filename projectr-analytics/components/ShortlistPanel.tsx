'use client'

import { useEffect, useState } from 'react'
import { useSitesStore } from '@/lib/sites-store'
import type { Site } from '@/lib/sites-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

function cycleBadgeClass(stage: string | undefined): string {
  if (stage === 'Expansion') return 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40'
  if (stage === 'Recovery') return 'bg-amber-500/25 text-amber-200 border-amber-500/35'
  return 'bg-red-500/20 text-red-300 border-red-500/35'
}

function SiteLabelInput({
  siteId,
  label,
}: {
  siteId: string
  label: string
}) {
  const updateLabel = useSitesStore((s) => s.updateLabel)
  const [value, setValue] = useState(label)
  useEffect(() => {
    setValue(label)
  }, [label, siteId])

  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const t = value.trim()
        if (!t) {
          setValue(label)
          return
        }
        if (t !== label) void updateLabel(siteId, t)
      }}
      className="h-6 rounded border border-sidebar-border bg-sidebar-accent/40 px-1.5 text-[11px] font-medium text-sidebar-foreground placeholder:text-muted-foreground focus-visible:border-primary"
      title="Site name — shown in PDF and map"
      aria-label="Site name"
    />
  )
}

export default function ShortlistPanel({ onOpenSite }: { onOpenSite: (site: Site) => void }) {
  const sites = useSitesStore((s) => s.sites)
  const loading = useSitesStore((s) => s.loading)
  const syncError = useSitesStore((s) => s.syncError)
  const panelOpen = useSitesStore((s) => s.shortlistPanelOpen)
  const setPanelOpen = useSitesStore((s) => s.setShortlistPanelOpen)
  const selectedForComparison = useSitesStore((s) => s.selectedForComparison)
  const toggleComparison = useSitesStore((s) => s.toggleComparison)
  const removeSite = useSitesStore((s) => s.removeSite)
  const updateNotes = useSitesStore((s) => s.updateNotes)
  const clearComparisonSelection = useSitesStore((s) => s.clearComparisonSelection)

  const compareCount = selectedForComparison.length

  return (
    <Collapsible
      open={panelOpen}
      onOpenChange={setPanelOpen}
      className="mt-1 border-t border-sidebar-border pt-2"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-between px-2 py-1.5 text-left font-normal hover:bg-sidebar-accent"
        >
          <span className="text-[10px] font-semibold tracking-wider text-sidebar-foreground/90 uppercase">
            Shortlist ({sites.length})
          </span>
          <span className="text-[10px] text-muted-foreground">{panelOpen ? '▾' : '▸'}</span>
        </Button>
      </CollapsibleTrigger>

      {syncError && (
        <p className="mt-1 px-2 text-[9px] leading-snug text-amber-500/90">{syncError}</p>
      )}

      <CollapsibleContent>
        <ScrollArea className="mt-1 max-h-[220px]">
          <div className="space-y-1 px-1 pb-2 pr-2">
            {loading && <p className="px-1 text-[10px] text-zinc-500">Loading…</p>}
            {!loading && sites.length === 0 && (
              <p className="px-1 text-[9px] leading-snug text-zinc-600">
                Add sites from the data panel; names default to the place (ZIP is only the data key).
              </p>
            )}
            {sites.map((s: Site) => (
              <div
                key={s.id}
                className="space-y-1 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-1.5"
              >
                <div className="flex items-start gap-1">
                  <Checkbox
                    checked={selectedForComparison.includes(s.id)}
                    onCheckedChange={() => toggleComparison(s.id)}
                    className="mt-1 border-sidebar-border data-checked:border-primary data-checked:bg-primary"
                    title="Include in PDF site comparison (pick 2+)"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <SiteLabelInput siteId={s.id} label={s.label} />
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="h-auto w-full justify-start p-0 text-[8px] font-normal tracking-wide text-muted-foreground hover:text-primary hover:no-underline"
                      onClick={() => onOpenSite(s)}
                    >
                      {s.isAggregate ? 'Load area' : 'Load market data'}
                      <span className="text-zinc-700">
                        {s.isAggregate && s.savedSearch?.trim()
                          ? ` · ${s.savedSearch.trim()}`
                          : ` · ZIP ${s.zip}`}
                      </span>
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="mt-0.5 shrink-0 text-[10px] text-zinc-600 hover:text-red-400"
                    onClick={() => void removeSite(s.id)}
                    title="Remove"
                  >
                    ×
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1 pl-5">
                  {(s.cycleStage || s.cyclePosition) && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-auto rounded border px-1.5 py-0.5 text-[8px] font-normal',
                        cycleBadgeClass(s.cycleStage)
                      )}
                    >
                      {s.cycleStage ?? '—'} {s.cyclePosition ?? ''}
                    </Badge>
                  )}
                  {s.momentumScore != null && (
                    <span className="text-[8px] text-zinc-400">Mom. {Math.round(s.momentumScore)}</span>
                  )}
                </div>
                <Input
                  type="text"
                  defaultValue={s.notes ?? ''}
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    const prev = (s.notes ?? '').trim()
                    if (next !== prev) void updateNotes(s.id, next)
                  }}
                  placeholder="Analyst note…"
                  className="ml-5 h-auto max-w-[calc(100%-1.25rem)] rounded border border-sidebar-border bg-sidebar-accent/50 px-1.5 py-1 text-[9px] text-sidebar-foreground/90 placeholder:text-muted-foreground focus-visible:border-primary/60"
                />
              </div>
            ))}

            {compareCount >= 2 && (
              <div className="flex items-center justify-between gap-1 px-1 pt-1">
                <p className="text-[9px] text-primary">
                  PDF site comparison: {compareCount} selected
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-auto p-0 text-[9px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => clearComparisonSelection()}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}
