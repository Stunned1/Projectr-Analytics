'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CommandCenterSidebar from '@/components/CommandCenterSidebar'
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
          <h1 className="text-base font-semibold tracking-tight text-foreground">Saved sites</h1>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Sites and areas you save from the map appear here. Use the sidebar search to jump to a ZIP or city on the map.
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <ShortlistPanel onOpenSite={goMapWithPending} className="h-full" />
        </main>
      </div>
    </div>
  )
}
