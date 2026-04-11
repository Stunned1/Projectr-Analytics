'use client'

import { useEffect, useState } from 'react'
import { useSitesStore } from '@/lib/sites-store'
import type { Site } from '@/lib/sites-store'

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
    <input
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
      className="w-full bg-black/30 border border-white/15 rounded px-1.5 py-0.5 text-[11px] text-white font-medium focus:outline-none focus:border-[#D76B3D]/50"
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
    <div className="border-t border-white/8 mt-1 pt-2">
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">
          Shortlist ({sites.length})
        </span>
        <span className="text-zinc-500 text-[10px]">{panelOpen ? '▾' : '▸'}</span>
      </button>

      {syncError && <p className="text-[9px] text-amber-500/90 px-2 mt-1 leading-snug">{syncError}</p>}

      {panelOpen && (
        <div className="mt-1 max-h-[220px] overflow-y-auto px-1 pb-2 space-y-1">
          {loading && <p className="text-[10px] text-zinc-500 px-1">Loading…</p>}
          {!loading && sites.length === 0 && (
            <p className="text-[9px] text-zinc-600 px-1 leading-snug">
              Add sites from the data panel; names default to the place (ZIP is only the data key).
            </p>
          )}
          {sites.map((s: Site) => (
            <div
              key={s.id}
              className="rounded-md border border-white/10 bg-white/[0.03] p-1.5 space-y-1"
            >
              <div className="flex items-start gap-1">
                <input
                  type="checkbox"
                  checked={selectedForComparison.includes(s.id)}
                  onChange={() => toggleComparison(s.id)}
                  className="mt-1 rounded border-white/20 flex-shrink-0"
                  title="Include in PDF site comparison (pick 2+)"
                />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <SiteLabelInput siteId={s.id} label={s.label} />
                  <button
                    type="button"
                    onClick={() => onOpenSite(s)}
                    className="text-[8px] text-zinc-600 hover:text-[#D76B3D] tracking-wide text-left w-full"
                  >
                    {s.isAggregate ? 'Load area' : 'Load market data'}
                    <span className="text-zinc-700">
                      {s.isAggregate && s.savedSearch?.trim()
                        ? ` · ${s.savedSearch.trim()}`
                        : ` · ZIP ${s.zip}`}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void removeSite(s.id)}
                  className="text-zinc-600 hover:text-red-400 text-[10px] px-1 flex-shrink-0 mt-0.5"
                  title="Remove"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-1 flex-wrap pl-5">
                {(s.cycleStage || s.cyclePosition) && (
                  <span className={`text-[8px] px-1.5 py-0.5 rounded border ${cycleBadgeClass(s.cycleStage)}`}>
                    {s.cycleStage ?? '—'} {s.cyclePosition ?? ''}
                  </span>
                )}
                {s.momentumScore != null && (
                  <span className="text-[8px] text-zinc-400">Mom. {Math.round(s.momentumScore)}</span>
                )}
              </div>
              <input
                type="text"
                defaultValue={s.notes ?? ''}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  const prev = (s.notes ?? '').trim()
                  if (next !== prev) void updateNotes(s.id, next)
                }}
                placeholder="Analyst note…"
                className="w-full ml-5 max-w-[calc(100%-1.25rem)] bg-black/40 border border-white/10 rounded text-[9px] text-zinc-300 placeholder:text-zinc-600 px-1.5 py-1 focus:outline-none focus:border-[#D76B3D]/40"
              />
            </div>
          ))}

          {compareCount >= 2 && (
            <div className="pt-1 px-1 flex items-center justify-between gap-1">
              <p className="text-[9px] text-[#D76B3D]">
                PDF site comparison: {compareCount} selected
              </p>
              <button
                type="button"
                onClick={() => clearComparisonSelection()}
                className="text-[9px] text-zinc-500 hover:text-zinc-300"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
