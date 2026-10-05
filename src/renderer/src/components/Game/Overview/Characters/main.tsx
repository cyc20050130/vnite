import { Badge } from '@ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@ui/dialog'
import { SeparatorDashed } from '@ui/separator-dashed'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameState } from '~/hooks'
import { cn } from '~/utils'

type CharacterEntry = {
  id: string
  source: string
  sourceId: string
  name: string
  originalName?: string
  imageUrl?: string
  imageCached?: boolean
  description?: string
  traits?: { name: string; group?: string; spoiler?: number }[]
  sex?: string
  actors?: string[]
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function Characters({
  gameId,
  className = ''
}: {
  gameId: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [characters] = useGameState(gameId, 'metadata.characters')
  const [selected, setSelected] = useState<CharacterEntry | null>(null)

  const groupedTraits = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const trait of selected?.traits ?? []) {
      const group = trait.group || t('characters.otherTraits')
      const list = map.get(group) ?? []
      list.push(trait.name)
      map.set(group, list)
    }
    return Array.from(map.entries())
  }, [selected, t])

  if (!characters || characters.length === 0) return <></>

  const imageOf = (character: CharacterEntry): string | undefined => {
    if (character.imageCached) {
      return 'attachment://game/' + gameId + '/images/characters/' + character.sourceId + '.webp?t=0'
    }
    return character.imageUrl
  }

  return (
    <div className={cn(className)}>
      <div className={cn('font-bold select-none')}>{t('characters.title')}</div>
      <SeparatorDashed />
      <div className={cn('mt-2 flex flex-wrap gap-3')}>
        {characters.map((character) => (
          <button
            key={character.id}
            type="button"
            className={cn('flex w-[72px] flex-col items-center gap-1 text-center')}
            onClick={() => setSelected(character as CharacterEntry)}
          >
            {imageOf(character as CharacterEntry) ? (
              <img
                src={imageOf(character as CharacterEntry)}
                alt={character.name}
                className={cn('h-16 w-16 rounded-full object-cover')}
                loading="lazy"
              />
            ) : (
              <div
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-secondary-foreground'
                )}
              >
                {character.name.slice(0, 1)}
              </div>
            )}
            <span className={cn('w-full truncate text-xs')}>{character.name}</span>
          </button>
        ))}
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="w-[60vw] max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.name}
              {selected?.originalName && selected.originalName !== selected.name
                ? ' / ' + selected.originalName
                : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-4">
            {selected && imageOf(selected) ? (
              <img
                src={imageOf(selected)}
                alt={selected.name}
                className="h-48 w-48 shrink-0 rounded object-cover"
              />
            ) : null}
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              {selected?.actors && selected.actors.length > 0 ? (
                <div>
                  <span className="text-muted-foreground">{t('characters.voice')}: </span>
                  {selected.actors.join(', ')}
                </div>
              ) : null}
              {selected?.sex ? (
                <div>
                  <span className="text-muted-foreground">{t('characters.sex')}: </span>
                  {selected.sex}
                </div>
              ) : null}
              {selected?.description ? (
                <p className="whitespace-pre-wrap">{stripHtml(selected.description)}</p>
              ) : null}
            </div>
          </div>
          {groupedTraits.length > 0 ? (
            <div className="flex flex-col gap-1 text-sm">
              <div className="font-bold">{t('characters.traits')}</div>
              {groupedTraits.map(([group, names]) => (
                <div key={group} className="flex items-start gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">{group}</span>
                  <div className="flex flex-wrap gap-1">
                    {names.map((name) => (
                      <Badge key={name} variant="secondary">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
