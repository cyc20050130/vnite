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
}

export async function evaluateArchive(filePath: string, dirPath: string): Promise<EvaluatedArchive> {
  const name = path.basename(filePath)
  const translation = scoreTranslation(name)
  const guess = guessVersion(name)
  let sizeBytes = 0
  try {
    sizeBytes = (await fse.stat(filePath)).size
  } catch {
    sizeBytes = 0
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
  if (priority === 'translation') {
    if (a.score !== b.score) return b.score - a.score
    const version = compareVersionDesc(a, b)
    if (version !== 0) return version
  } else {
    const version = compareVersionDesc(a, b)
    if (version !== 0) return version
    if (a.score !== b.score) return b.score - a.score
  }
  if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes
  return a.name ? a.name.localeCompare(b.name) : 0
}

export interface ArchiveGroupPlan<T extends ArchiveCandidateInput> {
  keep: T[]
  duplicates: Map<T, DuplicateInfo[]>
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

  for (const candidate of candidates) {
    if (candidate.entryKind !== 'archive' || !candidate.gamePath) {
      passthrough.push(candidate)
      continue
    }
    const key = candidate.dirPath.toLowerCase() + '|' + normalizeTitleKey(path.basename(candidate.gamePath))
    const list = groups.get(key) ?? []
    list.push({ candidate, evaluated: await evaluateArchive(candidate.gamePath, candidate.dirPath) })
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
          priority === 'translation'
            ? entry.evaluated.translation + ' / ' + (entry.evaluated.version || 'unknown version')
            : (entry.evaluated.version || 'unknown version') + ' / ' + entry.evaluated.translation
      }))
    )
  }

  return { keep: [...passthrough, ...keep], duplicates }
}
