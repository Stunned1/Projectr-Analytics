'use client'

import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'

const components: Components = {
  h2: ({ children }) => (
    <h2 className="mt-5 border-b border-border/60 pb-1 text-[13px] font-bold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 text-[12px] font-semibold text-foreground">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="mt-2 text-[13px] leading-[1.65] text-foreground/95 first:mt-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-foreground/95">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-foreground/95">{children}</ol>
  ),
  li: ({ children }) => <li className="[&>p]:mt-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
  code: ({ className, children }) => {
    const inline = !className
    return inline ? (
      <code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[11px] text-primary">{children}</code>
    ) : (
      <code className="block font-mono text-[11px] text-foreground/90">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-background/80 p-2 text-[11px] leading-snug">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-4 border-border/50" />,
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-[12px] italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-primary underline-offset-2 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
}

/** Renders model “thinking” prose (## headings, lists, **bold**) with app-consistent typography. */
export function AgentThinkingMarkdown({ source }: { source: string }) {
  return (
    <div className="agent-thinking-md">
      <ReactMarkdown components={components}>{source}</ReactMarkdown>
    </div>
  )
}
