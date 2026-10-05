import { Button } from '@ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { Textarea } from '@ui/textarea'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'

interface PendingArchive {
  gameId: string
  archivePath: string
  parts: string[]
  tried: number
  headerEncrypted: boolean
  error?: string
}

function baseName(value: string): string {
  const segments = (value || '').split(/[\\/]/)
  return segments[segments.length - 1] || value
}

export function ArchivePasswordDialog(): React.JSX.Element {
  const { t } = useTranslation('game')
  const [pending, setPending] = useState<PendingArchive[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const offRequired = ipcManager.on('archive:password-required', (_event, payload) => {
      setPending((prev) =>
        prev.some((entry) => entry.gameId === payload.gameId) ? prev : [...prev, { ...payload }]
      )
    })
    const offState = ipcManager.on('archive:state-changed', (_event, payload) => {
      if (payload.to === 'extracted') {
        setPending((prev) => prev.filter((entry) => entry.gameId !== payload.gameId))
      }
    })
    return () => {
      offRequired()
      offState()
    }
  }, [])

  const dismiss = (gameId: string): void => {
    setPending((prev) => prev.filter((entry) => entry.gameId !== gameId))
  }

  const submit = async (): Promise<void> => {
    const values = input
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (values.length === 0) {
      toast.error(t('archivePassword.empty'))
      return
    }
    setBusy(true)
    try {
      await ipcManager.invoke('archive:add-passwords', values, 'manual')
      const snapshot = pending
      const results = await Promise.allSettled(
        snapshot.map(async (entry) => {
          await ipcManager.invoke('archive:retry-password', entry.gameId)
          return entry.gameId
        })
      )
      const succeeded = new Set<string>()
      const failed = new Map<string, string>()
      results.forEach((result, index) => {
        const gameId = snapshot[index].gameId
        if (result.status === 'fulfilled') succeeded.add(gameId)
        else failed.set(gameId, result.reason instanceof Error ? result.reason.message : String(result.reason))
      })
      setPending((prev) =>
        prev
          .filter((entry) => !succeeded.has(entry.gameId))
          .map((entry) => ({ ...entry, error: failed.get(entry.gameId) ?? entry.error }))
      )
      if (succeeded.size > 0) toast.success(t('archivePassword.retried', { count: succeeded.size }))
      if (failed.size > 0) toast.error(t('archivePassword.stillFailing', { count: failed.size }))
      setInput('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={pending.length > 0}
      onOpenChange={(open) => {
        if (!open) setPending([])
      }}
    >
      <DialogContent className="w-[60vw]">
        <DialogHeader>
          <DialogTitle>{t('archivePassword.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t('archivePassword.hint')}</p>
          <div className="flex max-h-[25vh] flex-col gap-1 overflow-auto">
            {pending.map((entry) => (
              <div
                key={entry.gameId}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{baseName(entry.archivePath)}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.headerEncrypted
                      ? t('archivePassword.headerEncrypted')
                      : t('archivePassword.dataEncrypted')}
                    {' · '}
                    {t('archivePassword.tried', { count: entry.tried })}
                  </span>
                  {entry.error ? (
                    <span className="truncate text-xs text-destructive">{entry.error}</span>
                  ) : null}
                </div>
                <Button variant="ghost" size="sm" onClick={() => dismiss(entry.gameId)}>
                  {t('archivePassword.ignore')}
                </Button>
              </div>
            ))}
          </div>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('archivePassword.placeholder')}
            className="min-h-[120px]"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPending([])}>
            {t('archivePassword.close')}
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {t('archivePassword.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
