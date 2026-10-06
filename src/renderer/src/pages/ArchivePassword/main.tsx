import { Button } from '@ui/button'
import { Textarea } from '@ui/textarea'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { useArchivePasswordStore } from '~/stores/archivePasswordStore'
import { cn } from '~/utils'

function baseName(value: string): string {
  const segments = (value || '').split(/[\\/]/)
  return segments[segments.length - 1] || value
}

/**
 * Non-modal password queue pinned to the bottom-right corner. It never blocks the
 * rest of the UI and can be collapsed into a small pill.
 */
export function ArchivePasswordDialog(): React.JSX.Element | null {
  const { t } = useTranslation('game')
  const { pending, collapsed, setCollapsed, dismiss, setError, resolve, subscribe } =
    useArchivePasswordStore()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribe(), [subscribe])

  if (pending.length === 0) return null

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
      const snapshot = useArchivePasswordStore.getState().pending
      const results = await Promise.allSettled(
        snapshot.map((entry) => ipcManager.invoke('archive:retry-password', entry.gameId))
      )
      results.forEach((result, index) => {
        const gameId = snapshot[index].gameId
        if (result.status === 'fulfilled') resolve(gameId)
        else
          setError(
            gameId,
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          )
      })
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed === 0) toast.success(t('archivePassword.done'))
      else toast.error(t('archivePassword.partial', { count: failed }))
      setInput('')
      toast.success(t('archivePassword.saved'), { id: 'archive-password' })
    } finally {
      setBusy(false)
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className={cn(
          'fixed bottom-4 right-4 z-[900] flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-sm shadow-lg'
        )}
      >
        <span className={cn('icon-[mdi--lock-question] h-4 w-4')} />
        {t('archivePassword.collapsed', { count: pending.length })}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[900] flex w-[380px] flex-col gap-3 rounded-lg border bg-background/95 p-3 shadow-xl backdrop-blur'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {t('archivePassword.title')}
          <span className="ml-2 text-muted-foreground">({pending.length})</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)}>
          {t('archivePassword.collapse')}
        </Button>
      </div>

      <div className="flex max-h-[30vh] flex-col gap-1 overflow-auto scrollbar-base-thin">
        {pending.map((entry) => (
          <div key={entry.gameId} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{baseName(entry.archivePath)}</span>
              {entry.error ? (
                <span className="truncate text-destructive">{entry.error}</span>
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
        rows={2}
        placeholder={t('archivePassword.placeholder')}
        onChange={(event) => setInput(event.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('archivePassword.hint')}</span>
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {t('archivePassword.submit')}
        </Button>
      </div>
    </div>
  )
}
