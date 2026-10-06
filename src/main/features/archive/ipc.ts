import { ipcManager } from '~/core/ipc'
import { listArchive } from './services/archiveList'
import { addPasswords, getPasswords, removePassword } from './services/passwordVault'
import {
  backupSavesNow,
  compressGame,
  ensureExtracted,
  getArchiveStatus,
  runArchiveMaintenance
} from './services/archiveState'
import {
  cancelArchiveBatch,
  listArchiveBatchJobs,
  runArchiveBatch
} from './services/batchRunner'
import type { ArchiveBatchOp } from '@appTypes/utils'

export function setupArchiveIPC(): void {
  ipcManager.handle('archive:get-status', async (_event, gameId: string) =>
    getArchiveStatus(gameId)
  )

  ipcManager.handle('archive:extract', async (_event, gameId: string) => ensureExtracted(gameId))

  ipcManager.handle('archive:compress', async (_event, gameId: string) => compressGame(gameId))

  ipcManager.handle(
    'archive:list',
    async (_event, archivePath: string, password?: string) => listArchive(archivePath, password)
  )

  ipcManager.handle('archive:backup-saves', async (_event, gameId: string) =>
    backupSavesNow(gameId)
  )

  ipcManager.handle(
    'archive:batch-run',
    async (_event, op: ArchiveBatchOp, gameIds: string[], concurrency?: number) =>
      runArchiveBatch(op, gameIds, concurrency)
  )

  ipcManager.handle('archive:batch-cancel', async (_event, jobId: string) =>
    cancelArchiveBatch(jobId)
  )

  ipcManager.handle('archive:batch-jobs', async () => listArchiveBatchJobs())

  ipcManager.handle('archive:run-maintenance', async () => runArchiveMaintenance())

  ipcManager.handle('archive:get-passwords', async () => getPasswords())

  ipcManager.handle('archive:add-passwords', async (_event, values: string[], label?: string) =>
    addPasswords(values, label)
  )

  ipcManager.handle('archive:remove-password', async (_event, id: string) =>
    removePassword(id)
  )

  // Re-try extraction after the user supplied a password.
  ipcManager.handle('archive:retry-password', async (_event, gameId: string) =>
    ensureExtracted(gameId)
  )
}
