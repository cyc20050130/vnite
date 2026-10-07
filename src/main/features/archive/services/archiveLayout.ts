import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import { sanitizeFolderName, stripArchiveExtension } from '~/features/game/services/folderName'

/**
 * Per-game archive folder.
 *
 * When an archive-backed game is imported we give it a folder of its own next to the
 * archive, named after the localized name (译名):
 *
 *   <dir>/<译名>/<original archive>            <- right after the scan
 *   <dir>/<译名>/<译名>\...                    <- after extracting (archive deleted)
 *   <dir>/<译名>/<译名>.7z                     <- after re-compressing when finished
 *
 * The extracted folder therefore always sits at the same level as the archive, and every
 * stored path keeps pointing at the game's own folder instead of the shared scan root.
 */

export interface SyncArchiveFolderResult {
  moved: boolean
  from: string
  to: string
  reason: string
}

const inflight = new Map<string, Promise<SyncArchiveFolderResult>>()

async function isDir(target: string): Promise<boolean> {
  try {
    return (await fse.stat(target)).isDirectory()
  } catch {
    return false
  }
}

function isInside(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const a = path.resolve(child).toLowerCase()
  const b = path.resolve(parent).toLowerCase().replace(/[\\/]+$/, '')
  return a === b || a.startsWith(b + path.sep)
}

export async function syncArchiveFolder(gameId: string): Promise<SyncArchiveFolderResult> {
  const running = inflight.get(gameId)
  if (running) return running
  const task = doSyncArchiveFolder(gameId).finally(() => inflight.delete(gameId))
  inflight.set(gameId, task)
  return task
}

async function doSyncArchiveFolder(gameId: string): Promise<SyncArchiveFolderResult> {
  const empty = (reason: string): SyncArchiveFolderResult => ({
    moved: false,
    from: '',
    to: '',
    reason
  })
  // Feature cancelled on request: archives are no longer moved into a folder of their own.
  // Kept as a no-op so every caller (settings, rename, scan) simply falls back to the old
  // behaviour instead of creating folders again.
  return empty('disabled')
  // eslint-disable-next-line no-unreachable
  try {
    const game = await GameDBManager.getGame(gameId)
    const local = await GameDBManager.getGameLocal(gameId)
    const archive = local?.archive
    if (!game || !local || !archive?.enabled) return empty('notArchiveBacked')
    const enabled = await ConfigDBManager.getConfigValue('game.archive.archiveInFolder')
    if (!enabled) return empty('disabled')

    const parts = (archive.parts ?? []).filter(Boolean)
    const existing: string[] = []
    for (const part of parts) {
      if (await fse.pathExists(part)) existing.push(part)
    }
    const folderPath = archive.folderPath ?? ''
    const extracted =
      archive.extractDir && (await isDir(archive.extractDir)) ? archive.extractDir : ''
    if (existing.length === 0 && !folderPath) return empty('noArchive')

    const displayName = sanitizeFolderName(game.metadata?.name ?? '')
    const fallback = existing[0]
      ? stripArchiveExtension(path.basename(existing[0]))
      : path.basename(folderPath)
    const folderName = displayName || fallback
    if (!folderName) return empty('noName')

    // The parent of the game's own folder — not the archive's directory, which is the
    // folder itself once the archive has been moved inside it.
    const currentParent = folderPath
      ? path.dirname(folderPath)
      : existing[0]
        ? path.dirname(existing[0])
        : ''
    if (!currentParent) return empty('noParent')
    const target = path.join(currentParent, folderName)

    // Already the way we want it: nothing to move on disk, but keep the stored paths fresh.
    const partsInside = existing.every((part) => isInside(part, target))
    const extractInside = !extracted || isInside(extracted, target)
    if (folderPath.toLowerCase() === target.toLowerCase() && partsInside && extractInside) {
      await persist(gameId, {
        folderPath: target,
        parts: existing,
        extractDir: extracted,
        entrypoint: archive.entrypoint ?? ''
      })
      return { moved: false, from: target, to: target, reason: 'alreadyManaged' }
    }

    // Never merge into an existing folder that is not ours.
    if (
      target.toLowerCase() !== folderPath.toLowerCase() &&
      (await isDir(target)) &&
      (await fse.readdir(target).catch(() => [] as string[])).length > 0
    ) {
      return empty('targetExists')
    }

    await fse.ensureDir(target)

    const movedParts: string[] = []
    for (const part of existing) {
      const dest = path.join(target, path.basename(part))
      if (!isInside(part, target)) {
        await fse.move(part, dest, { overwrite: true })
        log.info('[Archive] Moved archive into its folder: ' + part + ' -> ' + dest)
      }
      movedParts.push(dest)
    }

    let finalExtract = extracted
    if (extracted && !isInside(extracted, target)) {
      const dest = path.join(target, path.basename(extracted))
      try {
        await fse.move(extracted, dest, { overwrite: true })
        finalExtract = dest
        log.info('[Archive] Moved extracted folder into its game folder: ' + dest)
      } catch (error) {
        log.warn('[Archive] Could not move extracted folder ' + extracted + ': ' + String(error))
      }
    }

    // Drop the old folder when we emptied it ourselves.
    if (folderPath && folderPath.toLowerCase() !== target.toLowerCase()) {
      const leftovers = await fse.readdir(folderPath).catch(() => [] as string[])
      if (leftovers.length === 0) await fse.remove(folderPath).catch(() => undefined)
    }

    await persist(gameId, {
      folderPath: target,
      parts: movedParts,
      extractDir: finalExtract,
      entrypoint: archive.entrypoint ?? ''
    })
    return { moved: true, from: folderPath, to: target, reason: 'ok' }
  } catch (error) {
    log.warn('[Archive] syncArchiveFolder failed for ' + gameId + ': ' + String(error))
    return empty('error')
  }
}

/** Write every stored path that must follow the game's own folder. */
async function persist(
  gameId: string,
  input: { folderPath: string; parts: string[]; extractDir: string; entrypoint: string }
): Promise<void> {
  await GameDBManager.setGameLocalValue(gameId, 'archive.folderPath', input.folderPath)
  await GameDBManager.setGameLocalValue(gameId, 'archive.layoutManaged', true)
  await GameDBManager.setGameLocalValue(gameId, 'archive.parts', input.parts)
  await GameDBManager.setGameLocalValue(gameId, 'archive.extractDir', input.extractDir)
  await GameDBManager.setGameLocalValue(gameId, 'utils.markPath', input.folderPath)
  await GameDBManager.setGameValue(
    gameId,
    'metadata.localName',
    path.basename(input.folderPath) as never
  )
  if (input.parts.length > 0) {
    await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', input.parts[0])
  } else if (input.extractDir) {
    const exe = input.entrypoint
      ? path.join(input.extractDir, input.entrypoint.split('/').join(path.sep))
      : ''
    const found = exe && (await fse.pathExists(exe)) ? exe : ''
    if (found) {
      await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', found)
      await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.path', found)
      await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.monitorPath', path.dirname(found))
    } else {
      await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', input.extractDir)
    }
  }
}

/** Result of dissolving the (cancelled) per-game archive folders. */
export interface DissolveResult {
  moved: number
  cleared: number
  skipped: number
  failed: string[]
}

/**
 * Undo the per-game archive folder layout.
 *
 * moveFiles: true  -> move every volume back to the folder's parent, remove the folder when
 *                     it ends up empty, and rewrite the stored paths.
 * moveFiles: false -> only clear archive.folderPath and leave every file where it is.
 * onlyUnder limits the work to games whose folder lives under that path.
 */
export async function dissolveArchiveFolders(options: {
  onlyUnder?: string
  moveFiles: boolean
}): Promise<DissolveResult> {
  const result: DissolveResult = { moved: 0, cleared: 0, skipped: 0, failed: [] }
  const filter = (options.onlyUnder ?? '').trim().toLowerCase().replace(/[\\/]+$/, '')
  const locals = ((await GameDBManager.getAllGamesLocal()) ?? {}) as Record<string, any>
  for (const gameId of Object.keys(locals)) {
    const archive = locals[gameId]?.archive
    const folder: string = archive?.folderPath ?? ''
    if (!archive?.enabled || !folder) continue
    const lower = folder.toLowerCase()
    if (
      filter &&
      !(lower === filter || lower.startsWith(filter + path.sep) || lower.startsWith(filter + '/'))
    ) {
      continue
    }
    if (!options.moveFiles) {
      await GameDBManager.setGameLocalValue(gameId, 'archive.folderPath', '')
      await GameDBManager.setGameLocalValue(gameId, 'archive.layoutManaged', false)
      result.cleared++
      log.info('[Archive] Cleared the folder field for ' + gameId + ' (' + folder + ')')
      continue
    }
    const parent = path.dirname(folder)
    const parts = (archive.parts ?? []).filter(Boolean) as string[]
    const movedParts: string[] = []
    let ok = true
    for (const part of parts) {
      if (path.dirname(part).toLowerCase() === parent.toLowerCase()) {
        movedParts.push(part)
        continue
      }
      const dest = path.join(parent, path.basename(part))
      try {
        if (await fse.pathExists(dest)) {
          result.failed.push(path.basename(part) + ' (target already exists)')
          ok = false
          break
        }
        await fse.move(part, dest)
        movedParts.push(dest)
      } catch (error) {
        result.failed.push(path.basename(part) + ' (' + String(error).slice(0, 70) + ')')
        ok = false
        break
      }
    }
    if (!ok) {
      result.skipped++
      continue
    }
    try {
      const left = await fse.readdir(folder)
      if (left.length === 0) await fse.remove(folder)
    } catch {
      // the folder may already be gone or hold something we must not touch
    }
    await GameDBManager.setGameLocalValue(gameId, 'archive.parts', movedParts)
    await GameDBManager.setGameLocalValue(gameId, 'archive.folderPath', '')
    await GameDBManager.setGameLocalValue(gameId, 'archive.layoutManaged', false)
    if (movedParts[0]) {
      await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', movedParts[0])
    }
    await GameDBManager.setGameLocalValue(gameId, 'utils.markPath', parent)
    await GameDBManager.setGameValue(
      gameId,
      'metadata.localName',
      (movedParts[0]
        ? path.basename(movedParts[0], path.extname(movedParts[0]))
        : path.basename(parent)) as never
    )
    result.moved++
    log.info('[Archive] Restored ' + gameId + ' out of ' + folder)
  }
  return result
}
