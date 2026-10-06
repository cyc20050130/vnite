/**
 * Tiny progress fan-out so long archive operations can be observed by whoever
 * started them (batch runner, task center) without creating an import cycle.
 */
export type ArchiveProgressListener = (gameId: string, percent: number) => void

const listeners = new Set<ArchiveProgressListener>()

export function onArchiveProgress(listener: ArchiveProgressListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitArchiveProgress(gameId: string, percent: number): void {
  if (!gameId || !Number.isFinite(percent)) return
  for (const listener of listeners) {
    try {
      listener(gameId, percent)
    } catch {
      // listeners must never break the operation they observe
    }
  }
}
