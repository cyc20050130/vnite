import log from 'electron-log/main'
import { compressFolder, extractArchive, hasFull7z, testArchive } from './sevenZip'
import { extractRarArchive } from './rarEngine'

/**
 * Pluggable archive engines.
 *
 * Built-in engines wrap 7-Zip and unrar; plugins can register additional engines
 * (ISO, NSIS, self-extracting installers...) or replace a built-in by using a higher
 * priority. Engines are only consulted when a non-built-in matches, so the default
 * extraction path stays exactly as before unless something extra is installed.
 */

export interface ArchiveEngineRunOptions {
  password?: string
  timeoutMs?: number
  onProgress?: (percent: number) => void
}

export interface ArchiveEngineResult {
  code: number
  stdout?: string
  stderr?: string
}

export interface ArchiveEngine {
  id: string
  name: string
  /** Formats handled, or ['*'] for everything. */
  formats: string[]
  /** Higher wins. Built-ins use 5-10, plugins should use more to take over. */
  priority?: number
  /** Built-in engines keep the legacy code path. */
  builtin?: boolean
  /** Optional availability probe (missing binary, missing codec...). */
  available?: () => boolean
  extract: (
    archivePath: string,
    targetDir: string,
    options: ArchiveEngineRunOptions
  ) => Promise<ArchiveEngineResult>
  compress?: (
    sourceParentDir: string,
    folderName: string,
    targetArchive: string,
    options: ArchiveEngineRunOptions & { format?: '7z' | 'zip'; level?: number }
  ) => Promise<ArchiveEngineResult>
  verify?: (archivePath: string, options: ArchiveEngineRunOptions) => Promise<ArchiveEngineResult>
}

const engines = new Map<string, ArchiveEngine>()

export function registerArchiveEngine(engine: ArchiveEngine): void {
  engines.set(engine.id, engine)
  log.info('[Archive] Registered engine ' + engine.id + ' (' + engine.name + ')')
}

export function unregisterArchiveEngine(id: string): void {
  engines.delete(id)
}

export function listArchiveEngines(): ArchiveEngine[] {
  return [...engines.values()].map((engine) => ({
    ...engine,
    available: engine.available ? engine.available() : true
  }))
}

export function getArchiveEngine(id: string): ArchiveEngine | undefined {
  return engines.get(id)
}

/** Best available engine for a format, highest priority first. */
export function pickArchiveEngine(format: string): ArchiveEngine | undefined {
  const candidates = [...engines.values()]
    .filter((engine) => engine.formats.includes(format) || engine.formats.includes('*'))
    .filter((engine) => (engine.available ? engine.available() : true))
  if (candidates.length === 0) return undefined
  return candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
}

const SEVEN_ZIP_FORMATS = [
  '7z',
  'zip',
  'zipx',
  'rar',
  'tar',
  'gz',
  'tgz',
  'xz',
  'zst',
  'bz2',
  '*'
]

registerArchiveEngine({
  id: 'full7z',
  name: '7-Zip',
  formats: SEVEN_ZIP_FORMATS,
  priority: 10,
  builtin: true,
  extract: async (archivePath, targetDir, options) => {
    const result = await extractArchive(archivePath, targetDir, options)
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  },
  compress: async (sourceParentDir, folderName, targetArchive, options) => {
    const result = await compressFolder(sourceParentDir, folderName, targetArchive, options)
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  },
  verify: async (archivePath, options) => {
    const result = await testArchive(archivePath, options)
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  }
})

registerArchiveEngine({
  id: 'unrar',
  name: 'unrar (wasm)',
  formats: ['rar'],
  priority: 5,
  builtin: true,
  available: () => !hasFull7z(),
  extract: async (archivePath, targetDir, options) => {
    await extractRarArchive(archivePath, targetDir, {
      password: options.password,
      onProgress: options.onProgress
    })
    return { code: 0 }
  }
})
