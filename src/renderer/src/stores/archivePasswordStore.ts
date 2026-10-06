import { create } from 'zustand'
import { ipcManager } from '~/app/ipc'

export interface PendingArchive {
  gameId: string
  archivePath: string
  parts: string[]
  tried: number
  headerEncrypted: boolean
  error?: string
}

interface ArchivePasswordState {
  pending: PendingArchive[]
  collapsed: boolean
  add: (entry: PendingArchive) => void
  dismiss: (gameId: string) => void
  setError: (gameId: string, error: string) => void
  resolve: (gameId: string) => void
  setCollapsed: (collapsed: boolean) => void
  subscribe: () => () => void
}

let subscribed = false

export const useArchivePasswordStore = create<ArchivePasswordState>((set, get) => ({
  pending: [],
  collapsed: false,

  add: (entry): void => {
    if (get().pending.some((item) => item.gameId === entry.gameId)) return
    set({ pending: [...get().pending, entry] })
  },

  dismiss: (gameId): void =>
    set({ pending: get().pending.filter((item) => item.gameId !== gameId) }),

  setError: (gameId, error): void =>
    set({
      pending: get().pending.map((item) => (item.gameId === gameId ? { ...item, error } : item))
    }),

  resolve: (gameId): void => {
    if (!get().pending.some((item) => item.gameId === gameId)) return
    set({ pending: get().pending.filter((item) => item.gameId !== gameId) })
  },

  setCollapsed: (collapsed): void => set({ collapsed }),

  /**
   * Non-blocking password queue: extraction failures land here instead of a modal
   * dialog, so several games can wait at the same time without interrupting the user.
   */
  subscribe: (): (() => void) => {
    const offRequired = ipcManager.on('archive:password-required', (_event, payload) => {
      useArchivePasswordStore.getState().add({ ...payload })
    })
    const offState = ipcManager.on('archive:state-changed', (_event, payload) => {
      if (payload.to === 'extracted') useArchivePasswordStore.getState().resolve(payload.gameId)
    })
    subscribed = true
    return () => {
      offRequired()
      offState()
      subscribed = false
    }
  }
}))

export function isArchivePasswordSubscribed(): boolean {
  return subscribed
}
