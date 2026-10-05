import { net } from 'electron'
import * as cheerio from 'cheerio'
import { GameList, GameMetadata, GameVersionInfo } from '@appTypes/utils'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await net.fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!response.ok) return null
    return await response.text()
  } catch (error) {
    console.error('[itch.io] fetch failed ' + url + ': ' + String(error))
    return null
  }
}

export function extractItchVersion(html: string): string | null {
  const versionRow = html.match(/Version[^0-9]{0,30}(\d+(?:\.\d+){0,3}[a-z]?)/i)
  return versionRow ? versionRow[1] : null
}

export async function searchItchGames(gameName: string): Promise<GameList> {
  const html = await fetchText('https://itch.io/search?q=' + encodeURIComponent(gameName))
  if (!html) return []
  const $ = cheerio.load(html)
  const results: GameList = []
  const seen = new Set<string>()
  $('a.game_link, a.title.game_link, div.game_cell a').each((_, element) => {
    const href = $(element).attr('href') || ''
    const text = $(element).text().trim()
    if (!href || !text) return
    const idMatch = href.match(/^https?:\/\/([^/]+)\.itch\.io\/([^/?#]+)/i)
    if (!idMatch || seen.has(idMatch[1] + '/' + idMatch[2])) return
    seen.add(idMatch[1] + '/' + idMatch[2])
    results.push({
      id: idMatch[1] + '/' + idMatch[2],
      name: text,
      releaseDate: '',
      developers: [idMatch[1]]
    })
  })
  return results.slice(0, 20)
}

function itchUrl(identifier: string): string {
  if (identifier.startsWith('http')) return identifier
  const parts = identifier.split('/')
  return parts.length >= 2 ? 'https://' + parts[0] + '.itch.io/' + parts[1] : 'https://itch.io/' + identifier
}

export async function checkItchGameExists(identifier: string): Promise<boolean> {
  const html = await fetchText(itchUrl(identifier))
  return Boolean(html)
}

export async function getItchVersion(identifier: string): Promise<GameVersionInfo | null> {
  const url = itchUrl(identifier)
  const html = await fetchText(url)
  if (!html) return null
  const version = extractItchVersion(html)
  const updatedMatch =
    html.match(/Updated[\s\S]{0,120}?title="([^"]+)"/i) ||
    html.match(/class="timeago"[^>]*title="([^"]+)"/i) ||
    html.match(/Updated\s*<\/strong>\s*([^<\n]+)/i)
  const updatedAt = updatedMatch ? updatedMatch[1].trim() : undefined
  if (!version && !updatedAt) return null
  return {
    version: version ?? undefined,
    updatedAt,
    source: 'itchio',
    confidence: version ? 'inferred' : 'unknown',
    url
  }
}

export async function getItchMetadata(identifier: string): Promise<GameMetadata> {
  const url = itchUrl(identifier)
  const html = await fetchText(url)
  if (!html) throw new Error('itch.io page not reachable')
  const $ = cheerio.load(html)
  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim()
  const description = ($('meta[property="og:description"]').attr('content') || '').trim()
  const image = $('meta[property="og:image"]').attr('content') || ''
  const dev = identifier.startsWith('http') ? '' : identifier.split('/')[0]
  return {
    name: title || identifier,
    originalName: null,
    releaseDate: '',
    description,
    developers: dev ? [dev] : [],
    relatedSites: [{ label: 'itch.io', url }],
    tags: [],
    extra: image ? [{ key: 'cover', value: [image] }] : []
  }
}
