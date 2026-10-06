import { Badge } from '@ui/badge'
import { Button } from '@ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/card'
import { Checkbox } from '@ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { Input } from '@ui/input'
import { Progress } from '@ui/progress'
import { Separator } from '@ui/separator'
import { Switch } from '@ui/switch'
import type { ArchivePasswordEntry, ArchiveStatusView } from '@appTypes/models'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { useConfigState, useGameLocalState } from '~/hooks'

function formatBytes(value: number): string {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = value
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024
    i++
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

function Row({
  label,
  value,
  mono
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? 'break-all font-mono text-xs' : 'break-all'}>{value}</span>
    </div>
  )
}

export function Archive({ gameId }: { gameId: string }): React.JSX.Element {
  const { t } = useTranslation('game')
  const [status, setStatus] = useState<ArchiveStatusView | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ jobType: string; percent: number } | null>(null)
  const [passwords, setPasswords] = useState<ArchivePasswordEntry[]>([])
  const [newPassword, setNewPassword] = useState('')
  const [keepArchive, setKeepArchive] = useGameLocalState(gameId, 'archive.keepArchive')
  const [confirmCompress, setConfirmCompress] = useConfigState('game.archive.confirmCompress')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dontAskAgain, setDontAskAgain] = useState(false)

  const backupSaves = useCallback(async (): Promise<void> => {
    try {
      const result = await ipcManager.invoke('archive:backup-saves', gameId)
      toast.success(t('archivePanel.backupDone') + ' - ' + result.mode + ' / ' + result.files)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [gameId, t, refresh])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await ipcManager.invoke('archive:get-status', gameId))
    } catch {
      setStatus(null)
    }
  }, [gameId])

  const refreshPasswords = useCallback(async (): Promise<void> => {
    try {
      setPasswords((await ipcManager.invoke('archive:get-passwords')) ?? [])
    } catch {
      setPasswords([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshPasswords()
  }, [refresh, refreshPasswords])

  useEffect(() => {
    const offProgress = ipcManager.on('archive:job-progress', (_event, payload) => {
      if (payload.gameId === gameId) {
        setProgress({ jobType: payload.jobType, percent: payload.percent })
      }
    })
    const offState = ipcManager.on('archive:state-changed', (_event, payload) => {
      if (payload.gameId === gameId) void refresh()
    })
    return () => {
      offProgress()
      offState()
    }
  }, [gameId, refresh])

  const run = async (kind: 'extract' | 'compress'): Promise<void> => {
    setBusy(true)
    try {
      if (kind === 'extract') {
        await ipcManager.invoke('archive:extract', gameId)
        toast.success(t('archivePanel.extractDone'))
      } else {
        await ipcManager.invoke('archive:compress', gameId)
        toast.success(t('archivePanel.compressDone'), {
          action: {
            label: t('archivePanel.undoExtract'),
            onClick: () => void run('extract')
          }
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(/password/i.test(message) ? t('archivePanel.needPassword') : message)
    } finally {
      setBusy(false)
      setProgress(null)
      await refresh()
    }
  }

  const addPassword = async (): Promise<void> => {
    const value = newPassword.trim()
    if (!value) return
    await ipcManager.invoke('archive:add-passwords', [value], 'manual')
    setNewPassword('')
    await refreshPasswords()
    toast.success(t('archivePanel.passwordAdded'))
  }

  const removePassword = async (id: string): Promise<void> => {
    await ipcManager.invoke('archive:remove-password', id)
    await refreshPasswords()
  }

  const stateLabel =
    status && status.state ? t('archivePanel.stateValue.' + status.state) : t('archivePanel.stateValue.unknown')

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('archivePanel.status')}</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
              {t('archivePanel.refresh')}
            </Button>
            <Button size="sm" onClick={() => void run('extract')} disabled={busy || !status?.enabled}>
              {t('archivePanel.extract')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => (confirmCompress === false ? void run('compress') : setConfirmOpen(true))}
              disabled={busy || status?.state !== 'extracted'}
            >
              {t('archivePanel.compress')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={status?.state === 'error' ? 'destructive' : 'secondary'}>{stateLabel}</Badge>
            {status?.encrypted ? <Badge variant="outline">{t('archivePanel.encrypted')}</Badge> : null}
            {busy && progress ? (
              <span className="text-muted-foreground">{progress.percent + '%'}</span>
            ) : null}
          </div>
          {busy && progress ? <Progress value={progress.percent} /> : null}
          <Row label={t('archivePanel.format')} value={status?.format || '-'} />
          <Row label={t('archivePanel.archiveSize')} value={formatBytes(status?.archiveBytes ?? 0)} />
          <Row label={t('archivePanel.extractedSize')} value={formatBytes(status?.extractedBytes ?? 0)} />
          <Row label={t('archivePanel.archivePath')} value={status?.archivePath || '-'} mono />
          <Row label={t('archivePanel.extractDir')} value={status?.extractDir || '-'} mono />
          <Row label={t('archivePanel.entrypoint')} value={status?.entrypoint || '-'} mono />
          {status?.lastError ? <Row label={t('archivePanel.lastError')} value={status.lastError} /> : null}
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('archivePanel.saves')}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void backupSaves()}
            disabled={busy || !status?.enabled}
          >
            {t('archivePanel.backupSaves')}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row
            label={t('archivePanel.saveBackupFiles')}
            value={String(status?.saveBackupFiles ?? 0)}
          />
          <Row
            label={t('archivePanel.saveBackupAt')}
            value={status?.saveBackupAt ? status.saveBackupAt.slice(0, 19).replace('T', ' ') : '-'}
          />
          <Row label={t('archivePanel.saveBackupPath')} value={status?.saveBackupPath || '-'} mono />
          <span className="text-muted-foreground">{t('archivePanel.savesHint')}</span>
        </CardContent>
      </Card>

      {status && status.duplicates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('archivePanel.duplicates')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <span className="text-muted-foreground">{t('archivePanel.duplicatesHint')}</span>
            {status.duplicates.map((duplicate) => (
              <div
                key={duplicate.path}
                className="flex flex-col gap-1 rounded-md border p-2"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {duplicate.translation || t('archivePanel.unknownVersion')}
                  </Badge>
                  <Badge variant="outline">
                    {duplicate.version || t('archivePanel.unknownVersion')}
                  </Badge>
                  <span className="text-muted-foreground">{formatBytes(duplicate.sizeBytes)}</span>
                </div>
                <span className="break-all font-mono text-xs">{duplicate.path}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('archivePanel.options')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span>{t('archivePanel.keepArchive')}</span>
          <Switch checked={Boolean(keepArchive)} onCheckedChange={(value) => void setKeepArchive(value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('archivePanel.passwords')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex gap-2">
            <Input
              value={newPassword}
              placeholder={t('archivePanel.passwordPlaceholder')}
              onChange={(event) => setNewPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addPassword()
              }}
            />
            <Button size="sm" onClick={() => void addPassword()}>
              {t('archivePanel.add')}
            </Button>
          </div>
          <Separator />
          {passwords.length === 0 ? (
            <span className="text-muted-foreground">{t('archivePanel.noPasswords')}</span>
          ) : null}
          {passwords.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{entry.value}</span>
              <Button variant="ghost" size="sm" onClick={() => void removePassword(entry.id)}>
                {t('archivePanel.remove')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('archivePanel.confirmCompressTitle')}</DialogTitle>
            <DialogDescription>{t('archivePanel.confirmCompressBody')}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={dontAskAgain}
              onCheckedChange={(value) => setDontAskAgain(Boolean(value))}
            />
            {t('archivePanel.dontAskAgain')}
          </label>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              {t('archivePanel.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (dontAskAgain) void setConfirmCompress(false)
                setConfirmOpen(false)
                void run('compress')
              }}
            >
              {t('archivePanel.confirmCompressAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
