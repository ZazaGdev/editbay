/**
 * An id that works in both processes.
 * `node:crypto` cannot be imported here because the renderer reads this module
 * too, and `crypto.randomUUID` is unavailable outside a secure context.
 */
export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
