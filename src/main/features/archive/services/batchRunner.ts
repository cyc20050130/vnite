import log from 'electron-log/main'
import { ipcManager } from '~/core/ipc'
import { GameDBManager } from '~/core/database'
import { generateUUID } from '@appUtils'
import type { ArchiveBatchItem, ArchiveBatchJob, ArchiveBatchOp } from '@appTypes/utils'
import { backupSavesNow, compressGame, ensureExtracted } from './archiveState'
import { onArchiveProgress } from './batchProgress'
import { trashDuplicateArchives } from './duplicateActions'
import { checkGameVersion } from '~/features/scraper/services/versionCheck'

const DEFAULT_CONCURRENCY: Record<ArchiveBatchOp, number> = {
  extract: 2,
  compress: 1,
  'backup-saves': 2,
  'check-version': 3,
  'resolve-duplicates': 1
}

const jobs = new Map<string, ArchiveBatchJob>()
const jobOrder: string[] = []
const activeGames = new Map<string, { jobId: string; itemIndex: number }>()
const lastEmitAt = new Map<string, number>()
const MAX_HISTORY = 20

function snapshot(job: ArchiveBatchJob): ArchiveBatchJob {
  return JSON.parse(JSON.stringify(job)) as ArchiveBatchJob
}

function emitProgress(job: ArchiveBatchJob, force = false): void {
  const now = Date.now()
  const last = lastEmitAt.get(job.id) ?? 0
  if (!force && now - last < 200) return
  lastEmitAt.set(job.id, now)
  ipcManager.send('archive:batch-progress', snapshot(job))
}

// Mirror per-game extraction/compression progress into the running batch item.
onArchiveProgress((gameId, percent) => {
  const active = activeGames.get(gameId)
  if (!active) return
  const job = jobs.get(active.jobId)
  if (!job) return
  const item = job.items[active.itemIndex]
  if (!item) return
  item.progress = Math.max(0, Math.min(100, Math.round(percent)))
  emitProgress(job)
})

interface SkipDecision {
  skip: boolean
  reason?: string
}

async function shouldSkip(op: ArchiveBatchOp, gameId: string): Promise<SkipDecision> {
  const local = await GameDBManager.getExistingGameLocal(gameId)
  const enabled = Boolean(local?.archive?.enabled)
  const state = local?.archive?.state ?? ''
  switch (op) {
    case 'extract':
      if (!enabled) return { skip: true, reason: 'notArchiveBacked' }
      if (state === 'extracted') return { skip: true, reason: 'alreadyExtracted' }
      return { skip: false }
    case 'compress':
      if (!enabled) return { skip: true, reason: 'notArchiveBacked' }
      if (state !== 'extracted') return { skip: true, reason: 'notExtracted' }
      {
        const playStatus = await GameDBManager.getGameValue(gameId, 'record.playStatus')
        if (playStatus !== 'finished') return { skip: true, reason: 'notFinished' }
      }
      return { skip: false }
    case 'backup-saves':
      if (!enabled) return { skip: true, reason: 'notArchiveBacked' }
      return { skip: false }
    case 'check-version':
      {
        const metadata = await GameDBManager.getGameValue(gameId, 'metadata')
        if (!metadata?.dataSource || !metadata?.dataSourceId) {
          return { skip: true, reason: 'noDataSource' }
        }
      }
      return { skip: false }
    case 'resolve-duplicates':
      if (!enabled) return { skip: true, reason: 'notArchiveBacked' }
      if ((local?.archive?.duplicates ?? []).length === 0) {
        return { skip: true, reason: 'noDuplicates' }
      }
      return { skip: false }
    default:
      return { skip: false }
  }
}

async function runItem(op: ArchiveBatchOp, item: ArchiveBatchItem): Promise<string> {
  switch (op) {
    case 'extract':
      await ensureExtracted(item.gameId)
      return ''
    case 'compress':
      await compressGame(item.gameId)
      return ''
    case 'backup-saves':
      {
        const result = await backupSavesNow(item.gameId)
        return String(result.files)
      }
    case 'check-version':
      {
        const result = await checkGameVersion(item.gameId)
        return result.status
      }
    case 'resolve-duplicates':
      {
        const result = await trashDuplicateArchives(item.gameId)
        return String(result.trashed)
      }
    default:
      return ''
  }
}

async function runPool(job: ArchiveBatchJob): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      if (job.status !== 'running') return
      const index = next++
      if (index >= job.items.length) return
      const item = job.items[index]

      const decision = await shouldSkip(job.op, item.gameId)
      if (decision.skip) {
        item.status = 'skipped'
        item.detail = decision.reason ?? ''
        emitProgress(job, true)
        continue
      }

      item.status = 'running'
      item.progress = 0
      activeGames.set(item.gameId, { jobId: job.id, itemIndex: index })
      emitProgress(job, true)

      try {
        const detail = await runItem(job.op, item)
        item.status = 'success'
        item.detail = detail
        item.progress = 100
      } catch (error) {
        item.status = 'failed'
        item.detail = error instanceof Error ? error.message : String(error)
      } finally {
        activeGames.delete(item.gameId)
      }
      emitProgress(job, true)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, job.concurrency) }, () => worker()))

  if (job.status === 'running') job.status = 'completed'
  job.finishedAt = new Date().toISOString()
  emitProgress(job, true)
  ipcManager.send('archive:batch-finished', snapshot(job))
  log.info(
    '[Archive] Batch ' +
      job.op +
      ' finished: ' +
      job.items.filter((i) => i.status === 'success').length +
      ' ok / ' +
      job.items.filter((i) => i.status === 'failed').length +
      ' failed / ' +
      job.items.filter((i) => i.status === 'skipped').length +
      ' skipped'
  )
}

export async function runArchiveBatch(
  op: ArchiveBatchOp,
  gameIds: string[],
  concurrency?: number
): Promise<ArchiveBatchJob> {
  const job: ArchiveBatchJob = {
    id: generateUUID(),
    op,
    status: 'running',
    concurrency: Math.max(1, Math.min(8, concurrency ?? DEFAULT_CONCURRENCY[op] ?? 1)),
    items: [],
    startedAt: new Date().toISOString(),
    finishedAt: ''
  }

  for (const gameId of gameIds) {
    const game = await GameDBManager.getGame(gameId)
    job.items.push({
      gameId,
      name: game?.metadata?.name || gameId,
      status: 'pending',
      detail: '',
      progress: 0
    })
  }

  jobs.set(job.id, job)
  jobOrder.push(job.id)
  while (jobOrder.length > MAX_HISTORY) {
    const stale = jobOrder.shift()
    if (stale && jobs.get(stale)?.status !== 'running') jobs.delete(stale)
    else if (stale) jobOrder.push(stale)
  }

  void runPool(job)
  return snapshot(job)
}

export function cancelArchiveBatch(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'running') return false
  job.status = 'cancelled'
  job.finishedAt = new Date().toISOString()
  emitProgress(job, true)
  ipcManager.send('archive:batch-finished', snapshot(job))
  return true
}

export function listArchiveBatchJobs(): ArchiveBatchJob[] {
  return jobOrder
    .map((id) => jobs.get(id))
    .filter((job): job is ArchiveBatchJob => Boolean(job))
    .reverse()
    .map(snapshot)
}

export function getArchiveBatchJob(jobId: string): ArchiveBatchJob | null {
  const job = jobs.get(jobId)
  return job ? snapshot(job) : null
}
