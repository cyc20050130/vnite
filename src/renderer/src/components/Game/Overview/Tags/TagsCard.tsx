import { SeparatorDashed } from '@ui/separator-dashed'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameState } from '~/hooks'
import { cn, copyWithToast } from '~/utils'
import { FilterAdder } from '../../FilterAdder'
import { SearchTagsDialog } from './SearchTagsDialog'
import { TagsDialog } from './TagsDialog'

export function TagsCard({
  gameId,
  className = ''
}: {
  gameId: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [tags, setTags] = useGameState(gameId, 'metadata.tags')
  const [playTags] = useGameState(gameId, 'metadata.playTags')
  const [originalName] = useGameState(gameId, 'metadata.originalName')
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  const handleSelectTags = (newTags: string[]): void => {
    setTags(newTags)
  }

  const groupedPlayTags = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const tag of playTags ?? []) {
      const list = map.get(tag.category) ?? []
      list.push(tag.name)
      map.set(tag.category, list)
    }
    return Array.from(map.entries())
  }, [playTags])

  return (
    <div className={cn(className, 'group')}>
      <div className={cn('flex flex-row justify-between items-center')}>
        <div
          className={cn('font-bold select-none cursor-pointer')}
          onClick={() => copyWithToast(`${tags.join(', ')}`)}
        >
          {t('detail.overview.sections.tags')}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'invisible group-hover:visible hover:text-primary cursor-pointer icon-[mdi--magnify] w-5 h-5'
            )}
            onClick={() => setIsSearchDialogOpen(true)}
          ></span>
          <span
            className={cn(
              'invisible group-hover:visible hover:text-primary cursor-pointer icon-[mdi--square-edit-outline] w-5 h-5'
            )}
            onClick={() => setIsEditDialogOpen(true)}
          ></span>
        </div>
      </div>
      <SeparatorDashed />
      <div className={cn('text-sm justify-start items-start')}>
        <div className={cn('flex flex-wrap gap-x-1 gap-y-[6px]')}>
          {tags.join(', ') === ''
            ? t('detail.overview.tags.empty')
            : tags.map((tag) => (
                <React.Fragment key={tag}>
                  <FilterAdder field="metadata.tags" value={tag} className={cn('')} />
                </React.Fragment>
              ))}
        </div>
      </div>

      {groupedPlayTags.length > 0 && (
        <div className={cn('mt-3 flex flex-col gap-1')}>
          <div className={cn('font-bold select-none')}>{t('playTags.title')}</div>
          <SeparatorDashed />
          {groupedPlayTags.map(([category, names]) => (
            <div key={category} className="flex gap-2 text-sm">
              <span className={cn('w-20 shrink-0 text-muted-foreground')}>
                {t('playTags.category.' + category)}
              </span>
              <div className="flex flex-wrap gap-x-1 gap-y-[6px]">
                {names.map((name) => (
                  <span
                    key={name}
                    className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TagsDialog gameId={gameId} isOpen={isEditDialogOpen} setIsOpen={setIsEditDialogOpen} />

      <SearchTagsDialog
        isOpen={isSearchDialogOpen}
        onClose={() => setIsSearchDialogOpen(false)}
        gameTitle={originalName}
        onSelect={handleSelectTags}
        initialTags={tags}
      />
    </div>
  )
}
