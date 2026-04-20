'use client'

import { useState } from 'react'
import { useSitesStore } from '@/lib/sites-store'
import type { Site } from '@/lib/sites-store'
import { MAP_VIEW_SAVE_ZIP } from '@/lib/saved-viewport'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Pencil } from 'lucide-react'

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

  return (
    <Input
      key={`${siteId}:${label}`}
      type="text"
      defaultValue={label}
      onBlur={(e) => {
        const t = e.target.value.trim()
        if (!t) {
          e.target.value = label
          return
        }
        if (t !== label) void updateLabel(siteId, t)
      }}
      className="h-6 rounded border border-border bg-muted/40 px-1.5 text-[11px] font-medium text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
      title="Site name - shown in PDF and map"
      aria-label="Site name"
    />
  )
}

function SiteNotesPencil({ siteId, notes }: { siteId: string; notes: string | null }) {
  const updateNotes = useSitesStore((s) => s.updateNotes)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(notes ?? '')

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="mt-0.5 h-6 w-6 shrink-0 text-zinc-500 hover:text-primary"
        title={notes?.trim() ? `Note: ${notes}` : 'Add analyst note'}
        onClick={() => {
          setValue(notes ?? '')
          setOpen(true)
        }}
      >
        <Pencil className="h-3 w-3" strokeWidth={2} />
      </Button>
    )
  }

  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const next = value.trim()
        const prev = (notes ?? '').trim()
        if (next !== prev) void updateNotes(siteId, next)
        setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setValue(notes ?? '')
          setOpen(false)
        }
      }}
      placeholder="Analyst note…"
      className="mt-0.5 h-7 max-w-[140px] rounded border border-border bg-muted/50 px-1.5 text-[9px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60"
      autoFocus
    />
  )
}

export default function ShortlistPanel({
  onOpenSite,
  className,
}: {
  onOpenSite: (site: Site) => void
  /** e.g. `min-h-0 flex-1` on the Saved page */
  className?: string
}) {
  const sites = useSitesStore((s) => s.sites)
  const loading = useSitesStore((s) => s.loading)
  const syncError = useSitesStore((s) => s.syncError)
  const selectedForComparison = useSitesStore((s) => s.selectedForComparison)
  const toggleComparison = useSitesStore((s) => s.toggleComparison)
  const removeSite = useSitesStore((s) => s.removeSite)
  const clearComparisonSelection = useSitesStore((s) => s.clearComparisonSelection)

  const compareCount = selectedForComparison.length

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      {syncError && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
          {syncError}
        </p>
      )}

      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border/80 bg-card/30">
        <div className="space-y-1 p-3 pr-4">
          {loading && <p className="px-1 text-sm text-muted-foreground">Loading…</p>}
          {!loading && sites.length === 0 && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Nothing saved yet. Load a market on the map, then use <strong className="text-foreground">Save Site</strong>,{' '}
              <strong className="text-foreground">Save area</strong> in the right data panel, or the terminal command{' '}
              <strong className="text-foreground">/save</strong>.
            </p>
          )}
          {sites.map((s: Site) => {
            const isMapBookmark = s.zip === MAP_VIEW_SAVE_ZIP
            return (
            <div
              key={s.id}
              className="space-y-1 rounded-lg border border-border bg-muted/20 p-2"
            >
              <div className="flex items-start gap-1">
                <Checkbox
                  checked={selectedForComparison.includes(s.id)}
                  onCheckedChange={() => toggleComparison(s.id)}
                  className="mt-1 border-border data-checked:border-primary data-checked:bg-primary"
                  title="Include in PDF site comparison (pick 2+)"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <SiteLabelInput siteId={s.id} label={s.label} />
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="h-auto w-full justify-start p-0 text-[11px] font-normal text-muted-foreground hover:text-primary hover:no-underline"
                    onClick={() => onOpenSite(s)}
                  >
                    {isMapBookmark ? 'Open map view' : s.isAggregate ? 'Open area on map' : 'Open ZIP on map'}
                    <span className="text-muted-foreground/80">
                      {isMapBookmark
                        ? ` · ${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}`
                        : s.isAggregate && s.savedSearch?.trim()
                          ? ` · ${s.savedSearch.trim()}`
                          : ` · ZIP ${s.zip}`}
                    </span>
                  </Button>
                </div>
                <SiteNotesPencil siteId={s.id} notes={s.notes ?? null} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
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
                      'h-auto rounded border px-1.5 py-0.5 text-[9px] font-normal',
                      cycleBadgeClass(s.cycleStage)
                    )}
                  >
                    {s.cycleStage ?? '-'} {s.cyclePosition ?? ''}
                  </Badge>
                )}
                {s.momentumScore != null && (
                  <span className="text-[9px] text-muted-foreground">Mom. {Math.round(s.momentumScore)}</span>
                )}
              </div>
            </div>
            )
          })}

          {compareCount >= 2 && (
            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
              <p className="text-xs font-medium text-primary">PDF site comparison: {compareCount} selected</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => clearComparisonSelection()}
              >
                Clear selection
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
