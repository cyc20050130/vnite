import { ipcManager } from '~/core/ipc'
import { pluginService } from './services'
import { PluginInstallOptions, PluginSearchOptions } from '@appTypes/plugin'
import {
  invokeMenu,
  listMenus,
  listPanels,
  loadPanel,
  type PluginMenuContext,
  type PluginPanelKind
} from './contributions'

export function setupPluginIPC(): void {
  ipcManager.handle('plugin:list-menu-contributions', async (_, context: PluginMenuContext) => {
    return listMenus(context)
  })

  ipcManager.handle('plugin:list-panels', async (_, kind: PluginPanelKind) => {
    return listPanels(kind)
  })

  ipcManager.handle('plugin:load-panel', async (_, id: string) => {
    return await loadPanel(id)
  })

  ipcManager.handle(
    'plugin:invoke-menu-contribution',
    async (_, id: string, payload: unknown) => {
      try {
        await invokeMenu(id, payload)
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcManager.handle('plugin:get-all-plugins', async () => {
    return pluginService.getSerializablePlugins()
  })

  ipcManager.handle('plugin:get-plugin', async (_, pluginId: string) => {
    return pluginService.getSerializablePlugin(pluginId)
  })

  ipcManager.handle('plugin:search-plugins', async (_, keyword: PluginSearchOptions) => {
    return await pluginService.searchPlugins(keyword)
  })

  ipcManager.handle(
    'plugin:install-plugin',
    async (_, source: string, options?: PluginInstallOptions) => {
      try {
        await pluginService.installPlugin(source, options)
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcManager.handle(
    'plugin:install-plugin-from-file',
    async (_, filePath: string, options?: { autoEnable?: boolean }) => {
      try {
        await pluginService.installPluginFromFile(filePath, options)
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcManager.handle('plugin:uninstall-plugin', async (_, pluginId: string) => {
    try {
      await pluginService.uninstallPlugin(pluginId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcManager.handle('plugin:activate-plugin', async (_, pluginId: string) => {
    try {
      await pluginService.activatePlugin(pluginId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcManager.handle('plugin:deactivate-plugin', async (_, pluginId: string) => {
    try {
      await pluginService.deactivatePlugin(pluginId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcManager.handle('plugin:check-updates', async () => {
    return await pluginService.checkPluginUpdates()
  })

  ipcManager.handle('plugin:get-stats', async () => {
    return pluginService.getPluginStats()
  })

  ipcManager.handle('plugin:get-plugin-configuration', async (_, pluginId: string) => {
    return await pluginService.getPluginConfiguration(pluginId)
  })
}
