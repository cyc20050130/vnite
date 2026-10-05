import fse from 'fs-extra'
import log from 'electron-log/main'
import { ConfigDBManager } from '~/core/database'
import type { ArchivePasswordEntry } from '@appTypes/models'
import { listArchive } from './archiveList'
import { testArchive } from './sevenZip'

export type { ArchivePasswordEntry }

function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function getPasswords(): Promise<ArchivePasswordEntry[]> {
  return (await ConfigDBManager.getConfigLocalValue('game.archive.passwords')) ?? []
}

/** Add raw password strings (one per line from the UI), skipping duplicates. */
export async function addPasswords(values: string[], label = ''): Promise<number> {
  const entries = await getPasswords()
  const existing = new Set(entries.map((e) => e.value))
  let added = 0
  for (const raw of values) {
    const value = (raw ?? '').trim()
    if (value.length === 0 || existing.has(value)) continue
    entries.push({
      id: randomId(),
      value,
      label,
      createdAt: new Date().toISOString(),
      successCount: 0
    })
    existing.add(value)
    added++
  }
  if (added > 0) await ConfigDBManager.setConfigLocalValue('game.archive.passwords', entries)
  return added
}

export async function removePassword(id: string): Promise<void> {
  const entries = await getPasswords()
  await ConfigDBManager.setConfigLocalValue(
    'game.archive.passwords',
    entries.filter((e) => e.id !== id)
  )
}

export function fingerprintOf(archivePath: string): string {
  try {
    const st = fse.statSync(archivePath)
    return (
      archivePath.toLowerCase() + '|' + st.size + '|' + Math.floor(st.mtimeMs) + '|' + st.birthtimeMs
    )
  } catch {
    return archivePath.toLowerCase()
  }
}

async function bind(fingerprint: string, entryId: string): Promise<void> {
  const bindings =
    (await ConfigDBManager.getConfigLocalValue('game.archive.bindings')) ?? {}
  bindings[fingerprint] = entryId
  await ConfigDBManager.setConfigLocalValue('game.archive.bindings', bindings)
}

async function markUsed(entryId: string): Promise<void> {
  const entries = await getPasswords()
  const entry = entries.find((e) => e.id === entryId)
  if (!entry) return
  entry.successCount += 1
  entry.lastUsedAt = new Date().toISOString()
  await ConfigDBManager.setConfigLocalValue('game.archive.passwords', entries)
}

export interface ResolvedArchivePassword {
  password: string | null
  entryId: string | null
  encrypted: boolean
  headerEncrypted: boolean
  tried: number
}

/**
 * Work out whether an archive is encrypted and, if so, find a working password.
 * Header-encrypted archives are validated by listing; data-encrypted ones by testing
 * the archive with each candidate password.
 */
export async function resolvePasswordForArchive(
  archivePath: string
): Promise<ResolvedArchivePassword> {
  const result: ResolvedArchivePassword = {
    password: null,
    entryId: null,
    encrypted: false,
    headerEncrypted: false,
    tried: 0
  }

  const base = await listArchive(archivePath)
  if (base.status === 'no-7z') return result
  if (base.status === 'error') {
    // Could be an encrypted header that cannot even be read; give passwords a chance.
    result.encrypted = true
  } else if (base.status === 'encrypted') {
    result.encrypted = true
    result.headerEncrypted = true
  } else if (base.status === 'ok' && !base.summary?.hasEncryptedData) {
    return result
  } else {
    result.encrypted = true
  }

  const entries = await getPasswords()
  if (entries.length === 0) return result

  const fingerprint = fingerprintOf(archivePath)
  const bindings = (await ConfigDBManager.getConfigLocalValue('game.archive.bindings')) ?? {}
  const boundId = bindings[fingerprint]
  const ordered = [...entries].sort((a, b) => {
    if (a.id === boundId) return -1
    if (b.id === boundId) return 1
    if (b.successCount !== a.successCount) return b.successCount - a.successCount
    return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')
  })

  for (const entry of ordered) {
    result.tried++
    let ok = false
    try {
      if (result.headerEncrypted) {
        const listed = await listArchive(archivePath, entry.value)
        ok = listed.status === 'ok'
      } else {
        const tested = await testArchive(archivePath, { password: entry.value, timeoutMs: 120000 })
        ok = tested.code === 0
      }
    } catch (error) {
      log.warn('[Archive] password probe failed: ' + String(error))
      ok = false
    }
    if (ok) {
      result.password = entry.value
      result.entryId = entry.id
      await bind(fingerprint, entry.id)
      await markUsed(entry.id)
      return result
    }
  }

  return result
}
