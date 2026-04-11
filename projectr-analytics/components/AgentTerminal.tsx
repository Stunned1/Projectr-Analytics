'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { AgentAction, AgentMessage, AnalysisSite } from '@/lib/agent-types'
import type { MapContext } from '@/lib/agent-types'
import { useAgentIntelligence, formatActionLogLine } from '@/lib/use-agent-intelligence'
import { cn } from '@/lib/utils'

const STREAM_MS = 72
const SUGGESTIONS = ['Show flood risk', 'Transit + amenities on', 'Run Manhattan site analysis']

function splitForTerminal(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const byNl = trimmed.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (byNl.length > 1) return byNl
  const sentences = trimmed.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean)
  if (sentences && sentences.length > 1) return sentences
  return [trimmed]
}

/** Streams the latest agent message body line-by-line; older messages render fully. */
function StreamedAgentBody({
  text,
  isLatest,
  isAnalyzing,
}: {
  text: string
  isLatest: boolean
  isAnalyzing?: boolean
}) {
  const [lines, setLines] = useState<string[]>(() => (isLatest && !isAnalyzing ? [] : splitForTerminal(text)))

  useEffect(() => {
    if (isAnalyzing) {
      setLines([text])
      return
    }
    if (!isLatest) {
      setLines(splitForTerminal(text))
      return
    }
    const parts = splitForTerminal(text)
    if (parts.length === 0) {
      setLines([])
      return
    }
    let i = 0
    setLines([])
    const id = window.setInterval(() => {
      i += 1
      setLines(parts.slice(0, i))
      if (i >= parts.length) window.clearInterval(id)
    }, STREAM_MS)
    return () => window.clearInterval(id)
  }, [text, isLatest, isAnalyzing])

  if (isAnalyzing) {
    return (
      <div className="flex items-center gap-2 text-primary/90">
        <span className="inline-flex gap-0.5">
          {[0, 1, 2].map((j) => (
            <span
              key={j}
              className="h-3 w-0.5 animate-pulse rounded-sm bg-primary"
              style={{ animationDelay: `${j * 120}ms` }}
            />
          ))}
        </span>
        <span>{text}</span>
      </div>
    )
  }

  return (
    <div className="space-y-0.5 whitespace-pre-wrap break-words">
      {lines.map((line, li) => (
        <div key={li} className="text-[11px] leading-snug text-zinc-300">
          {line}
        </div>
      ))}
    </div>
  )
}

export type AgentTerminalSize = 'collapsed' | 'compact' | 'expanded'

interface AgentTerminalProps {
  mapContext: MapContext
  onAction: (action: AgentAction) => void
  /** Shown in header, e.g. "Manhattan · 43 ZIPs" */
  contextSubtitle: string
  /** Parent increments to open/focus compact from sidebar AI button */
  expandSignal?: number
  onUnreadChange?: (unread: boolean) => void
  /** For layout (e.g. floating stats bubble clearance). */
  onSizeChange?: (size: AgentTerminalSize) => void
  /** Offset above bottom so floating stats pill stays visible */
  bottomOffsetClass?: string
}

export default function AgentTerminal({
  mapContext,
  onAction,
  contextSubtitle,
  expandSignal = 0,
  onUnreadChange,
  onSizeChange,
  bottomOffsetClass = 'bottom-0',
}: AgentTerminalProps) {
  const [size, setSize] = useState<AgentTerminalSize>('collapsed')
  const rootRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastExpandSignal = useRef(expandSignal)
  const [unread, setUnread] = useState(false)

  const shouldNotifyWhileClosed = useCallback(() => size === 'collapsed', [size])

  const { messages, input, setInput, loading, isRunningSequence, sendMessage } = useAgentIntelligence(
    mapContext,
    onAction,
    {
      shouldNotifyWhileClosed,
      onNotifyWhileClosed: () => {
        setUnread(true)
        onUnreadChange?.(true)
      },
    }
  )

  useEffect(() => {
    if (expandSignal !== lastExpandSignal.current) {
      lastExpandSignal.current = expandSignal
      setSize('compact')
      setUnread(false)
      onUnreadChange?.(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [expandSignal, onUnreadChange])

  useEffect(() => {
    if (size !== 'collapsed') {
      setUnread(false)
      onUnreadChange?.(false)
    }
  }, [size, onUnreadChange])

  useEffect(() => {
    onSizeChange?.(size)
  }, [size, onSizeChange])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, size, loading])

  useEffect(() => {
    if (size === 'collapsed' || size === 'expanded') return
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el || el.contains(e.target as Node)) return
      setSize('collapsed')
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [size])

  const lastStatusLine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'agent' && m.text) {
        const line = m.text.split('\n')[0].trim()
        return line.length > 72 ? `${line.slice(0, 69)}…` : line
      }
    }
    return 'Idle — type a command to run the engine.'
  }, [messages])

  const panelHeight =
    size === 'collapsed' ? 'h-8' : size === 'compact' ? 'h-[200px]' : 'min-h-[200px] h-[min(58vh,560px)] max-h-[560px]'

  function renderSiteTable(sites: AnalysisSite[]) {
    return (
      <div className="mt-1 border-l-2 border-primary/40 pl-2 text-[10px] leading-relaxed text-zinc-400">
        <div className="mb-0.5 font-semibold uppercase tracking-wider text-primary/90">Top sites</div>
        {sites.slice(0, 8).map((site, si) => (
          <button
            key={si}
            type="button"
            onClick={() => onAction({ type: 'fly_to', lat: site.lat, lng: site.lng, site })}
            className="block w-full text-left font-mono text-[10px] text-zinc-300 hover:text-primary"
          >
            #{si + 1} {site.address.slice(0, 28)}
            {site.address.length > 28 ? '…' : ''} · score {site.score.toFixed(0)} · {site.zone} · FAR{' '}
            {(site.far_utilization * 100).toFixed(0)}%
          </button>
        ))}
        {sites.length > 8 && <div className="text-zinc-600">… +{sites.length - 8} more (see map)</div>}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'pointer-events-auto absolute left-0 right-0 z-[38] flex flex-col border-t border-zinc-700/90 bg-[#0c0c0e] font-[family-name:var(--font-dm-mono)] shadow-[0_-8px_32px_rgba(0,0,0,0.45)]',
        bottomOffsetClass,
        panelHeight,
        'transition-[height,min-height] duration-200 ease-out'
      )}
    >
      {/* Title / collapse bar — always one row */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-2 pr-1">
        <button
          type="button"
          onClick={() => setSize((s) => (s === 'collapsed' ? 'compact' : 'collapsed'))}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={size === 'collapsed' ? 'Expand terminal' : 'Collapse terminal'}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="14" rx="1" />
            <path d="M6 8h.01M10 8h.01M6 12h8" />
          </svg>
          {size === 'collapsed' ? (
            <span className="truncate text-[10px] text-zinc-500">
              <span className="text-zinc-600">✓ </span>
              <span className="text-zinc-400">{lastStatusLine}</span>
            </span>
          ) : (
            <span className="truncate text-[9px] font-medium tracking-wide text-zinc-500">
              PROJECTR INTELLIGENCE ENGINE <span className="text-zinc-600">v1.0</span>
              <span className="text-primary/80"> [{contextSubtitle}]</span>
            </span>
          )}
        </button>
        {unread && size === 'collapsed' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
        {size !== 'collapsed' && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            title={size === 'expanded' ? 'Restore height' : 'Maximize'}
            onClick={() => setSize((s) => (s === 'expanded' ? 'compact' : 'expanded'))}
          >
            {size === 'expanded' ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSize((s) => (s === 'collapsed' ? 'compact' : 'collapsed'))}
          className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label={size === 'collapsed' ? 'Expand' : 'Collapse'}
        >
          <svg
            className={cn('h-3.5 w-3.5 transition-transform', size !== 'collapsed' && 'rotate-180')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {size !== 'collapsed' && (
        <>
          <div className="shrink-0 border-b border-zinc-800/80 px-2 py-0.5 text-[9px] text-zinc-600">
            ────────────────────────────────────────────
          </div>

          <div ref={outputRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {messages.map((msg, i) => {
              const isLatestAgent = msg.role === 'agent' && i === messages.length - 1
              if (msg.role === 'user') {
                return (
                  <div key={i} className="mb-2 text-[11px] text-primary">
                    <span className="text-zinc-600">&gt; </span>
                    {msg.text}
                  </div>
                )
              }
              const logLine = formatActionLogLine(msg.action)
              return (
                <div key={i} className="mb-3">
                  <StreamedAgentBody text={msg.text} isLatest={isLatestAgent} isAnalyzing={msg.isAnalyzing} />
                  {logLine && !msg.isAnalyzing && (
                    <div className="mt-1 text-[10px] text-emerald-500/90">{logLine}</div>
                  )}
                  {msg.insight && (
                    <div className="mt-1.5 border border-primary/25 bg-primary/5 px-2 py-1.5 text-[10px] leading-snug text-primary/95">
                      {splitForTerminal(msg.insight).map((line, li) => (
                        <div key={li}>{line}</div>
                      ))}
                    </div>
                  )}
                  {msg.analysisSites && msg.analysisSites.length > 0 && renderSiteTable(msg.analysisSites)}
                </div>
              )
            })}

            {loading && !messages.some((m) => m.isAnalyzing) && (
              <div className="flex items-center gap-1 text-[10px] text-zinc-600">
                <span className="inline-block h-2 w-1 animate-pulse bg-primary" />
                Awaiting model…
              </div>
            )}
          </div>

          {messages.length <= 2 && (
            <div className="flex shrink-0 flex-wrap gap-1 border-t border-zinc-800/60 px-2 py-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="rounded border border-zinc-700/80 px-2 py-0.5 text-[9px] text-zinc-500 hover:border-primary/40 hover:text-zinc-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage(input)
            }}
            className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-[#080809] px-2 py-1.5"
          >
            <span className="select-none text-primary/80">&gt;</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || isRunningSequence}
              placeholder={isRunningSequence ? 'Sequence running…' : '_'}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-200 caret-primary outline-none placeholder:text-zinc-700 disabled:opacity-50"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="h-3.5 w-px animate-pulse bg-primary/80" aria-hidden />
          </form>
        </>
      )}
    </div>
  )
}
