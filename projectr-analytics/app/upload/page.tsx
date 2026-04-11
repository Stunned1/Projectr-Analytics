'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AgenticNormalizer from '@/components/AgenticNormalizer'
import { ClearLocalWorkspaceButton } from '@/components/clear-local-workspace-button'
import CommandCenterSidebar from '@/components/CommandCenterSidebar'
import SitesBootstrap from '@/components/SitesBootstrap'
import { useClientUploadMarkersStore } from '@/lib/client-upload-markers-store'
import { stashPendingNav } from '@/lib/pending-navigation'
import type { Site } from '@/lib/sites-store'

export default function ClientUploadPage() {
  const router = useRouter()
  const [searchInput, setSearchInput] = useState('')
  const markers = useClientUploadMarkersStore((s) => s.markers)
  const clearMarkers = useClientUploadMarkersStore((s) => s.clearMarkers)

  function goMapWithPending(site: Site) {
    if (site.isAggregate && site.savedSearch?.trim()) {
      stashPendingNav({ type: 'aggregate', query: site.savedSearch.trim() })
    } else if (/^\d{5}$/.test(site.zip)) {
      stashPendingNav({ type: 'zip', zip: site.zip })
    }
    router.push('/')
  }

  async function handleAnalyzeFromUpload(e: React.FormEvent) {
    e.preventDefault()
    const input = searchInput.trim()
    if (!input) return
    if (/^\d{5}$/.test(input)) stashPendingNav({ type: 'zip', zip: input })
    else stashPendingNav({ type: 'aggregate', query: input })
    router.push('/')
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <SitesBootstrap />
      <CommandCenterSidebar
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        error={null}
        loading={false}
        onAnalyzeSubmit={handleAnalyzeFromUpload}
        activeMarket={null}
        panelOpen={false}
        onTogglePanel={() => router.push('/')}
        onShortlistOpenSite={goMapWithPending}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg space-y-6 px-6 py-10">
          <div>
            <h1 className="text-2xl font-bold text-white">Client CSV</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Gemini classifies each file. <span className="text-zinc-300">Geospatial</span> rows (lat/lng or ZIP) become
              orange <span className="text-zinc-300">3D cone pins</span> on the map when you enable the Client layer.
              <span className="text-zinc-300"> Temporal</span> and <span className="text-zinc-300">tabular</span> sets
              route to the map page <span className="text-zinc-300">Data</span> tab and ingest into your metrics pipeline.
            </p>
          </div>
          <AgenticNormalizer />
          {markers != null && markers.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{markers.length}</span> pin{markers.length === 1 ? '' : 's'}{' '}
                ready — turn on <span className="text-primary">Client</span> on the map
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="rounded-lg border border-primary/35 bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20"
                >
                  Open map
                </button>
                <button
                  type="button"
                  onClick={() => clearMarkers()}
                  className="rounded border border-border px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  Clear pins
                </button>
              </div>
            </div>
          )}
          <ClearLocalWorkspaceButton variant="panel" />
        </div>
      </main>
    </div>
  )
}
