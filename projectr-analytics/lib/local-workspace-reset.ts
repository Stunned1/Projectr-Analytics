import { AGENT_CHAT_STORAGE_KEY } from '@/lib/agent-chat-storage-key'
import { clearClientUploadWorkingRows } from '@/lib/client-upload-working-rows'
import { PENDING_NAV_KEY } from '@/lib/pending-navigation'
import { SAVED_CHARTS_STORAGE_KEY } from '@/lib/saved-charts-store'

/**
 * sessionStorage keys used for command-center local state (this browser tab).
 * Clearing them + reload resets Client CSV ingest, pins, agent transcript, and pending nav.
 */
export const LOCAL_WORKSPACE_SESSION_KEYS: readonly string[] = [
  'projectr-client-upload-session',
  'projectr-client-upload-markers',
  'scout-client-upload-markers',
  AGENT_CHAT_STORAGE_KEY,
  PENDING_NAV_KEY,
  SAVED_CHARTS_STORAGE_KEY,
]

/**
 * Removes workspace keys from sessionStorage and reloads the tab so Zustand + agent UI rehydrate clean.
 * Does not touch Supabase, shortlist (`saved_sites`), or other caches.
 */
export function clearLocalWorkspaceForTesting(): void {
  if (typeof window === 'undefined') return
  void clearClientUploadWorkingRows().finally(() => {
    for (const key of LOCAL_WORKSPACE_SESSION_KEYS) {
      try {
        sessionStorage.removeItem(key)
      } catch {
        /* quota / private mode */
      }
    }
    window.location.reload()
  })
}

const PROJECTR_STORAGE_KEY_PREFIX = 'projectr-'

/**
 * Removes every `sessionStorage` and `localStorage` key whose name starts with `projectr-`, then reloads.
 * Use after the user confirms **`/restart`** (plain **y** or **`/restart y`**) — broader than {@link clearLocalWorkspaceForTesting} if new keys are added later.
 * Does not touch Supabase, cookies, or non-Projectr keys.
 */
export function clearProjectrBrowserCachesAndReload(): void {
  if (typeof window === 'undefined') return
  void clearClientUploadWorkingRows().finally(() => {
    for (const storage of [sessionStorage, localStorage] as const) {
      try {
        const toRemove: string[] = []
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i)
          if (k?.startsWith(PROJECTR_STORAGE_KEY_PREFIX)) toRemove.push(k)
        }
        for (const k of toRemove) storage.removeItem(k)
      } catch {
        /* quota / private mode */
      }
    }
    window.location.reload()
  })
}
