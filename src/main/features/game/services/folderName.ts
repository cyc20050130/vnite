/**
 * Windows-safe folder name derived from a display name.
 *
 * Lives in its own module because both the game rename service and the archive layout
 * service need it, and the two would otherwise import each other.
 */
export function sanitizeFolderName(name: string): string {
  const cleaned = (name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 120) : ''
}

/** Strip a (possibly multi-part) archive extension from a file name. */
export function stripArchiveExtension(name: string): string {
  return (name || '').replace(/\.(7z|zip|zipx|rar|tar|gz|tgz|xz|zst|bz2)(\.\d{3})?$/i, '')
}
