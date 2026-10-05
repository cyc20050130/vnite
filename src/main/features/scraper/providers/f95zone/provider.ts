import { ScraperProvider } from '../../services/types'
import { GameList, GameMetadata, ScraperIdentifier, GameVersionInfo } from '@appTypes/utils'
import {
  searchF95Games,
  checkF95GameExists,
  getF95Version,
  getF95Metadata
} from './common'

export const f95zoneProvider: ScraperProvider = {
  id: 'f95zone',
  name: 'F95zone',

  async searchGames(gameName: string): Promise<GameList> {
    return await searchF95Games(gameName)
  },

  async checkGameExists(identifier: ScraperIdentifier): Promise<boolean> {
    return await checkF95GameExists(identifier.value)
  },

  async getGameMetadata(identifier: ScraperIdentifier): Promise<GameMetadata> {
    return await getF95Metadata(identifier.value)
  },

  async getGameVersion(identifier: ScraperIdentifier): Promise<GameVersionInfo | null> {
    return await getF95Version(identifier.value)
  }
}
