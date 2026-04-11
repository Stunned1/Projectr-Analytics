'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { AgentAction, AgentMessage, AgentStep, AnalysisSite, MapContext } from '@/lib/agent-types'

const ACTION_LOG: Record<string, string> = {
  toggle_layer: '→ Layer updated',
  toggle_layers: '→ Layers updated',
  set_metric: '→ Fill metric changed',
  search: '→ Navigating to market',
  generate_memo: '→ Opening data panel (memo)',
  set_tilt: '→ Map tilt updated',
  run_analysis: '→ Running spatial model…',
  show_sites: '→ Top sites on map',
  set_permit_filter: '→ Permit filter applied',
  fly_to: '→ Map centered on site',
  none: '',
}

export function formatActionLogLine(action: AgentAction | undefined): string | null {
  if (!action || action.type === 'none') return null
  const base = ACTION_LOG[action.type]
  if (!base) return null
  if (action.type === 'toggle_layer' && action.layer) {
    return `${base}: ${action.layer} ${action.value !== false ? 'ON' : 'OFF'}`
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
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      role: 'agent',
      text: 'Engine ready. Enter a command or paste an analyst brief.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isRunningSequence, setIsRunningSequence] = useState(false)
  const sequenceRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const shouldNotifyRef = useRef(options?.shouldNotifyWhileClosed)
  const notifyCbRef = useRef(options?.onNotifyWhileClosed)

  useEffect(() => {
    shouldNotifyRef.current = options?.shouldNotifyWhileClosed
    notifyCbRef.current = options?.onNotifyWhileClosed
  }, [options?.shouldNotifyWhileClosed, options?.onNotifyWhileClosed])

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
          layers: { parcels: false, permits: false },
        })
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

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading || isRunningSequence) return
      setMessages((prev) => [...prev, { role: 'user', text: text.trim() }])
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
          setMessages((prev) => [...prev, { role: 'agent', text: 'Something went wrong. Try again.' }])
          maybeNotify()
          return
        }

        if (data.steps?.length) {
          setMessages((prev) => [...prev, { role: 'agent', text: data.message, insight: data.insight }])
          maybeNotify()
          runSequence(data.steps)
          return
        }

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
    setMessages,
    input,
    setInput,
    loading,
    isRunningSequence,
    sendMessage,
    runAnalysis,
    ACTION_LOG,
  }
}
