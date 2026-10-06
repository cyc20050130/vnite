import { Progress } from '@ui/progress'
import {
  AlertTriangle,
  Folder,
  FolderPlus,
  ListFilter,
  Loader2,
  RefreshCw,
  Settings,
  StopCircle
} from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useConfigLocalState } from '~/hooks'
import { cn } from '~/utils'
import { EditScannerDialog } from './EditScannerDialog'
import { FailedFoldersDialog } from './FailedFoldersDialog'
import { GameScannerListItem } from './GameScannerListItem'
import { GlobalSettingsDialog } from './GlobalSettingsDialog'
import { useGameScannerStore } from './store'

export const GameScannerManager: React.FC = () => {
  const { t } = useTranslation('scanner')

  const [isShowingGlobalSettings, setShowingGlobalSettings] = useState(false)
  const [selectedScannerIds, setSelectedScannerIds] = useState<string[]>([])
  const [showBatchDelete, setShowBatchDelete] = useState(false)

  const [scannerConfig, setScannerConfig] = useConfigLocalState('game.scanner')

  const {
    scanProgress,
    isShowingFailedDialog,
    editingScanner,
    initialize,
    setEditingScanner,
    showFailedDialog,
    scanAll,
    stopScan,
    isStopping,
    scanScanner
  } = useGameScannerStore()

  // Initialize listeners and get initial state
  useEffect(() => {
    initialize()
  }, [initialize])

  const handleAddScanner = (): void => {
    setEditingScanner({ id: null, isNew: true })
  }

  const handleEditGlobalSettings = (): void => {
    setShowingGlobalSettings(true)
  }

  const calculateProgress = (): number => {
    if (scanProgress.totalScanners === 0) return 0
    return Math.round((scanProgress.processedScanners / scanProgress.totalScanners) * 100)
  }

  const getFailedFolderCount = (): number => {
    return Object.values(scanProgress?.scannerProgresses).reduce((total, progress) => {
      return total + (progress.failedFolders?.length || 0)
    }, 0)
  }

  const getStatusVariant = (): 'default' | 'outline' | 'secondary' | 'destructive' => {
    switch (scanProgress.status) {
      case 'scanning':
        return 'secondary'
      case 'completed':
        return 'default'
      case 'error':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  const getStatusText = (): string => {
    switch (scanProgress.status) {
      case 'idle':
        return t('status.idle')
      case 'scanning':
        return t('status.scanning')
      case 'completed':
        return t('status.completed')
      case 'error':
        return t('status.error')
      default:
        return t('status.unknown')
    }
  }

  // Scanner count and global settings
  const scannerList = scannerConfig?.list || {}
  const scannerIds = Object.keys(scannerList)
  const scannerCount = scannerIds.length
  const globalInterval = scannerConfig?.interval || 0

  return (
    <div className="flex flex-col w-full h-full bg-transparent">
      <ScrollArea className="w-full h-full">
        <div className="pt-[34px] px-6 pb-6">
          {/* Header title */}
          <div className="flex items-center justify-between mb-4 ">
            <h2 className="text-2xl font-bold">{t('title')}</h2>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* Status card */}
            <Card className="p-4 rounded-lg">
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Left: Status and progress information */}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Status indicator */}
                  <div className="flex items-center gap-2 pr-4 border-r">
                    <div className="flex items-center">
                      {scanProgress.status === 'scanning' ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin text-primary" />
                      ) : (
                        <Badge
                          variant={getStatusVariant()}
                          className="flex items-center h-6 gap-1 px-2"
                        >
                          {getStatusText()}
                        </Badge>
                      )}
                    </div>

                    {/* Progress bar and percentage */}
                    <div className="flex items-center gap-2">
                      <Progress
                        value={calculateProgress()}
                        className={cn(
                          'w-20 h-2',
                          scanProgress.status === 'scanning' && 'animate-pulse'
                        )}
                      />
                      <span className="text-xs font-medium">{calculateProgress()}%</span>
                    </div>
                  </div>

                  {/* Scanning metrics */}
                  <div className="flex flex-wrap items-center gap-3 pr-4 border-r">
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Folder className="w-3.5 h-3.5" />
                      <span>{t('metrics.scanners', { count: scannerCount })}</span>
                    </Badge>

                    <Badge variant="outline" className="flex items-center gap-1">
                      <ListFilter className="w-3.5 h-3.5" />
                      <span>{t('metrics.games', { count: scanProgress.scannedGames || 0 })}</span>
                    </Badge>

                    {globalInterval > 0 && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          {t('metrics.scanInterval', {
                            minutes: Math.round(globalInterval / 60000)
                          })}
                        </span>
                      </Badge>
                    )}
                  </div>
                  {getFailedFolderCount() > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex items-center h-[22px] gap-1 px-2 text-destructive-foreground"
                      onClick={() => showFailedDialog(true)}
                      disabled={scanProgress.status === 'scanning' || isStopping}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{t('metrics.failures', { count: getFailedFolderCount() })}</span>
                    </Button>
                  )}
                </div>

                {/* Right: Action buttons group */}
                <div className="flex gap-2">
                  {scanProgress.status === 'scanning' ? (
                    <Button size="sm" variant="delete" onClick={stopScan} disabled={isStopping}>
                      <StopCircle className="w-4 h-4 mr-2" />
                      {t('actions.stop')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={scanAll}
                      disabled={scannerCount === 0}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {t('actions.scanAll')}
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditGlobalSettings}
                    disabled={scanProgress.status === 'scanning' || isStopping}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    {t('actions.globalSettings')}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Scanners list and action card */}
            <Card className="flex flex-col flex-grow rounded-lg p-0 gap-0">
              {/* Scanners list title bar */}
              <div className="flex items-center justify-between p-4 border-b bg-muted/[calc(var(--glass-opacity)/2)] rounded-t-lg">
                <div className="text-sm font-medium">{t('list.title')}</div>
                <div className="flex items-center gap-2">
                  {selectedScannerIds.length > 0 ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {t('list.selected', { count: selectedScannerIds.length })}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedScannerIds([...scannerIds])}
                      >
                        {t('list.selectAll')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSelectedScannerIds([])}>
                        {t('list.clearSelection')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={scanProgress.status === 'scanning' || isStopping}
                        onClick={() => {
                          for (const id of selectedScannerIds) scanScanner(id)
                        }}
                      >
                        {t('list.batchScan')}
                      </Button>
                      <Button
                        size="sm"
                        variant="delete"
                        disabled={scanProgress.status === 'scanning' || isStopping}
                        onClick={() => setShowBatchDelete(true)}
                      >
                        {t('list.batchDelete')}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={handleAddScanner}
                    disabled={scanProgress.status === 'scanning' || isStopping}
                  >
                    <FolderPlus className="w-4 h-4 mr-2" />
                    {t('actions.addDirectory')}
                  </Button>
                </div>
              </div>

              {/* Game scanner directories list */}
              <div className="overflow-auto">
                {scannerCount > 0 ? (
                  <div className="divide-y">
                    {Object.entries(scannerList).map(([scannerId, scanner]) => (
                      <GameScannerListItem
                        key={scannerId}
                        scanner={scanner}
                        scannerId={scannerId}
                        onEditClick={() => setEditingScanner({ id: scannerId, isNew: false })}
                        selected={selectedScannerIds.includes(scannerId)}
                        onToggle={(checked) =>
                          setSelectedScannerIds((prev) =>
                            checked ? [...new Set([...prev, scannerId])] : prev.filter((id) => id !== scannerId)
                          )
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                    <Folder className="w-16 h-16 mb-4 opacity-20" />
                    <p className="mb-2 text-lg">{t('list.empty.title')}</p>
                    <p className="text-sm text-center text-muted-foreground">
                      {t('list.empty.description')}
                    </p>
                    <Button className="mt-4" onClick={handleAddScanner}>
                      <FolderPlus className="w-4 h-4 mr-2" />
                      {t('actions.addDirectory')}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Dialog components */}
          {editingScanner !== null && (
            <EditScannerDialog
              isOpen={editingScanner !== null}
              onClose={() => setEditingScanner(null)}
              scannerId={editingScanner.id}
              isNew={editingScanner.isNew}
            />
          )}

          <GlobalSettingsDialog
            isOpen={isShowingGlobalSettings}
            onClose={() => setShowingGlobalSettings(false)}
          />

          <FailedFoldersDialog
            isOpen={isShowingFailedDialog}
            onClose={() => showFailedDialog(false)}
          />

          <AlertDialog open={showBatchDelete} onOpenChange={setShowBatchDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('list.batchDeleteTitle', { count: selectedScannerIds.length })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('list.batchDeleteBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (scannerConfig?.list) {
                      const updatedList = { ...scannerConfig.list }
                      for (const id of selectedScannerIds) delete updatedList[id]
                      void setScannerConfig({ ...scannerConfig, list: updatedList })
                    }
                    setSelectedScannerIds([])
                    setShowBatchDelete(false)
                  }}
                >
                  {t('list.batchDelete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </ScrollArea>
    </div>
  )
}
