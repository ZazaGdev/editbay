import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { blockers, isAccepted, isPublic, privateLinks, readAllowList } from '../../scripts/publish-public.mjs'

/**
 * Plan 103: the public editbay repo gets, on each release, one commit holding
 * exactly the files the allow-list names, and nothing is published when the
 * open-source check finds something secret or private in them.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'publish-public.mjs')
const SCANNER = process.env.OSCHECK ?? join(homedir(), '.claude', 'skills', 'open-source-check', 'scripts', 'oscheck.py')
const base = mkdtempSync(join(tmpdir(), 'editbay-publish-test-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' })
}

/** A private repo with public and private files, committed, and an empty public one beside it. */
function repos(name: string, files: Record<string, string>): { source: string; target: string } {
  const root = join(base, name)
  const source = join(root, 'qzsource')
  const target = join(root, 'qztarget')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true })
    writeFileSync(join(source, path), text)
  }
  mkdirSync(target, { recursive: true })
  git(source, 'init', '-q')
  git(source, 'add', '-A')
  git(source, 'commit', '-qm', 'work')
  git(target, 'init', '-q')
  return { source, target }
}

const ALLOW = '# public\nsrc/\nREADME.md\nscripts/public-files.txt\n'

function publish(source: string, target: string): { status: number | null; out: string } {
  const r = spawnSync('node', [SCRIPT, target, '--version', '1.0.0', '--source', source], { encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('the allow-list', () => {
  it('names folders by a trailing slash and files by their whole path, and nothing else is public', () => {
    const allowed = readAllowList(ALLOW)
    expect(allowed).toEqual(['src/', 'README.md', 'scripts/public-files.txt'])
    expect(isPublic('src/main/index.ts', allowed)).toBe(true)
    expect(isPublic('README.md', allowed)).toBe(true)
    expect(isPublic('README.md.bak', allowed)).toBe(false)
    expect(isPublic('srcx/a.ts', allowed)).toBe(false)
    expect(isPublic('docs/plans/p.md', allowed)).toBe(false)
  })
})

describe('links in the public files', () => {
  it('are refused when they point at a file or folder that stays private, and not otherwise', () => {
    const allowed = readAllowList(ALLOW)
    const tracked = ['README.md', 'src/a.ts', 'docs/plans/p.md', 'docs/notes.md']
    const links = (text: string): string[] => privateLinks([['README.md', text]], tracked, allowed)
    expect(links('See [plans](docs/plans/) and [one](./docs/plans/p.md#goal).')).toHaveLength(2)
    expect(links('See [code](src/a.ts), [site](https://example.com) and [missing](nowhere.md).')).toEqual([])
    expect(privateLinks([['src/b.md', '[up](../docs/notes.md)']], tracked, allowed)).toHaveLength(1)
  })
})

describe('the check of what is published', () => {
  const scan = (personal: { what: string; where: string; match: string }[]) => ({
    files: { secrets: [], secret_files: [], personal },
    history: { secrets: [], secret_files_ever: [], messages: [] },
    private_docs: { tracked: [] }
  })

  it('stops on a personal detail no one has accepted, by file and match, whatever its line', () => {
    const hit = { what: 'email address', where: 'CODE_OF_CONDUCT.md:40', match: 'someone@example.com' }
    expect(blockers(scan([hit]), [])).toHaveLength(1)
    expect(isAccepted(hit, [{ file: 'CODE_OF_CONDUCT.md', match: 'someone@example.com' }])).toBe(true)
    expect(blockers(scan([hit]), [{ file: 'CODE_OF_CONDUCT.md', match: 'someone@example.com' }])).toEqual([])
    expect(blockers(scan([hit]), [{ file: 'README.md', match: 'someone@example.com' }])).toHaveLength(1)
  })
})

describe.runIf(existsSync(SCANNER))('publishing a release', () => {
  it('makes one commit holding exactly the public files, and never a private one', () => {
    const { source, target } = repos('clean', {
      'scripts/public-files.txt': ALLOW,
      'README.md': '# A video editor\n',
      'src/a.ts': 'export const a = 1\n',
      'docs/plans/2026-01-01-secret-plan.md': 'private\n'
    })
    const r = publish(source, target)
    expect(r.status, r.out).toBe(0)
    expect(git(target, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
    expect(git(target, 'ls-files').trim().split('\n').sort()).toEqual(['README.md', 'scripts/public-files.txt', 'src/a.ts'])
    expect(readFileSync(join(target, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1\n')

    // The next release: one more commit, and a file taken out of the list goes.
    writeFileSync(join(source, 'scripts', 'public-files.txt'), 'src/\nscripts/public-files.txt\n')
    git(source, 'commit', '-qam', 'readme private now')
    expect(publish(source, target).status).toBe(0)
    expect(git(target, 'rev-list', '--count', 'HEAD').trim()).toBe('2')
    expect(git(target, 'ls-files').trim().split('\n').sort()).toEqual(['scripts/public-files.txt', 'src/a.ts'])
  })

  it('takes the commit back off and says NO-GO when a public file holds a secret', () => {
    // Made here, so this test's own file holds no token for the scan of the real repo to find.
    const token = 'gh' + 'p_' + 'A1b2C3d4'.repeat(5)
    const { source, target } = repos('secret', {
      'scripts/public-files.txt': ALLOW,
      'README.md': '# A video editor\n',
      'src/a.ts': `export const token = '${token}'\n`
    })
    const r = publish(source, target)
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/NO-GO/)
    expect(spawnSync('git', ['-C', target, 'rev-parse', '--verify', '-q', 'HEAD']).status).not.toBe(0)
    expect(existsSync(join(target, 'src'))).toBe(false)
  })
})
