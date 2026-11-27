/**
 * dsh-research-record — append locking shared by the journal and provenance.
 *
 * Both stores are append-only JSONL, and now two writers exist per store: the
 * model (the `notebook` tool) and the provenance hook (auto notes). `appendFile`
 * appends at EOF atomically only for a single small write; a journal line with a
 * long `body` can exceed the filesystem's atomic window and interleave with a
 * concurrent writer, which silently breaks the hash chain.
 *
 * The lock is a directory: `mkdir` is atomic across processes. The holder's token
 * is written inside it, and only that token may release the lock, so a slow
 * process can never delete the lock of the writer that took over. A lock older
 * than `staleMs` is treated as abandoned (a crashed process must not wedge the
 * journal) and removed.
 *
 * When the lock cannot be acquired within the retry budget we THROW. Writing
 * anyway was the 0.8.1 behaviour, and it is worse than losing one record: the
 * unlocked writer reads a stale `prevHash` and breaks the chain for every reader
 * afterwards. A caller that must not fail (telemetry, auto notes) decides for
 * itself whether to swallow the error.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The lock is held by another writer for longer than the retry budget. */
export class LockTimeoutError extends Error {
  constructor(lockPath, waitedMs) {
    super(
      `could not acquire ${lockPath} within ${Math.round(waitedMs / 1000)} s — another writer holds it. ` +
        'Remove that directory if no process is alive.',
    )
    this.name = 'LockTimeoutError'
    this.code = 'LOCK_TIMEOUT'
    this.lockPath = lockPath
  }
}

async function takeOwnership(lockPath, token) {
  await writeFile(join(lockPath, 'owner'), token, 'utf8')
}

async function tryAcquire(lockPath, staleMs, token) {
  try {
    await mkdir(lockPath, { recursive: false })
    await takeOwnership(lockPath, token)
    return true
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      // The directory exists but we could not write into it, or mkdir failed for
      // another reason: do not leave a half-made lock behind.
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      if (error?.code === undefined) throw error
    }
  }
  // Someone holds it. Only break it when it is demonstrably abandoned.
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs > staleMs) {
      await rm(lockPath, { recursive: true, force: true })
      await mkdir(lockPath, { recursive: false })
      await takeOwnership(lockPath, token)
      return true
    }
  } catch {
    /* the holder released between EEXIST and stat — retry normally */
  }
  return false
}

/**
 * Run `body` while holding `<target>.lock`. Always releases, and only its own lock.
 * Throws `LockTimeoutError` when the lock stays taken for the whole budget.
 * @param {string} target - file being appended to; the lock path is derived.
 */
export async function withAppendLock(target, body, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 6000
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 10
  const staleMs = Number.isFinite(options.staleMs) ? options.staleMs : 10_000
  const lockPath = `${target}.lock`
  const token = randomBytes(8).toString('hex')
  const startedAt = Date.now()
  const budget = retries * waitMs

  let held = false
  while (!held && Date.now() - startedAt < budget) {
    held = await tryAcquire(lockPath, staleMs, token)
    if (!held) await sleep(waitMs)
  }
  if (!held) throw new LockTimeoutError(lockPath, Date.now() - startedAt)

  try {
    return await body()
  } finally {
    try {
      const owner = (await readFile(join(lockPath, 'owner'), 'utf8')).trim()
      if (owner === token) await rm(lockPath, { recursive: true, force: true })
    } catch {
      /* released by the stale-lock breaker, or already gone */
    }
  }
}

/** Append one JSONL line under the lock that belongs to `file`. */
export async function appendLine(file, line) {
  const { appendFile } = await import('node:fs/promises')
  return withAppendLock(file, () => appendFile(file, line, 'utf8'))
}
