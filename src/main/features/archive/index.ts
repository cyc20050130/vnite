export * from './services/archiveDetect'
export * from './services/slt'
export * from './services/titleResolver'
export * from './services/sevenZip'
export * from './services/archiveList'
export * from './services/archiveState'
export * from './services/rarEngine'
export { setupArchiveIPC } from './ipc'

import { setupArchiveIPC } from './ipc'
import { runArchiveMaintenance } from './services/archiveState'

/**
 * Register archive IPC and schedule the periodic sweep that re-compresses games
 * which have been marked as finished ("完结核销").
 */
export function setupArchive(): void {
  setupArchiveIPC()

  const timer = setInterval(() => {
    void runArchiveMaintenance()
  }, 5 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
}
