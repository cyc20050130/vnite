import { Badge } from '@ui/badge'
import { Button } from '@ui/button'
import { SeparatorDashed } from '@ui/separator-dashed'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { useGameState } from '~/hooks'
import { cn } from '~/utils'

function parseVersion(value?: string): number[] | null {
  if (!value) return null
  const cleaned = value.trim().replace(/^v/i, '')
  if (!/^\d/.test(cleaned)) return null
  const parts = cleaned
    .split(/[.\-+_\s]/)
    .map((segment) => parseInt(segment, 10))
    .filter((n) => !Number.isNaN(n))
  return parts.length > 0 ? parts : null
}

function compareVersions(local?: string, remote?: string): number | null {
  const a = parseVersion(local)
  const b = parseVersion(remote)
  if (!a || !b) return null
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function Version({
  gameId,
  className = ''
}: {
  gameId: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [localVersion] = useGameState(gameId, 'metadata.version')
  const [dataSource] = useGameState(gameId, 'metadata.dataSource')
  const [dataSourceId] = useGameState(gameId, 'metadata.dataSourceId')
  const [latest, setLatest] = useGameState(gameId, 'record.latestVersionInfo')
  const [busy, setBusy] = useState(false)

  const check = async (): Promise<void> => {
    if (!dataSource || !dataSourceId) {
      toast.error(t('version.noSource'))
      return
    }
    setBusy(true)
    try {
      const info = await ipcManager.invoke('scraper:get-game-version', dataSource, {
        type: 'id',
        value: dataSourceId
      })
      if (!info) {
        toast.error(t('version.noResult'))
        return
      }
      await setLatest({ ...info, checkedAt: new Date().toISOString() })
      toast.success(t('version.checked'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const cmp = latest ? compareVersions(localVersion, latest.version) : null
  const statusLabel = !latest
    ? t('version.status.unknown')
    : cmp === -1
      ? t('version.status.outdated')
      : cmp === 0 || cmp === 1
        ? t('version.status.latest')
        : t('version.status.partial')

  return (
    <div className={cn(className)}>
      <div className={cn('flex flex-row items-center justify-between')}>
        <div className={cn('font-bold select-none')}>{t('version.title')}</div>
        <div className="flex items-center gap-2">
          <Badge variant={cmp === -1 ? 'destructive' : 'secondary'}>{statusLabel}</Badge>
          <Button size="sm" variant="outline" onClick={() => void check()} disabled={busy}>
            {t('version.check')}
          </Button>
        </div>
      </div>
      <SeparatorDashed />
      <div className={cn('mt-1 flex flex-col gap-1 text-sm')}>
        <div className="flex gap-2">
          <span className="w-20 shrink-0 text-muted-foreground">{t('version.local')}</span>
          <span>{localVersion || t('version.unknown')}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-20 shrink-0 text-muted-foreground">{t('version.latest')}</span>
          <span>{latest?.version || latest?.buildId || t('version.unknown')}</span>
        </div>
        {latest?.source ? (
          <div className="flex gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">{t('version.source')}</span>
            <span>{latest.source + ' (' + latest.confidence + ')'}</span>
          </div>
        ) : null}
        {latest?.checkedAt ? (
          <div className="flex gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">{t('version.checkedAt')}</span>
            <span>{latest.checkedAt.slice(0, 19).replace('T', ' ')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
