export type ArchiveBatchOp = 'extract' | 'compress' | 'backup-saves' | 'check-version'

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
