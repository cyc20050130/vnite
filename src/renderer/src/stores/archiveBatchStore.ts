import { useEffect } from 'react'
import { create } from 'zustand'
import type { ArchiveBatchJob, ArchiveBatchOp } from '@appTypes/utils'
import { ipcManager } from '~/app/ipc'

interface ArchiveBatchState {
  jobs: ArchiveBatchJob[]
  activeJobId: string
  dialogOpen: boolean
  refresh: () => Promise<void>
  start: (op: ArchiveBatchOp, gameIds: string[], concurrency?: number) => Promise<void>
  cancel: (jobId: string) => Promise<void>
  retryFailed: (jobId: string, concurrency?: number) => Promise<void>
  openDialog: (jobId?: string) => void
  closeDialog: () => void
}

function upsert(jobs: ArchiveBatchJob[], job: ArchiveBatchJob): ArchiveBatchJob[] {
  const next = jobs.filter((entry) => entry.id !== job.id)
  return [job, ...next].slice(0, 20)
}

export const useArchiveBatchStore = create<ArchiveBatchState>((set, get) => ({
  jobs: [],
  activeJobId: '',
  dialogOpen: false,

  refresh: async (): Promise<void> => {
    const jobs = await ipcManager.invoke('archive:batch-jobs')
    set({ jobs })
  },

  start: async (op, gameIds, concurrency): Promise<void> => {
    const job = await ipcManager.invoke('archive:batch-run', op, gameIds, concurrency)
    set({ jobs: upsert(get().jobs, job), activeJobId: job.id, dialogOpen: true })
  },

  cancel: async (jobId): Promise<void> => {
    await ipcManager.invoke('archive:batch-cancel', jobId)
  },

  retryFailed: async (jobId, concurrency): Promise<void> => {
    const job = get().jobs.find((entry) => entry.id === jobId)
    if (!job) return
    const failed = job.items.filter((item) => item.status === 'failed').map((item) => item.gameId)
    if (failed.length === 0) return
    const next = await ipcManager.invoke(
      'archive:batch-run',
      job.op,
      failed,
      concurrency ?? job.concurrency
    )
    set({ jobs: upsert(get().jobs, next), activeJobId: next.id })
  },

  openDialog: (jobId): void => {
    const target = jobId ?? get().activeJobId
    set({ dialogOpen: true, activeJobId: target })
  },

  closeDialog: (): void => set({ dialogOpen: false })
}))

/** Subscribe to batch events once, from a long-lived component. */
export function useArchiveBatchEvents(): void {
  useEffect(() => {
    const handle = (_event: unknown, job: ArchiveBatchJob): void => {
      useArchiveBatchStore.setState((state) => ({
        jobs: upsert(state.jobs, job),
        activeJobId: state.activeJobId || job.id
      }))
    }
    const offProgress = ipcManager.on('archive:batch-progress', handle)
    const offFinished = ipcManager.on('archive:batch-finished', handle)
    void useArchiveBatchStore.getState().refresh()
    return () => {
      offProgress()
      offFinished()
    }
  }, [])
}
