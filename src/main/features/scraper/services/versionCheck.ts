import log from 'electron-log/main'
import { ipcManager } from '~/core/ipc'
import { GameDBManager } from '~/core/database'
import { scraperManager } from '~/features/scraper'
import type { VersionCheckResult } from '@appTypes/utils'

function parseVersion(value?: string): number[] | null {
  if (!value) return null
  const cleaned = value.trim().replace(/^v/i, '')
  if (!/^\d/.test(cleaned)) return null
  const parts = cleaned
    .split(/[.\-+_\s]/)
    .map((segment) => parseInt(segment, 10))
    .filter((n) => !Number.isNaN(n))
  return parts.length > 0 ? parts : null
}

/** Compare local and remote versions: -1 local older, 0 equal, 1 local newer. */
export function compareVersions(local?: string, remote?: string): number | null {
  const a = parseVersion(local)
  const b = parseVersion(remote)
  if (!a || !b) return null
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Ask the game's provider for the latest version and cache it on the record.
 * Shared by the version card and the batch "check version" job.
 */
export async function checkGameVersion(gameId: string): Promise<VersionCheckResult> {
  const metadata = await GameDBManager.getGameValue(gameId, 'metadata')
  const dataSource = metadata?.dataSource ?? ''
  const dataSourceId = metadata?.dataSourceId ?? ''
  if (!dataSource || !dataSourceId) {
    throw new Error('NO_DATA_SOURCE')
  }

  ipcManager.send('archive:job-progress', { gameId, jobType: 'check-version', percent: 10 })
  const info = await scraperManager.getGameVersion(dataSource, { type: 'id', value: dataSourceId })
  ipcManager.send('archive:job-progress', { gameId, jobType: 'check-version', percent: 70 })
  if (!info) throw new Error('NO_VERSION_INFO')

  const localVersion = metadata?.version ?? ''
  const comparison = compareVersions(localVersion, info.version)
  const status: VersionCheckResult['status'] =
    comparison === null ? 'unknown' : comparison < 0 ? 'outdated' : 'latest'

  const checkedAt = new Date().toISOString()
  await GameDBManager.setGameValue(gameId, 'record.latestVersionInfo', {
    version: info.version,
    buildId: info.buildId,
    updatedAt: info.updatedAt,
    source: info.source,
    confidence: info.confidence,
    url: info.url,
    changelog: info.changelog,
    checkedAt
  })

  ipcManager.send('archive:job-progress', { gameId, jobType: 'check-version', percent: 100 })
  log.info('[VersionCheck] ' + gameId + ' local=' + localVersion + ' remote=' + (info.version ?? '') + ' -> ' + status)
  return {
    status,
    localVersion,
    remoteVersion: info.version ?? info.buildId ?? '',
    source: info.source,
    checkedAt
  }
}
