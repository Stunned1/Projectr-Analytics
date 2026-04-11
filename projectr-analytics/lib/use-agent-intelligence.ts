'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { AgentAction, AgentMessage, AgentStep, AnalysisSite, MapContext } from '@/lib/agent-types'
import { AGENT_CHAT_STORAGE_KEY } from '@/lib/agent-chat-storage-key'
import { clearLocalWorkspaceForTesting, clearProjectrBrowserCachesAndReload } from '@/lib/local-workspace-reset'
import { ALL_LAYERS_OFF } from '@/lib/slash-layer-keys'
import {
  buildSlashHelpMessage,
  clearSlashUsageLines,
  goSlashUsageLines,
  isUnknownSlashOnly,
  layersSlashUsageLines,
  parseClearSlashCommand,
  parseGoSlashCommand,
  parseLayersSlashCommand,
  RESTART_CONFIRM_PROMPT_MESSAGE,
  parseRestartSlashCommand,
  parseRotateSlashCommand,
  parseTiltSlashCommand,
  parseViewSlashCommand,
  rotateSlashUsageLines,
  tiltSlashUsageLines,
} from '@/lib/slash-commands'

const ACTION_LOG: Record<string, string> = {
  toggle_layer: 'Layer updated',
  toggle_layers: 'Layers updated',
  set_metric: 'Fill metric changed',
  search: 'Navigating to market',
  generate_memo: 'Opening data panel (memo)',
  focus_data_panel: 'Opening Data tab',
  set_tilt: 'Map tilt updated',
  set_heading: 'Map heading updated',
  run_analysis: 'Running spatial model…',
  show_sites: 'Top sites on map',
  set_permit_filter: 'Permit filter applied',
  fly_to: 'Map centered on site',
  none: '',
}

/** Re-export for callers that imported the key from this module. */
export { AGENT_CHAT_STORAGE_KEY }

/** Slash command: full local workspace reset + reload (see `local-workspace-reset.ts`). */
export const SLASH_COMMAND_CLEAR = '/clear:workspace'

export interface CaseStudyBundle {
  userText: string
  agentLead: string
  insight: string | null
}

type PersistedAgentSession = {
  v: 1
  messages: AgentMessage[]
  caseStudyBundle: CaseStudyBundle | null
}

const DEFAULT_GREETING: AgentMessage = {
  role: 'agent',
  text: 'Engine ready. Enter a command or paste an analyst brief.',
}

function readPersistedSession(): PersistedAgentSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(AGENT_CHAT_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PersistedAgentSession
    if (p.v !== 1 || !Array.isArray(p.messages)) return null
    return p
  } catch {
    return null
  }
}

function writePersistedSession(messages: AgentMessage[], bundle: CaseStudyBundle | null) {
  try {
    sessionStorage.setItem(
      AGENT_CHAT_STORAGE_KEY,
      JSON.stringify({ v: 1, messages, caseStudyBundle: bundle } satisfies PersistedAgentSession)
    )
  } catch {
    /* quota / private mode */
  }
}

export function formatActionLogLine(action: AgentAction | undefined): string | null {
  if (!action || action.type === 'none') return null
  const base = ACTION_LOG[action.type]
  if (!base) return null
  if (action.type === 'toggle_layer' && action.layer) {
    return `${base}: ${action.layer} ${action.value !== false ? 'ON' : 'OFF'}`
  }
  if (action.type === 'toggle_layers' && action.layers) {
    const entries = Object.entries(action.layers)
    const allOff = entries.length > 0 && entries.every(([, v]) => v === false)
    if (allOff) return `${base}: all OFF`
    const on = entries.filter(([, v]) => v).map(([k]) => k)
    if (on.length) return `${base}: ${on.join(', ')} ON`
    return base
  }
  if (action.type === 'search' && action.query) {
    return `${base}: "${action.query}"`
  }
  return base
}

export function useAgentIntelligence(
  mapContext: MapContext,
  onAction: (action: AgentAction) => void,
  options?: {
    /** When true, new agent output triggers onNotifyWhileClosed */
    shouldNotifyWhileClosed?: () => boolean
    onNotifyWhileClosed?: () => void
  }
) {
  const [messages, setMessages] = useState<AgentMessage[]>([DEFAULT_GREETING])
  const [caseStudyBundle, setCaseStudyBundle] = useState<CaseStudyBundle | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isRunningSequence, setIsRunningSequence] = useState(false)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [storageHydrated, setStorageHydrated] = useState(false)
  /** Messages with index < this are hidden in the terminal (scrollback); session still stores full history. */
  const [terminalFirstVisibleIndex, setTerminalFirstVisibleIndex] = useState(0)
  const sequenceRef = useRef<ReturnType<typeof setTimeout>[]>([])
  /** After `/restart`, next plain `y` / `n` completes or cancels the wipe (not sent to Gemini). Cleared by `/help`, `/clear:memory`, `/clear:terminal`, `/clear:layers`, and restart confirm/cancel. */
  const restartConfirmPendingRef = useRef(false)
  const shouldNotifyRef = useRef(options?.shouldNotifyWhileClosed)
  const notifyCbRef = useRef(options?.onNotifyWhileClosed)

  useEffect(() => {
    shouldNotifyRef.current = options?.shouldNotifyWhileClosed
    notifyCbRef.current = options?.onNotifyWhileClosed
  }, [options?.shouldNotifyWhileClosed, options?.onNotifyWhileClosed])

  useEffect(() => {
    const p = readPersistedSession()
    if (p?.messages?.length) {
      setMessages(p.messages)
      setCaseStudyBundle(p.caseStudyBundle ?? null)
    }
    setTerminalFirstVisibleIndex(0)
    setStorageHydrated(true)
  }, [])

  useEffect(() => {
    if (!storageHydrated) return
    writePersistedSession(messages, caseStudyBundle)
  }, [messages, caseStudyBundle, storageHydrated])

  const visibleTerminalMessages = useMemo(() => {
    const s = Math.max(0, Math.min(terminalFirstVisibleIndex, messages.length))
    return messages.slice(s)
  }, [messages, terminalFirstVisibleIndex])

  useEffect(() => {
    return () => {
      sequenceRef.current.forEach(clearTimeout)
    }
  }, [])

  const maybeNotify = useCallback(() => {
    if (shouldNotifyRef.current?.()) notifyCbRef.current?.()
  }, [])

  const runAnalysis = useCallback(
    async (action: AgentAction) => {
      const borough = action.borough ?? 'manhattan'
      const topN = action.top_n ?? 5

      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          text: `Running spatial model across ${borough} parcels…`,
          isAnalyzing: true,
        },
      ])

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ borough, top_n: topN }),
        })
        const data = await res.json()

        if (data.error || !data.sites?.length) {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              role: 'agent',
              text: `Analysis complete — no qualifying sites found. ${data.error ?? ''}`,
            },
          ])
          maybeNotify()
          return
        }

        const sites: AnalysisSite[] = data.sites

        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: 'agent',
            text: `Analysis complete. Top ${sites.length} parcels ranked by upside (FAR, momentum, rent).`,
            analysisSites: sites,
          },
        ])

        onAction({
          type: 'toggle_layers',
          layers: { parcels: false, permits: false, tracts: false, blockGroups: false },
        })
        onAction({ type: 'set_permit_filter', types: [] })
        setTimeout(() => {
          onAction({ type: 'show_sites', sites })
        }, 600)
        maybeNotify()
      } catch {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: 'agent', text: 'Analysis failed. Please try again.' },
        ])
        maybeNotify()
      }
    },
    [onAction, maybeNotify]
  )

  const executeStep = useCallback(
    (step: AgentStep) => {
      setMessages((prev) => {
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
    },
    [onAction, runAnalysis]
  )

  const runSequence = useCallback(
    (steps: AgentStep[]) => {
      setIsRunningSequence(true)
      sequenceRef.current.forEach(clearTimeout)
      sequenceRef.current = []

      steps.forEach((step) => {
        const t = setTimeout(() => executeStep(step), step.delay)
        sequenceRef.current.push(t)
      })

      const maxDelay = Math.max(...steps.map((s) => s.delay), 0) + 1000
      const done = setTimeout(() => setIsRunningSequence(false), maxDelay)
      sequenceRef.current.push(done)
    },
    [executeStep]
  )

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

  const sendMessage = useCallback(
    async (text: string) => {
      const userPrompt = text.trim()
      if (!userPrompt) return

      if (/^\/help\b/i.test(userPrompt)) {
        restartConfirmPendingRef.current = false
        setInput('')
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          { role: 'agent', text: buildSlashHelpMessage() },
        ])
        return
      }

      const restartCmd = parseRestartSlashCommand(userPrompt)
      if (restartCmd) {
        setInput('')
        if (restartCmd.kind === 'prompt') {
          restartConfirmPendingRef.current = true
          setTerminalFirstVisibleIndex(0)
          setMessages([{ role: 'agent', text: RESTART_CONFIRM_PROMPT_MESSAGE }])
          return
        }
        if (restartCmd.kind === 'bad_arg') {
          restartConfirmPendingRef.current = false
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: restartCmd.message },
          ])
          return
        }
        if (restartCmd.kind === 'cancel') {
          restartConfirmPendingRef.current = false
          setTerminalFirstVisibleIndex(0)
          setMessages([DEFAULT_GREETING])
          return
        }
        restartConfirmPendingRef.current = false
        clearProjectrBrowserCachesAndReload()
        return
      }

      if (restartConfirmPendingRef.current) {
        setInput('')
        const low = userPrompt.toLowerCase()
        if (low === 'y' || low === 'yes') {
          restartConfirmPendingRef.current = false
          clearProjectrBrowserCachesAndReload()
          return
        }
        if (low === 'n' || low === 'no') {
          restartConfirmPendingRef.current = false
          setTerminalFirstVisibleIndex(0)
          setMessages([DEFAULT_GREETING])
          return
        }
        setMessages((prev) => [
          ...prev,
          {
            role: 'agent',
            text: 'Reply **y** to clear all `projectr-*` keys and reload, or **n** to cancel.',
          },
        ])
        return
      }

      const clearCmd = parseClearSlashCommand(userPrompt)
      if (clearCmd) {
        setInput('')
        if (clearCmd.kind === 'usage') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: clearSlashUsageLines() },
          ])
          return
        }
        if (clearCmd.kind === 'bad_arg') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: clearCmd.message },
          ])
          return
        }
        if (clearCmd.mode === 'workspace') {
          if (
            !window.confirm(
              'Clear this tab’s local workspace and reload?\n\n• Client CSV session & map pins\n• This chat history\n• Pending sidebar → map navigation\n\nSupabase and shortlist are unchanged.'
            )
          ) {
            setMessages((prev) => [
              ...prev,
              { role: 'user', text: userPrompt, ts: Date.now() },
              { role: 'agent', text: '/clear:workspace cancelled.' },
            ])
            return
          }
          clearLocalWorkspaceForTesting()
          return
        }
        if (clearCmd.mode === 'layers') {
          restartConfirmPendingRef.current = false
          onAction({ type: 'set_permit_filter', types: [] })
          onAction({ type: 'toggle_layers', layers: { ...ALL_LAYERS_OFF } })
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            {
              role: 'agent',
              text: 'All map layers are off and the permit-type filter was cleared.',
              action: { type: 'toggle_layers', layers: { ...ALL_LAYERS_OFF } },
            },
          ])
          return
        }
        if (clearCmd.mode === 'terminal') {
          restartConfirmPendingRef.current = false
          setTerminalFirstVisibleIndex(0)
          setMessages([DEFAULT_GREETING])
          return
        }
        if (clearCmd.mode === 'memory') {
          restartConfirmPendingRef.current = false
          setTerminalFirstVisibleIndex(0)
          setCaseStudyBundle(null)
          setMessages([DEFAULT_GREETING])
          return
        }
      }

      const goCmd = parseGoSlashCommand(userPrompt)
      if (goCmd) {
        setInput('')
        if (goCmd.kind === 'usage') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: goSlashUsageLines() },
          ])
          return
        }
        if (goCmd.kind === 'bad_arg') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: goCmd.message },
          ])
          return
        }
        onAction({ type: 'search', query: goCmd.query })
        setTimeout(() => {
          const form = document.querySelector('form')
          form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        }, 50)
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          {
            role: 'agent',
            text: `Searching for “${goCmd.query}”…`,
            action: { type: 'search', query: goCmd.query },
          },
        ])
        return
      }

      const layersCmd = parseLayersSlashCommand(userPrompt)
      if (layersCmd) {
        setInput('')
        if (layersCmd.kind === 'usage') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: layersSlashUsageLines() },
          ])
          return
        }
        if (layersCmd.kind === 'bad_arg') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: layersCmd.message },
          ])
          return
        }
        const patch = layersCmd.layers as Record<string, boolean>
        onAction({ type: 'toggle_layers', layers: patch })
        const names = Object.keys(patch).join(', ')
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          {
            role: 'agent',
            text: `Layers on: ${names}.`,
            action: { type: 'toggle_layers', layers: patch },
          },
        ])
        return
      }

      const viewCmd = parseViewSlashCommand(userPrompt)
      if (viewCmd) {
        setInput('')
        if (viewCmd.kind === 'usage') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: 'Usage: `/view 3d` (45° tilt) or `/view 2d` (flat map).' },
          ])
          return
        }
        if (viewCmd.kind === 'bad_arg') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            {
              role: 'agent',
              text: `Unknown view mode “${viewCmd.arg}”. Use \`/view 3d\` or \`/view 2d\`.`,
            },
          ])
          return
        }
        const tilt = viewCmd.mode === '3d' ? 45 : 0
        onAction({ type: 'set_tilt', tilt })
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          {
            role: 'agent',
            text: viewCmd.mode === '3d' ? 'Map tilt set to 3D (45°).' : 'Map tilt set to 2D (flat).',
            action: { type: 'set_tilt', tilt },
          },
        ])
        return
      }

      const tiltCmd = parseTiltSlashCommand(userPrompt)
      if (tiltCmd) {
        setInput('')
        if (tiltCmd.kind === 'usage') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: tiltSlashUsageLines() },
          ])
          return
        }
        if (tiltCmd.kind === 'bad_arg') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: tiltCmd.message },
          ])
          return
        }
        onAction({ type: 'set_tilt', tilt: tiltCmd.tiltDegrees })
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          {
            role: 'agent',
            text: tiltCmd.userFacingSummary,
            action: { type: 'set_tilt', tilt: tiltCmd.tiltDegrees },
          },
        ])
        return
      }

      const rotateCmd = parseRotateSlashCommand(userPrompt)
      if (rotateCmd) {
        setInput('')
        if (rotateCmd.kind === 'usage') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: rotateSlashUsageLines() },
          ])
          return
        }
        if (rotateCmd.kind === 'bad_arg') {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text: userPrompt, ts: Date.now() },
            { role: 'agent', text: rotateCmd.message },
          ])
          return
        }
        onAction({ type: 'set_heading', heading: rotateCmd.headingDegrees })
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          {
            role: 'agent',
            text: rotateCmd.userFacingSummary,
            action: { type: 'set_heading', heading: rotateCmd.headingDegrees },
          },
        ])
        return
      }

      if (isUnknownSlashOnly(userPrompt)) {
        setInput('')
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: userPrompt, ts: Date.now() },
          {
            role: 'agent',
            text: 'Unknown slash command. Try /help, or use colon forms like /clear:layers, /layers:rent, /go 10001. Anything else (no leading /, or text after a space mid-sentence) goes to the Gemini agent.',
          },
        ])
        return
      }

      if (loading || isRunningSequence) return

      setCaseStudyBundle({ userText: userPrompt, agentLead: '', insight: null })
      setMessages((prev) => [...prev, { role: 'user', text: userPrompt, ts: Date.now() }])
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
          maybeNotify()
          return
        }

        if (data.steps?.length) {
          setCaseStudyBundle({
            userText: userPrompt,
            agentLead: typeof data.message === 'string' ? data.message : '',
            insight: typeof data.insight === 'string' ? data.insight : null,
          })
          setMessages((prev) => [...prev, { role: 'agent', text: data.message, insight: data.insight }])
          maybeNotify()
          runSequence(data.steps)
          return
        }

        setCaseStudyBundle({
          userText: userPrompt,
          agentLead: typeof data.message === 'string' ? data.message : '',
          insight: typeof data.insight === 'string' ? data.insight : null,
        })
        setMessages((prev) => [
          ...prev,
          {
            role: 'agent',
            text: data.message,
            action: data.action?.type !== 'none' ? data.action : undefined,
            insight: data.insight,
          },
        ])
        maybeNotify()

        if (data.action?.type === 'run_analysis') {
          void runAnalysis(data.action)
        } else if (data.action && data.action.type !== 'none') {
          onAction(data.action)
        }
      } catch {
        setMessages((prev) => [...prev, { role: 'agent', text: 'Connection error.' }])
        maybeNotify()
      } finally {
        setLoading(false)
      }
    },
    [loading, isRunningSequence, mapContext, onAction, runSequence, runAnalysis, maybeNotify]
  )

  return {
    messages,
    visibleTerminalMessages,
    setMessages,
    input,
    setInput,
    loading,
    isRunningSequence,
    sendMessage,
    runAnalysis,
    generateCaseBrief,
    briefLoading,
    briefError,
    ACTION_LOG,
  }
}
