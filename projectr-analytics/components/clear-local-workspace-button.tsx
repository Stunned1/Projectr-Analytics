'use client'

import { clearLocalWorkspaceForTesting } from '@/lib/local-workspace-reset'

type ClearLocalWorkspaceButtonProps = {
  /** e.g. sidebar vs upload page */
  variant?: 'sidebar' | 'panel'
}

export function ClearLocalWorkspaceButton({ variant = 'panel' }: ClearLocalWorkspaceButtonProps) {
  const isSidebar = variant === 'sidebar'

  return (
    <button
      type="button"
      onClick={() => {
        if (
          !window.confirm(
            'Clear this tab’s local test data?\n\n• Client CSV session & preview\n• Upload map pins\n• AI agent chat history\n• Pending map navigation from sidebar\n\nThe page will reload. Supabase and shortlist are not deleted.'
          )
        ) {
          return
        }
        clearLocalWorkspaceForTesting()
      }}
      className={
        isSidebar
          ? 'w-full rounded-md border border-border/50 bg-transparent px-2 py-1.5 text-[9px] font-medium text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-200/90'
          : 'rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-amber-500/35 hover:bg-muted/30 hover:text-foreground'
      }
    >
      <span className={isSidebar ? '' : 'font-semibold text-foreground/90'}>Clear local test data</span>
      {!isSidebar && (
        <span className="mt-0.5 block text-[10px] text-muted-foreground/90">
          Session CSV, pins, agent chat, pending nav — reloads this tab only.
        </span>
      )}
    </button>
  )
}
