export interface ArchiveEntry {
  path: string
  size: number
  packedSize: number
  modified: string
  attributes: string
  isDir: boolean
  encrypted: boolean
  crc: string
  method: string
}

export interface ArchiveSummary {
  entryCount: number
  fileCount: number
  dirCount: number
  rootFolder: string
  executables: string[]
  infoFiles: string[]
  hasEncryptedData: boolean
  totalUnpacked: number
  extCount: Record<string, number>
}

const TOOL_DIR_RE =
  /(^|\/)(bepinex|bepinex_x64|dotnet|redist|redistributable|_redist|jre|java|python|nodejs|unityplayer|monobleedingedge|managed|plugins?|mods?|tools?|binaries|engine)(\/|$)/i
const TOOL_FILE_RE =
  /(unitycrashhandler|createdesktopshortcut|unins\d*|vcredist|dxsetup|directx|dotnetfx|setup|install(er)?|config|launcher_setup)\.(exe|bat|cmd)$/i

/** Parse the output of "7z l -slt" (key = value blocks separated by blank lines). */
export function parseSltOutput(text: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  const blocks = text.split(/\r?\n\r?\n/)
  for (const block of blocks) {
    if (!block.trim()) continue
    if (block.includes('----------')) continue
    const kv: Record<string, string> = {}
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(' = ')
      if (i < 0) continue
      kv[line.slice(0, i).trim()] = line.slice(i + 3).trim()
    }
    // Only entry blocks carry Attributes (the archive header block does not).
    if (kv['Attributes'] === undefined) continue
    if (kv['Path'] === undefined) continue
    const attributes = kv['Attributes'] ?? ''
    entries.push({
      path: kv['Path'].replace(/\\/g, '/'),
      size: Number(kv['Size'] ?? 0) || 0,
      packedSize: Number(kv['Packed Size'] ?? 0) || 0,
      modified: kv['Modified'] ?? '',
      attributes,
      isDir: attributes.startsWith('D') || kv['Folder'] === '+',
      encrypted: kv['Encrypted'] === '+',
      crc: kv['CRC'] ?? '',
      method: kv['Method'] ?? ''
    })
  }
  return entries
}

export function summarizeListing(entries: ArchiveEntry[]): ArchiveSummary {
  const fileEntries = entries.filter((e) => !e.isDir)
  const dirEntries = entries.filter((e) => e.isDir)
  const executables: string[] = []
  const infoFiles: string[] = []
  const extCount: Record<string, number> = {}
  let totalUnpacked = 0

  for (const e of fileEntries) {
    totalUnpacked += e.size
    const dot = e.path.lastIndexOf('.')
    const ext = dot >= 0 ? e.path.slice(dot + 1).toLowerCase() : ''
    extCount[ext] = (extCount[ext] ?? 0) + 1
    if (/\.(exe|bat|cmd|lnk)$/i.test(e.path)) executables.push(e.path)
    if (/\.(txt|md|nfo|url)$/i.test(e.path) || /作品情報|readme|説明|攻略|案内|更新|版本/i.test(e.path)) {
      infoFiles.push(e.path)
    }
  }

  return {
    entryCount: entries.length,
    fileCount: fileEntries.length,
    dirCount: dirEntries.length,
    rootFolder: topFolder(entries),
    executables: executables.slice(0, 40),
    infoFiles: infoFiles.slice(0, 40),
    hasEncryptedData: entries.some((e) => e.encrypted),
    totalUnpacked,
    extCount
  }
}

export function topFolder(entries: ArchiveEntry[]): string {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const top = e.path.split('/')[0]
    if (!top) continue
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  let best = ''
  let bestN = -1
  for (const [k, v] of counts) {
    if (v > bestN) {
      best = k
      bestN = v
    }
  }
  return best
}

export function depthOf(p: string): number {
  return p.split('/').filter(Boolean).length
}

/**
 * Choose the most likely game executable inside the archive.
 * Prefers the shallowest non-tool .exe, then .bat, then name similarity to the title.
 */
export function pickEntrypoint(entries: ArchiveEntry[], title?: string): string | null {
  const candidates = entries.filter((e) => !e.isDir && /\.(exe|bat|cmd)$/i.test(e.path))
  if (candidates.length === 0) return null

  const titleTokens = (title ?? '')
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/)
    .filter((t) => t.length >= 3)

  const scored = candidates
    .filter((e) => !TOOL_DIR_RE.test(e.path) && !TOOL_FILE_RE.test(e.path))
    .map((e) => {
      const depth = depthOf(e.path)
      const isExe = /\.exe$/i.test(e.path) ? 1 : 0
      const name = e.path.toLowerCase()
      const nameHit = titleTokens.some((t) => name.includes(t)) ? 1 : 0
      return { e, score: nameHit * 100 - depth * 10 + isExe }
    })
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0) return scored[0].e.path

  const fallback = candidates
    .map((e) => ({ e, depth: depthOf(e.path) }))
    .sort((a, b) => a.depth - b.depth)
  return fallback[0].e.path
}
