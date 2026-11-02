import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTrustedShares, onTrustWriteFailed, trustShares, trustedShares } from '../../src/main/settings/trusted-shares'

/** Audit 2026-10-01: the list of shares allowed, read as the other settings files are, and a failed write told. */

const root = await mkdtemp(join(tmpdir(), 'editbay-trust-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe('the shares you allowed', () => {
  it('sets a damaged list aside rather than letting the next save write over it', async () => {
    const dir = join(root, 'damaged')
    await rm(dir, { recursive: true, force: true })
    await import('node:fs/promises').then((f) => f.mkdir(dir, { recursive: true }))
    await writeFile(join(dir, 'trusted-shares.json'), '{ not json')
    await loadTrustedShares(dir)
    expect(trustedShares().size).toBe(0)
    expect((await readdir(dir)).some((n) => n.startsWith('trusted-shares.json.') && n.endsWith('.bad'))).toBe(true)
  })

  it('says so when the list cannot be written', async () => {
    // A folder inside a file, which no system will make, so writing the list fails.
    await writeFile(join(root, 'a-file'), '')
    await loadTrustedShares(join(root, 'a-file', 'folder'))
    const told: string[] = []
    onTrustWriteFailed((reason) => told.push(reason))
    await trustShares(['\\nas\footage'])
    expect(told).toHaveLength(1)
    expect(trustedShares().has('\\nas\footage')).toBe(true)
  })
})
