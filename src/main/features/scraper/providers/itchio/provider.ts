import { ScraperProvider } from '../../services/types'
import { GameList, GameMetadata, ScraperIdentifier, GameVersionInfo } from '@appTypes/utils'
import {
  searchItchGames,
  checkItchGameExists,
  getItchVersion,
  getItchMetadata
} from './common'

export const itchioProvider: ScraperProvider = {
  id: 'itchio',
  name: 'itch.io',

  async searchGames(gameName: string): Promise<GameList> {
    return await searchItchGames(gameName)
  },

  async checkGameExists(identifier: ScraperIdentifier): Promise<boolean> {
    return await checkItchGameExists(identifier.value)
  },

  async getGameMetadata(identifier: ScraperIdentifier): Promise<GameMetadata> {
    return await getItchMetadata(identifier.value)
  },

  async getGameVersion(identifier: ScraperIdentifier): Promise<GameVersionInfo | null> {
    return await getItchVersion(identifier.value)
  }
}
