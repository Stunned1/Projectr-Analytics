'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import ShortlistPanel from '@/components/ShortlistPanel'
import { Input } from '@/components/ui/input'
import type { Site } from '@/lib/sites-store'
import { cn } from '@/lib/utils'
import { BookOpen } from 'lucide-react'

const SIDEBAR_EXPANDED_PX = 200
const SIDEBAR_COLLAPSED_PX = 48

const navBtnClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
    active ? 'text-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
  )

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const pathname = usePathname()
  const active =
    href === '/'
      ? pathname === '/' || pathname === ''
      : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link href={href} className={navBtnClass(active)}>
      <span className="h-4 w-4 flex-shrink-0">{icon}</span>
      <span className="font-medium tracking-wide">{label}</span>
    </Link>
  )
}

function NavLinkCollapsed({ href, icon, title }: { href: string; icon: React.ReactNode; title: string }) {
  const pathname = usePathname()
  const active =
    href === '/'
      ? pathname === '/' || pathname === ''
      : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        'mx-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
        active ? 'text-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
      )}
    >
      {icon}
    </Link>
  )
}

const MapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
)

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const CollapseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
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
  /** Optional content below active market subtitle (e.g. cycle stage on the map page). */
  activeMarketExtra?: ReactNode
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
  activeMarketExtra,
}: CommandCenterSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className="z-20 flex flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_EXPANDED_PX }}
    >
      <div
        className={cn(
          'flex min-h-[56px] items-center border-b border-sidebar-border px-2 py-3',
          collapsed ? 'justify-center' : 'justify-between gap-2'
        )}
      >
        {!collapsed && (
          <Image
            src="/Projectr_Logo.png"
            alt="Projectr"
            width={120}
            height={32}
            loading="eager"
            style={{ width: 'auto', height: '28px' }}
          />
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>
      </div>

      {collapsed ? (
        <div className="border-b border-sidebar-border py-1">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex h-10 w-full items-center justify-center text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Search"
          >
            <SearchIcon />
          </button>
        </div>
      ) : (
        <div className="border-b border-sidebar-border px-3 py-3">
          <form onSubmit={onAnalyzeSubmit}>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">
                <SearchIcon />
              </span>
              {loading && (
                <span
                  className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
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
                placeholder="Enter ZIP, City, ST, or Borough"
                className={cn(
                  'h-8 rounded-md border-input bg-input/40 pl-7 text-xs text-sidebar-foreground placeholder:text-muted-foreground',
                  'focus-visible:border-primary focus-visible:ring-primary/25',
                  loading ? 'pr-9' : 'pr-3',
                  loading && 'opacity-60'
                )}
              />
            </div>
            {error && <p className="mt-1 px-0.5 text-[10px] text-red-400">{error}</p>}
          </form>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!collapsed && (
          <div className="space-y-0.5 border-b border-sidebar-border px-2 py-2">
            <NavLink href="/" icon={<MapIcon />} label="Map" />
            <NavLink href="/upload" icon={<UploadIcon />} label="Upload CSV" />
            <NavLink href="/guide" icon={<BookOpen className="h-4 w-4" strokeWidth={1.5} />} label="Guide" />
          </div>
        )}

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {collapsed ? (
            <div className="flex flex-col gap-1">
              <NavLinkCollapsed href="/" icon={<MapIcon />} title="Map" />
              <NavLinkCollapsed href="/upload" icon={<UploadIcon />} title="CSV upload" />
              <NavLinkCollapsed
                href="/guide"
                icon={<BookOpen className="h-4 w-4" strokeWidth={1.5} />}
                title="Guide"
              />
            </div>
          ) : (
            <ShortlistPanel onOpenSite={onShortlistOpenSite} />
          )}
        </nav>

        {activeMarket && (
          <div
            className={cn(
              'flex-shrink-0 border-t border-sidebar-border py-2',
              collapsed ? 'flex justify-center px-1' : 'px-3 py-3'
            )}
          >
            {collapsed ? (
              <button
                type="button"
                onClick={onTogglePanel}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                  panelOpen
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-sidebar-border bg-sidebar-accent/40 text-muted-foreground hover:border-primary/40 hover:text-sidebar-foreground'
                )}
                title={`${activeMarket.title} - toggle data panel`}
              >
                <MapIcon />
              </button>
            ) : (
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
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[9px] tracking-widest text-muted-foreground uppercase">Active Market</p>
                  <ChevronRight />
                </div>
                <p className="text-sm font-semibold text-sidebar-foreground">{activeMarket.title}</p>
                <p className="text-[10px] text-muted-foreground">{activeMarket.subtitle}</p>
                {activeMarketExtra}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
