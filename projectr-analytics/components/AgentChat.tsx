'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export interface AgentAction {
  type: 'toggle_layer' | 'toggle_layers' | 'set_metric' | 'search' | 'generate_memo' | 'set_tilt' | 'none'
  layer?: string
  value?: boolean
  layers?: Record<string, boolean>
  metric?: 'zori' | 'zhvi'
  query?: string
  tilt?: number
}

interface Message {
  role: 'user' | 'agent'
  text: string
  action?: AgentAction
  insight?: string | null
  timestamp: Date
}

interface MapContext {
  label?: string | null
  zip?: string | null
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
}

const ACTION_LABELS: Record<string, string> = {
  toggle_layer: '↳ Layer updated',
  toggle_layers: '↳ Layers updated',
  set_metric: '↳ Metric changed',
  search: '↳ Navigating to market',
  generate_memo: '↳ Opening memo',
  set_tilt: '↳ Map tilted',
  none: '',
}

const SUGGESTIONS = [
  'Show me flood risk zones',
  "What's the vacancy rate here?",
  'Highlight transit connectivity',
]

export default function AgentChat({ mapContext, onAction, isOpen, onToggle, hasStatsBar }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'agent',
      text: 'Spatial analyst ready. Ask me to navigate markets, toggle layers, or analyze conditions.',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 150)
  }, [isOpen])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    setMessages((prev) => [...prev, { role: 'user', text: text.trim(), timestamp: new Date() }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), context: mapContext }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [...prev, { role: 'agent', text: 'Something went wrong. Try again.', timestamp: new Date() }])
        return
      }

      setMessages((prev) => [...prev, {
        role: 'agent',
        text: data.message,
        action: data.action?.type !== 'none' ? data.action : undefined,
        insight: data.insight,
        timestamp: new Date(),
      }])

      if (data.action && data.action.type !== 'none') onAction(data.action)
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', text: 'Connection error.', timestamp: new Date() }])
    } finally {
      setLoading(false)
    }
  }, [loading, mapContext, onAction])

  const bottomOffset = hasStatsBar ? 'bottom-[76px]' : 'bottom-4'

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className={`absolute ${bottomOffset} right-4 z-40 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105`}
        style={{ background: 'linear-gradient(135deg, #D76B3D, #b85a30)' }}
        title="Open AI Agent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.5} className="w-4 h-4">
          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z" />
          <path d="M8 12h8M12 8v8" strokeLinecap="round" />
        </svg>
      </button>
    )
  }

  return (
    <div
      className={`absolute ${bottomOffset} right-4 z-40 w-[340px] flex flex-col rounded-2xl overflow-hidden shadow-2xl`}
      style={{
        background: 'rgba(10, 10, 10, 0.82)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#D76B3D]" style={{ boxShadow: '0 0 6px #D76B3D' }} />
          <span className="text-white text-sm font-semibold tracking-tight">Projectr AI Agent</span>
        </div>
        <button onClick={onToggle} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/5">×</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-64 scrollbar-thin">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className="max-w-[88%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed"
              style={msg.role === 'user' ? {
                background: 'rgba(215, 107, 61, 0.15)',
                border: '1px solid rgba(215, 107, 61, 0.25)',
                color: '#fff',
              } : {
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: '#d4d4d8',
              }}
            >
              {msg.text}
            </div>
            {msg.action && (
              <p className="text-[10px] text-[#D76B3D]/70 mt-0.5 px-1">{ACTION_LABELS[msg.action.type]}</p>
            )}
            {msg.insight && (
              <div className="mt-1 max-w-[88%] px-3 py-1.5 rounded-lg text-[11px] text-[#D76B3D]"
                style={{ background: 'rgba(215,107,61,0.08)', border: '1px solid rgba(215,107,61,0.15)' }}>
                {msg.insight}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex gap-1 items-center h-4">
                {[0, 150, 300].map((d) => (
                  <div key={d} className="w-1 h-1 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
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
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-1">
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(input) }}
          className="flex gap-2 items-center rounded-xl px-3 py-2"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this market..."
            disabled={loading}
            className="flex-1 bg-transparent text-[13px] text-white placeholder-zinc-600 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 flex-shrink-0"
            style={{ background: input.trim() ? 'linear-gradient(135deg, #D76B3D, #b85a30)' : 'rgba(255,255,255,0.06)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-3.5 h-3.5">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
