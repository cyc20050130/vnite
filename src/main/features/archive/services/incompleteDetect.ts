import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main'
import { hasFull7z, resolve7zPath, run7z } from './sevenZip'
import { listArchive } from './archiveList'

/**
 * Detect archives that are still downloading or were only partially downloaded, so they
 * are flagged as "incomplete" instead of being mistaken for corrupt games.
 */

export type IncompleteReason =
  | 'none'
  | 'downloadInProgress'
  | 'missingVolumes'
  | 'truncated'
  | 'zeroSize'
  /** Another process (usually the downloader) still holds the file. */
  | 'locked'

export interface IncompleteCheck {
  incomplete: boolean
  reason: IncompleteReason
  /** Missing volume file names (when known). */
  missing: string[]
  detail: string
}

const IN_PROGRESS_SUFFIX = /\.(crdownload|part|download|aria2|!ut|tmp|partial)$/i
const TRUNCATION_PATTERN =
  /unexpected end of archive|unexpected end of data|cannot find volume|missing volume|not complete|premature end|意外的压缩文件结尾|压缩文件意外结束|缺少分卷|分卷缺失|数据错误/i

/** Downloader / indexer still holds the file, or it is being written right now. */
const LOCKED_PATTERN =
  /being used by another process|resource busy|file is locked|另一个程序正在使用|正在使用此文件|进程无法访问|共享冲突/i

/** 7-Zip prints this when the process was interrupted, not when the file is bad. */
const INTERRUPTED_PATTERN = /break signaled|用户中断|被中断/i

function volumePartOf(fileName: string): { base: string; index: number; kind: 'part' | 'numeric' } | null {
  const part = fileName.match(/^(.*)\.part(\d+)\.rar$/i)
  if (part) return { base: part[1], index: Number(part[2]), kind: 'part' }
  const numeric = fileName.match(/^(.*)\.(\d{3})$/i)
  if (numeric) return { base: numeric[1], index: Number(numeric[2]), kind: 'numeric' }
  return null
}

function volumeFileName(base: string, index: number, kind: 'part' | 'numeric'): string {
  return kind === 'part' ? base + '.part' + index + '.rar' : base + '.' + String(index).padStart(3, '0')
}

const CLEAN = (): IncompleteCheck => ({ incomplete: false, reason: 'none', missing: [], detail: '' })

export async function detectIncompleteArchive(archivePath: string): Promise<IncompleteCheck> {
  try {
    if (!(await fse.pathExists(archivePath))) return CLEAN()
    const stats = await fse.stat(archivePath)
    const fileName = path.basename(archivePath)
    const dir = path.dirname(archivePath)
    if (stats.size === 0) {
      return { incomplete: true, reason: 'zeroSize', missing: [], detail: fileName + ' is empty' }
    }

    let names: string[] = []
    try {
      names = await fse.readdir(dir)
    } catch {
      names = []
    }

    // 1) a download of this archive (or of one of its volumes) is still running
    const stem = fileName.replace(/\.(rar|zip|7z|001)$/i, '').replace(/\.part\d+$/i, '').replace(/\.\d{3}$/i, '')
    const inProgress = names.find(
      (name) => IN_PROGRESS_SUFFIX.test(name) && name.toLowerCase().startsWith(stem.toLowerCase())
    )
    if (inProgress) {
      return { incomplete: true, reason: 'downloadInProgress', missing: [], detail: inProgress }
    }

    // 2) multi-volume set with gaps
    const info = volumePartOf(fileName)
    if (info && info.index === 1) {
      const indexes = names
        .map((name) => volumePartOf(name))
        .filter((parsed): parsed is NonNullable<typeof parsed> => Boolean(parsed))
        .filter((parsed) => parsed.base === info.base && parsed.kind === info.kind)
        .map((parsed) => parsed.index)
      const max = indexes.length > 0 ? Math.max(...indexes) : info.index
      const missing: string[] = []
      for (let i = 1; i <= max; i++) {
        if (!indexes.includes(i)) missing.push(volumeFileName(info.base, i, info.kind))
      }
      if (missing.length > 0) {
        return { incomplete: true, reason: 'missingVolumes', missing, detail: missing.join(', ') }
      }
    }

    // 3) header probe: truncation and missing volumes surface as listing errors, and the
    //    header declares how many volumes the set should have.
    if (resolve7zPath()) {
      const result = await run7z(['l', '-slt', '-sccUTF-8', '--', archivePath], {
        timeoutMs: 180000
      })
      const combined = result.stdout + '\n' + result.stderr
      // A locked file is almost always a download still in flight.
      if (result.code !== 0 && LOCKED_PATTERN.test(combined)) {
        return {
          incomplete: true,
          reason: 'locked',
          missing: [],
          detail: combined.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200)
        }
      }
      // Interrupted probes tell us nothing about the file.
      if (result.code !== 0 && INTERRUPTED_PATTERN.test(combined)) {
        return CLEAN()
      }
      if (result.code !== 0 && TRUNCATION_PATTERN.test(combined)) {
        return {
          incomplete: true,
          reason: 'truncated',
          missing: [],
          detail: combined.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 200)
        }
      }
      const declaredVolumes = Number((combined.match(/Volumes = (\d+)/i) || [])[1] ?? 0)
      if (declaredVolumes > 1) {
        const present = info
          ? names.filter((name) => {
              const parsed = volumePartOf(name)
              return parsed && parsed.base === info.base && parsed.kind === info.kind
            }).length
          : declaredVolumes
        if (present < declaredVolumes) {
          return {
            incomplete: true,
            reason: 'missingVolumes',
            missing: [],
            detail: present + '/' + declaredVolumes + ' volumes present'
          }
        }
      }
      return CLEAN()
    }

    // No 7-Zip: only the WASM unrar listing is available for RAR.
    if (!hasFull7z()) {
      const listing = await listArchive(archivePath)
      if (listing.status === 'error' && TRUNCATION_PATTERN.test(listing.error ?? '')) {
        return { incomplete: true, reason: 'truncated', missing: [], detail: (listing.error ?? '').slice(0, 200) }
      }
    }
    return CLEAN()
  } catch (error) {
    log.warn('[Archive] Incomplete check failed for ' + archivePath + ': ' + String(error))
    return CLEAN()
  }
}
