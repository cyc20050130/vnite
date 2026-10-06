import { spawn } from 'child_process'
import fse from 'fs-extra'
import { ipcManager } from '~/core/ipc'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import { listArchive } from './services/archiveList'
import { addPasswords, getPasswords, removePassword } from './services/passwordVault'
import {
  backupSavesNow,
  checkIncompleteArchive,
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
import { switchGameArchive, trashDuplicateArchives } from './services/duplicateActions'

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

  ipcManager.handle('archive:check-incomplete', async (_event, gameId: string) =>
    checkIncompleteArchive(gameId)
  )

  ipcManager.handle('archive:batch-cancel', async (_event, jobId: string) =>
    cancelArchiveBatch(jobId)
  )

  ipcManager.handle('archive:batch-jobs', async () => listArchiveBatchJobs())

  // Launch the user's preferred external archiver with the game's archive.
  ipcManager.handle('archive:open-with-external', async (_event, gameId: string) => {
    const configured = await ConfigDBManager.getConfigValue('game.archive.externalToolPath')
    if (!configured || configured.trim().length === 0) throw new Error('NO_EXTERNAL_TOOL')
    const local = await GameDBManager.getGameLocal(gameId)
    const parts = local.archive?.parts ?? []
    const target =
      parts.find((part) => part && fse.existsSync(part)) ?? local.path?.gamePath ?? ''
    if (!target) throw new Error('ARCHIVE_MISSING')
    spawn(configured.trim(), [target], { detached: true, stdio: 'ignore' }).unref()
  })

  ipcManager.handle('archive:duplicates-trash', async (_event, gameId: string, paths?: string[]) =>
    trashDuplicateArchives(gameId, paths)
  )

  ipcManager.handle(
    'archive:duplicates-switch',
    async (_event, gameId: string, archivePath: string) => switchGameArchive(gameId, archivePath)
  )

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
