export type ScanStatus = 'idle' | 'scanning' | 'completed' | 'error'

export interface ScannerProgress {
  status: ScanStatus
  processedFolders: number
  totalFolders: number
  currentFolder: string
  foldersToProcess: string[]
  failedFolders: {
    path: string
    name: string
    error: string
    dataSource: string
    gamePath?: string
    entryKind?: 'folder' | 'archive'
  }[]
  scannedGames: number
  skippedIncomplete: number
  /** Archives we refused to import, with the reason, so the UI can explain itself. */
  skippedArchives: { name: string; reason: string; detail: string }[]
  errorMessage?: string
}

export interface OverallScanProgress {
  status: ScanStatus
  currentScannerId: string
  processedScanners: number
  totalScanners: number
  scannersToProcess: string[]
  scannedGames: number
  errorMessage?: string
  scannerProgresses: Record<string, ScannerProgress>
}
