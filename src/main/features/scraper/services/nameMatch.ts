import { jaroWinkler } from '@appUtils'

/**
 * Name helpers shared by provider matching. Chinese and Japanese share hanzi, so the
 * writing system is the reliable signal: a Japanese title contains kana, a Chinese one
 * does not.
 */

const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/

/**
 * Clean a name that came from a provider.
 *
 * Some sources (Ymgal in particular) return the upload name instead of a title:
 * "1.炎の孕ませ転校生（炎孕转校生）", "10_もっと！…（吹弹！…）", "13.[PC]炎孕13 异世界魅魔学园！".
 * Strip the leading index / packaging tag and, when the main part is kana and the
 * parenthesised part is Chinese, keep the Chinese part.
 */
export function normalizeDisplayName(raw: string): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  let out = value.replace(/^\s*\d{1,3}\s*[.、_\-]\s*/, '')
  out = out.replace(/^\s*[\[【［][^\]】］]{1,8}[\]】］]\s*/, '')
  const match = out.match(/[（(]([^（）()]{2,60})[）)]\s*$/)
  if (match && match.index !== undefined) {
    const inside = match[1].trim()
    const outside = out.slice(0, match.index).trim()
    if (outside && KANA_RE.test(outside) && inside && !KANA_RE.test(inside)) return inside
  }
  return out.trim() || value
}

/** Names that certainly are not a game title, so we never search for (or import) them. */
const PLACEHOLDER_TITLES = new Set([
  'temp',
  'tmp',
  'test',
  'new',
  'newfolder',
  'untitled',
  'todo',
  'download',
  'archive',
  'game',
  'gamefolder',
  '新建文件夹',
  '新建文件夹2',
  '未命名',
  '下载',
  '压缩包'
])

export function isPlaceholderTitle(name: string): boolean {
  const key = (name || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
  if (!key) return true
  if (PLACEHOLDER_TITLES.has(key)) return true
  // "v1.2" / "2024-01-01" style names carry nothing to search for.
  return /^v?\d+([._-]\d+)*$/.test(name.trim().toLowerCase())
}

/** True when a name looks like Chinese (hanzi, no kana). */
export function isChineseName(value: string): boolean {
  if (!value) return false
  if (KANA_RE.test(value)) return false
  return (value.match(/[\u3400-\u9fff]/g) || []).length >= 2
}

/** Lowercase, strip brackets and punctuation for comparison. */
export function normalizeForMatch(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[\[【(（][^\]】)）]*[\]】)）]/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '')
}

/** Loose "same game" test used to accept a cross-provider name. */
export function isSameGameName(a: string, b: string): boolean {
  const left = normalizeForMatch(a)
  const right = normalizeForMatch(b)
  if (!left || !right) return false
  if (left === right) return true
  if (left.includes(right) || right.includes(left)) return true
  return jaroWinkler(left, right) >= 0.82
}

/** Similarity used when a non-Chinese query returns a Chinese name. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeForMatch(a)
  const right = normalizeForMatch(b)
  if (!left || !right) return 0
  return jaroWinkler(left, right)
}
