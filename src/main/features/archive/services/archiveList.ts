import { run7z, resolve7zPath, isPasswordError } from './sevenZip'
import { parseSltOutput, summarizeListing, pickEntrypoint } from './slt'
import type { ArchiveEntry, ArchiveSummary } from './slt'

export type ArchiveListStatus = 'ok' | 'encrypted' | 'no-7z' | 'error'

export interface ArchiveListResult {
  status: ArchiveListStatus
  entries: ArchiveEntry[]
  summary?: ArchiveSummary
  entrypoint?: string | null
  error?: string
}

/**
 * List an archive by reading only its header / central directory (no payload is decoded).
 * Multipart archives: pass the first volume (.001 / .part1.rar) or the volume carrying the
 * central directory (the last .zip for split zips).
 */
export async function listArchive(
  archivePath: string,
  password?: string,
  titleHint?: string
): Promise<ArchiveListResult> {
  if (!resolve7zPath()) return { status: 'no-7z', entries: [] }

  const result = await run7z(['l', '-slt', '-sccUTF-8', '--', archivePath], {
    password,
    timeoutMs: 5 * 60 * 1000
  })

  const combined = result.stdout + '\n' + result.stderr
  if (result.code !== 0) {
    if (isPasswordError(combined)) return { status: 'encrypted', entries: [] }
    return { status: 'error', entries: [], error: combined.trim().split(/\r?\n/).slice(-3).join(' ') }
  }
  if (isPasswordError(combined)) return { status: 'encrypted', entries: [] }

  const entries = parseSltOutput(result.stdout)
  if (entries.length === 0 && !/^Path = /m.test(result.stdout)) {
    return { status: 'error', entries: [], error: 'listing contained no entries' }
  }

  return {
    status: 'ok',
    entries,
    summary: summarizeListing(entries),
    entrypoint: pickEntrypoint(entries, titleHint)
  }
}
