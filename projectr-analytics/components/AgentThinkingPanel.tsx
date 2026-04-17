'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import type { AgentTrace } from '@/lib/agent-types'
import { cn } from '@/lib/utils'
import { AgentThinkingMarkdown } from '@/components/agent-thinking-markdown'

/** Pixels from bottom to still count as “following” the live stream. */
const STICK_THRESHOLD_PX = 72

export function AgentThinkingPanel({
  trace,
  onDismiss,
  className,
  embedded = true,
  streaming = false,
}: {
  trace: AgentTrace | null
  onDismiss?: () => void
  className?: string
  /** False = full-width header for thinking-only aside */
  embedded?: boolean
  /** True while reasoning / JSON model is still in flight (live NDJSON stream). */
  streaming?: boolean
}) {
  const thinkingScrollRef = useRef<HTMLDivElement>(null)
  /** When true, new tokens scroll the thinking pane to the bottom; false if the user scrolled up to read. */
  const stickToBottomRef = useRef(true)
  const wasStreamingRef = useRef(false)

  const updateStickFromScroll = useCallback(() => {
    const el = thinkingScrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = dist < STICK_THRESHOLD_PX
  }, [])

  useLayoutEffect(() => {
    if (streaming && !wasStreamingRef.current) {
      stickToBottomRef.current = true
    }
    wasStreamingRef.current = streaming

    if (!trace?.methodology && !trace?.thinking) return
    const el = thinkingScrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [trace?.methodology, trace?.thinking, streaming])

  if (!trace) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col p-4', className)}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Open the EDA assistant and use <strong className="text-foreground">Show analysis notes</strong> on a reply to
          load methodology, evidence, caveats, and follow-up questions here.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      {!embedded && (
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/50 p-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight text-foreground">Analysis Notes</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Methodology, findings, evidence, and caveats for the active EDA response
            </p>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xl leading-none text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {(trace.methodology || trace.thinking) && (
          <section className="flex min-h-0 flex-col">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-primary">Methodology</p>
            <p className="mb-2.5 text-[10px] leading-snug text-muted-foreground">
              Plain-language explanation of what workspace evidence the assistant used.
            </p>
            <div
              ref={thinkingScrollRef}
              onScroll={updateStickFromScroll}
              className="max-h-[min(55vh,520px)] min-h-[120px] overflow-y-auto rounded-lg border border-border/70 bg-muted/15 p-3 shadow-inner"
            >
              <AgentThinkingMarkdown source={trace.methodology ?? trace.thinking ?? ''} />
            </div>
          </section>
        )}

        <section>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-primary">Summary</p>
            {streaming && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-medium text-primary animate-pulse">
                Live
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug text-foreground">{trace.summary}</p>
        </section>

        {trace.keyFindings && trace.keyFindings.length > 0 && (
          <section>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Key Findings</p>
            <ul className="space-y-2 text-xs leading-relaxed text-foreground/90">
              {trace.keyFindings.map((finding, index) => (
                <li key={index} className="border-l-2 border-primary/35 pl-3">
                  {finding}
                </li>
              ))}
            </ul>
          </section>
        )}

        {trace.evidence && trace.evidence.length > 0 && (
          <section>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Evidence</p>
            <ul className="space-y-2 text-xs leading-relaxed text-foreground/90">
              {trace.evidence.map((item, index) => (
                <li key={index} className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {trace.caveats && trace.caveats.length > 0 && (
          <section className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Caveats
            </p>
            <ul className="space-y-1.5 text-xs leading-relaxed text-foreground/90">
              {trace.caveats.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {trace.nextQuestions && trace.nextQuestions.length > 0 && (
          <section>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Next Questions</p>
            <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-foreground/90">
              {trace.nextQuestions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </section>
        )}

        {trace.detail && (
          <section>
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Legacy Detail</p>
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{trace.detail}</p>
          </section>
        )}

        {trace.plan && trace.plan.length > 0 && (
          <section>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Legacy Plan</p>
            <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-foreground/90">
              {trace.plan.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ol>
          </section>
        )}

        {trace.eval && (
          <section className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Legacy Self-check
            </p>
            <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">{trace.eval}</p>
          </section>
        )}

        {trace.toolCalls && trace.toolCalls.length > 0 && (
          <section>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Tool calls</p>
            <ul className="space-y-2">
              {trace.toolCalls.map((t, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 font-mono text-[10px] leading-snug text-muted-foreground"
                >
                  <span className="font-semibold text-primary">{t.name}</span>
                  {t.ok != null && (
                    <span className={t.ok ? ' text-emerald-500' : ' text-red-400'}>{t.ok ? ' · ok' : ' · error'}</span>
                  )}
                  {t.argsPreview && <pre className="mt-1 whitespace-pre-wrap text-[9px] opacity-90">{t.argsPreview}</pre>}
                  {t.resultPreview && (
                    <pre className="mt-1 whitespace-pre-wrap text-[9px] text-foreground/70">{t.resultPreview}</pre>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {trace.executionSteps && trace.executionSteps.length > 0 && (
          <section>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              Legacy Map Execution Sequence
            </p>
            <ul className="space-y-2">
              {trace.executionSteps.map((row, i) => (
                <li key={i} className="border-l-2 border-primary/35 pl-3">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-wide text-primary/90">
                    {row.actionType}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">{row.message}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {embedded && onDismiss && trace && (
          <div className="border-t border-border/50 pt-4">
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-medium text-muted-foreground hover:text-primary"
            >
              Clear analysis notes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
