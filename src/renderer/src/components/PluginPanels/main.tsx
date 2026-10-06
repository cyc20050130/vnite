import { Button } from '@ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/card'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcManager } from '~/app/ipc'
import { cn } from '~/utils'

interface PanelContribution {
  id: string
  pluginId: string
  title: string
  kind: 'card' | 'section'
}

interface LoadedPanel extends PanelContribution {
  rows: { label: string; value: string }[]
  error?: string
}

/**
 * Read-only panels contributed by plugins: cards on the game overview page and sections
 * on the settings page. A plugin only returns label/value rows, so nothing here can
 * execute arbitrary UI code.
 */
export function PluginPanels({
  kind,
  className = ''
}: {
  kind: 'card' | 'section'
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation(kind === 'card' ? 'game' : 'config')
  const [panels, setPanels] = useState<LoadedPanel[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await ipcManager.invoke('plugin:list-panels', kind)
      if (!list || list.length === 0) {
        setPanels([])
        return
      }
      const loaded = await Promise.all(
        list.map(async (panel) => {
          try {
            const rows = await ipcManager.invoke('plugin:load-panel', panel.id)
            return { ...panel, rows: rows ?? [] }
          } catch (error) {
            return {
              ...panel,
              rows: [],
              error: error instanceof Error ? error.message : String(error)
            }
          }
        })
      )
      setPanels(loaded)
    } catch {
      setPanels([])
    }
  }, [kind])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (panels.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {panels.map((panel) => (
        <Card key={panel.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{panel.title}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              {t(kind === 'card' ? 'pluginCards.refresh' : 'pluginSections.refresh')}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {panel.error ? (
              <span className="text-destructive">{panel.error}</span>
            ) : panel.rows.length === 0 ? (
              <span className="text-muted-foreground">
                {t(kind === 'card' ? 'pluginCards.empty' : 'pluginSections.empty')}
              </span>
            ) : (
              panel.rows.map((row) => (
                <div key={row.label} className="flex gap-3">
                  <span className="w-28 shrink-0 text-muted-foreground">{row.label}</span>
                  <span className="break-all">{row.value}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
