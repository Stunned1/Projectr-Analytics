'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { AGENT_CHAT_STORAGE_KEY } from '@/lib/use-agent-intelligence'

export interface AgentAction {
  type: 'toggle_layer' | 'toggle_layers' | 'set_metric' | 'search' | 'generate_memo' | 'focus_data_panel' | 'set_tilt' | 'set_heading' | 'run_analysis' | 'show_sites' | 'set_permit_filter' | 'fly_to' | 'none'
  layer?: string
  value?: boolean
  layers?: Record<string, boolean>
  metric?: 'zori' | 'zhvi'
  query?: string
  tilt?: number
  borough?: string
  top_n?: number
  sites?: AnalysisSite[]
  types?: string[]
  lat?: number
  lng?: number
  site?: AnalysisSite
}

export interface AnalysisSite {
  address: string
  lat: number
  lng: number
  zone: string
  built_far: number
  max_far: number
  air_rights_sqft: number
  far_utilization: number
  lot_area: number
  assessed_value: number
  score: number
  zori_growth: number | null
  momentum: number | null
}

interface AgentStep {
  delay: number
  message: string
  action: AgentAction
}

interface Message {
  role: 'user' | 'agent'
  text: string
  action?: AgentAction
  insight?: string | null
  isAnalyzing?: boolean
  analysisSites?: AnalysisSite[]
}

interface MapContext {
  label?: string | null
  zip?: string | null
  hasRankedSites?: boolean
  rankedSiteCount?: number
  layers?: Record<string, boolean>
  activeMetric?: string
  zori?: number | null
  zhvi?: number | null
  zoriGrowth?: number | null
  zhviGrowth?: number | null
  vacancyRate?: number | null
  dozPending?: number | null
  priceCuts?: number | null
  inventory?: number | null
  transitStops?: number | null
  population?: number | null
}

interface AgentChatProps {
  mapContext: MapContext
  onAction: (action: AgentAction) => void
  isOpen: boolean
  onToggle: () => void
  hasStatsBar?: boolean
  /** `docked` - no floating FAB; parent renders the open button (e.g. sidebar). */
  variant?: 'floating' | 'docked'
  /** Prefer over onToggle for explicit close (×). */
  onClose?: () => void
  /** Fired when a new agent message is added while the panel is closed (unread hint). */
  onNotifyWhileClosed?: () => void
}

const ACTION_LABELS: Record<string, string> = {
  toggle_layer: '↳ Layer updated',
  toggle_layers: '↳ Layers updated',
  set_metric: '↳ Metric changed',
  search: '↳ Navigating to market',
  generate_memo: '↳ Opening memo',
  set_tilt: '↳ Map tilted',
  set_heading: '↳ Map rotated',
  run_analysis: '↳ Running spatial model...',
  show_sites: '↳ Top sites revealed',
  set_permit_filter: '↳ Permit filter applied',
  none: '',
}

const SUGGESTIONS = [
  'Show me flood risk zones',
  "What's the vacancy rate here?",
  'Highlight transit connectivity',
]

interface CaseStudyBundle {
  userText: string
  agentLead: string
  insight: string | null
}

type PersistedAgentChat = {
  v: 1
  messages: Message[]
  caseStudyBundle: CaseStudyBundle | null
}

function readPersistedChat(): PersistedAgentChat | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(AGENT_CHAT_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PersistedAgentChat
    if (p.v !== 1 || !Array.isArray(p.messages)) return null
    return p
  } catch {
    return null
  }
}

function writePersistedChat(messages: Message[], bundle: CaseStudyBundle | null) {
  try {
    sessionStorage.setItem(
      AGENT_CHAT_STORAGE_KEY,
      JSON.stringify({ v: 1, messages, caseStudyBundle: bundle } satisfies PersistedAgentChat)
    )
  } catch {
    /* quota / private mode */
  }
}

const DEFAULT_GREETING: Message = {
  role: 'agent',
  text: 'Spatial analyst ready. Paste a case study or ask me to navigate markets, toggle layers, or run a site analysis.',
}

export default function AgentChat({
  mapContext,
  onAction,
  isOpen,
  onToggle,
  hasStatsBar,
  variant = 'floating',
  onClose,
  onNotifyWhileClosed,
}: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([DEFAULT_GREETING])
  const [caseStudyBundle, setCaseStudyBundle] = useState<CaseStudyBundle | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isRunningSequence, setIsRunningSequence] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sequenceRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const [storageHydrated, setStorageHydrated] = useState(false)

  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 150)
  }, [isOpen])

  useEffect(() => {
    const p = readPersistedChat()
    if (p?.messages?.length) {
      setMessages(p.messages)
      setCaseStudyBundle(p.caseStudyBundle ?? null)
    }
    setStorageHydrated(true)
  }, [])

  useEffect(() => {
    if (!storageHydrated) return
    writePersistedChat(messages, caseStudyBundle)
  }, [messages, caseStudyBundle, storageHydrated])

  // Clear pending timeouts on unmount
  useEffect(() => {
    return () => { sequenceRef.current.forEach(clearTimeout) }
  }, [])

  const runAnalysis = useCallback(async (action: AgentAction) => {
    const borough = action.borough ?? 'manhattan'
    const topN = action.top_n ?? 5

    // Add analyzing message
    setMessages((prev) => [...prev, {
      role: 'agent',
      text: `Running spatial model across ${borough} parcels...`,
      isAnalyzing: true,
    }])

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borough, top_n: topN }),
      })
      const data = await res.json()

      if (data.error || !data.sites?.length) {
        setMessages((prev) => [...prev.slice(0, -1), {
          role: 'agent',
          text: `Analysis complete - no qualifying sites found. ${data.error ?? ''}`,
        }])
        if (!isOpen) onNotifyWhileClosed?.()
        return
      }

      const sites: AnalysisSite[] = data.sites

      // Remove analyzing message, add results
      setMessages((prev) => [...prev.slice(0, -1), {
        role: 'agent',
        text: `Analysis complete. Here are the top ${sites.length} high-upside parcels that maximize unbuilt FAR, sit inside momentum zones, and offer the highest projected rental yield.`,
        analysisSites: sites,
      }])

      // Clear analytical clutter before pins (parcels, permits, census overlays); drop agent permit filter so UI matches “reveal” state
      onAction({
        type: 'toggle_layers',
        layers: { parcels: false, permits: false, tracts: false, blockGroups: false },
      })
      onAction({ type: 'set_permit_filter', types: [] })
      setTimeout(() => {
        onAction({ type: 'show_sites', sites })
      }, 600)
      if (!isOpen) onNotifyWhileClosed?.()
    } catch {
      setMessages((prev) => [...prev.slice(0, -1), {
        role: 'agent',
        text: 'Analysis failed. Please try again.',
      }])
      if (!isOpen) onNotifyWhileClosed?.()
    }
  }, [onAction, isOpen, onNotifyWhileClosed])

  const executeStep = useCallback((step: AgentStep) => {
    setMessages((prev) => {
      // Update last agent message or add new one
      const last = prev[prev.length - 1]
      if (last?.role === 'agent' && !last.analysisSites) {
        return [...prev.slice(0, -1), { role: 'agent', text: step.message, action: step.action }]
      }
      return [...prev, { role: 'agent', text: step.message, action: step.action }]
    })

    if (step.action.type === 'run_analysis') {
      void runAnalysis(step.action)
    } else if (step.action.type !== 'none') {
      onAction(step.action)
    }
  }, [onAction, runAnalysis])

  const generateCaseBrief = useCallback(async () => {
    const sitesMsg = [...messages].reverse().find((m) => m.analysisSites?.length)
    const bundle = caseStudyBundle
    if (!sitesMsg?.analysisSites?.length) return
    setBriefLoading(true)
    setBriefError(null)
    try {
      const res = await fetch('/api/agent/case-brief/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseStudy: bundle?.userText ?? '',
          agentSummary: bundle?.agentLead ?? '',
          insight: bundle?.insight ?? '',
          sites: sitesMsg.analysisSites,
          mapContext,
        }),
      })
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null
        setBriefError(errBody?.error ?? `Brief PDF failed (${res.status})`)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition')
      let filename = 'Projectr-Case-Brief.pdf'
      const m = cd?.match(/filename="([^"]+)"/)
      if (m?.[1]) filename = m[1]
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setBriefError('Connection error')
    } finally {
      setBriefLoading(false)
    }
  }, [messages, mapContext, caseStudyBundle])

  const runSequence = useCallback((steps: AgentStep[]) => {
    setIsRunningSequence(true)
    sequenceRef.current.forEach(clearTimeout)
    sequenceRef.current = []

    steps.forEach((step) => {
      const t = setTimeout(() => executeStep(step), step.delay)
      sequenceRef.current.push(t)
    })

    const maxDelay = Math.max(...steps.map((s) => s.delay)) + 1000
    const done = setTimeout(() => setIsRunningSequence(false), maxDelay)
    sequenceRef.current.push(done)
  }, [executeStep])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading || isRunningSequence) return
    const userPrompt = text.trim()
    setCaseStudyBundle({ userText: userPrompt, agentLead: '', insight: null })
    setMessages((prev) => [...prev, { role: 'user', text: userPrompt }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userPrompt, context: mapContext }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [...prev, { role: 'agent', text: 'Something went wrong. Try again.' }])
        if (!isOpen) onNotifyWhileClosed?.()
        return
      }

      // Multi-step sequence
      if (data.steps?.length) {
        setCaseStudyBundle({
          userText: userPrompt,
          agentLead: typeof data.message === 'string' ? data.message : '',
          insight: typeof data.insight === 'string' ? data.insight : null,
        })
        setMessages((prev) => [...prev, { role: 'agent', text: data.message, insight: data.insight }])
        if (!isOpen) onNotifyWhileClosed?.()
        runSequence(data.steps)
        return
      }

      // Single action
      setCaseStudyBundle({
        userText: userPrompt,
        agentLead: typeof data.message === 'string' ? data.message : '',
        insight: typeof data.insight === 'string' ? data.insight : null,
      })
      setMessages((prev) => [...prev, {
        role: 'agent',
        text: data.message,
        action: data.action?.type !== 'none' ? data.action : undefined,
        insight: data.insight,
      }])
      if (!isOpen) onNotifyWhileClosed?.()

      if (data.action?.type === 'run_analysis') {
        void runAnalysis(data.action)
      } else if (data.action && data.action.type !== 'none') {
        onAction(data.action)
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', text: 'Connection error.' }])
      if (!isOpen) onNotifyWhileClosed?.()
    } finally {
      setLoading(false)
    }
  }, [loading, isRunningSequence, mapContext, onAction, runSequence, runAnalysis, isOpen, onNotifyWhileClosed])

  const bottomOffset = hasStatsBar ? 'bottom-[7.25rem]' : 'bottom-10'

  const latestAnalysisMessage = [...messages].reverse().find((m) => m.analysisSites?.length)
  const showBriefCta =
    Boolean(latestAnalysisMessage?.analysisSites?.length) && !isRunningSequence && !loading

  if (!isOpen) {
    if (variant === 'docked') return null
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`absolute ${bottomOffset} right-4 z-40 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105`}
        style={{ background: 'linear-gradient(135deg, #D76B3D, #b85a30)' }}
        title="Open AI Agent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.5} className="w-4 h-4">
          <circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </svg>
      </button>
    )
  }

  const panelPositionClass =
    variant === 'docked'
      ? 'relative z-10 w-full max-w-[360px] flex flex-col rounded-2xl overflow-hidden shadow-2xl'
      : `absolute ${bottomOffset} right-4 z-40 w-[360px] flex flex-col rounded-2xl overflow-hidden shadow-2xl`

  return (
    <div
      className={panelPositionClass}
      style={{
        background: 'rgba(6, 6, 6, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={() => (onClose ? onClose() : onToggle())}
        className="absolute top-2.5 right-3 z-10 text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/5"
        aria-label="Close AI chat"
      >×</button>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pt-8 pb-3 space-y-3 max-h-[420px]">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            {msg.role === 'user' ? (
              <div
                className="max-w-[88%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed text-white"
                style={{ background: 'rgba(215, 107, 61, 0.18)', border: '1px solid rgba(215, 107, 61, 0.28)' }}
              >
                {msg.text}
              </div>
            ) : msg.isAnalyzing ? (
              <div className="flex items-center gap-2 px-0.5 py-1">
                {/* Scanning animation */}
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3, 4].map((j) => (
                    <div
                      key={j}
                      className="w-0.5 rounded-full bg-[#D76B3D]"
                      style={{
                        height: 16,
                        animation: 'scanBar 1s ease-in-out infinite',
                        animationDelay: `${j * 0.1}s`,
                        opacity: 0.7,
                      }}
                    />
                  ))}
                </div>
                <p className="text-[13px] text-zinc-400">{msg.text}</p>
              </div>
            ) : (
              <p className="max-w-[95%] text-[13px] leading-relaxed text-zinc-300 px-0.5">{msg.text}</p>
            )}

            {msg.action && ACTION_LABELS[msg.action.type] && (
              <p className="text-[10px] text-[#D76B3D]/60 mt-0.5 px-0.5">{ACTION_LABELS[msg.action.type]}</p>
            )}

            {msg.insight && (
              <div className="mt-1 max-w-[88%] px-3 py-1.5 rounded-lg text-[11px] text-[#D76B3D]"
                style={{ background: 'rgba(215,107,61,0.07)', border: '1px solid rgba(215,107,61,0.12)' }}>
                {msg.insight}
              </div>
            )}

            {/* Analysis results card */}
            {msg.analysisSites && msg.analysisSites.length > 0 && (
              <div className="mt-2 w-full space-y-1.5">
                {msg.analysisSites.map((site, si) => (
                  <button
                    key={si}
                    onClick={() => onAction({ type: 'fly_to', lat: site.lat, lng: site.lng, site })}
                    className="w-full text-left rounded-xl px-3 py-2.5 transition-all hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background: 'rgba(215,107,61,0.08)', border: '1px solid rgba(215,107,61,0.2)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-[12px] font-semibold leading-tight truncate">
                          <span className="text-[#D76B3D] mr-1">#{si + 1}</span>{site.address}
                        </p>
                        <p className="text-zinc-500 text-[10px] mt-0.5">{site.zone} · tap to fly there</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[#D76B3D] text-[11px] font-bold">{site.score.toFixed(0)}</p>
                        <p className="text-zinc-600 text-[9px]">score</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      <div>
                        <p className="text-zinc-600 text-[9px] uppercase tracking-wide">Air Rights</p>
                        <p className="text-white text-[10px] font-medium">{(site.air_rights_sqft / 1000).toFixed(0)}k sqft</p>
                      </div>
                      <div>
                        <p className="text-zinc-600 text-[9px] uppercase tracking-wide">FAR Used</p>
                        <p className="text-white text-[10px] font-medium">{(site.far_utilization * 100).toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="text-zinc-600 text-[9px] uppercase tracking-wide">Nearby Dev</p>
                        <p className="text-white text-[10px] font-medium">{site.momentum ?? 0} permits</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {(loading || isRunningSequence) && !messages.some((m) => m.isAnalyzing) && (
          <div className="flex items-center gap-1 px-0.5 py-1">
            {[0, 150, 300].map((d) => (
              <div key={d} className="w-1 h-1 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className="text-[11px] text-zinc-400 px-3 py-1 rounded-full transition-all hover:text-white"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {showBriefCta && (
        <div className="px-4 pb-2 pt-1 border-t border-white/[0.06] shrink-0">
          <button
            type="button"
            onClick={() => void generateCaseBrief()}
            disabled={briefLoading}
            className="w-full rounded-xl px-3 py-2.5 text-[12px] font-semibold tracking-wide text-white transition-all disabled:opacity-45 hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, rgba(215,107,61,0.35), rgba(215,107,61,0.12))',
              border: '1px solid rgba(215,107,61,0.45)',
              boxShadow: '0 0 24px rgba(215,107,61,0.12)',
            }}
          >
            {briefLoading ? 'Building PDF…' : 'Download case brief (PDF)'}
          </button>
          {briefError && <p className="text-red-400/90 text-[11px] mt-1.5 px-0.5">{briefError}</p>}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-1">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input) }}
          className="flex gap-2 items-center rounded-xl px-3 py-2"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRunningSequence ? 'Analysis in progress...' : 'Ask or paste a case study...'}
            disabled={loading || isRunningSequence}
            className="flex-1 bg-transparent text-[13px] text-white placeholder-zinc-600 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || isRunningSequence || !input.trim()}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 flex-shrink-0"
            style={{ background: input.trim() && !isRunningSequence ? 'linear-gradient(135deg, #D76B3D, #b85a30)' : 'rgba(255,255,255,0.05)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-3.5 h-3.5">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>

      <style>{`
        @keyframes scanBar {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}
