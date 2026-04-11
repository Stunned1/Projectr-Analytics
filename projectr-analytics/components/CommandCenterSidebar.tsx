'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ShortlistPanel from '@/components/ShortlistPanel'
import { Input } from '@/components/ui/input'
import type { Site } from '@/lib/sites-store'
import { cn } from '@/lib/utils'

const navBtnClass = (active: boolean) =>
  cn(
    'w-full flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors rounded-lg',
    active
      ? 'border-primary bg-primary/15 text-primary'
      : 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
  )

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const pathname = usePathname()
  const active = pathname === href || (href === '/' && (pathname === '/' || pathname === ''))
  return (
    <Link href={href} className={navBtnClass(active)}>
      <span className="w-4 h-4 flex-shrink-0">{icon}</span>
      <span className="font-medium tracking-wide">{label}</span>
    </Link>
  )
}

const MapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export type CommandCenterActiveMarket =
  | { kind: 'zip'; title: string; subtitle: string }
  | { kind: 'aggregate'; title: string; subtitle: string }

export type CommandCenterSidebarProps = {
  searchInput: string
  setSearchInput: (v: string) => void
  error: string | null
  loading: boolean
  onAnalyzeSubmit: (e: React.FormEvent) => void | Promise<void>
  activeMarket: CommandCenterActiveMarket | null
  panelOpen: boolean
  onTogglePanel: () => void
  onShortlistOpenSite: (site: Site) => void
}

export default function CommandCenterSidebar({
  searchInput,
  setSearchInput,
  error,
  loading,
  onAnalyzeSubmit,
  activeMarket,
  panelOpen,
  onTogglePanel,
  onShortlistOpenSite,
}: CommandCenterSidebarProps) {
  return (
    <aside className="z-20 flex w-[240px] flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <Image
          src="/Projectr_Logo.png"
          alt="Projectr"
          width={120}
          height={32}
          loading="eager"
          style={{ width: 'auto', height: '32px' }}
        />
      </div>

      <div className="border-b border-sidebar-border px-3 py-3">
        <form onSubmit={onAnalyzeSubmit}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">
              <SearchIcon />
            </span>
            {loading && (
              <span
                className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-primary"
                aria-label="Loading"
              >
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-90"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </span>
            )}
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              disabled={loading}
              placeholder="ZIP, City, ST, or Borough — Enter"
              className={cn(
                'h-8 rounded-md border-input bg-input/40 pl-7 text-xs text-sidebar-foreground placeholder:text-muted-foreground',
                'focus-visible:border-primary focus-visible:ring-primary/25',
                loading ? 'pr-9' : 'pr-3',
                loading && 'opacity-60'
              )}
            />
          </div>
          {error && <p className="text-red-400 text-[10px] mt-1 px-0.5">{error}</p>}
        </form>
      </div>

      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 min-h-0">
        <NavLink href="/" icon={<MapIcon />} label="Map" />
        <NavLink href="/upload" icon={<UploadIcon />} label="Client CSV" />
        <ShortlistPanel onOpenSite={onShortlistOpenSite} />
      </nav>

      {activeMarket && (
        <div className="border-t border-sidebar-border px-3 py-3">
          <div
            className="cursor-pointer rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3 transition-colors hover:border-primary/40"
            onClick={onTogglePanel}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onTogglePanel()
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] tracking-widest text-muted-foreground uppercase">Active Market</p>
              <ChevronRight />
            </div>
            <p className="text-sm font-semibold text-sidebar-foreground">{activeMarket.title}</p>
            <p className="text-[10px] text-muted-foreground">{activeMarket.subtitle}</p>
          </div>
        </div>
      )}
    </aside>
  )
}
