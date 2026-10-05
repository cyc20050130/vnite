import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import { eventBus } from '~/core/events'
import { ipcManager } from '~/core/ipc'
import {
  extractArchive,
  compressFolder,
  testArchive,
  resolve7zPath,
  isPasswordError,
  hasFull7z
} from './sevenZip'
import { classifyArchive, detectArchiveByMagic } from './archiveDetect'
import { extractRarArchive, isRarPasswordError } from './rarEngine'
import { resolvePasswordForArchive } from './passwordVault'

const TMP_SUFFIX = '.vnite-tmp'
const LONG_TIMEOUT = 6 * 60 * 60 * 1000

export interface ArchiveStatus {
  gameId: string
  enabled: boolean
  state: string
  format: string
  archivePath: string
  parts: string[]
  extractDir: string
  entrypoint: string
  encrypted: boolean
  archiveBytes: number
  extractedBytes: number
  lastError: string
  extractDirExists: boolean
}

function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'game'
}

function stripArchiveExtension(name: string): string {
  return name.replace(/\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)(\.\d{3})?$/i, '')
}

async function resolveExtractDir(archivePath: string, titleHint?: string): Promise<string> {
  const configured = await ConfigDBManager.getConfigValue('game.archive.defaultExtractRoot')
  const base =
    configured && configured.trim().length > 0 ? configured.trim() : path.dirname(archivePath)
  const raw = titleHint && titleHint.trim().length > 0 ? titleHint : path.basename(archivePath)
  return path.join(base, sanitizeFolderName(stripArchiveExtension(raw)))
}

const TOOL_DIR_RE =
  /(^|[\\/])(bepinex|bepinex_x64|dotnet|redist|_redist|jre|java|python|nodejs|unityplayer|monobleedingedge|managed|plugins?|mods?|tools?)([\\/]|$)/i

/** Breadth-first search for the most plausible game executable. */
export async function findExecutable(dir: string): Promise<string | null> {
  const queue: string[] = [dir]
  const found: string[] = []
  while (queue.length > 0 && found.length < 500) {
    const current = queue.shift() as string
    let entries: fse.Dirent[] = []
    try {
      entries = await fse.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (/\.(exe|bat|cmd)$/i.test(entry.name)) found.push(full)
    }
  }
  if (found.length === 0) return null
  const filtered = found.filter((p) => !TOOL_DIR_RE.test(p))
  const pool = filtered.length > 0 ? filtered : found
  pool.sort(
    (a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length || a.localeCompare(b)
  )
  return pool[0]
}

async function resolveEntrypoint(
  root: string,
  entrypoint: string,
  asAbsolute: boolean
): Promise<string | null> {
  const clean = (entrypoint ?? '').replace(/\\/g, '/')
  if (clean.length > 0) {
    const candidate = path.join(root, clean)
    if (await fse.pathExists(candidate)) {
      return asAbsolute ? candidate : clean
    }
  }
  const found = await findExecutable(root)
  if (!found) return null
  return asAbsolute ? found : path.relative(root, found).split(path.sep).join('/')
}

async function setState(gameId: string, state: string, error = ''): Promise<void> {
  await GameDBManager.setGameLocalValue(gameId, 'archive.state', state as never)
  await GameDBManager.setGameLocalValue(gameId, 'archive.lastTransitionAt', new Date().toISOString())
  await GameDBManager.setGameLocalValue(gameId, 'archive.lastError', error)
}

async function markExtracted(
  gameId: string,
  extractDir: string,
  exe: string,
  entrypoint: string
): Promise<void> {
  await GameDBManager.setGameLocalValue(gameId, 'archive.state', 'extracted')
  await GameDBManager.setGameLocalValue(gameId, 'archive.extractDir', extractDir)
  await GameDBManager.setGameLocalValue(gameId, 'archive.entrypoint', entrypoint)
  await GameDBManager.setGameLocalValue(gameId, 'archive.lastError', '')
  await GameDBManager.setGameLocalValue(gameId, 'archive.lastTransitionAt', new Date().toISOString())
  await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', exe)
  await GameDBManager.setGameLocalValue(gameId, 'launcher.mode', 'archive')
  await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.path', exe)
  await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.monitorMode', 'folder')
  await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.monitorPath', path.dirname(exe))
  eventBus.emit(
    'archive:state-changed',
    { gameId, from: 'archiving', to: 'extracted' },
    { source: 'archive' }
  )
}

async function removeArchiveParts(parts: string[]): Promise<void> {
  for (const part of parts) {
    if (!part) continue
    try {
      await fse.remove(part)
      log.info('[Archive] Removed archive part after extraction: ' + part)
    } catch (error) {
      log.warn('[Archive] Failed to remove archive part ' + part + ': ' + String(error))
    }
  }
}

const inflight = new Map<string, Promise<string>>()

/** Extract the archive if needed and return the executable path. */
export async function ensureExtracted(gameId: string): Promise<string> {
  const running = inflight.get(gameId)
  if (running) return running
  const task = doEnsureExtracted(gameId).finally(() => inflight.delete(gameId))
  inflight.set(gameId, task)
  return task
}

async function doEnsureExtracted(gameId: string): Promise<string> {
  const local = await GameDBManager.getGameLocal(gameId)
  const archive = local.archive
  if (!archive || !archive.enabled) {
    throw new Error('Game ' + gameId + ' is not archive-backed')
  }

  const parts: string[] = archive.parts ?? []
  const archivePath = parts.find((p) => p && fse.existsSync(p)) ?? ''

  const format =
    (archive.format as string) ||
    (archivePath ? classifyArchive(path.basename(archivePath))?.format : '') ||
    (archivePath ? detectArchiveByMagic(archivePath) : '') ||
    'other'
  // Full 7-Zip reads RAR (multi-volume included); otherwise fall back to WASM unrar.
  const useUnrar = format === 'rar' && !hasFull7z()
  if (!useUnrar && !resolve7zPath()) {
    throw new Error('7-Zip CLI not found; cannot extract')
  }

  // Already extracted?
  if (archive.extractDir && (await fse.pathExists(archive.extractDir))) {
    const exe = await resolveEntrypoint(archive.extractDir, archive.entrypoint, true)
    if (exe) {
      await markExtracted(gameId, archive.extractDir, exe, path.relative(archive.extractDir, exe).split(path.sep).join('/'))
      return exe
    }
  }

  if (!archivePath) {
    throw new Error('Archive file not found for game ' + gameId)
  }

  const game = await GameDBManager.getGame(gameId)
  const title = game?.metadata?.name || path.basename(archivePath)
  const extractDir = archive.extractDir || (await resolveExtractDir(archivePath, title))
  const tmpDir = extractDir + TMP_SUFFIX

  // Encrypted archives: find a working password before touching the disk.
  let password: string | null = null
  if (archive.encrypted) {
    const resolved = await resolvePasswordForArchive(archivePath)
    if (resolved.encrypted && !resolved.password) {
      await setState(gameId, 'passwordRequired', 'password required')
      eventBus.emit(
        'archive:password-required',
        {
          gameId,
          archivePath,
          parts,
          tried: resolved.tried,
          headerEncrypted: resolved.headerEncrypted
        },
        { source: 'archive' }
      )
      throw new Error('password required for ' + path.basename(archivePath))
    }
    password = resolved.password
  }

  await fse.remove(tmpDir)
  await fse.ensureDir(path.dirname(extractDir))
  await setState(gameId, 'extracting')
  ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent: 0 })

  try {
    if (useUnrar) {
      await extractRarArchive(archivePath, tmpDir, {
        password: password ?? undefined,
        onProgress: (percent) => {
          if (percent >= 0) {
            ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent })
          }
        }
      })
    } else {
      const result = await extractArchive(archivePath, tmpDir, {
        password: password ?? undefined,
        timeoutMs: LONG_TIMEOUT,
        onProgress: (percent) =>
          ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent })
      })
      if (result.code !== 0) {
        const output = (result.stderr || '') + (result.stdout || '')
        if (isPasswordError(output)) {
          await setState(gameId, 'passwordRequired', 'password required')
        }
        throw new Error('7-Zip extract failed: ' + output.slice(-300))
      }
    }
    const found = await resolveEntrypoint(tmpDir, archive.entrypoint, true)
    if (!found) throw new Error('No executable found inside the archive')

    await fse.remove(extractDir)
    await fse.move(tmpDir, extractDir, { overwrite: true })
    const exe = path.join(extractDir, path.relative(tmpDir, found))

    await markExtracted(gameId, extractDir, exe, path.relative(extractDir, exe).split(path.sep).join('/'))
    await GameDBManager.setGameLocalValue(gameId, 'archive.archiveBytes', 0)

    if (!archive.keepArchive) {
      await removeArchiveParts(parts.length > 0 ? parts : [archivePath])
    }

    ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent: 100 })
    return exe
  } catch (error) {
    await fse.remove(tmpDir).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    if (isRarPasswordError(error) || /password/i.test(message)) {
      await setState(gameId, 'passwordRequired', message)
    } else {
      await setState(gameId, 'error', message)
    }
    throw error
  }
}

/** Re-compress an extracted archive game and remove the extracted folder. */
export async function compressGame(gameId: string): Promise<string> {
  const local = await GameDBManager.getGameLocal(gameId)
  const archive = local.archive
  if (!archive || !archive.enabled) throw new Error('Game ' + gameId + ' is not archive-backed')
  if (!resolve7zPath()) throw new Error('7-Zip CLI not found; cannot compress')

  const extractDir = archive.extractDir
  if (!extractDir || !(await fse.pathExists(extractDir))) {
    throw new Error('Nothing to compress for game ' + gameId)
  }

  const parts: string[] = archive.parts ?? []
  let targetArchive = parts[0] && parts[0].length > 0
    ? parts[0]
    : path.join(path.dirname(extractDir), path.basename(extractDir) + '.7z')

  const configured = await ConfigDBManager.getConfigValue('game.archive.compressFormat')
  const format: '7z' | 'zip' = configured === 'zip' ? 'zip' : '7z'
  if (!new RegExp('\\.' + format + '$', 'i').test(targetArchive)) {
    targetArchive = targetArchive.replace(/\.[^.]+$/, '') + '.' + format
  }

  const tmpArchive = targetArchive + TMP_SUFFIX + '-' + Date.now() + '.' + format
  const parent = path.dirname(extractDir)
  const folderName = path.basename(extractDir)

  await setState(gameId, 'compressing')
  ipcManager.send('archive:job-progress', { gameId, jobType: 'compress', percent: 0 })

  try {
    const result = await compressFolder(parent, folderName, tmpArchive, {
      format,
      level: 9,
      timeoutMs: LONG_TIMEOUT,
      onProgress: (percent) => ipcManager.send('archive:job-progress', { gameId, jobType: 'compress', percent })
    })
    if (result.code !== 0) {
      throw new Error('7-Zip compress failed: ' + (result.stderr || result.stdout).slice(-300))
    }
    const test = await testArchive(tmpArchive, { timeoutMs: LONG_TIMEOUT })
    if (test.code !== 0) {
      throw new Error('7-Zip verify failed: ' + (test.stderr || test.stdout).slice(-300))
    }

    const backup = targetArchive + '.bak'
    await fse.remove(backup).catch(() => undefined)
    if (await fse.pathExists(targetArchive)) await fse.move(targetArchive, backup, { overwrite: true })
    await fse.move(tmpArchive, targetArchive, { overwrite: true })
    await fse.remove(extractDir)
    await fse.remove(backup).catch(() => undefined)

    const size = (await fse.stat(targetArchive)).size
    await GameDBManager.setGameLocalValue(gameId, 'archive.state', 'archived')
    await GameDBManager.setGameLocalValue(gameId, 'archive.parts', [targetArchive])
    await GameDBManager.setGameLocalValue(gameId, 'archive.extractDir', '')
    await GameDBManager.setGameLocalValue(gameId, 'archive.entrypoint', '')
    await GameDBManager.setGameLocalValue(gameId, 'archive.archiveBytes', size)
    await GameDBManager.setGameLocalValue(gameId, 'archive.extractedBytes', 0)
    await GameDBManager.setGameLocalValue(gameId, 'archive.lastError', '')
    await GameDBManager.setGameLocalValue(gameId, 'archive.lastTransitionAt', new Date().toISOString())
    await GameDBManager.setGameLocalValue(gameId, 'path.gamePath', targetArchive)
    await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.path', '')
    await GameDBManager.setGameLocalValue(gameId, 'launcher.fileConfig.monitorPath', '')

    eventBus.emit(
      'archive:state-changed',
      { gameId, from: 'extracted', to: 'archived' },
      { source: 'archive' }
    )
    ipcManager.send('archive:job-progress', { gameId, jobType: 'compress', percent: 100 })
    return targetArchive
  } catch (error) {
    await fse.remove(tmpArchive).catch(() => undefined)
    await setState(gameId, 'error', error instanceof Error ? error.message : String(error))
    throw error
  }
}

export async function getArchiveStatus(gameId: string): Promise<ArchiveStatus | null> {
  const local = await GameDBManager.getExistingGameLocal(gameId)
  if (!local) return null
  const archive = local.archive
  const parts = archive?.parts ?? []
  return {
    gameId,
    enabled: Boolean(archive?.enabled),
    state: archive?.state ?? 'archived',
    format: archive?.format ?? '',
    archivePath: parts[0] ?? '',
    parts,
    extractDir: archive?.extractDir ?? '',
    entrypoint: archive?.entrypoint ?? '',
    encrypted: Boolean(archive?.encrypted),
    archiveBytes: archive?.archiveBytes ?? 0,
    extractedBytes: archive?.extractedBytes ?? 0,
    lastError: archive?.lastError ?? '',
    extractDirExists: Boolean(archive?.extractDir && fse.existsSync(archive.extractDir))
  }
}

/** Called when a session ends: re-compress if the game is marked finished and auto-compress is on. */
export async function archiveOnSessionEnd(gameId: string): Promise<void> {
  try {
    const local = await GameDBManager.getExistingGameLocal(gameId)
    if (!local || !local.archive?.enabled) return
    if (local.archive.state !== 'extracted') return
    const auto = await ConfigDBManager.getConfigValue('game.archive.autoCompressOnFinished')
    if (!auto) return
    const status = await GameDBManager.getGameValue(gameId, 'record.playStatus')
    if (status !== 'finished') return
    await compressGame(gameId)
  } catch (error) {
    log.warn('[Archive] on-session-end failed for ' + gameId + ': ' + String(error))
  }
}

/** Re-compress every extracted game whose playStatus is finished. Runs periodically. */
export async function runArchiveMaintenance(): Promise<number> {
  let compressed = 0
  try {
    const auto = await ConfigDBManager.getConfigValue('game.archive.autoCompressOnFinished')
    if (!auto) return 0
    const locals = await GameDBManager.getAllGamesLocal()
    for (const gameId of Object.keys(locals)) {
      const archive = locals[gameId].archive
      if (!archive?.enabled || archive.state !== 'extracted') continue
      const status = await GameDBManager.getGameValue(gameId, 'record.playStatus')
      if (status !== 'finished') continue
      try {
        await compressGame(gameId)
        compressed++
      } catch (error) {
        log.warn('[Archive] maintenance compress failed for ' + gameId + ': ' + String(error))
      }
    }
  } catch (error) {
    log.warn('[Archive] maintenance run failed: ' + String(error))
  }
  return compressed
}
