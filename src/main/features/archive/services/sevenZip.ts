import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface SevenZipRunOptions {
  password?: string
  timeoutMs?: number
  cwd?: string
  onProgress?: (percent: number) => void
}

export interface SevenZipRunResult {
  code: number | null
  stdout: string
  stderr: string
  bin: string
}

const NAMES = ['7z.exe', '7za.exe', '7zz.exe', '7z', '7za', '7zz']

/** Locate the 7-Zip CLI. Windows-only for now (project decision: Windows target). */
export function resolve7zPath(): string | null {
  const envPath = process.env.VNITE_7Z_PATH
  if (envPath && fs.existsSync(envPath)) return envPath

  const roots: string[] = []
  const rp = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (rp) {
    // Packaged app: resources/** is unpacked next to app.asar.
    roots.push(path.join(rp, 'app.asar.unpacked', 'resources', '7z'))
    roots.push(path.join(rp, 'resources', '7z'))
    roots.push(rp)
  }
  roots.push(path.join(process.cwd(), 'resources', '7z'))
  roots.push(path.join(process.cwd(), 'resources'))
  try {
    roots.push(path.join(__dirname, '..', '..', '..', '..', 'resources', '7z'))
  } catch {
    // __dirname may be unavailable in some bundlers; ignore
  }

  for (const root of roots) {
    for (const name of NAMES) {
      const p = path.join(root, name)
      if (fs.existsSync(p)) return p
    }
  }

  const rel = ['7zip-bin/win/x64/7za.exe', '7zip-bin/win/x64/7zz.exe', '7zip-bin/win/ia32/7za.exe']
  const bases = [process.cwd(), path.join(process.cwd(), '..', '..')]
  for (const base of bases) {
    for (const r of rel) {
      const p = path.join(base, 'node_modules', r)
      if (fs.existsSync(p)) return p
    }
  }

  for (const name of ['7z', '7za', '7zz']) {
    try {
      const found = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true })
      if (found.status === 0) {
        const first = (found.stdout || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)[0]
        if (first && fs.existsSync(first)) return first
      }
    } catch {
      // ignore
    }
  }

  return null
}

/** Run the 7-Zip CLI. The password (if any) is appended as -pPASSWORD and never logged. */
export async function run7z(
  args: string[],
  options: SevenZipRunOptions = {}
): Promise<SevenZipRunResult> {
  const bin = resolve7zPath()
  if (!bin) {
    throw new Error('7-Zip CLI not found. Install "7zip-bin" or set VNITE_7Z_PATH.')
  }

  const fullArgs = args.slice()
  if (options.password) fullArgs.push('-p' + options.password)

  return await new Promise<SevenZipRunResult>((resolve, reject) => {
    const child = spawn(bin, fullArgs, { windowsHide: true, cwd: options.cwd })
    let stdout = ''
    let stderr = ''
    let buffer = ''
    const timer = options.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill()
          } catch {
            // ignore
          }
        }, options.timeoutMs)
      : null

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      if (options.onProgress) {
        buffer += text
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const m = line.match(/(\d{1,3})%/)
          if (m) options.onProgress(Number(m[1]))
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, bin })
    })
  })
}

/** Extract an archive into targetDir (targetDir is created by 7-Zip). */
export async function extractArchive(
  archivePath: string,
  targetDir: string,
  options: SevenZipRunOptions = {}
): Promise<SevenZipRunResult> {
  return run7z(['x', '-y', '-bsp1', '-o' + targetDir, '--', archivePath], options)
}

/** Create an archive from a folder; cwd is the folder's parent so paths stay relative. */
export async function compressFolder(
  sourceParentDir: string,
  folderName: string,
  targetArchive: string,
  options: SevenZipRunOptions & { format?: '7z' | 'zip'; level?: number } = {}
): Promise<SevenZipRunResult> {
  const format = options.format ?? '7z'
  const level = options.level ?? 9
  return run7z(
    ['a', '-t' + format, '-mx=' + level, '-y', '-bsp1', '--', targetArchive, folderName],
    { ...options, cwd: options.cwd ?? sourceParentDir }
  )
}

/** Verify archive integrity (and password if provided). */
export async function testArchive(
  archivePath: string,
  options: SevenZipRunOptions = {}
): Promise<SevenZipRunResult> {
  return run7z(['t', '-bsp1', '--', archivePath], options)
}

/** True when the resolved binary is the full 7-Zip (has the RAR codec), not standalone 7za. */
export function hasFull7z(): boolean {
  const bin = resolve7zPath()
  return Boolean(bin && /(^|[\\/])7z\.exe$/i.test(bin))
}

export function isPasswordError(text: string): boolean {
  return /enter password|invalid password|wrong password|cannot open encrypted archive|password is required/i.test(
    text
  )
}
