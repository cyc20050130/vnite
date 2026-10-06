import { jaroWinkler } from '@appUtils'

/**
 * Name helpers shared by provider matching. Chinese and Japanese share hanzi, so the
 * writing system is the reliable signal: a Japanese title contains kana, a Chinese one
 * does not.
 */

const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/

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
