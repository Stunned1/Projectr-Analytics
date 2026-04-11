'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ShortlistPanel from '@/components/ShortlistPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Site } from '@/lib/sites-store'
import { cn } from '@/lib/utils'

const navBtnClass = (active: boolean) =>
  `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors border-l-2 ${
    active
      ? 'bg-[#D76B3D]/15 text-[#D76B3D] border-[#D76B3D]'
      : 'text-zinc-400 hover:text-white hover:bg-white/5 border-transparent'
  }`

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
    <aside className="w-[200px] flex-shrink-0 flex flex-col bg-[#0a0a0a] border-r border-white/8 z-20">
      <div className="px-4 py-4 border-b border-white/8">
        <Image
          src="/Projectr_Logo.png"
          alt="Projectr"
          width={120}
          height={32}
          loading="eager"
          style={{ width: 'auto', height: '32px' }}
        />
      </div>

      <div className="px-3 py-3 border-b border-white/8">
        <form onSubmit={onAnalyzeSubmit}>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
              <SearchIcon />
            </span>
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ZIP, City, ST, or Borough..."
              className={cn(
                'h-8 rounded-md pl-7 pr-3 text-xs text-white placeholder:text-zinc-600',
                'border-white/10 bg-white/5 focus-visible:border-[#D76B3D]/50 focus-visible:ring-[#D76B3D]/25'
              )}
            />
          </div>
          {error && <p className="text-red-400 text-[10px] mt-1 px-0.5">{error}</p>}
          <Button
            type="submit"
            disabled={loading}
            size="sm"
            className="mt-2 h-8 w-full rounded-md bg-[#D76B3D] text-xs font-semibold text-white hover:bg-[#c45e32] disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Analyze Market'}
          </Button>
        </form>
      </div>

      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 min-h-0">
        <NavLink href="/" icon={<MapIcon />} label="Map" />
        <NavLink href="/upload" icon={<UploadIcon />} label="Client CSV" />
        <ShortlistPanel onOpenSite={onShortlistOpenSite} />
      </nav>

      {activeMarket && (
        <div className="px-3 py-3 border-t border-white/8">
          <div
            className="bg-white/5 border border-white/8 rounded-lg p-3 cursor-pointer hover:border-[#D76B3D]/30 transition-colors"
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
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Active Market</p>
              <ChevronRight />
            </div>
            <p className="text-white text-sm font-semibold">{activeMarket.title}</p>
            <p className="text-zinc-500 text-[10px]">{activeMarket.subtitle}</p>
          </div>
        </div>
      )}
    </aside>
  )
}
