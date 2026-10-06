import type { ArchiveStatusView } from '@appTypes/models'

export interface IPluginArchiveAPI {
  getStatus(gameId: string): Promise<ArchiveStatusView | null>
  listArchive(archivePath: string, password?: string): Promise<unknown>
  extract(gameId: string): Promise<string>
  compress(gameId: string): Promise<string>
  backupSaves(gameId: string): Promise<{ files: number; mode: string }>
  listDuplicates(gameId: string): Promise<
    { path: string; version: string; translation: string; sizeBytes: number; reason: string }[]
  >
  trashDuplicates(gameId: string, paths?: string[]): Promise<{ trashed: number; skipped: number }>
  switchArchive(gameId: string, archivePath: string): Promise<void>
}

import { ConfigDBManager, GameDBManager } from '~/core/database'
import { EventBus } from '~/core/events'
import { IPCManager } from '~/core/ipc'
import { ScraperManager } from '~/features/scraper/services/ScraperManager'

export interface IPluginAPI {
  readonly pluginId: string
  readonly ConfigDB: ConfigDBManager
  readonly GameDB: GameDBManager
  readonly PluginDB: {
    getValue: (key: string, defaultValue?: any) => Promise<any>
    setValue: (key: string, value: any) => Promise<void>
  }
  readonly eventBus: EventBus
  readonly ipc: IPCManager
  readonly scraper: ScraperManager
  readonly archive: IPluginArchiveAPI
}

export interface IPlugin {
  activate(api: IPluginAPI): Promise<void> | void
  deactivate?(api: IPluginAPI): Promise<void> | void
}
