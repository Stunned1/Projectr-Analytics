'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CommandCenterSidebar from '@/components/CommandCenterSidebar'
import SavedChartsPanel from '@/components/SavedChartsPanel'
import ShortlistPanel from '@/components/ShortlistPanel'
import SitesBootstrap from '@/components/SitesBootstrap'
import { stashPendingNav } from '@/lib/pending-navigation'
import { MAP_VIEW_SAVE_ZIP } from '@/lib/saved-viewport'
import type { Site } from '@/lib/sites-store'

export default function SavedPage() {
  const router = useRouter()
  const [sidebarSearch, setSidebarSearch] = useState('')

  function goMapWithPending(site: Site) {
    if (site.zip === MAP_VIEW_SAVE_ZIP) {
      stashPendingNav({ type: 'coords', lat: site.lat, lng: site.lng })
    } else if (site.isAggregate && site.savedSearch?.trim()) {
      stashPendingNav({ type: 'aggregate', query: site.savedSearch.trim() })
    } else if (/^\d{5}$/.test(site.zip)) {
      stashPendingNav({ type: 'zip', zip: site.zip })
    }
    router.push('/')
  }

  async function handleSidebarAnalyze(e: React.FormEvent) {
    e.preventDefault()
    const input = sidebarSearch.trim()
    if (!input) return
    if (/^\d{5}$/.test(input)) stashPendingNav({ type: 'zip', zip: input })
    else stashPendingNav({ type: 'aggregate', query: input })
    router.push('/')
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <SitesBootstrap />
      <CommandCenterSidebar
        searchInput={sidebarSearch}
        setSearchInput={setSidebarSearch}
        error={null}
        loading={false}
        onAnalyzeSubmit={handleSidebarAnalyze}
        activeMarket={null}
        panelOpen={false}
        onTogglePanel={() => router.push('/')}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border/60">
        <header className="shrink-0 border-b border-border bg-muted/20 px-5 py-3">
          <p className="text-[10px] font-semibold tracking-widest text-primary uppercase">Workspace</p>
          <h1 className="text-base font-semibold tracking-tight text-foreground">Saved workspace</h1>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Sites and areas you save from the map, plus terminal charts you save from the assistant, appear here. Use the sidebar search to jump to a ZIP, county, metro, or city on the map.
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-5 py-4 xl:overflow-hidden">
          <div className="grid min-h-full gap-4 xl:h-full xl:min-h-0 xl:grid-cols-2">
            <section className="flex min-h-[24rem] flex-col gap-3 xl:min-h-0">
              <div>
                <h2 className="text-[10px] font-semibold tracking-widest text-primary uppercase">Saved Sites</h2>
                <p className="mt-1 text-xs text-muted-foreground">ZIPs, areas, and map views you can reopen or compare later.</p>
              </div>
              <ShortlistPanel onOpenSite={goMapWithPending} className="min-h-[20rem] flex-1 xl:min-h-0" />
            </section>

            <section className="flex min-h-[24rem] flex-col gap-3 xl:min-h-0">
              <div>
                <h2 className="text-[10px] font-semibold tracking-widest text-primary uppercase">Saved Charts</h2>
                <p className="mt-1 text-xs text-muted-foreground">Terminal charts persist for the current session and can be removed here.</p>
              </div>
              <SavedChartsPanel className="min-h-[20rem] flex-1 xl:min-h-0" />
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
