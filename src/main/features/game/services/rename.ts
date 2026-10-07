import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import { syncArchiveFolder } from '~/features/archive/services/archiveLayout'
import { sanitizeFolderName } from './folderName'

export { sanitizeFolderName }

/**
 * Rename a game's folder so the filesystem matches the localized name (译名).
 *
 * The display name comes from the provider (Bangumi name_cn, VNDB zh-Hans title...).
 * After adding or re-scraping a game we mirror it onto the folder on disk and fix every
 * stored path that pointed inside the old folder.
 */

export interface RenameFolderResult {
  renamed: boolean
  from: string
  to: string
  reason: string
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fse.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/** Rename the folder of a game to its current display name. */
export async function renameGameFolderToName(gameId: string): Promise<RenameFolderResult> {
  const empty = (reason: string): RenameFolderResult => ({ renamed: false, from: '', to: '', reason })
  try {
    const game = await GameDBManager.getGame(gameId)
    const local = await GameDBManager.getGameLocal(gameId)
    if (!game || !local) return empty('noGame')

    const displayName = sanitizeFolderName(game.metadata?.name ?? '')
    if (!displayName) return empty('noName')

    const extractDir = local.archive?.extractDir ?? ''
    const markPath = local.utils?.markPath ?? ''
    const rootPath = local.utils?.rootPath ?? ''
    const gamePath = local.path?.gamePath ?? ''

    const extractedDir = extractDir && (await isDirectory(extractDir)) ? extractDir : ''
    const archiveBacked = Boolean(local.archive?.enabled)

    // Archive games own a folder next to the archive; renaming that folder is safe even
    // while the archive is still packed, so hand the whole job to the layout service.
    if (archiveBacked) {
      const synced = await syncArchiveFolder(gameId)
      if (synced.reason === 'ok') {
        return { renamed: true, from: synced.from, to: synced.to, reason: 'renamedFolder' }
      }
      if (synced.reason === 'alreadyManaged') {
        return { renamed: false, from: synced.to, to: synced.to, reason: 'alreadyNamed' }
      }
      // Anything else (layout disabled, no archive, name clash) keeps the old behaviour.
      if (synced.reason !== 'disabled' && synced.reason !== 'noArchive') {
        return empty(synced.reason)
      }
    }

    // Safety: when an archive is not extracted there is no folder of its own —
    // utils.markPath points at the container directory (e.g. the whole scan root), and
    // renaming that would be catastrophic.
    if (archiveBacked && !extractedDir) return empty('noFolder')

    // Safety: only rename a folder that actually contains the game executable.
    const isInside = (child: string, parent: string): boolean => {
      if (!child || !parent) return false
      const normalizedChild = child.toLowerCase()
      const normalizedParent = parent.toLowerCase().replace(/[\\/]+$/, '')
      return (
        normalizedChild === normalizedParent ||
        normalizedChild.startsWith(normalizedParent + path.sep)
      )
    }
    if (!extractedDir && gamePath && markPath && !isInside(gamePath, markPath)) {
      return empty('noFolder')
    }

    // Which directory represents the game: the extracted folder for archive games,
    // otherwise the folder that was scanned.
    const currentDir = extractedDir
      ? extractedDir
      : markPath && (await isDirectory(markPath))
        ? markPath
        : ''
    if (!currentDir) return empty('noFolder')

    const currentName = path.basename(currentDir)
    if (currentName === displayName) return empty('unchanged')

    const target = path.join(path.dirname(currentDir), displayName)
    if (await fse.pathExists(target)) return empty('exists')

    try {
      await fse.move(currentDir, target, { overwrite: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('[Rename] Failed to rename ' + currentDir + ': ' + message)
      return { renamed: false, from: currentDir, to: target, reason: 'locked' }
    }

    const lowerOld = currentDir.toLowerCase()
    const rewrite = (value: string): string =>
      value && value.toLowerCase().startsWith(lowerOld)
        ? path.join(target, value.slice(currentDir.length))
        : value

    if (extractDir) await GameDBManager.setGameLocalValue(gameId, 'archive.extractDir', target)
    if (markPath) await GameDBManager.setGameLocalValue(gameId, 'utils.markPath', rewrite(markPath))
    if (rootPath && rootPath.toLowerCase() === lowerOld) {
      await GameDBManager.setGameLocalValue(gameId, 'utils.rootPath', target)
    }
    const newGamePath = rewrite(gamePath)
    if (newGamePath !== gamePath) {
      await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', newGamePath)
    }
    const launcherPath = local.launcher?.fileConfig?.path ?? ''
    if (launcherPath) {
      const newLauncherPath = rewrite(launcherPath)
      await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.path', newLauncherPath)
      await GameDBManager.setGameLocalValue(
        gameId,
        'launcher.fileConfig.monitorPath',
        path.dirname(newLauncherPath)
      )
    }
    // localName only records where the game currently lives.
    await GameDBManager.setGameValue(gameId, 'metadata.localName', displayName)

    log.info('[Rename] ' + currentDir + ' -> ' + target)
    return { renamed: true, from: currentDir, to: target, reason: 'ok' }
  } catch (error) {
    log.warn('[Rename] Unexpected failure for ' + gameId + ': ' + String(error))
    return empty('error')
  }
}

/** Rename after a scrape, honouring the user's setting. */
export async function maybeRenameGameFolder(gameId: string): Promise<RenameFolderResult> {
  try {
    const enabled = await ConfigDBManager.getConfigValue('game.scraper.common.renameFolderToName')
    if (!enabled) return { renamed: false, from: '', to: '', reason: 'disabled' }
  } catch {
    // fall through and try anyway
  }
  return await renameGameFolderToName(gameId)
}
