import { ARCHIVE_ERROR_CODES, type ArchiveErrorCode } from '@appTypes/utils'

/** True when a backend message is one of the stable archive error codes. */
export function isArchiveErrorCode(value: string): value is ArchiveErrorCode {
  return (ARCHIVE_ERROR_CODES as readonly string[]).includes(value)
}

/** Readable message for a backend value, falling back to the raw text. */
export function archiveErrorMessage(value: string, t: (key: string) => string): string {
  return isArchiveErrorCode(value) ? t('archivePanel.errors.' + value) : value
}
