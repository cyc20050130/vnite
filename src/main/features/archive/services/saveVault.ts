import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main'
import { app } from 'electron'
import { ConfigDBManager, GameDBManager } from '~/core/database'

/**
 * Save-data protection.
 *
 * Re-compressing deletes the extracted folder. Saves that a game wrote into that
 * folder (the common case for RPG Maker / KiriKiri / Ren'Py portable builds) would
 * only survive inside the new archive. We additionally mirror them into a vault
 * outside the game folder so a failed compression can never lose them, and we copy
 * them back after the next extraction.
 *
 * Saves kept outside the game folder (Documents / AppData / LocalLow) are never
 * touched by compression and therefore need no handling here.
 */

const SAVE_DIR_PATTERN =
  /^(saves?|save[_\- ]?data|savegames?|savedata|user[_\- ]?data|存档(数据)?|セーブ(データ)?|セイブ|세이브|profile|_save|game[_\- ]?data)$/i

const SAVE_FILE_PATTERN =
  /\.(sav|save|sav\.dat|rpgsave|rvdata|rvdata2|rmmzsave|rmvsave|ssg|sgd|slot|sol|es3|ksd|asd)$/i

/** Directories that never contain saves and can be huge. */
const SKIP_DIR_PATTERN =
  /^(bepinex|bepinex_x64|dotnet|redist|_redist|jre|java|python|nodejs|managed|mono|plugins?|mods?|tools?|__pycache__|node_modules)$/i

const MAX_DEPTH = 6
const MAX_FILES = 20000
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024

export interface SaveVaultResult {
  files: number
  bytes: number
  root: string
  entries: string[]
}

async function resolveVaultRoot(): Promise<string> {
  try {
    const configured = await ConfigDBManager.getConfigValue('game.archive.saveVaultPath')
    if (configured && configured.trim().length > 0) return configured.trim()
  } catch {
    // ignore
  }
  return path.join(app.getPath('userData'), 'save-vault')
}

function vaultDirFor(root: string, gameId: string): string {
  return path.join(root, gameId)
}

/** Collect save files that live inside the game folder. */
export async function collectSaveFiles(extractDir: string): Promise<string[]> {
  const collected: string[] = []
  let totalBytes = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || collected.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return
    let entries: fse.Dirent[] = []
    try {
      entries = await fse.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const isSaveDir = SAVE_DIR_PATTERN.test(path.basename(dir))
    for (const entry of entries) {
      if (collected.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIR_PATTERN.test(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      // Files inside a recognised save directory always count; elsewhere only
      // well-known save extensions do (so game assets are not copied).
      if (!isSaveDir && !SAVE_FILE_PATTERN.test(entry.name)) continue
      try {
        const stats = await fse.stat(full)
        totalBytes += stats.size
      } catch {
        continue
      }
      collected.push(full)
    }
  }

  await walk(extractDir, 0)
  return collected
}

/** Mirror the game's save files into the vault. */
export async function backupSaves(gameId: string, extractDir: string): Promise<SaveVaultResult> {
  const root = await resolveVaultRoot()
  const target = vaultDirFor(root, gameId)
  const files = await collectSaveFiles(extractDir)
  if (files.length === 0) {
    return { files: 0, bytes: 0, root: target, entries: [] }
  }

  await fse.ensureDir(target)
  let bytes = 0
  const entries: string[] = []
  for (const file of files) {
    const relative = path.relative(extractDir, file)
    const destination = path.join(target, relative)
    try {
      await fse.ensureDir(path.dirname(destination))
      await fse.copy(file, destination, { overwrite: true, preserveTimestamps: true })
      bytes += (await fse.stat(file)).size
      entries.push(relative)
    } catch (error) {
      log.warn('[SaveVault] Failed to back up ' + file + ': ' + String(error))
    }
  }

  await GameDBManager.setGameLocalValue(gameId, 'archive.saveBackupPath', target)
  await GameDBManager.setGameLocalValue(gameId, 'archive.saveBackupFiles', entries.length)
  await GameDBManager.setGameLocalValue(gameId, 'archive.saveBackupAt', new Date().toISOString())
  log.info('[SaveVault] Backed up ' + entries.length + ' save file(s) for ' + gameId)
  return { files: entries.length, bytes, root: target, entries }
}

/** Copy vaulted saves back after extracting. Newer local files win. */
export async function restoreSaves(gameId: string, extractDir: string): Promise<number> {
  const root = await resolveVaultRoot()
  const source = vaultDirFor(root, gameId)
  if (!(await fse.pathExists(source))) return 0

  let restored = 0
  const walkFiles = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    let entries: fse.Dirent[] = []
    try {
      entries = await fse.readdir(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await walkFiles(full)))
      else if (entry.isFile()) out.push(full)
    }
    return out
  }

  for (const file of await walkFiles(source)) {
    const relative = path.relative(source, file)
    const destination = path.join(extractDir, relative)
    try {
      const vaultStats = await fse.stat(file)
      if (await fse.pathExists(destination)) {
        const localStats = await fse.stat(destination)
        if (localStats.mtimeMs >= vaultStats.mtimeMs) continue
      }
      await fse.ensureDir(path.dirname(destination))
      await fse.copy(file, destination, { overwrite: true, preserveTimestamps: true })
      restored++
    } catch (error) {
      log.warn('[SaveVault] Failed to restore ' + destination + ': ' + String(error))
    }
  }
  if (restored > 0) log.info('[SaveVault] Restored ' + restored + ' save file(s) for ' + gameId)
  return restored
}

/** Remove the vault of a deleted game. */
export async function removeSaveVault(gameId: string): Promise<void> {
  const root = await resolveVaultRoot()
  await fse.remove(vaultDirFor(root, gameId)).catch(() => undefined)
}
