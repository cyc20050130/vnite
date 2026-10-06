import log from 'electron-log/main'

/**
 * Plugin UI contribution points.
 *
 * Plugins register menu entries and matching action handlers; the renderer asks for
 * the entries of a context and invokes them by id. Everything is namespaced by plugin
 * id so two plugins cannot collide, and deactivating a plugin removes its entries.
 */

export type PluginMenuContext = 'game' | 'batch'

export interface PluginMenuContribution {
  /** Namespaced id: <pluginId>:<id> */
  id: string
  pluginId: string
  label: string
  context: PluginMenuContext
}

type ActionHandler = (payload: unknown) => Promise<void> | void

const menus = new Map<string, PluginMenuContribution>()
const actions = new Map<string, ActionHandler>()

function keyOf(pluginId: string, id: string): string {
  return pluginId + ':' + id
}

export function registerMenu(
  pluginId: string,
  item: { id: string; label: string; context?: PluginMenuContext }
): void {
  if (!item?.id || !item?.label) return
  const key = keyOf(pluginId, item.id)
  menus.set(key, {
    id: key,
    pluginId,
    label: item.label,
    context: item.context ?? 'game'
  })
  log.info('[Plugin] Menu contribution registered: ' + key)
}

export function registerAction(pluginId: string, actionId: string, handler: ActionHandler): void {
  actions.set(keyOf(pluginId, actionId), handler)
}

export function listMenus(context: PluginMenuContext): PluginMenuContribution[] {
  return [...menus.values()].filter((entry) => entry.context === context)
}

export async function invokeMenu(id: string, payload: unknown): Promise<void> {
  const handler = actions.get(id)
  if (!handler) throw new Error('NO_PLUGIN_ACTION')
  await handler(payload)
}

export function clearPluginContributions(pluginId: string): void {
  for (const key of [...menus.keys()]) {
    if (key.startsWith(pluginId + ':')) menus.delete(key)
  }
  for (const key of [...actions.keys()]) {
    if (key.startsWith(pluginId + ':')) actions.delete(key)
  }
}
