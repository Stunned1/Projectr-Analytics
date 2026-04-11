'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Search } from 'lucide-react'
import CommandCenterSidebar from '@/components/CommandCenterSidebar'
import SitesBootstrap from '@/components/SitesBootstrap'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
  Documentation_FEATURES,
  Documentation_FEATURES_SECTION_SEARCH_BLOB,
  Documentation_METRICS_INTRO_SEARCH_BLOB,
  Documentation_NEW_USERS_SEARCH_BLOB,
  getDocumentationDocOutline,
  metricCategoryAnchorId,
  type DocumentationFeatureBlock,
  type DocumentationOutlineNode,
} from '@/lib/guide-content'
import {
  ANALYST_METRIC_CADENCE,
  ANALYST_REFERENCE_CATEGORIES,
  metricSearchBlob,
  textMatchesDocumentationSearch,
} from '@/lib/analyst-guide'
import type { MetricKey } from '@/lib/metric-definitions'
import { METRIC_DEFINITIONS } from '@/lib/metric-definitions'
import { stashPendingNav } from '@/lib/pending-navigation'
import type { Site } from '@/lib/sites-store'
import { cn } from '@/lib/utils'

function flattenOutlineIds(nodes: DocumentationOutlineNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    out.push(n.id)
    if (n.children) {
      for (const c of n.children) out.push(c.id)
    }
  }
  return out
}

function DocumentationOutlineNav({
  outline,
  activeId,
  onJump,
}: {
  outline: DocumentationOutlineNode[]
  activeId: string
  onJump: (id: string) => void
}) {
  return (
    <nav aria-label="Outline" className="space-y-5">
      <p className="text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">Outline</p>
      <ul className="space-y-4">
        {outline.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onJump(node.id)}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
                'hover:bg-muted/80 hover:text-foreground',
                activeId === node.id ? 'bg-primary/12 text-primary' : 'text-foreground/80'
              )}
            >
              {node.label}
            </button>
            {node.children && node.children.length > 0 ? (
              <ul className="mt-1.5 ml-1 space-y-0.5 border-l border-border/70 py-0.5 pl-2.5">
                {node.children.map((ch) => (
                  <li key={ch.id}>
                    <button
                      type="button"
                      onClick={() => onJump(ch.id)}
                      className={cn(
                        'w-full rounded px-1.5 py-1 text-left text-[11px] leading-snug transition-colors',
                        'hover:bg-muted/60 hover:text-foreground',
                        activeId === ch.id ? 'font-medium text-primary' : 'text-foreground/65'
                      )}
                    >
                      {ch.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  )
}

function DocSectionTitle({
  id,
  children,
  kicker,
}: {
  id?: string
  children: ReactNode
  kicker?: string
}) {
  return (
    <div id={id} className="scroll-mt-6">
      {kicker ? (
        <p className="mb-1.5 text-[10px] font-semibold tracking-[0.2em] text-primary uppercase">{kicker}</p>
      ) : null}
      <h2 className="border-l-4 border-primary pl-3 text-base font-semibold tracking-tight text-foreground">{children}</h2>
    </div>
  )
}

function MetricBlock({ metricKey }: { metricKey: MetricKey }) {
  const d = METRIC_DEFINITIONS[metricKey]
  const cadence = ANALYST_METRIC_CADENCE[metricKey]
  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <div className="rounded-r-md border border-border/80 border-l-4 border-l-primary/55 bg-muted/20 py-3 pr-3 pl-3.5">
        <h4 className="text-sm font-semibold text-foreground">{d.label}</h4>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{d.short}</p>
        <dl className="mt-3 grid gap-1 text-xs text-foreground/80">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 font-medium text-primary/90">Source</dt>
            <dd>{d.source}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 font-medium text-primary/90">Updates</dt>
            <dd>{cadence}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function renderFeatureBody(f: DocumentationFeatureBlock): ReactNode {
  if (f.id === 'feature-data-panel') {
    const m = f.body.match(/^Analysis:\s*([\s\S]+?)\nData:\s*([\s\S]+)$/)
    if (m) {
      return (
        <div className="space-y-2">
          <p>
            <span className="font-semibold text-primary">Analysis: </span>
            {m[1].trim()}
          </p>
          <p>
            <span className="font-semibold text-primary">Data: </span>
            {m[2].trim()}
          </p>
        </div>
      )
    }
  }
  const paras = f.body.split(/\n\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return (
    <>
      {paras.map((para, i) => (
        <p key={i} className={paras.length > 1 && i > 0 ? 'mt-2' : ''}>
          {para}
        </p>
      ))}
    </>
  )
}

function FeatureCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6 rounded-lg border border-border/90 bg-muted/15 p-4 shadow-sm">
      <h3 className="text-[11px] font-semibold tracking-wider text-primary uppercase">{title}</h3>
      <div className="mt-2.5 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  )
}

function FeaturesSection({ blocks }: { blocks: DocumentationFeatureBlock[] }) {
  return (
    <section className="scroll-mt-6">
      <DocSectionTitle id="features" kicker="Capabilities">
        Available Features
      </DocSectionTitle>
      <p className="mt-3 text-sm text-foreground/75">
        Everything below is available in the command center and related pages; there are no scripted walkthroughs.
      </p>
      <div className="mt-6 space-y-4">
        {blocks.map((f) => (
          <FeatureCard key={f.id} id={f.id} title={f.title}>
            {renderFeatureBody(f)}
          </FeatureCard>
        ))}
      </div>
    </section>
  )
}

export default function DocumentationPage() {
  const router = useRouter()
  const mainRef = useRef<HTMLElement>(null)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [docSearch, setDocSearch] = useState('')
  const [forNewUsersOpen, setForNewUsersOpen] = useState(true)
  const [outlineActiveId, setOutlineActiveId] = useState('new-users')

  const outline = useMemo(() => getDocumentationDocOutline(), [])
  const outlineIds = useMemo(() => flattenOutlineIds(outline), [outline])

  function goMapWithPending(site: Site) {
    if (site.isAggregate && site.savedSearch?.trim()) {
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

  const q = docSearch.trim()

  const showNewUsers = useMemo(() => !q || textMatchesDocumentationSearch(q, Documentation_NEW_USERS_SEARCH_BLOB), [q])

  const visibleFeatures = useMemo(() => {
    if (!q) return Documentation_FEATURES
    if (textMatchesDocumentationSearch(q, Documentation_FEATURES_SECTION_SEARCH_BLOB)) return Documentation_FEATURES
    return Documentation_FEATURES.filter((f) =>
      textMatchesDocumentationSearch(q, [f.title, f.body, f.searchAliases ?? ''].join(' '))
    )
  }, [q])

  const showFeatures = !q || visibleFeatures.length > 0

  const filteredCategories = useMemo(() => {
    if (!q) return ANALYST_REFERENCE_CATEGORIES
    if (textMatchesDocumentationSearch(q, Documentation_METRICS_INTRO_SEARCH_BLOB)) return ANALYST_REFERENCE_CATEGORIES
    return ANALYST_REFERENCE_CATEGORIES.map((cat) => {
      const titleMatch = textMatchesDocumentationSearch(q, cat.title)
      const keyHits = cat.keys.filter((k) => textMatchesDocumentationSearch(q, metricSearchBlob(k)))
      if (titleMatch) return { ...cat, keys: [...cat.keys] }
      if (keyHits.length > 0) return { ...cat, keys: keyHits }
      return { ...cat, keys: [] as MetricKey[] }
    }).filter((cat) => cat.keys.length > 0)
  }, [q])

  const showMetrics = filteredCategories.length > 0

  const noResults = Boolean(q) && !showNewUsers && !showFeatures && !showMetrics

  const showMetricsHr = showFeatures && showMetrics

  function jumpToSection(id: string) {
    setDocSearch('')
    setOutlineActiveId(id)
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  useEffect(() => {
    const main = mainRef.current
    if (!main) return

    const onScroll = () => {
      if (docSearch.trim()) return
      const rootRect = main.getBoundingClientRect()
      const threshold = rootRect.top + 72
      let best: string | null = null
      let bestTop = -Infinity
      for (const id of outlineIds) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        if (top <= threshold && top > bestTop) {
          bestTop = top
          best = id
        }
      }
      if (best) setOutlineActiveId(best)
    }

    main.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => main.removeEventListener('scroll', onScroll)
  }, [outlineIds, docSearch])

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
        onShortlistOpenSite={goMapWithPending}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-muted/20 px-5 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">Documentation</h1>
            
          </div>
          <div className="relative w-full max-w-[min(100%,280px)] sm:max-w-[280px]">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-foreground/45"
              strokeWidth={2}
              aria-hidden
            />
            <Input
              id="doc-search"
              type="search"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              placeholder="Search docs (words, metrics, layers)…"
              autoComplete="off"
              className={cn(
                'h-8 border-border/90 bg-background pl-8 pr-2 text-xs shadow-none',
                'placeholder:text-foreground/40',
                'focus-visible:border-foreground/25 focus-visible:ring-1 focus-visible:ring-foreground/15'
              )}
            />
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          <aside className="w-[152px] shrink-0 overflow-y-auto border-r border-border bg-muted/10 py-5 pr-1.5 pl-2 sm:w-[200px] sm:py-6 sm:pr-2 sm:pl-4">
            <DocumentationOutlineNav outline={outline} activeId={outlineActiveId} onJump={jumpToSection} />
          </aside>

          <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-2xl px-5 py-8 pb-16">
              {noResults && (
                <p className="mb-8 rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground/80">
                  No sections match &quot;{q}&quot;. Clear the filter to see everything.
                </p>
              )}

              {showNewUsers && (
                <section id="new-users" className="scroll-mt-6">
                  <Collapsible open={forNewUsersOpen} onOpenChange={setForNewUsersOpen}>
                    <div className="overflow-hidden rounded-xl border border-primary/25 bg-card shadow-sm ring-1 ring-primary/10">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="border-primary/45 bg-primary/10 text-[10px] font-bold tracking-widest text-primary"
                            >
                              FOR NEW USERS
                            </Badge>
                            <span className="text-xs text-foreground/60">Orientation (expand or collapse)</span>
                          </div>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 shrink-0 text-primary transition-transform duration-200',
                              forNewUsersOpen && 'rotate-180'
                            )}
                            aria-hidden
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-4 border-t border-border/80 px-4 pt-4 pb-5">
                          <p className="text-sm leading-relaxed text-foreground/85">
                            Quick orientation. The sections below describe product features and every metric the UI
                            exposes.
                          </p>
                          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-foreground/90 marker:text-primary marker:font-semibold">
                            <li>
                              <span className="font-semibold text-primary">Load a market: </span>
                              In the sidebar, enter a ZIP, city and state (e.g. Austin, TX), or an NYC borough name, then
                              press Enter. The map and data panel update together.
                            </li>
                            <li>
                              <span className="font-semibold text-primary">Analysis vs Data: </span>
                              The right panel has two tabs: <em className="text-foreground/95">Analysis</em> for cycle,
                              momentum, PDF brief, and memo; <em className="text-foreground/95">Data</em> for tables,
                              trends, and exports.
                            </li>
                            <li>
                              <span className="font-semibold text-primary">Layers: </span>
                              Use the map&apos;s layer control (top-left) for choropleth, transit, tracts, permits, and
                              uploaded CSV pins.
                            </li>
                            <li>
                              <span className="font-semibold text-primary">Intelligence terminal: </span>
                              The bar at the bottom of the map opens the agent: natural-language questions and layer
                              shortcuts.
                            </li>
                            <li>
                              <span className="font-semibold text-primary">Upload CSV: </span>
                              Open <strong className="font-medium text-foreground">Upload CSV</strong> from the sidebar
                              to upload geocoded spreadsheets; turn on the{' '}
                              <em className="text-foreground/95">Client</em> layer on the map to see pins.
                            </li>
                            <li>
                              <span className="font-semibold text-primary">Shortlist &amp; PDF: </span>
                              Save ZIPs or areas from the sidebar shortlist; check two or more for comparison in the
                              market brief PDF when exported.
                            </li>
                          </ol>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                  <hr className="my-10 border-border" />
                </section>
              )}

              {showFeatures && (
                <>
                  <FeaturesSection blocks={visibleFeatures} />
                  {showMetricsHr ? <hr className="my-12 border-border" /> : null}
                </>
              )}

              {showMetrics && (
                <section id="metrics" className="scroll-mt-6">
                  <DocSectionTitle kicker="Glossary">Metric Reference</DocSectionTitle>
                  <p className="mt-3 text-sm text-foreground/75">
                    Same definitions as in-app tooltips; source and typical update cadence for each field.
                  </p>
                  <div className="mt-8 space-y-10">
                    {(q ? filteredCategories : ANALYST_REFERENCE_CATEGORIES).map((cat) => (
                      <div key={cat.title} id={metricCategoryAnchorId(cat.title)}>
                        <h3 className="border-b border-primary/25 pb-2 text-sm font-semibold tracking-tight text-foreground">
                          {cat.title}
                        </h3>
                        <div className="mt-2">
                          {cat.keys.map((k) => (
                            <MetricBlock key={k} metricKey={k} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
