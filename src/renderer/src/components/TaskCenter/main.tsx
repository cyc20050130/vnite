import { Badge } from '@ui/badge'
import { Button } from '@ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip'
import type { ArchiveBatchJob } from '@appTypes/utils'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useArchiveBatchStore } from '~/stores/archiveBatchStore'
import { cn } from '~/utils'

const OP_KEY: Record<ArchiveBatchJob['op'], string> = {
  extract: 'extract',
  compress: 'compress',
  'backup-saves': 'backupSaves',
  'check-version': 'checkVersion',
  'resolve-duplicates': 'resolveDuplicates'
}

const STATUS_KEY: Record<ArchiveBatchJob['status'], string> = {
  running: 'running',
  completed: 'success',
  cancelled: 'cancelled'
}

/** Small task list in the titlebar so long jobs stay visible from anywhere. */
export function TaskCenter(): React.JSX.Element {
  const { t } = useTranslation('game')
  const jobs = useArchiveBatchStore((state) => state.jobs)
  const openDialog = useArchiveBatchStore((state) => state.openDialog)
  const open = useArchiveBatchStore((state) => state.taskCenterOpen)
  const setOpen = useArchiveBatchStore((state) => state.setTaskCenterOpen)
  const running = jobs.filter((job) => job.status === 'running').length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="thirdary" size={'icon'} className={cn('relative h-[32px] w-[32px]')}>
              <span className={cn('icon-[mdi--clipboard-text-clock] w-4 h-4')}></span>
              {running > 0 ? (
                <span
                  className={cn(
                    'absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground'
                  )}
                >
                  {running}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('taskCenter.title')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[320px] flex-col gap-1 p-2">
        {jobs.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground">{t('taskCenter.empty')}</div>
        ) : (
          jobs.map((job) => {
            const success = job.items.filter((item) => item.status === 'success').length
            const failed = job.items.filter((item) => item.status === 'failed').length
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => openDialog(job.id)}
                className={cn('flex w-full flex-col gap-1 rounded p-2 text-left hover:bg-accent')}
              >
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={job.status === 'running' ? 'outline' : 'secondary'}>
                    {t('archiveBatch.status.' + STATUS_KEY[job.status])}
                  </Badge>
                  <span className="truncate">{t('archiveBatch.title.' + OP_KEY[job.op])}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t('taskCenter.counts', { done: success, total: job.items.length, failed })}
                </span>
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
