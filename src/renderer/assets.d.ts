/** A file bundled with the window, imported for the address it is served at. */
declare module '*?url' {
  const url: string
  export default url
}

/**
 * Vite's build-time file glob, declared here rather than by pulling in
 * `vite/client`, the same way the `?url` import above is handled. Typed for
 * the calls that use it: the tutorials read as raw text, and the caption
 * fonts found by their addresses.
 */
interface ImportMeta {
  glob(pattern: string, options: { query: '?raw' | '?url'; import: 'default'; eager: true }): Record<string, string>
}
