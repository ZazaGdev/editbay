/**
 * What the command line has in place of Electron, which it does not run in.
 *
 * The media code it shares with the app imports `app` from Electron for the
 * one thing it is asked for, the app's own data folder, where the cache is.
 * Nothing the command line does reaches the cache, so asking says so rather
 * than quietly writing somewhere.
 */
export const app = {
  getPath(name: string): string {
    throw new Error(`the command line has no ${name} folder: it does not run inside Editbay`)
  }
}
