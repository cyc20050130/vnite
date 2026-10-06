import type { ArchiveStatusView } from '@appTypes/models'
import type {
  ArchiveEngine,
  ArchiveEngineInfo
} from '~/features/archive/services/engineRegistry'

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
  /** Register a custom extraction/compression engine (higher priority than built-ins). */
  registerEngine(engine: ArchiveEngine): void
  unregisterEngine(engineId: string): void
  listEngines(): Promise<ArchiveEngineInfo[]>
}

export interface IPluginContributesAPI {
  /** Add an entry to a context menu ('game' for a single game, 'batch' for multi-select). */
  menu(item: { id: string; label: string; context?: 'game' | 'batch' }): void
  /** Handle clicks of the menu entry with the same id. */
  action(id: string, handler: (payload: unknown) => Promise<void> | void): void
  /** Read-only card on the game overview page (label/value rows). */
  card(item: {
    id: string
    title: string
    load: () => Promise<{ label: string; value: string }[]> | { label: string; value: string }[]
  }): void
  /** Read-only section on the settings page. */
  section(item: {
    id: string
    title: string
    load: () => Promise<{ label: string; value: string }[]> | { label: string; value: string }[]
  }): void
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
  readonly contributes: IPluginContributesAPI
}

export interface IPlugin {
  activate(api: IPluginAPI): Promise<void> | void
  deactivate?(api: IPluginAPI): Promise<void> | void
}
