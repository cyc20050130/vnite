import type { ArchiveErrorCode } from '@appTypes/utils'

const RULES: { re: RegExp; code: ArchiveErrorCode }[] = [
  { re: /password is incorrect|wrong password|can not open encrypted|CRC failed in encrypted/i, code: 'PASSWORD_WRONG' },
  { re: /password required|encrypted/i, code: 'PASSWORD_REQUIRED' },
  { re: /not enough space|disk full|insufficient disk|there is not enough space/i, code: 'DISK_FULL' },
  { re: /unexpected end of archive|cannot open the file as archive|data error|headers error|crc failed|is not archive|archive is corrupted/i, code: 'CORRUPT_ARCHIVE' },
  { re: /being used by another process|ebusy|resource busy|file is locked/i, code: 'FILE_IN_USE' },
  { re: /access is denied|eperm|permission denied/i, code: 'PERMISSION_DENIED' },
  { re: /cannot find archive|no such file|enoent/i, code: 'ARCHIVE_NOT_FOUND' },
  { re: /7-zip cli not found/i, code: 'SEVEN_ZIP_MISSING' },
  { re: /no executable found inside the archive/i, code: 'NO_EXECUTABLE' },
  { re: /^archive_missing$|archive file not found/i, code: 'ARCHIVE_MISSING' },
  { re: /^game_extracted$/, code: 'GAME_EXTRACTED' },
  { re: /^not_archive_backed$/, code: 'NOT_ARCHIVE_BACKED' }
]

/** Turn a thrown error or CLI output into a stable code (falls back to the raw text). */
export function classifyArchiveError(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? '')
  for (const rule of RULES) {
    if (rule.re.test(raw)) return rule.code
  }
  return raw.slice(0, 300)
}

/** True when the value looks like one of the stable codes. */
export function isArchiveErrorCode(value: string): value is ArchiveErrorCode {
  return /^[A-Z_]+$/.test(value) && value.length > 3
}
