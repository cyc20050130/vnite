import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Button } from '~/components/ui/button'
import { useConfigLocalState, useConfigState } from '~/hooks'
import { ArrayTextarea } from '@ui/array-textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/utils'
import { useGameScannerStore } from './store'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'

interface GlobalSettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export const GlobalSettingsDialog: React.FC<GlobalSettingsDialogProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation('scanner')
  const [scannerConfig, setScannerConfig] = useConfigLocalState('game.scanner')
  const [scanArchives, setScanArchives] = useConfigState('game.archive.enabled')
  const [aggregateSearch, setAggregateSearch] = useConfigState(
    'game.scraper.common.aggregateSearch'
  )
  const [nameFromFolder, setNameFromFolder] = useConfigState('game.scraper.common.nameFromFolder')
  const [skipIncomplete, setSkipIncomplete] = useConfigState('game.archive.skipIncomplete')
  const [preserveSaves, setPreserveSaves] = useConfigState('game.archive.preserveSaves')
  const [duplicatePriority, setDuplicatePriority] = useConfigState('game.archive.duplicatePriority')
  const [extractRoot, setExtractRoot] = useConfigState('game.archive.defaultExtractRoot')
  const [externalToolPath, setExternalToolPath] = useConfigState('game.archive.externalToolPath')
  const [autoCompress, setAutoCompress] = useConfigState('game.archive.autoCompressOnFinished')
  const { globalSettings, intervalMinutes, updateGlobalSettings, updateIntervalMinutes } =
    useGameScannerStore()

  // Initialize form data
  useEffect(() => {
    if (isOpen && scannerConfig) {
      // Initialize global settings
      updateGlobalSettings({
        interval: scannerConfig.interval || 0,
        ignoreList: scannerConfig.ignoreList || []
      })
      updateIntervalMinutes(((scannerConfig.interval || 0) / 60000).toString())
    }
  }, [isOpen, scannerConfig, updateGlobalSettings, updateIntervalMinutes])

  const handleSave = async (): Promise<void> => {
    if (globalSettings.interval < 5 * 60 * 1000) {
      toast.error(t('notifications.intervalTooShort'))
      return
    }
    const normalize = (p: string): string => p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const dedupedIgnoreList = Array.from(
      new Set((globalSettings.ignoreList || []).map(normalize).filter((v) => v.length > 0))
    ).sort()
    const updatedConfig = {
      ...scannerConfig,
      interval: globalSettings.interval,
      ignoreList: dedupedIgnoreList
    }
    await setScannerConfig(updatedConfig)
    await ipcManager.invoke('scanner:start-periodic-scan')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[70vw]">
        <DialogHeader>
          <DialogTitle>{t('globalSettings.title')}</DialogTitle>
        </DialogHeader>

        <div
          className={cn('grid grid-cols-[auto_1fr] gap-y-3 gap-x-4 px-3 py-5 items-center text-sm')}
        >
          {/* Scan interval */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.scanInterval')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <Input
                type="text"
                value={intervalMinutes}
                onChange={(e) => updateIntervalMinutes(e.target.value)}
                className={cn('text-sm')}
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.scanIntervalTooltip')}</div>
            </TooltipContent>
          </Tooltip>
          {/* Ignore list */}
          <div className={cn('whitespace-nowrap select-none self-start mt-1')}>
            {t('globalSettings.ignoreList')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <ArrayTextarea
                className="h-[30vh] lg:h-[50vh] resize-none"
                placeholder={t('globalSettings.ignoreListPlaceholder')}
                value={globalSettings.ignoreList}
                onChange={(value: string[]) => updateGlobalSettings({ ignoreList: value })}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.ignoreListTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Scan archives */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.scanArchives')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={Boolean(scanArchives)}
                  onCheckedChange={(value) => void setScanArchives(value)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.scanArchivesTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Aggregate search */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.aggregateSearch')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={Boolean(aggregateSearch)}
                  onCheckedChange={(value) => void setAggregateSearch(value)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.aggregateSearchTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Use folder name as localized name */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.nameFromFolder')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={Boolean(nameFromFolder)}
                  onCheckedChange={(value) => void setNameFromFolder(value)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.nameFromFolderTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Skip archives that are still downloading */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.skipIncomplete')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={Boolean(skipIncomplete)}
                  onCheckedChange={(value) => void setSkipIncomplete(value)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.skipIncompleteTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Preserve saves before re-compressing */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.preserveSaves')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={Boolean(preserveSaves)}
                  onCheckedChange={(value) => void setPreserveSaves(value)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.preserveSavesTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Prefer the newest version when de-duplicating */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.duplicatePriority')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={duplicatePriority === 'version'}
                  onCheckedChange={(value) =>
                    void setDuplicatePriority(value ? 'version' : 'translation')
                  }
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.duplicatePriorityTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Unified extract root */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.extractRoot')}
          </div>
          <Input
            type="text"
            value={extractRoot ?? ''}
            placeholder={t('globalSettings.extractRootPlaceholder')}
            onChange={(event) => void setExtractRoot(event.target.value)}
            className={cn('text-sm')}
          />

          {/* External archiver used by "open with" */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.externalTool')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <Input
                type="text"
                value={externalToolPath ?? ''}
                placeholder={t('globalSettings.externalToolPlaceholder')}
                onChange={(event) => void setExternalToolPath(event.target.value)}
                className={cn('text-sm')}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.externalToolTooltip')}</div>
            </TooltipContent>
          </Tooltip>

          {/* Auto compress on finished */}
          <div className={cn('whitespace-nowrap select-none justify-self-start')}>
            {t('globalSettings.autoCompress')}
          </div>
          <Tooltip>
            <TooltipTrigger className={cn('p-0 max-w-none m-0 w-full')}>
              <div>
                <Switch
                  checked={Boolean(autoCompress)}
                  onCheckedChange={(value) => void setAutoCompress(value)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className={cn('text-xs')}>{t('globalSettings.autoCompressTooltip')}</div>
            </TooltipContent>
          </Tooltip>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
