import { ipcManager } from '~/core/ipc'
import { listArchive } from './services/archiveList'
import {
  compressGame,
  ensureExtracted,
  getArchiveStatus,
  runArchiveMaintenance
} from './services/archiveState'

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

  ipcManager.handle('archive:run-maintenance', async () => runArchiveMaintenance())
}
