import path from 'path'
import fse from 'fs-extra'
import { shell } from 'electron'
import log from 'electron-log/main'
import { GameDBManager } from '~/core/database'
import { classifyArchive } from './archiveDetect'
import { guessVersion } from './titleResolver'
import { scoreTranslation, type DuplicateInfo } from './duplicateResolver'

/** Move the recorded duplicate archives to the system recycle bin. */
export async function trashDuplicateArchives(
  gameId: string,
  paths?: string[]
): Promise<{ trashed: number; skipped: number }> {
  const local = await GameDBManager.getGameLocal(gameId)
  const duplicates = local.archive?.duplicates ?? []
  const currentPaths = new Set((local.archive?.parts ?? []).map((entry) => entry.toLowerCase()))
  const selected =
    paths && paths.length > 0 ? duplicates.filter((entry) => paths.includes(entry.path)) : duplicates

  let trashed = 0
  let skipped = 0
  const remaining: DuplicateInfo[] = []

  for (const duplicate of duplicates) {
    if (!selected.includes(duplicate)) {
      remaining.push(duplicate)
      continue
    }
    if (currentPaths.has(duplicate.path.toLowerCase())) {
      remaining.push(duplicate)
      skipped++
      continue
    }
    if (!(await fse.pathExists(duplicate.path))) {
      skipped++
      continue
    }
    try {
      await shell.trashItem(duplicate.path)
      trashed++
      log.info('[Archive] Trashed duplicate archive ' + duplicate.path)
    } catch (error) {
      log.warn('[Archive] Failed to trash ' + duplicate.path + ': ' + String(error))
      remaining.push(duplicate)
      skipped++
    }
  }

  await GameDBManager.setGameLocalValue(gameId, 'archive.duplicates', remaining)
  return { trashed, skipped }
}

/**
 * Make another archive the game's active one. The previously active archive is kept
 * (moved into the duplicate list) so nothing is lost.
 */
export async function switchGameArchive(
  gameId: string,
  archivePath: string,
  options: { compressFirst?: boolean } = {}
): Promise<void> {
  const local = await GameDBManager.getGameLocal(gameId)
  const archive = local.archive
  if (!archive || !archive.enabled) throw new Error('NOT_ARCHIVE_BACKED')
  if (archive.state === 'extracted') {
    // Switching while extracted is only safe after packing the current folder back up,
    // otherwise the extracted files would look orphaned.
    if (!options.compressFirst) throw new Error('GAME_EXTRACTED')
    const { compressGame } = await import('./archiveState')
    await compressGame(gameId)
  }
  if (!(await fse.pathExists(archivePath))) throw new Error('ARCHIVE_MISSING')

  const duplicates = archive.duplicates ?? []
  const previous = (archive.parts ?? [])[0] ?? ''
  const info = classifyArchive(path.basename(archivePath))
  const stats = await fse.stat(archivePath)

  await GameDBManager.setGameLocalValue(gameId, 'archive.parts', [archivePath])
  await GameDBManager.setGameLocalValue(gameId, 'archive.format', (info?.format ?? 'other') as never)
  await GameDBManager.setGameLocalValue(gameId, 'archive.state', 'archived' as never)
  await GameDBManager.setGameLocalValue(gameId, 'archive.encrypted', Boolean(info?.encrypted))
  await GameDBManager.setGameLocalValue(gameId, 'archive.archiveBytes', stats.size)
  await GameDBManager.setGameLocalValue(gameId, 'archive.extractDir', '')
  await GameDBManager.setGameLocalValue(gameId, 'archive.entrypoint', '')
  await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', archivePath)

  const remaining = duplicates.filter((entry) => entry.path !== archivePath)
  if (previous && previous !== archivePath) {
    const translation = scoreTranslation(path.basename(previous))
    remaining.push({
      path: previous,
      version: guessVersion(path.basename(previous)).version ?? '',
      translation: translation.label,
      sizeBytes: (await fse.pathExists(previous)) ? (await fse.stat(previous)).size : 0,
      reason: 'switchedOut'
    })
  }
  await GameDBManager.setGameLocalValue(gameId, 'archive.duplicates', remaining)
  log.info('[Archive] Switched ' + gameId + ' to ' + archivePath)
}
