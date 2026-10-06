import { Badge } from '@ui/badge'
import { Button } from '@ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { Progress } from '@ui/progress'
import type { ArchiveBatchItem, ArchiveBatchJob, ArchiveBatchOp } from '@appTypes/utils'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useArchiveBatchStore } from '~/stores/archiveBatchStore'
import { cn } from '~/utils'

const OP_LABEL: Record<ArchiveBatchOp, string> = {
  extract: 'extract',
  compress: 'compress',
  'backup-saves': 'backupSaves',
  'check-version': 'checkVersion',
  'resolve-duplicates': 'resolveDuplicates'
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
  unknown: 'result.unknown'
}

function statusVariant(status: ArchiveBatchItem['status']): 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive'
  if (status === 'success') return 'secondary'
  return 'outline'
}

export function ArchiveBatchDialog(): React.JSX.Element | null {
  const { t } = useTranslation('game')
  const { jobs, activeJobId, dialogOpen, closeDialog, cancel, retryFailed } = useArchiveBatchStore()

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
            <span className="text-muted-foreground">
              {t('archiveBatch.concurrency', { count: job.concurrency })}
            </span>
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
            <Button variant="secondary" size="sm" onClick={() => void retryFailed(job.id)}>
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
