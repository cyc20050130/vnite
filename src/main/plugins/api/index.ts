import { ConfigDBManager, GameDBManager, PluginDBManager } from '~/core/database'
import { eventBus } from '~/core/events'
import { ipcManager } from '~/core/ipc'
import { scraperManager } from '~/features/scraper/services/ScraperManager'
import { registerAction, registerMenu, registerPanel } from '../contributions'

export class VnitePluginAPI {
  public readonly pluginId: string
  public readonly ConfigDB = ConfigDBManager
  public readonly GameDB = GameDBManager
  public readonly PluginDB: {
    getValue: (key: string, defaultValue?: any) => Promise<any>
    setValue: (key: string, value: any) => Promise<void>
  }
  public readonly eventBus = eventBus
  public readonly ipc = ipcManager
  public readonly scraper = scraperManager

  /** UI contribution points (menus + their action handlers). */
  public readonly contributes = {
    menu: (item: { id: string; label: string; context?: 'game' | 'batch' }): void => {
      registerMenu(this.pluginId, item)
    },
    action: (id: string, handler: (payload: unknown) => Promise<void> | void): void => {
      registerAction(this.pluginId, id, handler)
    },
    card: (item: {
      id: string
      title: string
      load: () => Promise<{ label: string; value: string }[]> | { label: string; value: string }[]
    }): void => {
      registerPanel(this.pluginId, { ...item, kind: 'card' })
    },
    section: (item: {
      id: string
      title: string
      load: () => Promise<{ label: string; value: string }[]> | { label: string; value: string }[]
    }): void => {
      registerPanel(this.pluginId, { ...item, kind: 'section' })
    }
  }

  /**
   * Archive capabilities for plugins (lazy imports keep the module graph acyclic and
   * let plugins run even when the archive feature is disabled).
   */
  public readonly archive = {
    getStatus: async (gameId: string) => {
      const { getArchiveStatus } = await import('~/features/archive/services/archiveState')
      return await getArchiveStatus(gameId)
    },
    listArchive: async (archivePath: string, password?: string) => {
      const { listArchive } = await import('~/features/archive/services/archiveList')
      return await listArchive(archivePath, password)
    },
    extract: async (gameId: string): Promise<string> => {
      const { ensureExtracted } = await import('~/features/archive/services/archiveState')
      return await ensureExtracted(gameId)
    },
    compress: async (gameId: string): Promise<string> => {
      const { compressGame } = await import('~/features/archive/services/archiveState')
      return await compressGame(gameId)
    },
    backupSaves: async (gameId: string) => {
      const { backupSavesNow } = await import('~/features/archive/services/archiveState')
      return await backupSavesNow(gameId)
    },
    listDuplicates: async (gameId: string) => {
      const local = await GameDBManager.getGameLocal(gameId)
      return local.archive?.duplicates ?? []
    },
    trashDuplicates: async (gameId: string, paths?: string[]) => {
      const { trashDuplicateArchives } = await import(
        '~/features/archive/services/duplicateActions'
      )
      return await trashDuplicateArchives(gameId, paths)
    },
    switchArchive: async (gameId: string, archivePath: string) => {
      const { switchGameArchive } = await import('~/features/archive/services/duplicateActions')
      await switchGameArchive(gameId, archivePath)
    },
    registerEngine: (engine: unknown) => {
      // Kept synchronous so plugins can register during activate().
      void import('~/features/archive/services/engineRegistry').then(({ registerArchiveEngine }) => {
        registerArchiveEngine(engine as never)
      })
    },
    unregisterEngine: (engineId: string) => {
      void import('~/features/archive/services/engineRegistry').then(({ unregisterArchiveEngine }) => {
        unregisterArchiveEngine(engineId)
      })
    },
    listEngines: async () => {
      const { listArchiveEngines } = await import('~/features/archive/services/engineRegistry')
      return listArchiveEngines()
    }
  }

  constructor(pluginId: string) {
    this.pluginId = pluginId
    this.PluginDB = {
      getValue: (key: string, defaultValue?: any): Promise<any> => {
        return PluginDBManager.getPluginValue(this.pluginId, key, defaultValue)
      },
      setValue: (key: string, value: any): Promise<void> => {
        return PluginDBManager.setPluginValue(this.pluginId, key, value)
      }
    }
  }
}
