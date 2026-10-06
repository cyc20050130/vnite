import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '~/components/ui/context-menu'
import type { ArchiveBatchOp } from '@appTypes/utils'
import { useArchiveBatchStore } from '~/stores/archiveBatchStore'
import { cn } from '~/utils'
import { CollectionMenu } from './CollectionMenu'
import { InformationDialog } from './InformationDialog'
import { DeleteGameAlert } from './DeleteGameAlert'
import { useState, useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { useGameBatchEditorStore } from '../store'
import { useTranslation } from 'react-i18next'
import { useGameMetadataUpdaterStore } from '~/pages/GameMetadataUpdater'

export function BatchGameNavCM({
  openAddCollectionDialog
}: {
  openAddCollectionDialog: () => void
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [isInformationDialogOpen, setIsInformationDialogOpen] = useState(false)
  const { clearGameIds, selectedGamesMap } = useGameBatchEditorStore()
  const {
    setGameIds: setGameMetadataUpdaterGameIds,
    setIsOpen: setIsGameMetadataUpdaterDialogOpen
  } = useGameMetadataUpdaterStore()
  const gameIds = Object.keys(selectedGamesMap)
  const location = useLocation()
  const startBatch = useArchiveBatchStore((state) => state.start)
  const onBatch = (op: ArchiveBatchOp): void => {
    void startBatch(op, gameIds)
  }

  useEffect(() => {
    // clear batchEditor gameList when switching to a non-game-detail page and not in batchMode
    if (!location.pathname.includes(`/library/games/`) && gameIds.length < 2) {
      clearGameIds()
    }
  }, [location.pathname])

  return (
    <ContextMenuContent className={cn('w-[180px]')}>
      {/* Collection Menu */}
      <CollectionMenu gameIds={gameIds} openAddCollectionDialog={openAddCollectionDialog} />
      <ContextMenuSeparator />
      {/* Information Dialog */}
      <InformationDialog
        gameIds={gameIds}
        isOpen={isInformationDialogOpen}
        setIsOpen={setIsInformationDialogOpen}
      >
        <ContextMenuItem
          onClick={(e) => {
            e.preventDefault()
            setIsInformationDialogOpen(true)
          }}
        >
          <div>{t('batchEditor.contextMenu.editInfo')}</div>
        </ContextMenuItem>
      </InformationDialog>
      {/* Game Metadata Updater */}
      <ContextMenuItem
        onClick={() => {
          setIsGameMetadataUpdaterDialogOpen(true)
          setGameMetadataUpdaterGameIds(gameIds)
        }}
      >
        <div>{t('batchEditor.contextMenu.updateMetadata')}</div>
      </ContextMenuItem>
      {/* Archive batch operations */}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <div>{t('batchEditor.contextMenu.archive.title')}</div>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={cn('w-[200px]')}>
          <ContextMenuItem onClick={() => onBatch('extract')}>
            <div>{t('batchEditor.contextMenu.archive.extract')}</div>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onBatch('compress')}>
            <div>{t('batchEditor.contextMenu.archive.compress')}</div>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onBatch('backup-saves')}>
            <div>{t('batchEditor.contextMenu.archive.backupSaves')}</div>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onBatch('check-version')}>
            <div>{t('batchEditor.contextMenu.archive.checkVersion')}</div>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      {/* Delete Game Alert */}
      <DeleteGameAlert gameIds={gameIds}>
        <ContextMenuItem onSelect={(e) => e.preventDefault()}>
          <div>{t('batchEditor.contextMenu.delete')}</div>
        </ContextMenuItem>
      </DeleteGameAlert>
    </ContextMenuContent>
  )
}
