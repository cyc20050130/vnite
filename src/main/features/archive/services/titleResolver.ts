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

/* ------------------------------------------------------------------ *
 * Name parsing: separate the original title from a Chinese translation
 * ------------------------------------------------------------------ */

const ARCHIVE_EXT_RE = /\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)(\.\d{3})?$/i
/** Leading ordering index: "1.", "10_", "第3話", "[13] ". */
const LEADING_INDEX_RE = /^\s*[\[(【]?\d{1,3}[\])】]?\s*[.\-_、:：)\]]\s*/
const BRACKET_RE = /[\[【(（《]([^\[\]【】()（）《》]{1,80})[\]】)）》]/g
const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/
/**
 * Characters used by simplified Chinese but not by Japanese. A kanji-only segment
 * without any of them is probably a Japanese title, not a translation, so it is kept
 * only as a weak candidate (better to leave the name empty than to fill it wrongly).
 */
const SIMPLIFIED_HINT_RE =
  /[们这说时么爱让边过还进运选图戏录欢乐买卖单车东长门问闻间关摄丽开专业题应该对错电读认识觉习视网络软动动漫风发见现观样务员无厕诉]/
const CJK_RE = /[\u3400-\u9fff]/
/** Bracket contents / segments that describe the release instead of naming it. */
const TAG_RE =
  /^(?:v|ver|version)?[.\s]*\d+(?:\.\d+)*[a-z]?$|^(?:pc|win|windows|android|mac|linux|steam|dl|dlsite|fanza|rj|vj|bj|re)\d*$|^(?:汉化|汉化版|官中|官方中文|官方汉化|中文|中文版|简中|繁中|简体|繁体|机翻|ai汉化|ai翻译|步兵|无修|破解|存档|全cg存档|全回想|特典|攻略|dlc|patch|补丁|生肉|熟肉|完全版|体验版|正式版|重制版|合集|作品集|薄码版|薄码)$/i
/** Noise that can appear inside an otherwise usable segment. */
const NOISE_RE =
  /汉化|官中|官方中文|机翻|云翻|ai翻译|ai汉化|gpt|翻译|作弊|存档|特典|全cg|全回想|步兵|薄码|马赛克|破解|无修|去码|绅士回廊|补丁|dlc/i
/** Collection prefixes such as "_电脑_", "PC_", "安卓_". */
const CATEGORY_RE =
  /^(?:电脑|微机|安卓|手机|苹果|汉化|官中|ai|gpt|part\d+|pc|jp|en|zh|\d{1,3}|[a-z]{1,2}\d{0,2})$/i
/** Producer / date codes like 191129POISON or 130329POISON_MOTION. */
const CODE_RE = /^\d{6}[a-z]*$/i

/** Release words that cleanTitle may leave behind in the final title. */
const TITLE_NOISE_RE =
  /(精翻|汉化版|汉化|官中|官方中文|官方汉化|机翻|云翻|AI翻译|AI汉化|GPT翻译|翻译|薄码版|薄码|步兵版|步兵|无修|去码|马赛克|作弊|全CG存档|全回想|存档|特典|攻略|破解|正式版|体验版|part\d+)/gi

function stripTitleNoise(value: string): string {
  return value
    .replace(TITLE_NOISE_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[+＋\s]+|[+＋\s]+$/g, '')
    .trim()
}

function isNoiseSegment(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (TAG_RE.test(trimmed) || CATEGORY_RE.test(trimmed) || CODE_RE.test(trimmed)) return true
  if (NOISE_RE.test(trimmed) && CJK_RE.test(trimmed) === false) return true
  // A segment that only survives because of release keywords is metadata too.
  const withoutNoise = trimmed.replace(new RegExp(NOISE_RE.source, 'gi'), '').replace(/[+\s]+/g, '')
  return withoutNoise.length < 2
}

export interface ParsedArchiveName {
  raw: string
  /** Main title: index, brackets and collection prefixes removed. */
  mainTitle: string
  /** Best Chinese translation found in brackets / after an underscore ('' when none). */
  translation: string
  /** Names to try when searching providers, best first. */
  candidates: string[]
}

/**
 * Split an archive or folder name into an original title and a translation.
 *
 * Key signal: Japanese titles almost always contain kana (の / ー / ッ ...) while a
 * Chinese translation contains hanzi only. A segment with hanzi but no kana is
 * therefore treated as the translation; release metadata (【PC】, v1.2, 汉化, 存档)
 * and collection prefixes (_电脑_) are ignored.
 */
export function parseArchiveName(rawInput: string): ParsedArchiveName {
  const raw = (rawInput ?? '').trim()
  const working = raw
    .replace(/\.part\d+\.rar$/i, '')
    .replace(/\.(\d{3})$/i, '')
    .replace(ARCHIVE_EXT_RE, '')
    .replace(LEADING_INDEX_RE, '')
    .replace(/[_\-\s]+part\d+$/i, '')

  const bracketContents: string[] = []
  const withoutBrackets = working.replace(BRACKET_RE, (_match, inner: string) => {
    bracketContents.push(inner.trim())
    return ' '
  })

  const segments = working
    .split(/_+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  const meaningful = segments.filter((segment) => !isNoiseSegment(segment))
  const mainTitle =
    stripTitleNoise(
      cleanTitle(meaningful.join(' ')) || cleanTitle(withoutBrackets.replace(/_+/g, ' '))
    ) ||
    working.replace(/_+/g, ' ')

  const mainHasKana = KANA_RE.test(mainTitle)
  const mainIsChinese = CJK_RE.test(mainTitle) && !mainHasKana

  const scored: { value: string; score: number }[] = []
  const consider = (value: string, score: number): void => {
    if (isNoiseSegment(value)) return
    const cleaned = cleanTitle(value.replace(/_+/g, ' '))
    // The cleaned form can still collapse into a release tag (精翻汉化薄码版 -> 薄码版).
    if (cleaned.length < 3 || cleaned === mainTitle || isNoiseSegment(cleaned)) return
    scored.push({ value: cleaned, score })
  }

  for (const inner of bracketContents) {
    const hasKana = KANA_RE.test(inner)
    const hasCjk = CJK_RE.test(inner)
    if (hasCjk && !hasKana) consider(inner, mainHasKana ? 3 : 2)
    else if (hasKana) consider(inner, 1)
    else consider(inner, 0)
  }
  for (const segment of meaningful) {
    if (KANA_RE.test(segment)) continue
    if (CJK_RE.test(segment)) {
      consider(segment, mainHasKana && SIMPLIFIED_HINT_RE.test(segment) ? 3 : 1)
    } else if (/[a-z]/i.test(segment)) {
      consider(segment, 0)
    }
  }

  scored.sort((a, b) => b.score - a.score)

  // When the main title is already Chinese, only something clearly better replaces it.
  const threshold = mainIsChinese ? 4 : 3
  const translation =
    scored.find((entry) => entry.score >= threshold && CJK_RE.test(entry.value))?.value ?? ''

  const candidates: string[] = []
  for (const value of [translation, mainTitle, ...scored.map((entry) => entry.value)]) {
    if (value && !candidates.includes(value)) candidates.push(value)
  }

  return { raw, mainTitle, translation, candidates }
}
