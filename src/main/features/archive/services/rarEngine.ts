import fse from 'fs-extra'
import { createExtractorFromFile } from 'node-unrar-js'
import type { ArchiveEntry, ArchiveSummary } from './slt'
import { pickEntrypoint, summarizeListing } from './slt'

export type RarListStatus = 'ok' | 'encrypted' | 'error'

export interface RarListResult {
  status: RarListStatus
  entries: ArchiveEntry[]
  summary?: ArchiveSummary
  entrypoint?: string | null
  error?: string
}

interface RarFileHeader {
  name: string
  flags?: { encrypted?: boolean; directory?: boolean }
  packSize?: number
  unpSize?: number
  crc?: number
  time?: string
  method?: string
}

interface RarArcHeader {
  flags?: { headerEncrypted?: boolean; volume?: boolean }
}

function toEntry(header: RarFileHeader): ArchiveEntry {
  return {
    path: String(header.name ?? '').replace(/\\/g, '/'),
    size: Number(header.unpSize) || 0,
    packedSize: Number(header.packSize) || 0,
    modified: header.time ?? '',
    attributes: header.flags?.directory ? 'D' : 'A',
    isDir: Boolean(header.flags?.directory),
    encrypted: Boolean(header.flags?.encrypted),
    crc: header.crc !== undefined ? String(header.crc) : '',
    method: header.method ?? ''
  }
}

export function isRarPasswordError(error: unknown): boolean {
  const reason = (error as { reason?: string } | null)?.reason ?? ''
  const message = error instanceof Error ? error.message : String(error)
  return /PASSWORD/i.test(reason) || /password/i.test(message)
}

/** List a RAR archive (header only). RAR is not supported by the 7za engine, so it has its own backend. */
export async function listRarArchive(
  archivePath: string,
  password?: string,
  titleHint?: string
): Promise<RarListResult> {
  try {
    const extractor = await createExtractorFromFile({
      filepath: archivePath,
      password: password ?? ''
    })
    const listing = extractor.getFileList()
    const arcHeader = listing.arcHeader as RarArcHeader
    const entries: ArchiveEntry[] = []
    for (const header of listing.fileHeaders as unknown as Iterable<RarFileHeader>) {
      entries.push(toEntry(header))
    }
    const summary = summarizeListing(entries)
    if (arcHeader.flags?.headerEncrypted) {
      return { status: 'encrypted', entries: [], summary }
    }
    return { status: 'ok', entries, summary, entrypoint: pickEntrypoint(entries, titleHint) }
  } catch (error) {
    if (isRarPasswordError(error)) return { status: 'encrypted', entries: [] }
    return {
      status: 'error',
      entries: [],
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200)
    }
  }
}

/** Extract a RAR archive into targetDir (targetDir is created if missing). */
export async function extractRarArchive(
  archivePath: string,
  targetDir: string,
  options: { password?: string; onProgress?: (percent: number) => void } = {}
): Promise<void> {
  await fse.ensureDir(targetDir)
  const extractor = await createExtractorFromFile({
    filepath: archivePath,
    targetPath: targetDir,
    password: options.password ?? ''
  })

  let total = 0
  try {
    const listing = extractor.getFileList()
    for (const _header of listing.fileHeaders as unknown as Iterable<RarFileHeader>) total++
  } catch {
    // listing may fail for some volumes; extraction below will surface real errors
  }

  const files = extractor.extract({ password: options.password ?? '' })
  let done = 0
  for (const _file of files.files as unknown as Iterable<unknown>) {
    done++
    if (options.onProgress && total > 0) {
      options.onProgress(Math.min(99, Math.round((done * 100) / total)))
    }
  }
  options.onProgress?.(100)
}
