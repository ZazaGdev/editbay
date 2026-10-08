import { readFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { CREDIT_FILE, creditKey, creditLine } from '../shared/credits'

/**
 * Task 47: the credits a video's description needs, for the files it uses.
 * A file needs one when it was marked by hand, or when a folder it is in,
 * or one above it, holds a credit.txt: the line written there. Each line is
 * given once, in the order the files first need it.
 */
export async function creditsFor(paths: readonly string[], marked: Readonly<Record<string, string>>): Promise<string[]> {
  const found: string[] = []
  const read = new Map<string, Promise<string | null>>()
  const inFolder = (dir: string): Promise<string | null> => {
    let line = read.get(dir)
    if (!line) {
      line = readFile(join(dir, CREDIT_FILE), 'utf8').then(creditLine, () => null)
      read.set(dir, line)
    }
    return line
  }
  for (const path of paths) {
    let line: string | null = marked[creditKey(path)] ?? null
    for (let dir = dirname(path); line === null; dir = dirname(dir)) {
      line = await inFolder(dir)
      if (dir === parse(dir).root) break
    }
    if (line && !found.includes(line)) found.push(line)
  }
  return found
}
