import { net } from 'electron'
import * as cheerio from 'cheerio'
import { GameList, GameMetadata, GameVersionInfo } from '@appTypes/utils'
import { ConfigDBManager } from '~/core/database'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9'
    }
    try {
      const cookie = await ConfigDBManager.getConfigValue('game.scraper.f95zone.cookie')
      if (cookie && cookie.trim().length > 0) headers.Cookie = cookie.trim()
    } catch {
      // ignore config read failures
    }
    const response = await net.fetch(url, { headers, signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return null
    return await response.text()
  } catch (error) {
    console.error('[F95zone] fetch failed ' + url + ': ' + String(error))
    return null
  }
}

export function extractVersionFromText(text: string): string | null {
  const bracket = text.match(/\[(?:v|ver(?:sion)?\.?\s*)?(\d+(?:\.\d+){0,3}[a-z]?)\]/i)
  if (bracket) return bracket[1]
  const inline = text.match(/\b(?:v|version)\s*(\d+(?:\.\d+){0,3}[a-z]?)\b/i)
  return inline ? inline[1] : null
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*-\s*F95zone\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function searchF95Games(gameName: string): Promise<GameList> {
  const html = await fetchText('https://f95zone.to/search/?q=' + encodeURIComponent(gameName))
  if (!html) return []
  const $ = cheerio.load(html)
  const results: GameList = []
  const seen = new Set<string>()
  $('a[href*="/threads/"]').each((_, element) => {
    const href = $(element).attr('href') || ''
    const text = $(element).text().trim()
    const idMatch = href.match(/\/threads\/([^/]+)\/?/)
    if (!text || !idMatch || seen.has(idMatch[1])) return
    seen.add(idMatch[1])
    results.push({
      id: idMatch[1],
      name: cleanTitle(text),
      releaseDate: '',
      developers: []
    })
  })
  return results.slice(0, 20)
}

export async function checkF95GameExists(identifier: string): Promise<boolean> {
  if (!identifier) return false
  const html = await fetchText(
    identifier.startsWith('http') ? identifier : 'https://f95zone.to/threads/' + identifier + '/'
  )
  return Boolean(html)
}

export async function getF95Version(identifier: string): Promise<GameVersionInfo | null> {
  const url = identifier.startsWith('http')
    ? identifier
    : 'https://f95zone.to/threads/' + identifier + '/'
  const html = await fetchText(url)
  if (!html) return null
  const $ = cheerio.load(html)
  const title = ($('title').first().text() || $('h1').first().text() || '').trim()
  const version = extractVersionFromText(title)
  const updatedMatch = html.match(/Thread Updated:\s*(?:<[^>]+>\s*)*([^<]+)/i)
  const updatedAt = updatedMatch ? updatedMatch[1].trim() : undefined
  if (!version && !updatedAt) return null
  return {
    version: version ?? undefined,
    updatedAt,
    source: 'f95zone',
    confidence: version ? 'inferred' : 'inferred',
    url
  }
}

export async function getF95Metadata(identifier: string): Promise<GameMetadata> {
  const url = identifier.startsWith('http')
    ? identifier
    : 'https://f95zone.to/threads/' + identifier + '/'
  const html = await fetchText(url)
  if (!html) throw new Error('F95zone page not reachable')
  const $ = cheerio.load(html)
  const titleText = ($('title').first().text() || '').trim()
  const name = cleanTitle(titleText)
  const description = ($('meta[property="og:description"]').attr('content') || '').trim()
  const image = $('meta[property="og:image"]').attr('content') || ''
  return {
    name: name || identifier,
    originalName: null,
    releaseDate: '',
    description,
    developers: [],
    relatedSites: [{ label: 'F95zone', url }],
    tags: [],
    extra: image ? [{ key: 'cover', value: [image] }] : []
  }
}
