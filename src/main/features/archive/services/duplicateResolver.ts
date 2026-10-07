import path from 'path'
import fse from 'fs-extra'
import { cleanTitle, guessVersion } from './titleResolver'

/**
 * Duplicate archive resolution.
 *
 * Several archives can hold the same game (different versions, different Chinese
 * translations, a patch applied or not). We group them by a title key and keep the
 * best one, preferring the best Chinese translation and then the newest version.
 */

export type DuplicatePriority = 'translation' | 'version'

export interface DuplicateInfo {
  path: string
  version: string
  translation: string
  sizeBytes: number
  reason: string
}

export interface ArchiveCandidateInput {
  name: string
  dirPath: string
  gamePath?: string
  entryKind?: 'folder' | 'archive'
  archivePaths?: string[]
}

export interface PlatformInfo {
  /** The package contains something that runs on PC. */
  pc: boolean
  android: boolean
  korean: boolean
  label: string
}

/**
 * Which platform / language a package targets.
 *
 * Packages are often named like 【PC＋KR】... or "...-apk-PC汉化.zip" or plain "...apk".
 * An Android build can easily be several GB, so it must never outrank a PC build on size
 * alone; a name without any marker is treated as PC because that is the common case.
 */
export function detectPlatform(name: string): PlatformInfo {
  const lower = (name || '').toLowerCase()
  const explicitPc =
    /(^|[^a-z])pc([^a-z]|$)/i.test(lower) ||
    /(电脑|windows|steam版|硬盘版)/i.test(name) ||
    /[［【\[][pP][cC][］】\]]/.test(name)
  const android = /.apk$/i.test(lower) || /(^|[^a-z])apk([^a-z]|$)/i.test(lower)
  // Name-only, and with word boundaries: "【PC＋KR】" / "xxx_kr.zip" match, while the KiriKiri
  // plugin names (krmovie.dll, krkr*.dll) inside a path do not.
  const korean = /(^|[^a-z])kr([^a-z]|$)/i.test(lower) || /(korea|한국|韩|韓)/i.test(name)
  // No marker at all means the normal PC release; an Android OR Korean marker without an
  // explicit PC marker means the package is not the PC build we want to keep.
  const pc = explicitPc || (!android && !korean)
  const label =
    [pc ? 'PC' : '', android ? 'Android' : '', korean ? 'KR' : ''].filter(Boolean).join('+') ||
    'PC'
  return { pc, android, korean, label }
}

/**
 * True for the non-first volume of a split archive (x.7z.002, x.part3.rar, x.r01 ...).
 * These must never take part in duplicate resolution, otherwise a volume could be
 * deleted as if it were a redundant copy of its own archive.
 */
export function isSecondaryVolume(fileName: string): boolean {
  const numbered = (fileName || '').match(/\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)\.(\d{3})$/i)
  if (numbered) return Number(numbered[2]) > 1
  if (/\.(z|r)\d{2}$/i.test(fileName)) return true
  const part = (fileName || '').match(/\.part(\d+)\.rar$/i)
  if (part) return Number(part[1]) > 1
  return false
}

interface TranslationRule {
  re: RegExp
  score: number
  label: string
}

/** Ordered from best to worst; the first match wins. */
const TRANSLATION_RULES: TranslationRule[] = [
  {
    re: /(官中|官方中文|官方汉化|官汉|DL官方中文|STEAM官方中文|简繁官中|官中版)/i,
    score: 60,
    label: '官中'
  },
  {
    re: /(精翻|完整汉化|完全汉化|全文本汉化|汉化修正|汉化组)/i,
    score: 45,
    label: '精翻汉化'
  },
  {
    re: /(AI汉化|AI翻译|机翻|云翻|MTOOL|Translator\+\+|挂载翻译|外挂翻译)/i,
    score: 12,
    label: '机翻'
  },
  {
    re: /(汉化|中文化|中文版|简体中文|繁体中文|简中|繁中|中文|CHS|CHT|Chinese)/i,
    score: 30,
    label: '汉化'
  }
]

export function scoreTranslation(name: string): { score: number; label: string } {
  for (const rule of TRANSLATION_RULES) {
    if (rule.re.test(name)) return { score: rule.score, label: rule.label }
  }
  return { score: 0, label: '原版' }
}

/**
 * Classify one entry inside an archive as Android or Korean content.
 *
 * Deliberately strict: only an ".apk" file, a path segment that is exactly a platform /
 * language marker, or a segment carrying an explicit _kr / -kr / .kr marker counts. Anything
 * ambiguous returns '' so a wrong guess can never delete a playable file.
 */
export function classifyArchiveEntry(entryPath: string): 'android' | 'korean' | '' {
  const parts = (entryPath || '').split(/[\\/]+/).filter(Boolean)
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower.endsWith('.apk')) return 'android'
    if (lower === 'android' || lower === 'apk' || lower === '安卓') return 'android'
    if (
      lower === 'kr' ||
      lower === 'ko' ||
      lower === 'korea' ||
      lower === 'korean' ||
      lower === '한국' ||
      lower === '韩' ||
      lower === '韓'
    ) {
      return 'korean'
    }
    if (/(^|[._-])(kr|ko)([._-]|$)/.test(lower) || /(韩|韓)/.test(part)) return 'korean'
  }
  return ''
}

/** Version-independent, translation-independent key used to spot the same game. */
export function normalizeTitleKey(name: string): string {
  const withoutExtension = name
    .replace(/\.part\d+\.rar$/i, '')
    .replace(/\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)(\.\d{3})?$/i, '')
  return cleanTitle(withoutExtension)
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '')
}

function parseVersionParts(version: string | null): number[] {
  if (!version) return []
  return version
    .split(/[.\-_]/)
    .map((part) => parseInt(part, 10))
    .filter((n) => !Number.isNaN(n))
}

export interface EvaluatedArchive extends DuplicateInfo {
  key: string
  score: number
  label: string
  versionParts: number[]
  dirPath: string
  gamePath: string
  platform: PlatformInfo
}

export async function evaluateArchive(
  filePath: string,
  dirPath: string,
  extraParts: string[] = []
): Promise<EvaluatedArchive> {
  const name = path.basename(filePath)
  const translation = scoreTranslation(name)
  const guess = guessVersion(name)
  const platform = detectPlatform(name)
  let sizeBytes = 0
  for (const part of [filePath, ...extraParts]) {
    try {
      sizeBytes += (await fse.stat(part)).size
    } catch {
      // a missing volume simply does not add to the size
    }
  }
  return {
    path: filePath,
    gamePath: filePath,
    dirPath,
    key: normalizeTitleKey(name),
    version: guess.version ?? '',
    versionParts: parseVersionParts(guess.version),
    translation: translation.label,
    score: translation.score,
    label: translation.label,
    sizeBytes,
    platform,
    reason: ''
  }
}

function compareVersionDesc(a: EvaluatedArchive, b: EvaluatedArchive): number {
  const max = Math.max(a.versionParts.length, b.versionParts.length)
  for (let i = 0; i < max; i++) {
    const x = a.versionParts[i] ?? 0
    const y = b.versionParts[i] ?? 0
    if (x !== y) return y - x
  }
  return 0
}

/** Negative when a should be kept over b. */
export function compareCandidates(
  a: EvaluatedArchive,
  b: EvaluatedArchive,
  priority: DuplicatePriority
): number {
  // A Korean release ranks below a pure PC release even when it is newer or better translated:
  // that is the whole point of the rule. Only the package name is used for this, so a KiriKiri
  // plugin such as krmovie.dll can never mark a game as Korean.
  if (a.platform.korean !== b.platform.korean) return a.platform.korean ? 1 : -1
  // A PC build always beats an Android-only build: an APK can be several GB and would
  // otherwise win on size alone. Everything below only compares equal platforms.
  if (a.platform.pc !== b.platform.pc) return a.platform.pc ? -1 : 1
  if (priority === 'translation') {
    if (a.score !== b.score) return b.score - a.score
    const version = compareVersionDesc(a, b)
    if (version !== 0) return version
  } else {
    const version = compareVersionDesc(a, b)
    if (version !== 0) return version
    if (a.score !== b.score) return b.score - a.score
  }
  // File size is deliberately NOT a criterion: PC+KR / Android bundles inflate it and a
  // repack can come out smaller, so it says nothing about which copy is the better one.
  // The path only keeps the comparison deterministic when everything else is equal.
  return a.path.localeCompare(b.path)
}

export interface ArchiveGroupPlan<T extends ArchiveCandidateInput> {
  keep: T[]
  duplicates: Map<T, DuplicateInfo[]>
  /**
   * Android-only / KR-only packages. They are never compared with the PC release: the user
   * wants them gone. A package that also carries a PC build is NOT in here, because deleting
   * it would throw the playable version away too.
   */
  disposable: T[]
}

/**
 * Expand archive candidates, group the ones that hold the same game and pick the best.
 * Groups are scoped to one directory so two different games cannot be merged by name.
 */
export async function planArchiveGroups<T extends ArchiveCandidateInput>(
  candidates: T[],
  priority: DuplicatePriority
): Promise<ArchiveGroupPlan<T>> {
  const groups = new Map<string, { candidate: T; evaluated: EvaluatedArchive }[]>()
  const keep: T[] = []
  const passthrough: T[] = []
  const disposable: T[] = []

  for (const candidate of candidates) {
    if (candidate.entryKind !== 'archive' || !candidate.gamePath) {
      passthrough.push(candidate)
      continue
    }
    // Volumes of one archive are never copies of each other.
    const platform = detectPlatform(path.basename(candidate.gamePath))
    if (isSecondaryVolume(path.basename(candidate.gamePath))) {
      passthrough.push(candidate)
      continue
    }
    // A pure Android release is removed outright. A Korean release is NOT deleted: it stays
    // in the review and simply ranks below a pure PC copy (see compareCandidates). The
    // "korean" flag comes from the package NAME only, never from an entry inside it.
    if (!platform.pc && platform.android) {
      disposable.push(candidate)
      continue
    }
    const key = candidate.dirPath.toLowerCase() + '|' + normalizeTitleKey(path.basename(candidate.gamePath))
    const list = groups.get(key) ?? []
    list.push({
      candidate,
      evaluated: await evaluateArchive(candidate.gamePath, candidate.dirPath)
    })
    groups.set(key, list)
  }

  const duplicates = new Map<T, DuplicateInfo[]>()
  for (const list of groups.values()) {
    if (list.length === 1) {
      keep.push(list[0].candidate)
      continue
    }
    const sorted = [...list].sort((x, y) => compareCandidates(x.evaluated, y.evaluated, priority))
    const best = sorted[0]
    keep.push(best.candidate)
    duplicates.set(
      best.candidate,
      sorted.slice(1).map((entry) => ({
        path: entry.evaluated.path,
        version: entry.evaluated.version,
        translation: entry.evaluated.translation,
        sizeBytes: entry.evaluated.sizeBytes,
        reason:
          (priority === 'translation'
            ? entry.evaluated.translation + ' / ' + (entry.evaluated.version || 'unknown version')
            : (entry.evaluated.version || 'unknown version') + ' / ' + entry.evaluated.translation) +
          ' / ' +
          entry.evaluated.platform.label
      }))
    )
  }

  return { keep: [...passthrough, ...keep], duplicates, disposable }
}
