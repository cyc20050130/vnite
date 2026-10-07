import { ScraperProvider, ScraperCapabilities } from './types'
import {
  GameList,
  GameMetadata,
  ScraperIdentifier,
  GameDescriptionList,
  GameTagsList,
  GameExtraInfoList,
  GameDevelopersList,
  GamePublishersList,
  GameGenresList,
  GamePlatformsList,
  GameRelatedSitesList,
  GameInformationList,
  AggregatedSearchOptions,
  AggregatedSearchResult,
  AggregatedGameListItem,
  AggregatedSearchError,
  GameCharacter,
  GameVersionInfo
} from '@appTypes/utils'
import { withTimeout } from '~/utils'
import { isChineseName, isSameGameName, nameSimilarity } from './nameMatch'
import { Transformer } from '~/features/transformer'
import log from 'electron-log/main'

function normalizeSearchText(input: string): string {
  return (input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\[\]【】()（）「」『』:：\-_/\\.,，。!！?？~～☆★]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export class ScraperManager {
  private providers: Map<string, ScraperProvider> = new Map()

  /** Providers that keep failing in the current scan; skipped after two failures. */
  private providerFailures: Map<string, number> = new Map()

  public registerProvider(provider: ScraperProvider): void {
    this.providers.set(provider.id, provider)
  }

  public unregisterProvider(providerId: string): void {
    this.providers.delete(providerId)
  }

  public getProvider(providerId: string): ScraperProvider | undefined {
    return this.providers.get(providerId)
  }

  public getAllProviders(): ScraperProvider[] {
    return Array.from(this.providers.values())
  }

  public getProviderIds(): string[] {
    return Array.from(this.providers.keys())
  }

  public hasProvider(providerId: string): boolean {
    return this.providers.has(providerId)
  }

  public async searchGames(
    providerId: string,
    gameName: string,
    gamePath?: string
  ): Promise<GameList> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.searchGames) {
        throw new Error(`Provider '${providerId}' does not support searching games`)
      }
      return provider.searchGames(gameName, gamePath)
    } catch (error) {
      log.error(`[Scraper] Failed to search games using provider '${providerId}': ${error}`)
      throw error
    }
  }

  public async checkGameExists(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<boolean> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.checkGameExists) {
        throw new Error(`Provider '${providerId}' does not support checking game existence`)
      }
      return provider.checkGameExists(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to check game existence using provider '${providerId}': ${error}`)
      return false
    }
  }

  public async getGameMetadata(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<GameMetadata> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameMetadata) {
        throw new Error(`Provider '${providerId}' does not support getting game metadata`)
      }
      const metadata = await provider.getGameMetadata(identifier)
      return Transformer.transformMetadata(metadata, '#all')
    } catch (error) {
      log.error(`[Scraper] Failed to get game metadata using provider '${providerId}': ${error}`)
      throw error
    }
  }

  public async getGameBackgrounds(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameBackgrounds) {
        throw new Error(`Provider '${providerId}' does not support getting game backgrounds`)
      }
      return provider.getGameBackgrounds(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game backgrounds using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public async getGameWideCovers(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameWideCovers) {
        throw new Error(`Provider '${providerId}' does not support getting game wide covers`)
      }
      return provider.getGameWideCovers(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game wide covers using provider '${providerId}': ${error}`)
      return []
    }
  }

  public async getGameVersion(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<GameVersionInfo | null> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider || !provider.getGameVersion) return null
      return await provider.getGameVersion(identifier)
    } catch (error) {
      log.error('[Scraper] Failed to get game version from ' + providerId + ': ' + error)
      return null
    }
  }

  public async getGameCharacters(
    providerId: string,
    identifier: ScraperIdentifier
  ): Promise<GameCharacter[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider || !provider.getGameCharacters) return []
      return await provider.getGameCharacters(identifier)
    } catch (error) {
      log.error('[Scraper] Failed to get characters from ' + providerId + ': ' + error)
      return []
    }
  }

  /** Fan out character lookups; VNDB first, then other capable providers. */
  public async getGameCharactersList(
    identifier: ScraperIdentifier
  ): Promise<{ dataSource: string; characters: GameCharacter[] }[]> {
    const preferred = ['vndb', 'bangumi', 'ymgal', 'erogamescape']
    const capable = this.getProviderIdsWithCapabilities(['getGameCharacters'])
    const ordered = preferred
      .filter((id) => capable.includes(id))
      .concat(capable.filter((id) => !preferred.includes(id)))
    const settled = await Promise.allSettled(
      ordered.map(async (providerId) => ({
        dataSource: providerId,
        characters: await withTimeout(this.getGameCharacters(providerId, identifier), 8000, providerId)
      }))
    )
    return settled
      .filter(
        (result): result is PromiseFulfilledResult<{
          dataSource: string
          characters: GameCharacter[]
        }> => result.status === 'fulfilled'
      )
      .map((result) => result.value)
      .filter((entry) => entry.characters.length > 0)
  }

  public async getGameCovers(providerId: string, identifier: ScraperIdentifier): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameCovers) {
        throw new Error(`Provider '${providerId}' does not support getting game covers`)
      }
      return provider.getGameCovers(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game covers using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public async getGameLogos(providerId: string, identifier: ScraperIdentifier): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameLogos) {
        throw new Error(`Provider '${providerId}' does not support getting game logos`)
      }
      return provider.getGameLogos(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game logos using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public async getGameIcons(providerId: string, identifier: ScraperIdentifier): Promise<string[]> {
    try {
      const provider = this.getProvider(providerId)
      if (!provider) {
        throw new Error(`Provider '${providerId}' not found`)
      }
      if (!provider.getGameIcons) {
        throw new Error(`Provider '${providerId}' does not support getting game icons`)
      }
      return provider.getGameIcons(identifier)
    } catch (error) {
      log.error(`[Scraper] Failed to get game icons using provider '${providerId}': ${error}`)
      // Return an empty array on error, preventing interruptions
      return []
    }
  }

  public clearProviders(): void {
    this.providers.clear()
  }

  private getProviderCapabilities(provider: ScraperProvider): ScraperCapabilities[] {
    return Object.keys(provider)
      .filter((key) => key !== 'id' && key !== 'name')
      .filter((key) => typeof provider[key] === 'function')
      .map((key) => key as ScraperCapabilities)
  }

  public getProviderInfo(providerId: string): {
    id: string
    name: string
    capabilities: ScraperCapabilities[]
  } {
    const provider = this.getProvider(providerId)
    if (!provider) {
      throw new Error(`Provider '${providerId}' not found`)
    }
    return {
      id: provider.id,
      name: provider.name,
      capabilities: this.getProviderCapabilities(provider)
    }
  }

  public getProviderInfosWithCapabilities(
    capabilities: ScraperCapabilities[],
    requireAll: boolean = true
  ): { id: string; name: string; capabilities: ScraperCapabilities[] }[] {
    return this.getAllProviders()
      .filter((provider) => {
        const providerCapabilities = this.getProviderCapabilities(provider)

        if (requireAll) {
          return capabilities.every((capability) => providerCapabilities.includes(capability))
        } else {
          return capabilities.some((capability) => providerCapabilities.includes(capability))
        }
      })
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        capabilities: capabilities.filter((capability) =>
          this.getProviderCapabilities(provider).includes(capability)
        )
      }))
  }

  private getProviderIdsWithCapabilities(
    capabilities: ScraperCapabilities[],
    requireAll: boolean = true
  ): string[] {
    return this.getProviderInfosWithCapabilities(capabilities, requireAll).map(
      (providerInfo) => providerInfo.id
    )
  }

  public async getGameDescriptionList(identifier: ScraperIdentifier): Promise<GameDescriptionList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, description: metadata.description || '' }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, description: '' }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; description: string }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.description)

      const descriptionList = candidates as GameDescriptionList
      return await Transformer.transformDescriptionList(descriptionList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game description list: ${error}`)
      throw error
    }
  }

  public async getGameTagsList(identifier: ScraperIdentifier): Promise<GameTagsList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, tags: metadata.tags || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, tags: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; tags: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.tags.length > 0)

      const tagsList = candidates as GameTagsList
      return await Transformer.transformTagsList(tagsList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game tags list: ${error}`)
      throw error
    }
  }

  public async getGameExtraInfoList(identifier: ScraperIdentifier): Promise<GameExtraInfoList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, extra: metadata.extra || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, extra: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; extra: any[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.extra && item.extra.length > 0)

      const extraInfoList = candidates as GameExtraInfoList
      return await Transformer.transformExtraInfoList(extraInfoList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game extra info list: ${error}`)
      throw error
    }
  }

  public async getGameDevelopersList(identifier: ScraperIdentifier): Promise<GameDevelopersList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, developers: metadata.developers || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, developers: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{ dataSource: string; developers: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.developers && item.developers.length > 0)

      const developersList = candidates as GameDevelopersList
      return await Transformer.transformDevelopersList(developersList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game developers list: ${error}`)
      throw error
    }
  }

  public async getGamePublishersList(identifier: ScraperIdentifier): Promise<GamePublishersList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, publishers: metadata.publishers || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, publishers: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{ dataSource: string; publishers: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.publishers && item.publishers.length > 0)

      const publishersList = candidates as GamePublishersList
      return await Transformer.transformPublishersList(publishersList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game publishers list: ${error}`)
      throw error
    }
  }

  public async getGameGenresList(identifier: ScraperIdentifier): Promise<GameGenresList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, genres: metadata.genres || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, genres: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; genres: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.genres && item.genres.length > 0)

      const genresList = candidates as GameGenresList
      return await Transformer.transformGenresList(genresList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game genres list: ${error}`)
      throw error
    }
  }

  public async getGamePlatformsList(identifier: ScraperIdentifier): Promise<GamePlatformsList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, platforms: metadata.platforms || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, platforms: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; platforms: string[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.platforms && item.platforms.length > 0)

      const platformsList = candidates as GamePlatformsList
      return await Transformer.transformPlatformsList(platformsList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game platforms list: ${error}`)
      throw error
    }
  }

  public async getGameRelatedSitesList(
    identifier: ScraperIdentifier
  ): Promise<GameRelatedSitesList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return { dataSource: providerId, relatedSites: metadata.relatedSites || [] }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return { dataSource: providerId, relatedSites: [] }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (result): result is PromiseFulfilledResult<{ dataSource: string; relatedSites: any[] }> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => item.relatedSites && item.relatedSites.length > 0)

      const relatedSitesList = candidates as GameRelatedSitesList
      return await Transformer.transformRelatedSitesList(relatedSitesList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game related sites list: ${error}`)
      throw error
    }
  }

  public async getGameInformationList(identifier: ScraperIdentifier): Promise<GameInformationList> {
    try {
      const providerIds = this.getProviderIdsWithCapabilities(['getGameMetadata'])
      const TIMEOUT_MS = 5000

      // Execute all requests in parallel
      const metadataResults = await Promise.allSettled(
        providerIds.map(async (providerId) => {
          try {
            const metadata = await withTimeout(
              this.getGameMetadata(providerId, identifier),
              TIMEOUT_MS,
              providerId
            )
            return {
              dataSource: providerId,
              information: {
                name: metadata.name || undefined,
                originalName: metadata.originalName || undefined,
                releaseDate: metadata.releaseDate || undefined,
                developers:
                  metadata.developers && metadata.developers.length > 0
                    ? metadata.developers
                    : undefined,
                publishers:
                  metadata.publishers && metadata.publishers.length > 0
                    ? metadata.publishers
                    : undefined,
                genres: metadata.genres && metadata.genres.length > 0 ? metadata.genres : undefined,
                platforms:
                  metadata.platforms && metadata.platforms.length > 0
                    ? metadata.platforms
                    : undefined
              }
            }
          } catch (error) {
            log.warn(`[Scraper] Failed to get metadata from ${providerId}: ${error}`)
            return {
              dataSource: providerId,
              information: {}
            }
          }
        })
      )

      // Extract successful results
      const candidates = metadataResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{
            dataSource: string
            information: any
          }> => result.status === 'fulfilled'
        )
        .map((result) => result.value)
        .filter((item) => {
          const info = item.information
          return (
            info &&
            (info.name ||
              info.originalName ||
              info.releaseDate ||
              (info.developers && info.developers.length > 0) ||
              (info.publishers && info.publishers.length > 0) ||
              (info.genres && info.genres.length > 0) ||
              (info.platforms && info.platforms.length > 0))
          )
        })

      const informationList = candidates as GameInformationList
      return await Transformer.transformInformationList(informationList)
    } catch (error) {
      log.error(`[Scraper] Failed to get game information list: ${error}`)
      throw error
    }
  }

  /**
   * Query several providers at once and merge/dedupe/rank their results.
   * Provider order in options.providers doubles as the tie-break priority.
   */
  /**
   * Look for a Chinese localized name across the Chinese-capable providers.
   * Returns null when nothing convincing is found, so the caller keeps the original name
   * (a missing translation is better than a wrong one).
   */
  public async findChineseName(
    queries: string[],
    options: { providers?: string[]; timeoutMs?: number } = {}
  ): Promise<{ name: string; source: string; id: string } | null> {
    const providers =
      options.providers && options.providers.length > 0
        ? options.providers
        : ['bangumi', 'ymgal', 'vndb', 'dlsite', 'steam']
    const timeoutMs = options.timeoutMs ?? 15000

    for (const rawQuery of queries) {
      const query = (rawQuery ?? '').trim()
      if (query.length < 2) continue
      for (const providerId of providers) {
        const provider = this.getProvider(providerId)
        if (!provider?.searchGames) continue
        try {
          const results = await Promise.race([
            provider.searchGames(query),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), timeoutMs)
            )
          ])
          for (const candidate of (results ?? []).slice(0, 3)) {
            if (!candidate?.name || !isChineseName(candidate.name)) continue
            // A Chinese query should match closely; a Japanese query may match loosely
            // because the provider answers with its own localized title.
            const confident =
              isSameGameName(candidate.name, query) ||
              nameSimilarity(candidate.name, query) >= (isChineseName(query) ? 0.45 : 0.35)
            if (!confident) continue
            log.info(
              '[Scraper] Chinese name from ' + providerId + ': ' + candidate.name + ' (query: ' + query + ')'
            )
            return { name: candidate.name, source: providerId, id: candidate.id }
          }
        } catch (error) {
          log.warn('[Scraper] Chinese name lookup failed on ' + providerId + ': ' + String(error))
        }
      }
    }
    return null
  }

  /** A new scan gives every provider another chance. */
  public resetProviderHealth(): void {
    this.providerFailures.clear()
  }

  public async aggregateSearchGames(
    gameName: string,
    options: AggregatedSearchOptions = {}
  ): Promise<AggregatedSearchResult> {
    const errors: AggregatedSearchError[] = []
    if (!gameName || gameName.trim().length === 0) {
      return { query: gameName, items: [], errors }
    }

    const fallbackOrder = ['bangumi', 'vndb', 'dlsite', 'ymgal', 'steam', 'igdb', 'erogamescape']
    const requested =
      options.providers && options.providers.length > 0 ? options.providers : fallbackOrder
    // Providers that already failed twice in this scan are skipped: unreachable sources and
    // sources without credentials (IGDB) would otherwise cost a timeout on every folder.
    const callable = requested.filter((id) => {
      if (!this.hasProvider(id)) return false
      if (!this.getProvider(id)!.searchGames) return false
      return (this.providerFailures.get(id) ?? 0) < 2
    })

    const timeoutMs = options.perSourceTimeoutMs ?? 8000
    const concurrency = Math.max(1, options.concurrency ?? 4)
    const limit = options.limitPerSource ?? 0
    const collected: AggregatedGameListItem[] = []

    for (let i = 0; i < callable.length; i += concurrency) {
      const batch = callable.slice(i, i + concurrency)
      const settled = await Promise.allSettled(
        batch.map(async (providerId) => {
          const provider = this.getProvider(providerId)!
          const list = await withTimeout(
            provider.searchGames!(gameName, options.gamePath),
            timeoutMs,
            providerId
          )
          return {
            providerId,
            providerName: provider.name,
            list: limit > 0 ? list.slice(0, limit) : list
          }
        })
      )

      settled.forEach((result, index) => {
        const providerId = batch[index]
        if (result.status === 'fulfilled') {
          for (const item of result.value.list) {
            collected.push({
              ...item,
              source: providerId,
              sourceName: result.value.providerName,
              score: this.rankSearchCandidate(item, gameName)
            })
          }
        } else {
          const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          errors.push({ source: providerId, message: reason })
        // Count the failure so an unreachable/credential-less provider stops costing a
        // timeout on every single folder of this scan.
        this.providerFailures.set(providerId, (this.providerFailures.get(providerId) ?? 0) + 1)
          log.warn('[Scraper] aggregate search failed for ' + providerId + ': ' + reason)
        }
      })
    }

    const deduped = this.dedupeSearchCandidates(collected, options.dedupe ?? 'per-source')
    const orderIndex = new Map(callable.map((id, index) => [id, index] as const))
    deduped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ai = orderIndex.get(a.source) ?? 999
      const bi = orderIndex.get(b.source) ?? 999
      if (ai !== bi) return ai - bi
      return a.name.localeCompare(b.name)
    })

    return { query: gameName, items: deduped, errors }
  }

  private rankSearchCandidate(item: GameList[number], query: string): number {
    const a = normalizeSearchText(item.name)
    const b = normalizeSearchText(query)
    let score = 0
    if (a.length > 0 && a === b) {
      score += 100
    } else if (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))) {
      score += 50
    } else {
      const tokensA = new Set(a.split(' ').filter(Boolean))
      const tokensB = b.split(' ').filter(Boolean)
      if (tokensB.length > 0) {
        const hit = tokensB.filter((t) => tokensA.has(t)).length
        score += Math.round((hit / tokensB.length) * 40)
      }
    }
    if (item.releaseDate) score += 10
    if (item.developers && item.developers.length > 0) score += 5
    return score
  }

  private dedupeSearchCandidates(
    items: AggregatedGameListItem[],
    mode: 'none' | 'per-source' | 'cross-source'
  ): AggregatedGameListItem[] {
    if (mode === 'none') return items
    const seen = new Set<string>()
    const result: AggregatedGameListItem[] = []
    for (const item of items) {
      const key =
        mode === 'per-source'
          ? item.source + '::' + item.id
          : normalizeSearchText(item.name) + '::' + (item.releaseDate || '').slice(0, 4)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
  }
}

// Export singleton instance
export const scraperManager = new ScraperManager()
