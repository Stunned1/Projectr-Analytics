'use client'

import { Fragment, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import type { AgentAction, AgentTrace, AnalysisSite } from '@/lib/agent-types'
import type { MapContext } from '@/lib/agent-types'
import { buildAgentInputPlaceholder, buildAgentStarterSuggestions } from '@/lib/agent-surface-copy'
import { useAgentIntelligence, formatActionLogLine } from '@/lib/use-agent-intelligence'
import { getSlashPaletteState } from '@/lib/slash-commands'
import { cn } from '@/lib/utils'

const STREAM_MS = 72

/** Scout orange / narrative / system / chrome */
const C_USER_GT = '#D76B3D'
const C_USER_TEXT = '#ffffff'
const C_TS = '#4b5563'
const C_NARRATIVE = '#c9d1d9'
const C_NARRATIVE_BULLET = '#4b5563'
const C_SYSTEM = '#10b981'
const C_SEPARATOR = '#2d3342'

const TERMINAL_DEFAULT_OPEN_PX = 200
const TERMINAL_MIN_OPEN_PX = 120
const TERMINAL_MAX_OPEN_PX = 560
/** Matches `h-8` collapsed chrome — height we animate to before unmounting open content */
const TERMINAL_COLLAPSED_HEIGHT_PX = 32
/** Fallback if `transitionend` doesn’t fire; slightly longer than `duration-300` */
const CLOSE_FALLBACK_MS = 400

function maxOpenTerminalHeightPx(): number {
  if (typeof window === 'undefined') return TERMINAL_MAX_OPEN_PX
  return Math.min(TERMINAL_MAX_OPEN_PX, Math.round(window.innerHeight * 0.85))
}

function expandedPresetHeightPx(): number {
  if (typeof window === 'undefined') return TERMINAL_MAX_OPEN_PX
  return Math.min(TERMINAL_MAX_OPEN_PX, Math.round(window.innerHeight * 0.58))
}

function clampOpenTerminalHeightPx(h: number): number {
  return Math.round(Math.max(TERMINAL_MIN_OPEN_PX, Math.min(maxOpenTerminalHeightPx(), h)))
}

function formatUserCommandTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

function splitForTerminal(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const byNl = trimmed.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (byNl.length > 1) return byNl
  const sentences = trimmed.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean)
  if (sentences && sentences.length > 1) return sentences
  return [trimmed]
}

function SystemActionLine({ children, pulsing }: { children: React.ReactNode; pulsing?: boolean }) {
  return (
    <div
      className="mb-1 flex items-center gap-2 font-mono text-[11px] leading-snug"
      style={{ color: C_SYSTEM }}
    >
      <span
        className={cn('inline-block shrink-0 rounded-full', pulsing && 'animate-terminal-dot-pulse')}
        style={{
          width: 7,
          height: 7,
          background: C_SYSTEM,
          marginBottom: 1,
          verticalAlign: 'middle',
        }}
        aria-hidden
      />
      <span>{children}</span>
    </div>
  )
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
  const parts = useMemo(() => splitForTerminal(text), [text])
  const [revealedCount, setRevealedCount] = useState(() => (isLatest && !isAnalyzing ? 0 : parts.length))

  useEffect(() => {
    if (isAnalyzing || !isLatest || parts.length === 0) return
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setRevealedCount(i)
      if (i >= parts.length) window.clearInterval(id)
    }, STREAM_MS)
    return () => window.clearInterval(id)
  }, [parts, isLatest, isAnalyzing])

  if (isAnalyzing) {
    return (
      <div className="mb-2 pl-[2ch]">
        <SystemActionLine pulsing>{text}</SystemActionLine>
      </div>
    )
  }

  const lines = isLatest ? parts.slice(0, revealedCount) : parts
  if (lines.length === 0) return null

  return (
    <div className="mb-3 space-y-0.5 whitespace-pre-wrap break-words pl-[2ch] font-mono text-[11px] leading-relaxed">
      {lines.map((line, li) => (
        <div key={li} style={{ color: C_NARRATIVE }}>
          <span className="select-none" style={{ color: C_NARRATIVE_BULLET }}>
            ·{' '}
          </span>
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
  /** Shown in header, e.g. "Harris County, TX · County view · 37 ZIP codes" */
  contextSubtitle: string
  onUnreadChange?: (unread: boolean) => void
  /** For layout (e.g. floating stats bubble clearance). */
  onSizeChange?: (size: AgentTerminalSize) => void
  /** Open-state pixel height (null when collapsed) for parent layout offsets. */
  onOpenHeightPxChange?: (heightPx: number | null) => void
  /** Offset above bottom so floating stats pill stays visible */
  bottomOffsetClass?: string
  /** Map page: `/save` persists ZIP, aggregate, or camera to Saved. */
  onSlashSave?: (customLabel: string | null) => Promise<{ ok: boolean; message: string }>
  /** Open right sidebar with plan / eval / execution trace from `/api/agent`. */
  onShowThinking?: (trace: AgentTrace) => void
  /** Live updates while `/api/agent` streams reasoning (Thinking tab opens automatically). */
  onAgentThinkingUpdate?: (u: { trace: AgentTrace; phase: 'thinking' | 'json' | 'done' }) => void
  onAgentThinkingStreamFinished?: () => void
}

export default function AgentTerminal({
  mapContext,
  onAction,
  contextSubtitle,
  onUnreadChange,
  onSizeChange,
  onOpenHeightPxChange,
  bottomOffsetClass = 'bottom-0',
  onSlashSave,
  onShowThinking,
  onAgentThinkingUpdate,
  onAgentThinkingStreamFinished,
}: AgentTerminalProps) {
  const [size, setSize] = useState<AgentTerminalSize>('collapsed')
  const [openHeightPx, setOpenHeightPx] = useState(TERMINAL_DEFAULT_OPEN_PX)
  /** True while animating height down before switching to `collapsed` (click-outside / collapse controls). */
  const [isClosing, setIsClosing] = useState(false)
  const restoreHeightAfterCloseRef = useRef(TERMINAL_DEFAULT_OPEN_PX)
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const resizeStartYRef = useRef(0)
  const resizeStartHRef = useRef(TERMINAL_DEFAULT_OPEN_PX)
  const rootRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** After `/` opens the panel from collapsed, focus input and insert `/` once the field mounts. */
  const slashOpenPendingRef = useRef(false)
  const [unread, setUnread] = useState(false)
  const [slashHighlight, setSlashHighlight] = useState(0)

  const shouldNotifyWhileClosed = useCallback(() => size === 'collapsed', [size])

  const {
    messages,
    visibleTerminalMessages,
    input,
    setInput,
    loading,
    isRunningSequence,
    sendMessage,
    generateCaseBrief,
    briefLoading,
    briefError,
  } = useAgentIntelligence(mapContext, onAction, {
    shouldNotifyWhileClosed,
    onNotifyWhileClosed: () => {
      setUnread(true)
      onUnreadChange?.(true)
    },
    onSlashSave,
    onAgentThinkingUpdate,
    onAgentThinkingStreamFinished,
  })

  const slashPalette = useMemo(() => getSlashPaletteState(input), [input])
  const starterSuggestions = useMemo(() => buildAgentStarterSuggestions(mapContext), [mapContext])
  const activeSlashHighlight = useMemo(() => {
    if (!slashPalette.open || slashPalette.matches.length === 0) return 0
    return Math.min(slashHighlight, slashPalette.matches.length - 1)
  }, [slashHighlight, slashPalette.open, slashPalette.matches.length])

  const showCaseBriefCta = useMemo(() => {
    const latest = [...messages].reverse().find((m) => m.analysisSites?.length)
    return Boolean(latest?.analysisSites?.length) && !isRunningSequence && !loading
  }, [messages, isRunningSequence, loading])

  useEffect(() => {
    onSizeChange?.(size)
  }, [size, onSizeChange])

  useEffect(() => {
    onOpenHeightPxChange?.(size === 'collapsed' ? null : openHeightPx)
  }, [size, openHeightPx, onOpenHeightPxChange])

  const focusTerminalAndInsertSlash = useCallback(() => {
    inputRef.current?.focus()
    setInput((p) => `${p}/`)
  }, [setInput])

  const clearUnreadIndicator = useCallback(() => {
    setUnread(false)
    onUnreadChange?.(false)
  }, [onUnreadChange])

  const openTerminal = useCallback((nextSize: Exclude<AgentTerminalSize, 'collapsed'> = 'compact') => {
    clearUnreadIndicator()
    setSize(nextSize)
  }, [clearUnreadIndicator])

  useLayoutEffect(() => {
    if (size === 'collapsed' || !slashOpenPendingRef.current) return
    slashOpenPendingRef.current = false
    if (loading || isRunningSequence) {
      inputRef.current?.focus()
      return
    }
    focusTerminalAndInsertSlash()
  }, [size, loading, isRunningSequence, focusTerminalAndInsertSlash])

  useEffect(() => {
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return

      const target = e.target
      if (inputRef.current && (target === inputRef.current || inputRef.current.contains(target as Node))) return

      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      e.preventDefault()

      if (loading || isRunningSequence) {
        if (size === 'collapsed') openTerminal('compact')
        return
      }

      if (size === 'collapsed') {
        slashOpenPendingRef.current = true
        openTerminal('compact')
        return
      }

      focusTerminalAndInsertSlash()
    }

    document.addEventListener('keydown', onDocKeyDown, true)
    return () => document.removeEventListener('keydown', onDocKeyDown, true)
  }, [size, loading, isRunningSequence, focusTerminalAndInsertSlash, openTerminal])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
  }, [visibleTerminalMessages, size, loading])

  const finishSmoothCollapse = useCallback(() => {
    setSize('collapsed')
    setIsClosing(false)
    setOpenHeightPx(restoreHeightAfterCloseRef.current)
  }, [])

  const beginSmoothCollapse = useCallback(() => {
    if (size === 'collapsed' || isClosing) return
    restoreHeightAfterCloseRef.current = openHeightPx
    setIsClosing(true)
    requestAnimationFrame(() => {
      setOpenHeightPx(TERMINAL_COLLAPSED_HEIGHT_PX)
    })
  }, [size, isClosing, openHeightPx])

  useEffect(() => {
    if (!isClosing) return
    const id = window.setTimeout(finishSmoothCollapse, CLOSE_FALLBACK_MS)
    return () => window.clearTimeout(id)
  }, [isClosing, finishSmoothCollapse])

  useEffect(() => {
    if (size === 'collapsed' || size === 'expanded' || isClosing) return
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el || el.contains(e.target as Node)) return
      beginSmoothCollapse()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [size, isClosing, beginSmoothCollapse])

  const endResize = useCallback(() => {
    isResizingRef.current = false
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const onWinUp = () => endResize()
    window.addEventListener('pointerup', onWinUp)
    window.addEventListener('pointercancel', onWinUp)
    return () => {
      window.removeEventListener('pointerup', onWinUp)
      window.removeEventListener('pointercancel', onWinUp)
    }
  }, [isResizing, endResize])

  useEffect(() => {
    const onResize = () => setOpenHeightPx((h) => clampOpenTerminalHeightPx(h))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (size === 'collapsed' || e.button !== 0) return
    e.preventDefault()
    resizeStartYRef.current = e.clientY
    resizeStartHRef.current = openHeightPx
    isResizingRef.current = true
    setIsResizing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [size, openHeightPx])

  const onResizeHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return
    const dy = resizeStartYRef.current - e.clientY
    setOpenHeightPx(clampOpenTerminalHeightPx(resizeStartHRef.current + dy))
  }, [])

  const onResizeHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    endResize()
  }, [endResize])

  const terminalMsgOffset = messages.length - visibleTerminalMessages.length
  const hasUserMessage = useMemo(() => messages.some((m) => m.role === 'user'), [messages])
  const inputPlaceholder = useMemo(
    () => buildAgentInputPlaceholder(mapContext, hasUserMessage, isRunningSequence),
    [mapContext, hasUserMessage, isRunningSequence]
  )

  const lastStatusLine = useMemo(() => {
    for (let i = visibleTerminalMessages.length - 1; i >= 0; i--) {
      const m = visibleTerminalMessages[i]
      if (m.role === 'agent' && m.text) {
        const line = m.text.split('\n')[0].trim()
        return line.length > 72 ? `${line.slice(0, 69)}…` : line
      }
    }
    return 'Idle — type a command to run the engine.'
  }, [visibleTerminalMessages])

  function renderSiteTable(sites: AnalysisSite[]) {
    return (
      <div className="mt-2 border-l-2 border-primary/40 pl-2 text-[10px] leading-relaxed text-zinc-400">
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

  const waitingForModel = loading && !visibleTerminalMessages.some((m) => m.isAnalyzing)

  const onRootTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (!isClosing || e.propertyName !== 'height') return
      if (e.target !== e.currentTarget) return
      finishSmoothCollapse()
    },
    [isClosing, finishSmoothCollapse]
  )

  return (
    <div
      ref={rootRef}
      style={size === 'collapsed' ? undefined : { height: openHeightPx }}
      onTransitionEnd={onRootTransitionEnd}
      className={cn(
        'pointer-events-auto absolute left-0 right-0 z-[38] flex flex-col border-t border-zinc-700/90 bg-[#0c0c0e] font-[family-name:var(--font-dm-mono)] shadow-[0_-8px_32px_rgba(0,0,0,0.45)]',
        bottomOffsetClass,
        size === 'collapsed' ? 'h-8' : 'min-h-0 overflow-hidden',
        !isResizing &&
          size !== 'collapsed' &&
          (isClosing ? 'transition-[height] duration-300 ease-out' : 'transition-[height] duration-200 ease-out')
      )}
    >
      {/* Inner `relative` only — never put `relative` on the root or tailwind-merge drops `absolute` and the bar jumps to the top of the map */}
      <div className="relative flex h-full min-h-0 flex-col">
        {/* Full-width top edge (no grip chrome) — same interaction as resizing a desktop terminal window */}
        {size !== 'collapsed' && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal height"
            title="Drag top edge to resize"
            onPointerDown={onResizeHandlePointerDown}
            onPointerMove={onResizeHandlePointerMove}
            onPointerUp={onResizeHandlePointerUp}
            onPointerCancel={onResizeHandlePointerUp}
            className="absolute left-0 right-0 top-0 z-[41] h-3 cursor-ns-resize touch-none"
          />
        )}
        {/* Title / collapse bar - always one row */}
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-2 pr-1">
        <button
          type="button"
          onClick={() => (size === 'collapsed' ? openTerminal('compact') : beginSmoothCollapse())}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={size === 'collapsed' ? 'Expand terminal (or press /)' : 'Collapse terminal'}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="14" rx="1" />
            <path d="M6 8h.01M10 8h.01M6 12h8" />
          </svg>
          {size === 'collapsed' ? (
            <span className="min-w-0 flex-1 truncate text-[10px]">
              <span className="text-zinc-500">Click to Expand: </span>
              <span className="text-zinc-400">{lastStatusLine}</span>
            </span>
          ) : (
            <span className="truncate text-[9px] font-medium tracking-wide text-zinc-500">
              SCOUT INTELLIGENCE ENGINE <span className="text-zinc-600">v1.0</span>
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
            onClick={() => {
              if (size === 'expanded') {
                setOpenHeightPx(TERMINAL_DEFAULT_OPEN_PX)
                openTerminal('compact')
              } else {
                setOpenHeightPx(clampOpenTerminalHeightPx(expandedPresetHeightPx()))
                openTerminal('expanded')
              }
            }}
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
          onClick={() => (size === 'collapsed' ? openTerminal('compact') : beginSmoothCollapse())}
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
            <span className="text-zinc-500">Slash:</span> type <span className="font-mono text-zinc-500">/</span> for
            suggestions; <span className="font-mono text-zinc-500">/help</span>;{' '}
            <span className="font-mono text-zinc-500">/view 3d</span> /{' '}
            <span className="font-mono text-zinc-500">/view 2d</span>;{' '}
            <span className="font-mono text-zinc-500">/tilt 0–100</span> (% of max 67.5°);{' '}
            <span className="font-mono text-zinc-500">/rotate °</span> (bearing);{' '}
            <span className="font-mono text-zinc-500">/go</span> search;{' '}
            <span className="font-mono text-zinc-500">/layers:a,b</span>;{' '}
            <span className="font-mono text-zinc-500">/clear:…</span>;{' '}
            <span className="font-mono text-zinc-500">/restart</span> → y/n; see /help
          </div>

          <div ref={outputRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {visibleTerminalMessages.map((msg, j) => {
              const i = terminalMsgOffset + j
              const isLatestAgent = msg.role === 'agent' && i === messages.length - 1

              if (msg.role === 'user') {
                return (
                  <Fragment key={i}>
                    {i > 0 && (
                      <div
                        className="my-3 border-t"
                        style={{ borderColor: C_SEPARATOR, opacity: 0.55 }}
                        aria-hidden
                      />
                    )}
                    <div className="mb-2 flex items-baseline justify-between gap-3 font-mono text-[13px] leading-snug">
                      <div className="min-w-0 flex-1">
                        <span style={{ color: C_USER_GT }}>&gt; </span>
                        <span style={{ color: C_USER_TEXT, fontWeight: 500 }}>{msg.text}</span>
                      </div>
                      {msg.ts != null && (
                        <span className="shrink-0 tabular-nums text-[11px]" style={{ color: C_TS }}>
                          {formatUserCommandTime(msg.ts)}
                        </span>
                      )}
                    </div>
                  </Fragment>
                )
              }

              const logLine = formatActionLogLine(msg.action)
              const showNarrative = Boolean(msg.text?.trim())

              return (
                <div key={i}>
                  {showNarrative && (
                    <StreamedAgentBody
                      key={`${i}:${msg.text}:${msg.isAnalyzing ? '1' : '0'}:${isLatestAgent ? '1' : '0'}`}
                      text={msg.text}
                      isLatest={isLatestAgent}
                      isAnalyzing={msg.isAnalyzing}
                    />
                  )}
                  {logLine && !msg.isAnalyzing && <SystemActionLine>{logLine}</SystemActionLine>}
                  {msg.insight && (
                    <div
                      className="mt-2 border border-primary/25 border-l-[3px] border-l-primary/75 bg-primary/5 px-2 py-1.5 font-mono text-[10px] leading-snug text-primary/95"
                    >
                      {splitForTerminal(msg.insight).map((line, li) => (
                        <div key={li}>{line}</div>
                      ))}
                    </div>
                  )}
                  {msg.trace && onShowThinking && !msg.isAnalyzing && (
                    <div className="mt-2 pl-[2ch]">
                      <button
                        type="button"
                        onClick={() => onShowThinking(msg.trace!)}
                        className="max-w-full text-left text-[10px] font-semibold text-primary hover:underline"
                      >
                        Show thinking
                      </button>
                      <p className="mt-0.5 line-clamp-2 font-mono text-[9px] leading-snug text-zinc-500">
                        {msg.trace.summary}
                      </p>
                    </div>
                  )}
                  {msg.analysisSites && msg.analysisSites.length > 0 && renderSiteTable(msg.analysisSites)}
                </div>
              )
            })}

            {waitingForModel && (
              <div className="pl-[2ch]">
                <SystemActionLine pulsing>Awaiting model…</SystemActionLine>
              </div>
            )}
          </div>

          {messages.length <= 2 && (
            <div className="flex shrink-0 flex-wrap gap-1 border-t border-zinc-800/60 px-2 py-1">
              {starterSuggestions.map((s) => (
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

          {showCaseBriefCta && (
            <div className="shrink-0 border-t border-zinc-800/80 px-2 py-1.5">
              <button
                type="button"
                onClick={() => void generateCaseBrief()}
                disabled={briefLoading}
                className="w-full rounded border border-primary/45 bg-primary/15 px-2 py-1.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-45"
              >
                {briefLoading ? 'Building PDF…' : 'Download case brief (PDF)'}
              </button>
              {briefError && <p className="mt-1 text-[9px] text-red-400/90">{briefError}</p>}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage(input)
            }}
            className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-[#080809] px-2 py-1.5"
          >
            <span
              className={cn(
                'select-none font-mono text-[11px]',
                loading || isRunningSequence ? 'animate-terminal-prompt-wait' : ''
              )}
              style={{ color: C_USER_GT }}
            >
              &gt;
            </span>
            <div className="relative min-w-0 flex-1">
              {slashPalette.open && (
                <div
                  className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[9.5rem] overflow-y-auto rounded border border-zinc-700/90 bg-[#121215] py-0.5 shadow-lg"
                  role="listbox"
                  aria-label="Slash commands"
                >
                  {slashPalette.matches.length === 0 ? (
                    <div className="px-2 py-1.5 font-mono text-[10px] text-zinc-500">No matching commands — try /help</div>
                  ) : (
                    slashPalette.matches.map((cmd, i) => (
                      <button
                        key={cmd.command}
                        type="button"
                        role="option"
                        aria-selected={i === activeSlashHighlight}
                        className={cn(
                          'flex w-full flex-col gap-0.5 px-2 py-1.5 text-left font-mono text-[10px] transition-colors',
                          i === activeSlashHighlight ? 'bg-primary/15 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/80'
                        )}
                        onMouseEnter={() => setSlashHighlight(i)}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => setInput(`/${cmd.command}`)}
                      >
                        <span className="text-primary/90">/{cmd.command}</span>
                        <span className="text-[9px] font-normal leading-snug text-zinc-500">{cmd.summary}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  const { open, matches } = getSlashPaletteState(input)
                  if (!open) return
                  if (e.key === 'ArrowDown' && matches.length > 0) {
                    e.preventDefault()
                    setSlashHighlight((h) => (h + 1) % matches.length)
                    return
                  }
                  if (e.key === 'ArrowUp' && matches.length > 0) {
                    e.preventDefault()
                    setSlashHighlight((h) => (h - 1 + matches.length) % matches.length)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setInput('')
                    return
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && matches.length > 0) {
                    e.preventDefault()
                    const cmd = matches[activeSlashHighlight]?.command
                    if (cmd) setInput(`/${cmd}`)
                  }
                }}
                disabled={loading || isRunningSequence}
                placeholder={inputPlaceholder}
                className="w-full min-w-0 bg-transparent font-mono text-[11px] text-zinc-200 caret-primary outline-none placeholder:text-zinc-700 disabled:opacity-50"
                style={{ color: C_USER_TEXT }}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <span className="h-3.5 w-px animate-pulse bg-primary/80" aria-hidden />
          </form>
        </>
        )}
      </div>
    </div>
  )
}
