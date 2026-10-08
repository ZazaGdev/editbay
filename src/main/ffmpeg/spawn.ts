import { spawn } from 'node:child_process'

/**
 * The only module in this codebase that starts a process.
 *
 * Arguments are always an array and never a shell string, so a file path
 * containing a quote, a space or an ampersand is data rather than syntax.
 * Nothing here interpolates input into a command line.
 */

const STDERR_KEEP = 8000

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'ProcessError'
  }
}

export interface SpawnOptions {
  /** Called with each chunk of stdout, for callers that stream. */
  onStdout?: (chunk: Buffer) => void
  /** Collect stdout into the resolved buffer. Off for large streams handled by onStdout. */
  collectStdout?: boolean
  /** Maximum bytes of stdout to collect. */
  maxStdout?: number
  /** Called with each chunk of stderr, for a program that reports its progress there. */
  onStderr?: (chunk: Buffer) => void
  /** The environment to start it in, when it is not this process's own. */
  env?: NodeJS.ProcessEnv
  /** The folder to start it in, when it is not this process's own. */
  cwd?: string
  signal?: AbortSignal
  /**
   * Stop it after this many milliseconds, for a program that should answer
   * quickly and could otherwise hang on a damaged file or a share that stopped
   * answering, holding up everything queued behind it.
   */
  timeoutMs?: number
}

export interface SpawnResult {
  stdout: Buffer
  stderr: string
}

/** Run a binary to completion. Rejects with a ProcessError carrying the tail of stderr. */
export function capture(binary: string, args: string[], opts: SpawnOptions = {}): Promise<SpawnResult> {
  const collect = opts.collectStdout ?? true
  const maxStdout = opts.maxStdout ?? 64 * 1024 * 1024

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, shell: false, ...(opts.env ? { env: opts.env } : {}), ...(opts.cwd ? { cwd: opts.cwd } : {}) })

    const chunks: Buffer[] = []
    let collected = 0
    let stderr = ''
    let overflowed = false
    let timedOut = false

    child.stdout.on('data', (b: Buffer) => {
      opts.onStdout?.(b)
      if (collect && !overflowed) {
        collected += b.length
        if (collected > maxStdout) {
          overflowed = true
          child.kill('SIGKILL')
          return
        }
        chunks.push(b)
      }
    })

    child.stderr.on('data', (b: Buffer) => {
      opts.onStderr?.(b)
      stderr = (stderr + b.toString()).slice(-STDERR_KEEP)
    })

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    // Stopped before it started: it stops at once, rather than running to the end.
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })

    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, opts.timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(new ProcessError(`could not start ${binary}: ${err.message}`, null, stderr))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (overflowed) {
        reject(new ProcessError(`${binary} produced more than ${maxStdout} bytes of output`, code, stderr))
      } else if (opts.signal?.aborted) {
        reject(new ProcessError('cancelled', code, stderr))
      } else if (timedOut) {
        reject(new ProcessError(`${binary} did not finish within ${(opts.timeoutMs ?? 0) / 1000} seconds and was stopped`, code, stderr.trim()))
      } else if (code === 0) {
        resolve({ stdout: Buffer.concat(chunks), stderr })
      } else {
        reject(new ProcessError(`${binary} exited with code ${code}`, code, stderr.trim()))
      }
    })
  })
}

/** Run a binary and return its stdout as text. */
export async function captureText(binary: string, args: string[], opts: SpawnOptions = {}): Promise<string> {
  return (await capture(binary, args, opts)).stdout.toString()
}
