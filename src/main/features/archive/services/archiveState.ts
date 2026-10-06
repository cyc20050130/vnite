import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import type { ArchiveStatusView } from '@appTypes/models'
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
import { backupSaves, restoreSaves } from './saveVault'
import { emitArchiveProgress } from './batchProgress'
import { classifyArchiveError } from './errorCodes'
import { pickArchiveEngine } from './engineRegistry'
import { detectIncompleteArchive } from './incompleteDetect'
import { parseArchiveName } from './titleResolver'
import { backupGameSave, searchGameSavePaths } from '~/features/game'

const TMP_SUFFIX = '.vnite-tmp'
const LONG_TIMEOUT = 6 * 60 * 60 * 1000

export type ArchiveStatus = ArchiveStatusView

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
  // A plugin-registered engine with a higher priority takes over the built-ins.
  const customEngine = pickArchiveEngine(format)
  const useCustomEngine = Boolean(customEngine && !customEngine.builtin)
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
  eventBus.emit('archive:before-extract', { gameId, archivePath, parts, format }, { source: 'archive' })

  try {
    if (useCustomEngine && customEngine) {
      const engineResult = await customEngine.extract(archivePath, tmpDir, {
        password: password ?? undefined,
        timeoutMs: LONG_TIMEOUT,
        onProgress: (percent) => {
          if (percent >= 0) {
            ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent })
            emitArchiveProgress(gameId, percent)
          }
        }
      })
      if (engineResult.code !== 0) {
        const output = (engineResult.stderr || '') + (engineResult.stdout || '')
        if (isPasswordError(output)) {
          await setState(gameId, 'passwordRequired', 'password required')
        }
        throw new Error('Engine ' + customEngine.id + ' failed: ' + output.slice(-300))
      }
    } else if (useUnrar) {
      await extractRarArchive(archivePath, tmpDir, {
        password: password ?? undefined,
        onProgress: (percent) => {
          if (percent >= 0) {
            ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent })
            emitArchiveProgress(gameId, percent)
          }
        }
      })
    } else {
      const result = await extractArchive(archivePath, tmpDir, {
        password: password ?? undefined,
        timeoutMs: LONG_TIMEOUT,
        onProgress: (percent) => {
          ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent })
          emitArchiveProgress(gameId, percent)
        }
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

    // Put back any saves mirrored before the last compression.
    let restoredSaves = 0
    try {
      const preserveSaves = await ConfigDBManager.getConfigValue('game.archive.preserveSaves')
      if (preserveSaves) restoredSaves = await restoreSaves(gameId, extractDir)
    } catch (error) {
      log.warn('[Archive] Save restore failed for ' + gameId + ': ' + String(error))
    }
    eventBus.emit(
      'archive:after-extract',
      {
        gameId,
        extractDir,
        entrypoint: path.relative(extractDir, exe).split(path.sep).join('/'),
        restoredSaves
      },
      { source: 'archive' }
    )

    if (!archive.keepArchive) {
      await removeArchiveParts(parts.length > 0 ? parts : [archivePath])
    }

    ipcManager.send('archive:job-progress', { gameId, jobType: 'extract', percent: 100 })
    return exe
  } catch (error) {
    await fse.remove(tmpDir).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    const code = classifyArchiveError(error)
    if (isRarPasswordError(error) || /password/i.test(message)) {
      await setState(gameId, 'passwordRequired', code + ' | ' + message.slice(0, 300))
    } else {
      await setState(gameId, 'error', code + ' | ' + message.slice(0, 300))
    }
    throw new Error(code)
  }
}

/**
 * Make sure the game's saves are backed up before the extracted folder disappears.
 * Uses Vnite's own save system when a save path is known (or can be detected), and
 * falls back to mirroring in-folder saves into the vault.
 */
async function ensureSaveSafetyBeforeCompress(gameId: string, extractDir: string): Promise<void> {
  try {
    const preserveSaves = await ConfigDBManager.getConfigValue('game.archive.preserveSaves')
    if (!preserveSaves) return

    const savePaths = await GameDBManager.getGameLocalValue(gameId, 'path.savePaths')
    const configured = (savePaths ?? []).filter(Boolean)
    if (configured.length > 0) {
      // The monitor normally backs up on exit; only act when that backup is stale.
      const saveList = await GameDBManager.getGameValue(gameId, 'save.saveList')
      const latest = Math.max(
        0,
        ...Object.values(saveList ?? {}).map((entry) => new Date(entry.date).getTime())
      )
      if (Date.now() - latest > 5 * 60 * 1000) {
        await backupGameSave(gameId)
      }
      return
    }

    // No save path configured: detect one, otherwise mirror in-folder saves.
    const detected = await searchGameSavePaths(gameId)
    if (detected.length > 0) {
      await GameDBManager.setGameLocalValue(gameId, 'path.savePaths', detected)
      await backupGameSave(gameId)
      return
    }
    await backupSaves(gameId, extractDir)
  } catch (error) {
    log.warn('[Archive] Save safety check failed for ' + gameId + ': ' + String(error))
  }
}

/** Re-check whether the game's archive finished downloading and cache the result. */
export async function checkIncompleteArchive(gameId: string): Promise<{
  incomplete: boolean
  reason: string
  detail: string
}> {
  const local = await GameDBManager.getGameLocal(gameId)
  const parts = local.archive?.parts ?? []
  const target = parts.find((part) => part && fse.existsSync(part)) ?? local.path?.gamePath ?? ''
  if (!target) return { incomplete: false, reason: 'none', detail: '' }
  const check = await detectIncompleteArchive(target)
  await GameDBManager.setGameLocalValue(gameId, 'archive.incomplete', check.incomplete)
  await GameDBManager.setGameLocalValue(gameId, 'archive.incompleteReason', check.reason)
  await GameDBManager.setGameLocalValue(gameId, 'archive.incompleteDetail', check.detail)
  await GameDBManager.setGameLocalValue(gameId, 'archive.incompleteCheckedAt', new Date().toISOString())
  return { incomplete: check.incomplete, reason: check.reason, detail: check.detail }
}

export interface SuggestedName {
  suggested: string
  mainTitle: string
  translation: string
  source: string
}

/** Best display name for a game, parsed from its archive / folder name. */
export async function suggestGameName(gameId: string): Promise<SuggestedName> {
  const local = await GameDBManager.getGameLocal(gameId)
  const archivePath = (local.archive?.parts ?? []).find((part) => Boolean(part)) ?? ''
  const markPath = local.utils?.markPath ?? ''
  const gamePath = local.path?.gamePath ?? ''
  const source = archivePath || markPath || (gamePath ? path.dirname(gamePath) : '')
  const parsed = parseArchiveName(path.basename(source))
  return {
    suggested: parsed.translation || parsed.mainTitle || path.basename(source),
    mainTitle: parsed.mainTitle,
    translation: parsed.translation,
    source
  }
}

/**
 * Recompute the display name (译名) for a game from its archive / folder name.
 * Only touches names that still mirror the stored localName, so manual edits survive.
 */
export async function normalizeGameName(
  gameId: string,
  force = false
): Promise<{ changed: boolean; name: string }> {
  const suggestion = await suggestGameName(gameId)
  const metadata = await GameDBManager.getGameValue(gameId, 'metadata')
  const current = metadata?.name ?? ''
  const localName = metadata?.localName ?? ''
  if (!suggestion.suggested) return { changed: false, name: current }
  const isUntouched = !localName || current === localName
  if (!force && !isUntouched) return { changed: false, name: current }
  if (current === suggestion.suggested && localName === suggestion.suggested) {
    return { changed: false, name: current }
  }
  await GameDBManager.setGameValue(gameId, 'metadata.name', suggestion.suggested)
  await GameDBManager.setGameValue(gameId, 'metadata.localName', suggestion.suggested)
  log.info('[Archive] Normalized name for ' + gameId + ': ' + current + ' -> ' + suggestion.suggested)
  return { changed: true, name: suggestion.suggested }
}

/** Manual "back up saves now" entry point for the archive panel. */
export async function backupSavesNow(gameId: string): Promise<{ files: number; mode: string }> {
  const local = await GameDBManager.getGameLocal(gameId)
  const extractDir = local.archive?.extractDir ?? ''
  const savePaths = ((await GameDBManager.getGameLocalValue(gameId, 'path.savePaths')) ?? []).filter(
    Boolean
  )
  if (savePaths.length > 0) {
    await backupGameSave(gameId)
    return { files: savePaths.length, mode: 'vnite' }
  }
  const detected = await searchGameSavePaths(gameId)
  if (detected.length > 0) {
    await GameDBManager.setGameLocalValue(gameId, 'path.savePaths', detected)
    await backupGameSave(gameId)
    return { files: detected.length, mode: 'detected' }
  }
  if (!extractDir || !(await fse.pathExists(extractDir))) {
    throw new Error('Game is not extracted and no save path was detected')
  }
  const result = await backupSaves(gameId, extractDir)
  return { files: result.files, mode: 'vault' }
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

  // Back up saves before the extracted folder disappears.
  await ensureSaveSafetyBeforeCompress(gameId, extractDir)

  await setState(gameId, 'compressing')
  ipcManager.send('archive:job-progress', { gameId, jobType: 'compress', percent: 0 })
  eventBus.emit('archive:before-compress', { gameId, extractDir, format }, { source: 'archive' })

  try {
    const compressEngine = pickArchiveEngine(format)
    const compressOptions = {
      format,
      level: 9,
      timeoutMs: LONG_TIMEOUT,
      onProgress: (percent: number) => {
        ipcManager.send('archive:job-progress', { gameId, jobType: 'compress', percent })
        emitArchiveProgress(gameId, percent)
      }
    }
    const result =
      compressEngine && !compressEngine.builtin && compressEngine.compress
        ? await compressEngine.compress(parent, folderName, tmpArchive, compressOptions)
        : await compressFolder(parent, folderName, tmpArchive, compressOptions)
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
    eventBus.emit(
      'archive:after-compress',
      { gameId, archivePath: targetArchive, bytes: size },
      { source: 'archive' }
    )
    ipcManager.send('archive:job-progress', { gameId, jobType: 'compress', percent: 100 })
    return targetArchive
  } catch (error) {
    await fse.remove(tmpArchive).catch(() => undefined)
    const raw = error instanceof Error ? error.message : String(error)
    const code = classifyArchiveError(error)
    await setState(gameId, 'error', code + ' | ' + raw.slice(0, 300))
    throw new Error(code)
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
    extractDirExists: Boolean(archive?.extractDir && fse.existsSync(archive.extractDir)),
    duplicates: archive?.duplicates ?? [],
    saveBackupPath: archive?.saveBackupPath ?? '',
    saveBackupFiles: archive?.saveBackupFiles ?? 0,
    saveBackupAt: archive?.saveBackupAt ?? '',
    incomplete: Boolean(archive?.incomplete),
    incompleteReason: archive?.incompleteReason ?? '',
    incompleteDetail: archive?.incompleteDetail ?? ''
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
