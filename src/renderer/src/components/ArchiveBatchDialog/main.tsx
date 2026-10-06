import { Badge } from '@ui/badge'
import { Button } from '@ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { Progress } from '@ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select'
import type { ArchiveBatchItem, ArchiveBatchJob, ArchiveBatchOp } from '@appTypes/utils'
import React from 'react'
import { useTranslation } from 'react-i18next'
import React, { useEffect } from 'react'
import { useConfigState } from '~/hooks'
import { useArchiveBatchStore } from '~/stores/archiveBatchStore'
import { archiveErrorMessage } from '~/utils/archiveError'
import { cn } from '~/utils'

const OP_LABEL: Record<ArchiveBatchOp, string> = {
  extract: 'extract',
  compress: 'compress',
  'backup-saves': 'backupSaves',
  'check-version': 'checkVersion',
  'resolve-duplicates': 'resolveDuplicates',
  'rename-folders': 'renameFolders'
}

/** Detail values that come from the backend as enum-ish codes. */
const DETAIL_KEYS: Record<string, string> = {
  notArchiveBacked: 'skipReason.notArchiveBacked',
  alreadyExtracted: 'skipReason.alreadyExtracted',
  notExtracted: 'skipReason.notExtracted',
  notFinished: 'skipReason.notFinished',
  noDataSource: 'skipReason.noDataSource',
  NO_DATA_SOURCE: 'skipReason.noDataSource',
  NO_VERSION_INFO: 'skipReason.noVersion',
  latest: 'result.latest',
  outdated: 'result.outdated',
  unknown: 'result.unknown',
  renamed: 'result.renamed',
  unchanged: 'result.unchanged',
  noName: 'skipReason.noName',
  noFolder: 'skipReason.noFolder',
  exists: 'skipReason.nameExists',
  locked: 'skipReason.renameLocked',
  disabled: 'skipReason.renameDisabled',
  noGame: 'skipReason.unknown'
}

function statusVariant(status: ArchiveBatchItem['status']): 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive'
  if (status === 'success') return 'secondary'
  return 'outline'
}

export function ArchiveBatchDialog(): React.JSX.Element | null {
  const { t } = useTranslation('game')
  const { jobs, activeJobId, dialogOpen, closeDialog, cancel, retryFailed } = useArchiveBatchStore()
  const [batchConcurrency, setBatchConcurrency] = useConfigState('game.archive.batchConcurrency')
  const [batchOnFinish, setBatchOnFinish] = useConfigState('game.archive.batchOnFinish')
  const jobStatus = jobs.find((entry) => entry.id === activeJobId)?.status

  // "Close when done" is applied here so the setting survives a dialog re-open.
  useEffect(() => {
    if (batchOnFinish === 'close' && jobStatus && jobStatus !== 'running' && dialogOpen) {
      closeDialog()
    }
  }, [batchOnFinish, jobStatus, dialogOpen, closeDialog])

  if (!dialogOpen) return null
  const job: ArchiveBatchJob | undefined = jobs.find((entry) => entry.id === activeJobId) ?? jobs[0]
  if (!job) return null

  const success = job.items.filter((item) => item.status === 'success').length
  const failed = job.items.filter((item) => item.status === 'failed').length
  const skipped = job.items.filter((item) => item.status === 'skipped').length
  const finished = job.items.filter((item) => item.status === 'success' || item.status === 'failed')
  const overall = job.items.length > 0 ? Math.round((finished.length / job.items.length) * 100) : 0

  const detailText = (item: ArchiveBatchItem): string => {
    if (!item.detail) return ''
    const key = DETAIL_KEYS[item.detail]
    if (key) return t('archiveBatch.' + key)
    const readable = archiveErrorMessage(item.detail, t)
    if (readable !== item.detail) return readable
    if (/^\d+$/.test(item.detail)) {
      return job.op === 'resolve-duplicates'
        ? t('archiveBatch.result.trashed', { count: item.detail })
        : t('archiveBatch.result.backupFiles', { count: item.detail })
    }
    return item.detail
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent className="w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('archiveBatch.title.' + OP_LABEL[job.op])}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t('archiveBatch.summary', {
                done: success,
                total: job.items.length,
                failed,
                skipped
              })}
            </span>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{t('archiveBatch.onFinishLabel')}</span>
              <Select
                value={batchOnFinish ?? 'notify'}
                onValueChange={(value) => void setBatchOnFinish(value as never)}
              >
                <SelectTrigger className={cn('h-7 w-[108px] text-xs')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('archiveBatch.onFinish.none')}</SelectItem>
                  <SelectItem value="notify">{t('archiveBatch.onFinish.notify')}</SelectItem>
                  <SelectItem value="close">{t('archiveBatch.onFinish.close')}</SelectItem>
                </SelectContent>
              </Select>
              <span>{t('archiveBatch.concurrencyLabel')}</span>
              <Select
                value={String(batchConcurrency?.[job.op] ?? job.concurrency)}
                onValueChange={(value) =>
                  void setBatchConcurrency({
                    ...(batchConcurrency ?? {}),
                    [job.op]: Number(value)
                  } as never)
                }
                disabled={job.status === 'running'}
              >
                <SelectTrigger className={cn('h-7 w-[76px] text-xs')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Progress value={job.status === 'running' ? overall : 100} />

          <div className="flex max-h-[46vh] flex-col gap-1 overflow-auto scrollbar-base-thin pr-1">
            {job.items.map((item) => (
              <div key={item.gameId} className="flex flex-col gap-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(item.status)}>
                    {t('archiveBatch.status.' + item.status)}
                  </Badge>
                  <span className="truncate">{item.name}</span>
                </div>
                {item.status === 'running' ? <Progress value={item.progress} /> : null}
                {detailText(item) ? (
                  <span
                    className={cn(
                      'break-all text-xs',
                      item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                    )}
                  >
                    {detailText(item)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          {job.status === 'running' ? (
            <Button variant="outline" size="sm" onClick={() => void cancel(job.id)}>
              {t('archiveBatch.actions.cancel')}
            </Button>
          ) : null}
          {failed > 0 && job.status !== 'running' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void retryFailed(job.id, batchConcurrency?.[job.op] ?? job.concurrency)
              }
            >
              {t('archiveBatch.actions.retryFailed')}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => closeDialog()}>
            {t('archiveBatch.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
