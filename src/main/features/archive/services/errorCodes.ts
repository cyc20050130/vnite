import type { ArchiveErrorCode } from '@appTypes/utils'

/**
 * 7-Zip and the OS emit localized messages, so both English and Chinese patterns are
 * matched here before falling back to the raw text.
 */
const RULES: { re: RegExp; code: ArchiveErrorCode }[] = [
  {
    re: /password is incorrect|wrong password|can not open encrypted|密码错误|输入密码|请输入密码|口令/i,
    code: 'PASSWORD_WRONG'
  },
  { re: /password required|encrypted|需要密码|加密/i, code: 'PASSWORD_REQUIRED' },
  {
    re: /not enough space|disk full|insufficient disk|磁盘空间不足|空间不足/i,
    code: 'DISK_FULL'
  },
  { re: /^incomplete_download$/, code: 'INCOMPLETE_DOWNLOAD' },
  {
    re: /unexpected end of archive|unexpected end of data|cannot find volume|missing volume|premature end|意外的压缩文件结尾|压缩文件意外结束|数据错误|缺少分卷|分卷缺失|不完整/i,
    code: 'INCOMPLETE_DOWNLOAD'
  },
  { re: /^file_in_use$/, code: 'FILE_IN_USE' },
  {
    re: /being used by another process|resource busy|file is locked|另一个程序正在使用|正在使用此文件|进程无法访问|共享冲突|ebusy/i,
    code: 'FILE_IN_USE'
  },
  { re: /^permission_denied$/, code: 'PERMISSION_DENIED' },
  { re: /access is denied|eperm|permission denied|拒绝访问|权限不足/i, code: 'PERMISSION_DENIED' },
  { re: /^archive_not_found$/, code: 'ARCHIVE_NOT_FOUND' },
  {
    re: /cannot find archive|no such file|enoent|系统找不到指定的文件|找不到指定的文件|不存在/i,
    code: 'ARCHIVE_NOT_FOUND'
  },
  { re: /7-zip cli not found|未找到 7-zip/i, code: 'SEVEN_ZIP_MISSING' },
  { re: /no executable found inside the archive/i, code: 'NO_EXECUTABLE' },
  { re: /^archive_missing$|archive file not found/i, code: 'ARCHIVE_MISSING' },
  { re: /^game_extracted$/, code: 'GAME_EXTRACTED' },
  { re: /^not_archive_backed$/, code: 'NOT_ARCHIVE_BACKED' },
  { re: /^no_external_tool$/, code: 'NO_EXTERNAL_TOOL' },
  {
    re: /can ?not open the file as|data error|headers error|crc failed|is not archive|archive is corrupted|无法作为压缩文件打开|不是压缩文件|校验和错误|损坏/i,
    code: 'CORRUPT_ARCHIVE'
  }
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
