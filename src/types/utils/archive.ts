export type ArchiveBatchOp =
  | 'extract'
  | 'compress'
  | 'backup-saves'
  | 'check-version'
  | 'resolve-duplicates'

export type ArchiveBatchItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface ArchiveBatchItem {
  gameId: string
  name: string
  status: ArchiveBatchItemStatus
  detail: string
  progress: number
}

export interface ArchiveBatchJob {
  id: string
  op: ArchiveBatchOp
  status: 'running' | 'cancelled' | 'completed'
  concurrency: number
  items: ArchiveBatchItem[]
  startedAt: string
  finishedAt: string
}

export interface VersionCheckResult {
  status: 'latest' | 'outdated' | 'unknown'
  localVersion: string
  remoteVersion: string
  source: string
  checkedAt: string
}

/** Stable error codes so the UI can show a readable message instead of raw CLI output. */
export const ARCHIVE_ERROR_CODES = [
  'PASSWORD_REQUIRED',
  'PASSWORD_WRONG',
  'DISK_FULL',
  'CORRUPT_ARCHIVE',
  'FILE_IN_USE',
  'PERMISSION_DENIED',
  'ARCHIVE_NOT_FOUND',
  'SEVEN_ZIP_MISSING',
  'NO_EXECUTABLE',
  'ARCHIVE_MISSING',
  'GAME_EXTRACTED',
  'NOT_ARCHIVE_BACKED'
] as const

export type ArchiveErrorCode = (typeof ARCHIVE_ERROR_CODES)[number]
