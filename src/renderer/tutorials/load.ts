import { inOrder, parseTutorial, type Tutorial } from '../../shared/tutorials'

/**
 * Every tutorial, read at build time.
 *
 * `docs/tutorials` is the single source of truth: the window renders these
 * files and GitHub serves the same ones, so there is no second copy to drift.
 *
 * They are bundled rather than read from disk at runtime, which means a
 * development run and the packaged app behave identically and asking for help
 * costs no round trip to main. Forty short files is a few tens of kilobytes in
 * the bundle, which is nothing beside the window's own code.
 */
const FILES = import.meta.glob('../../../docs/tutorials/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
})

/** `.../150-remove-silences.md` becomes `150-remove-silences`. */
function idOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}

/**
 * Only the numbered files are entries. `README.md` sits in the same folder and
 * explains how to write one, so it is skipped by shape rather than by name:
 * anything without the `NNN-` prefix is documentation about the tutorials, not
 * a tutorial.
 */
export const TUTORIALS: Tutorial[] = inOrder(
  Object.entries(FILES)
    .filter(([path]) => /\/\d{3}-[^/]+\.md$/.test(path))
    .map(([path, text]) => parseTutorial(idOf(path), text))
)
