import path from 'path'
import fse from 'fs-extra'
import { shell } from 'electron'
import log from 'electron-log/main'
import { GameDBManager } from '~/core/database'
import { classifyArchive } from './archiveDetect'
import { guessVersion } from './titleResolver'
import { scoreTranslation, type DuplicateInfo } from './duplicateResolver'

/**
 * Every file that belongs to one archive: the file itself plus its other volumes
 * (x.7z.001 + x.7z.002..., x.part1.rar + x.part2.rar..., x.zip + x.z01...).
 * Deleting a "worse" copy must take all of them, never leave half an archive behind.
 */
export async function collectArchiveVolumes(filePath: string): Promise<string[]> {
  const result = [filePath]
  try {
    const dir = path.dirname(filePath)
    const base = path.basename(filePath)
    const volumeKey = base
      .replace(/\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)\.\d{3}$/i, '$1')
      .replace(/\.(z|r)\d{2}$/i, '')
      .replace(/\.part\d+\.rar$/i, '')
    const siblings = await fse.readdir(dir)
    for (const name of siblings) {
      if (name === base) continue
      const siblingKey = name
        .replace(/\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)\.\d{3}$/i, '$1')
        .replace(/\.(z|r)\d{2}$/i, '')
        .replace(/\.part\d+\.rar$/i, '')
      if (siblingKey !== volumeKey) continue
      // Only names that really look like another volume of the same archive.
      if (!/\.(z|r)\d{2}$/i.test(name) && !/\.\d{3}$/i.test(name) && !/\.part\d+\.rar$/i.test(name)) {
        continue
      }
      if (name.toLowerCase() === base.toLowerCase()) continue
      const full = path.join(dir, name)
      if (!result.includes(full)) result.push(full)
    }
  } catch (error) {
    log.warn('[Archive] Could not list volumes for ' + filePath + ': ' + String(error))
  }
  return result
}

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
      const volumes = await collectArchiveVolumes(duplicate.path)
      for (const volume of volumes) {
        if (currentPaths.has(volume.toLowerCase())) continue
        if (!(await fse.pathExists(volume))) continue
        await shell.trashItem(volume)
        log.info('[Archive] Trashed duplicate archive ' + volume)
      }
      trashed++
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
  // Encryption cannot be read from the filename; probe the header so a switched-in
  // password archive still prompts for its password on extraction.
  let encrypted = false
  try {
    const { listArchive } = await import('./archiveList')
    const listing = await listArchive(archivePath)
    encrypted = listing.status === 'encrypted' || listing.summary?.hasEncryptedData === true
  } catch {
    encrypted = false
  }
  await GameDBManager.setGameLocalValue(gameId, 'archive.encrypted', encrypted)
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
