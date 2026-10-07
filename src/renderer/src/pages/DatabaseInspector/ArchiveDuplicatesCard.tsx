import { Badge } from '@ui/badge'
import { Button } from '@ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/card'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useArchiveBatchStore } from '~/stores/archiveBatchStore'
import { useGameRegistry } from '~/stores/game/gameRegistry'
import { getGameLocalStore } from '~/stores/game/gameLocalStoreFactory'
import { getGameStore } from '~/stores/game/gameStoreFactory'
import { formatStorageSize } from '~/utils'

/**
 * Duplicate archives, right where the other database findings are.
 * The duplicates themselves are discovered by the scanner; this card is the place to see
 * them and to throw the worse copies away (recycle bin, so nothing is lost).
 */
export function ArchiveDuplicatesCard(): React.JSX.Element {
  const { t } = useTranslation('databaseInspector')
  const gameIds = useGameRegistry((state) => state.gameIds)
  const start = useArchiveBatchStore((state) => state.start)
  const [visible, setVisible] = useState(8)

  const groups = useMemo(() => {
    const rows: {
      gameId: string
      name: string
      count: number
      bytes: number
      sample: string
    }[] = []
    for (const gameId of gameIds ?? []) {
      try {
        const duplicates = getGameLocalStore(gameId)?.getState()?.data?.archive?.duplicates ?? []
        if (duplicates.length === 0) continue
        const name = getGameStore(gameId)?.getState()?.data?.metadata?.name ?? gameId
        rows.push({
          gameId,
          name,
          count: duplicates.length,
          bytes: duplicates.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
          sample: duplicates[0]?.path ?? ''
        })
      } catch {
        // a game that is not loaded yet simply has no duplicates to report
      }
    }
    return rows.sort((a, b) => b.bytes - a.bytes)
  }, [gameIds])

  const totalFiles = groups.reduce((sum, group) => sum + group.count, 0)
  const totalBytes = groups.reduce((sum, group) => sum + group.bytes, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>{t('duplicates.title')}</CardTitle>
          <CardDescription>{t('duplicates.description')}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {t('duplicates.summary', { files: totalFiles, size: formatStorageSize(totalBytes) })}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={groups.length === 0}
            onClick={() => void start('resolve-duplicates', groups.map((group) => group.gameId))}
          >
            {t('duplicates.cleanAll')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0 text-sm">
        {groups.length === 0 ? (
          <span className="text-muted-foreground">{t('duplicates.empty')}</span>
        ) : (
          <>
            {groups.slice(0, visible).map((group) => (
              <div key={group.gameId} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{group.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{group.sample}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-muted-foreground">
                    {t('duplicates.count', { count: group.count })} · {formatStorageSize(group.bytes)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void start('resolve-duplicates', [group.gameId])}
                  >
                    {t('duplicates.cleanOne')}
                  </Button>
                </div>
              </div>
            ))}
            {groups.length > visible ? (
              <Button variant="ghost" size="sm" onClick={() => setVisible(groups.length)}>
                {t('duplicates.showMore', { count: groups.length - visible })}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
