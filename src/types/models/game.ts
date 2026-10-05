import { Paths } from 'type-fest'

export type GameMediaType = 'cover' | 'background' | 'icon' | 'logo' | 'wideCover'

export type GameMemoryViewMode = 'grid' | 'full' | 'masonry' | 'list'

export type gameDocs = {
  [gameId: string]: gameDoc
}

export interface gameDoc {
  _id: string
  metadata: {
    name: string
    originalName: string
    sortName: string
    version: string
    releaseDate: string
    description: string
    developers: string[]
    publishers: string[]
    platforms: string[]
    genres: string[]
    tags: string[]
    /** Structured play tags (act / gameplay / theme / content). */
    playTags: {
      name: string
      category: string
      sources: string[]
    }[]
    /** Characters with locally cached cover images. */
    characters: {
      id: string
      source: string
      sourceId: string
      name: string
      originalName?: string
      imageUrl?: string
      imageCached?: boolean
      description?: string
      traits?: { name: string; group?: string; spoiler?: number }[]
      sex?: string
      actors?: string[]
    }[]
    relatedSites: {
      label: string
      url: string
    }[]
    steamId: string
    vndbId: string
    igdbId: string
    ymgalId: string
    extra: {
      key: string
      value: string[]
    }[]
  }
  record: {
    addDate: string
    lastRunDate: string
    score: number
    playTime: number
    playStatus: 'unplayed' | 'playing' | 'partial' | 'finished' | 'multiple' | 'shelved'
    hideFromRecentGames: boolean
    timers: {
      start: string
      end: string
    }[]
    dailyPlayTimes: {
      date: string
      playTime: number
    }[]
    storageSize: number
  }
  save: {
    saveList: {
      [saveId: string]: {
        _id: string
        date: string
        note: string
        locked: boolean
      }
    }
    maxBackups: number
    autoRestoreSave: boolean
  }
  memory: {
    preferences: {
      viewMode: GameMemoryViewMode | null
    }
    memoryList: {
      [memoryId: string]: {
        _id: string
        date: string
        note: string
        pinned?: boolean
      }
    }
  }
  apperance: {
    logo: {
      position: {
        x: number
        y: number
      }
      size: number
      visible: boolean
    }
    nsfw: boolean
  }
}

export interface gameCollectionDocs {
  [gameCollectionId: string]: gameCollectionDoc
}

export interface gameCollectionDoc {
  _id: string
  name: string
  sort: number
  sortBy:
    | 'metadata.name'
    | 'metadata.sortName'
    | 'metadata.releaseDate'
    | 'record.lastRunDate'
    | 'record.addDate'
    | 'record.playTime'
    | 'record.storageSize'
    | 'custom'
  sortOrder: 'asc' | 'desc'
  games: string[]
}

export interface gameLocalDocs {
  [gameId: string]: gameLocalDoc
}

export type GameArchiveFormat = 'zip' | '7z' | 'rar' | 'tar' | 'gz' | 'xz' | 'zst' | 'bz2' | 'other'
export type GameArchiveState =
  | 'archived'
  | 'extracting'
  | 'extracted'
  | 'compressing'
  | 'error'
  | 'passwordRequired'

export interface gameArchiveLocal {
  enabled: boolean
  format: GameArchiveFormat | ''
  parts: string[]
  state: GameArchiveState
  entrypoint: string
  extractDir: string
  keepArchive: boolean
  passwordId: string
  encrypted: boolean
  headerEncrypted: boolean
  lastError: string
  lastTransitionAt: string
  archiveBytes: number
  extractedBytes: number
}

export interface ArchiveStatusView {
  gameId: string
  enabled: boolean
  state: string
  format: string
  archivePath: string
  parts: string[]
  extractDir: string
  entrypoint: string
  encrypted: boolean
  archiveBytes: number
  extractedBytes: number
  lastError: string
  extractDirExists: boolean
}

export interface gameLocalDoc {
  _id: string
  path: {
    gamePath: string
    savePaths: string[]
    screenshotPath?: string
  }
  launcher: {
    mode: 'file' | 'archive' | 'url' | 'script'
    fileConfig: {
      path: string
      args: string[]
      monitorMode: 'file' | 'folder' | 'process'
      monitorPath: string
    }
    urlConfig: {
      url: string
      browserPath: string
      monitorMode: 'file' | 'folder' | 'process'
      monitorPath: string
    }
    scriptConfig: {
      workingDirectory: string
      command: string[]
      monitorMode: 'file' | 'folder' | 'process'
      monitorPath: string
    }
    useMagpie: boolean
  }
  archive: gameArchiveLocal
  utils: {
    markPath: string
    rootPath: string
  }
}

export const DEFAULT_GAME_LOCAL_VALUES: Readonly<gameLocalDoc> = {
  _id: '',
  path: {
    gamePath: '',
    savePaths: [],
    screenshotPath: ''
  },
  launcher: {
    mode: 'file',
    fileConfig: {
      path: '',
      args: [],
      monitorMode: 'folder',
      monitorPath: ''
    },
    urlConfig: {
      url: '',
      browserPath: '',
      monitorMode: 'folder',
      monitorPath: ''
    },
    scriptConfig: {
      workingDirectory: '',
      command: [],
      monitorMode: 'folder',
      monitorPath: ''
    },
    useMagpie: false
  },
  archive: {
    enabled: false,
    format: '',
    parts: [],
    state: 'archived',
    entrypoint: '',
    extractDir: '',
    keepArchive: false,
    passwordId: '',
    encrypted: false,
    headerEncrypted: false,
    lastError: '',
    lastTransitionAt: '',
    archiveBytes: 0,
    extractedBytes: 0
  },
  utils: {
    markPath: '',
    rootPath: ''
  }
} as const

export const DEFAULT_GAME_COLLECTION_VALUES: Readonly<gameCollectionDoc> = {
  _id: '',
  name: '',
  sort: 0,
  sortBy: 'custom',
  sortOrder: 'asc',
  games: []
} as const

/**
 * Storage size value indicating the size has not been calculated yet
 */
export const STORAGE_SIZE_NOT_CALCULATED = -1

export const DEFAULT_GAME_VALUES: Readonly<gameDoc> = {
  _id: '',
  metadata: {
    name: '',
    originalName: '',
    sortName: '',
    version: '',
    releaseDate: '',
    description: '',
    developers: [] as string[],
    publishers: [] as string[],
    platforms: [] as string[],
    genres: [] as string[],
    tags: [] as string[],
    playTags: [] as { name: string; category: string; sources: string[] }[],
    characters: [] as {
      id: string
      source: string
      sourceId: string
      name: string
      originalName?: string
      imageUrl?: string
      imageCached?: boolean
      description?: string
      traits?: { name: string; group?: string; spoiler?: number }[]
      sex?: string
      actors?: string[]
    }[],
    relatedSites: [] as { label: string; url: string }[],
    steamId: '',
    vndbId: '',
    igdbId: '',
    ymgalId: '',
    extra: [] as { key: string; value: string[] }[]
  },
  record: {
    addDate: '',
    lastRunDate: '',
    score: -1,
    playTime: 0,
    playStatus: 'unplayed',
    hideFromRecentGames: false,
    timers: [],
    dailyPlayTimes: [],
    storageSize: STORAGE_SIZE_NOT_CALCULATED
  },
  save: {
    saveList: {},
    maxBackups: 7,
    autoRestoreSave: false
  },
  memory: {
    preferences: {
      viewMode: null
    },
    memoryList: {}
  },
  apperance: {
    logo: {
      position: {
        x: 1.5,
        y: 35
      },
      size: 100,
      visible: true
    },
    nsfw: false
  }
} as const

export interface SortConfig {
  by: Paths<gameDoc, { bracketNotation: true }>
  order?: 'asc' | 'desc'
}

export interface Timer {
  start: string
  end: string
}

export interface DailyPlayTime {
  date: string
  playTime: number
}

export interface MaxPlayTimeDay {
  date: string
  playTime: number
}

export const DEFAULT_PLAY_STATUS_ORDER: gameDoc['record']['playStatus'][] = [
  'unplayed',
  'playing',
  'partial',
  'finished',
  'multiple',
  'shelved'
]

export const METADATA_EXTRA_PREDEFINED_KEYS = [
  'director',
  'scenario',
  'illustration',
  'music',
  'voice',
  'engine'
]

export interface BatchGameInfo {
  dataId: string
  dataSource: string
  name: string
  id: string
  status: 'idle' | 'loading' | 'success' | 'error' | 'existed'
  dirPath: string
}

export enum TimerStatus {
  Resumed,
  Paused
}

export interface GameTimerStatus {
  name: string
  status: TimerStatus
}
