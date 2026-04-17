import type {
  ClientUploadSession,
  ClientUploadSessionLegacy,
  ClientUploadSessionNew,
} from '@/lib/client-upload-session-store'
import type { UploadRawRow } from '@/lib/upload/types'

const CLIENT_UPLOAD_DB_NAME = 'projectr-client-upload'
const CLIENT_UPLOAD_DB_VERSION = 1
const CLIENT_UPLOAD_WORKING_ROWS_STORE = 'working-rows'

interface ClientUploadWorkingRowsRecord {
  id: string
  rows: UploadRawRow[]
  updatedAt: string
}

function isSessionNew(session: ClientUploadSession): session is ClientUploadSessionNew {
  return Array.isArray((session as ClientUploadSessionNew).sources)
}

function getSessionSources(session: ClientUploadSession | null) {
  if (!session) return []
  if (isSessionNew(session)) return session.sources

  const legacy = session as ClientUploadSessionLegacy
  return [legacy]
}

function openClientUploadDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CLIENT_UPLOAD_DB_NAME, CLIENT_UPLOAD_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CLIENT_UPLOAD_WORKING_ROWS_STORE)) {
        db.createObjectStore(CLIENT_UPLOAD_WORKING_ROWS_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open client upload storage.'))
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
  })
}

function readRequestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

export function buildClientUploadWorkingRowsKey(
  ingestedAt: string,
  index: number,
  fileName: string | null
): string {
  return `${ingestedAt}::${index}::${fileName ?? 'file'}`
}

export function collectClientUploadWorkingRowsKeys(session: ClientUploadSession | null): string[] {
  return getSessionSources(session)
    .map((source) => source.workingRowsKey?.trim() ?? '')
    .filter((key): key is string => key.length > 0)
}

export async function putClientUploadWorkingRows(key: string, rows: UploadRawRow[]): Promise<void> {
  const db = await openClientUploadDb()
  if (!db) return

  try {
    const transaction = db.transaction(CLIENT_UPLOAD_WORKING_ROWS_STORE, 'readwrite')
    transaction.objectStore(CLIENT_UPLOAD_WORKING_ROWS_STORE).put({
      id: key,
      rows,
      updatedAt: new Date().toISOString(),
    } satisfies ClientUploadWorkingRowsRecord)
    await waitForTransaction(transaction)
  } finally {
    db.close()
  }
}

export async function getClientUploadWorkingRows(key: string): Promise<UploadRawRow[] | null> {
  const db = await openClientUploadDb()
  if (!db) return null

  try {
    const transaction = db.transaction(CLIENT_UPLOAD_WORKING_ROWS_STORE, 'readonly')
    const record = await readRequestValue(
      transaction.objectStore(CLIENT_UPLOAD_WORKING_ROWS_STORE).get(key)
    ) as ClientUploadWorkingRowsRecord | undefined
    await waitForTransaction(transaction)
    return record?.rows ?? null
  } finally {
    db.close()
  }
}

export async function deleteClientUploadWorkingRowsMany(keys: string[]): Promise<void> {
  if (keys.length === 0) return

  const db = await openClientUploadDb()
  if (!db) return

  try {
    const transaction = db.transaction(CLIENT_UPLOAD_WORKING_ROWS_STORE, 'readwrite')
    const store = transaction.objectStore(CLIENT_UPLOAD_WORKING_ROWS_STORE)
    for (const key of keys) {
      if (key.trim().length === 0) continue
      store.delete(key)
    }
    await waitForTransaction(transaction)
  } finally {
    db.close()
  }
}

export async function clearClientUploadWorkingRows(): Promise<void> {
  const db = await openClientUploadDb()
  if (!db) return

  try {
    const transaction = db.transaction(CLIENT_UPLOAD_WORKING_ROWS_STORE, 'readwrite')
    transaction.objectStore(CLIENT_UPLOAD_WORKING_ROWS_STORE).clear()
    await waitForTransaction(transaction)
  } finally {
    db.close()
  }
}
