/**
 * dsh-research-record — append locking shared by the journal and provenance.
 *
 * Both stores are append-only JSONL, and now two writers exist per store: the
 * model (the `notebook` tool) and the provenance hook (auto notes). `appendFile`
 * appends at EOF atomically only for a single small write; a journal line with a
 * long `body` can exceed the filesystem's atomic window and interleave with a
 * concurrent writer, which silently breaks the hash chain.
 *
 * The lock is a directory: `mkdir` is atomic across processes and its removal is
 * the release. A lock older than `staleMs` is treated as abandoned (a crashed
 * process must not wedge the journal) and removed. If acquisition still fails
 * after `retries`, we proceed anyway: losing a lock for one second is better
 * than dropping a research record, and the guard chain re-verifies afterwards.
 */

import { appendFile, mkdir, rm, stat } from 'node:fs/promises'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function tryAcquire(lockPath, staleMs) {
  try {
    await mkdir(lockPath, { recursive: false })
    return true
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  // Someone holds it. Only break it when it is demonstrably abandoned.
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs > staleMs) {
      await rm(lockPath, { recursive: true, force: true })
      await mkdir(lockPath, { recursive: false })
      return true
    }
  } catch {
    /* the holder released between EEXIST and stat — retry normally */
  }
  return false
}

/**
 * Run `body` while holding `<target>.lock`. Always releases.
 * @param {string} target - file being appended to; the lock path is derived.
 */
export async function withAppendLock(target, body, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 200
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 10
  const staleMs = Number.isFinite(options.staleMs) ? options.staleMs : 10_000
  const lockPath = `${target}.lock`

  let held = false
  for (let attempt = 0; attempt < retries && !held; attempt += 1) {
    held = await tryAcquire(lockPath, staleMs)
    if (!held) await sleep(waitMs)
  }

  try {
    return await body()
  } finally {
    if (held) await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Append one JSONL line under the lock that belongs to `file`. */
export async function appendLine(file, line) {
  return withAppendLock(file, () => appendFile(file, line, 'utf8'))
}
