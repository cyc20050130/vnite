import type { ArchiveEntry } from './slt'
import { depthOf } from './slt'

export const GENERIC_DIRS =
  /^(res|resources|data|game|games|pc|bin|binary|binaries|www|assets|content|build|release|plugin|plugins|engine|files|x64|win64|windows|app|aaaaaa|a|new folder|1|2)$/i

/** Clean a raw archive / folder name into a candidate title. */
export function cleanTitle(raw: string): string {
  let t = ' ' + raw + ' '
  t = t.replace(/[\[【(（][^\]】)）]*[\]】)）]/g, ' ') // [PC] 【PC】 （吹弹！…）
  t = t.replace(/[_\-\s]*\d{6}[A-Za-z]*[_\-\s]+/g, ' ') // 160826POISON_
  t = t.replace(/\b(POISON MOTION|POISON|PAJAMAS|MOTION)\b/gi, ' ')
  t = t.replace(/\.(7z|zip|rar|tar|gz|tgz|xz|zst|bz2)(\.\d{3})?$/i, ' ')
  t = t.replace(/\.part\d+\.rar$/i, ' ')
  t = t.replace(/^\s*\d{1,3}\s*[.\-_、]\s*(?=[^\d])/, ' ') // leading index "13. " / "10_"
  t = t.replace(/\b(v|ver\.?|version)\s*\d+(\.\d+)*[a-z]?\b/gi, ' ')
  t = t.replace(
    /(AI汉化版?|精翻汉化版?|云翻汉化版?|汉化版?|机翻|DL官方中文版?|官方中文版?|中文化|步兵版?|补丁|作弊)/gi,
    ' '
  )
  t = t.replace(/[+＋]\s*(全CG存档|全回想|存档|特典|攻略|CG|DLC|汉化)/gi, ' ')
  t = t.replace(/(全CG存档|全回想|存档|特典|攻略|STEAM官方中文|Steam)/gi, ' ')
  t = t.replace(/\bPC\b/gi, ' ')
  t = t.replace(/[_\-]{2,}/g, ' ')
  t = t.replace(/^[_\-\s]+|[_\-\s]+$/g, '')
  return t.replace(/\s{2,}/g, ' ').trim()
}

/** Extract a DLsite work id (RJ/BJ/VJ/RE) from arbitrary text. */
export function extractDlsiteId(text: string): string | null {
  const m = text.match(/(RJ|BJ|VJ|RE)\d{4,}/i)
  return m ? m[0].toUpperCase() : null
}

export interface ResolvedTitle {
  fromFile: string
  fromArchive?: string
  fromExeDir?: string
  best: string
}

export function resolveTitle(archiveFileName: string, entries: ArchiveEntry[]): ResolvedTitle {
  const fromFile = cleanTitle(archiveFileName)

  let fromArchive: string | undefined
  const roots = new Map<string, number>()
  for (const e of entries) {
    const top = e.path.split('/')[0]
    if (!top) continue
    roots.set(top, (roots.get(top) ?? 0) + 1)
  }
  let bestRoot = ''
  let bestRootN = -1
  for (const [k, v] of roots) {
    if (v > bestRootN) {
      bestRoot = k
      bestRootN = v
    }
  }
  if (bestRoot && !GENERIC_DIRS.test(bestRoot)) {
    const cleaned = cleanTitle(bestRoot)
    if (cleaned.length >= 2 && cleaned.length <= 120) fromArchive = cleaned
  }

  // The shallowest folder that contains an executable often carries the original title.
  const exeDirs = entries
    .filter((e) => !e.isDir && /\.(exe|bat|cmd)$/i.test(e.path))
    .map((e) => e.path.split('/').slice(0, -1).join('/'))
    .filter(Boolean)
  let fromExeDir: string | undefined
  if (exeDirs.length > 0) {
    const depths = exeDirs.map((d) => depthOf(d))
    const min = Math.min(...depths)
    const shallow = exeDirs.filter((_, i) => depths[i] === min)
    const counts = new Map<string, number>()
    for (const d of shallow) counts.set(d, (counts.get(d) ?? 0) + 1)
    let bestDir = ''
    let bestDirN = -1
    for (const [k, v] of counts) {
      if (v > bestDirN) {
        bestDir = k
        bestDirN = v
      }
    }
    const leaf = bestDir.split('/').filter(Boolean).pop() ?? ''
    const cleaned = cleanTitle(leaf)
    if (cleaned.length >= 3 && cleaned.length <= 120 && !GENERIC_DIRS.test(cleaned)) fromExeDir = cleaned
  }

  const best = fromExeDir || (fromArchive && fromArchive.length >= 4 ? fromArchive : fromFile)
  return { fromFile, fromArchive, fromExeDir, best }
}

export interface VersionGuess {
  version: string | null
  source: 'filename' | 'archive' | 'none'
}

const VERSION_PATTERNS: RegExp[] = [
  /\b[vV](?:er(?:sion)?\.?\s*)?(\d+(?:\.\d+){1,3}[a-z]?)\b/,
  /\b(\d+\.\d+(?:\.\d+){0,3}[a-z]?)\b/,
  /[_\-\s](?:v)?(\d{1,3}(?:\.\d{1,3}){1,3})\b/
]

/** Best-effort version guess from the archive name (M8 refines this with readme/exe resources). */
export function guessVersion(archiveFileName: string): VersionGuess {
  const base = archiveFileName.replace(/\.(7z|zip|rar|tar|gz|tgz|xz|zst|bz2)(\.\d{3})?$/i, '')
  for (const re of VERSION_PATTERNS) {
    const m = base.match(re)
    if (m) return { version: m[1], source: 'filename' }
  }
  return { version: null, source: 'none' }
}
