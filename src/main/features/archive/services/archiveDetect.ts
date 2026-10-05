import fs from 'fs'
import path from 'path'

export type ArchiveFormat = 'zip' | '7z' | 'rar' | 'tar' | 'gz' | 'xz' | 'zst' | 'bz2' | 'other'

export interface ArchivePartInfo {
  base: string
  format: ArchiveFormat
  kind: 'single' | 'num' | 'part' | 'z'
  part: number
}

export interface ArchiveGroup {
  base: string
  format: ArchiveFormat
  parts: string[]
  split: boolean
  totalBytes: number
}

/** Extensions that may indicate an archive (multipart is detected by pattern, not extension alone). */
export const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.zipx',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.tgz',
  '.xz',
  '.zst',
  '.bz2'
]

const SINGLE_RE = /^(.*)\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)$/i
const NUM_RE = /^(.*)\.(7z|zip|rar)\.(\d{3})$/i
const PART_RE = /^(.*)\.part(\d+)\.rar$/i
const Z_RE = /^(.*)\.z(\d{2})$/i

function toFormat(ext: string): ArchiveFormat {
  const e = ext.toLowerCase()
  if (e === 'zip' || e === 'zipx') return 'zip'
  if (e === '7z') return '7z'
  if (e === 'rar') return 'rar'
  if (e === 'tar') return 'tar'
  if (e === 'gz' || e === 'tgz') return 'gz'
  if (e === 'xz') return 'xz'
  if (e === 'zst') return 'zst'
  if (e === 'bz2') return 'bz2'
  return 'other'
}

/** Classify a bare file name (no directory) into an archive part descriptor. */
export function classifyArchive(fileName: string): ArchivePartInfo | null {
  let m = fileName.match(NUM_RE)
  if (m) return { base: m[1], format: toFormat(m[2]), kind: 'num', part: Number(m[3]) }

  m = fileName.match(PART_RE)
  if (m) return { base: m[1], format: 'rar', kind: 'part', part: Number(m[2]) }

  m = fileName.match(Z_RE)
  if (m) return { base: m[1], format: 'zip', kind: 'z', part: Number(m[2]) }

  m = fileName.match(SINGLE_RE)
  if (m) return { base: m[1], format: toFormat(m[2]), kind: 'single', part: 0 }

  return null
}

export function isArchiveName(fileName: string): boolean {
  return classifyArchive(fileName) !== null
}

export function archiveFormatOf(fileName: string): ArchiveFormat | null {
  const info = classifyArchive(fileName)
  return info ? info.format : null
}

/**
 * Group loose file names into logical archives (multipart volumes collapse into one group).
 * Order of parts is normalised: .001/.002, .part1/.part2, .z01..zip.
 */
export function groupArchives(
  files: Array<{ name: string; size?: number }>
): ArchiveGroup[] {
  const map = new Map<string, ArchiveGroup>()

  for (const f of files) {
    const info = classifyArchive(f.name)
    if (!info) continue

    const key = info.base + '::' + info.format
    let group = map.get(key)
    if (!group) {
      group = { base: info.base, format: info.format, parts: [], split: false, totalBytes: 0 }
      map.set(key, group)
    }
    group.parts.push(f.name)
    group.totalBytes += f.size ?? 0
  }

  for (const group of map.values()) {
    const withInfo = group.parts.map((name) => ({ name, info: classifyArchive(name)! }))
    withInfo.sort((a, b) => {
      // .z01..zNN then the final .zip (part 0 in SINGLE_RE) belongs last but EOCD lives there
      const rank = (x: { info: ArchivePartInfo }) => (x.info.kind === 'single' ? 100000 : x.info.part)
      return rank(a) - rank(b)
    })
    group.parts = withInfo.map((x) => x.name)
    group.split = group.parts.length > 1
  }

  return Array.from(map.values()).sort((a, b) => a.base.localeCompare(b.base))
}

const MAGIC: Array<{ format: ArchiveFormat; bytes: number[]; offset?: number }> = [
  { format: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { format: 'zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { format: 'zip', bytes: [0x50, 0x4b, 0x07, 0x08] },
  { format: '7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { format: 'rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { format: 'gz', bytes: [0x1f, 0x8b] },
  { format: 'xz', bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { format: 'zst', bytes: [0x28, 0xb5, 0x2f, 0xfd] },
  { format: 'bz2', bytes: [0x42, 0x5a, 0x68] }
]

/** Read a small header and verify the file really is an archive of a known type. */
export function detectArchiveByMagic(filePath: string): ArchiveFormat | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(512)
    const read = fs.readSync(fd, buf, 0, buf.length, 0)
    if (read < 4) return null

    for (const m of MAGIC) {
      const off = m.offset ?? 0
      if (read >= off + m.bytes.length && m.bytes.every((b, i) => buf[off + i] === b)) return m.format
    }
    // tar: "ustar" at offset 257
    if (read >= 262 && buf.subarray(257, 262).toString('latin1') === 'ustar') return 'tar'
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Given a path and its sibling file names, return the archive this path belongs to (if any). */
export function groupOfPath(target: string, allNames: string[]): ArchiveGroup | null {
  const base = path.basename(target)
  const info = classifyArchive(base)
  if (!info) return null
  const groups = groupArchives(allNames.map((n) => ({ name: n })))
  return groups.find((g) => g.base === info.base && g.format === info.format) ?? null
}
