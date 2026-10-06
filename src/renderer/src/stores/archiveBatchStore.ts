import { useEffect } from 'react'
import { create } from 'zustand'
import type { ArchiveBatchJob, ArchiveBatchOp } from '@appTypes/utils'
import { ipcManager } from '~/app/ipc'
import { getGameStore } from '~/stores/game/gameStoreFactory'

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
  taskCenterOpen: boolean
  setTaskCenterOpen: (open: boolean) => void
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

  closeDialog: (): void => set({ dialogOpen: false }),

  taskCenterOpen: false,
  setTaskCenterOpen: (open): void => set({ taskCenterOpen: open })
}))

/**
 * Single-game operations (extract / compress / backup / version check) do not create a
 * batch job, so the task center synthesises a one-item job from their progress events.
 */
const singleJobsByGame = new Map<string, string>()

function singleJobId(gameId: string): string {
  return 'single:' + gameId
}

function upsertSingleJob(
  gameId: string,
  op: ArchiveBatchJob['op'],
  percent: number,
  finished = false
): void {
  const id = singleJobId(gameId)
  singleJobsByGame.set(gameId, id)
  const state = useArchiveBatchStore.getState()
  const previous = state.jobs.find((job) => job.id === id)
  let name = previous?.items[0]?.name ?? ''
  if (!name) {
    try {
      name = getGameStore(gameId).getState().data?.metadata?.name ?? gameId
    } catch {
      name = gameId
    }
  }
  const done = finished || percent >= 100
  const job: ArchiveBatchJob = {
    id,
    op,
    status: done ? 'completed' : 'running',
    concurrency: 1,
    items: [
      {
        gameId,
        name,
        status: done ? 'success' : 'running',
        detail: '',
        progress: Math.max(0, Math.min(100, Math.round(percent)))
      }
    ],
    startedAt: previous?.startedAt ?? new Date().toISOString(),
    finishedAt: done ? new Date().toISOString() : ''
  }
  useArchiveBatchStore.setState({ jobs: upsert(state.jobs, job) })
}

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

    // Single-game progress: only build a task when the game is not part of a batch job.
    const offSingle = ipcManager.on('archive:job-progress', (_event, payload) => {
      const state = useArchiveBatchStore.getState()
      const inBatch = state.jobs.some(
        (job) =>
          job.status === 'running' &&
          job.items.some((item) => item.gameId === payload.gameId && item.status === 'running')
      )
      if (inBatch) return
      upsertSingleJob(payload.gameId, payload.jobType as ArchiveBatchJob['op'], payload.percent)
    })
    const offState = ipcManager.on('archive:state-changed', (_event, payload) => {
      if (payload.to === 'extracted' || payload.to === 'archived') {
        const id = singleJobsByGame.get(payload.gameId)
        if (id) {
          upsertSingleJob(payload.gameId, payload.to === 'archived' ? 'compress' : 'extract', 100, true)
        }
      }
    })

    void useArchiveBatchStore.getState().refresh()
    return () => {
      offProgress()
      offFinished()
      offSingle()
      offState()
    }
  }, [])
}
