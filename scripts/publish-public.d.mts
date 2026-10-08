// Types for scripts/publish-public.mjs, so test/unit/publish-public.test.ts type-checks.
export interface ScanHit {
  what: string
  where: string
  match: string
}
export interface Accepted {
  file: string
  match?: string
}
export interface Scan {
  files: { secrets: ScanHit[]; secret_files: string[]; personal: ScanHit[] }
  history: { secrets: ScanHit[]; secret_files_ever: string[]; messages: ScanHit[] }
  private_docs: { tracked: string[] }
}
export declare function readAllowList(text: string): string[]
export declare function isPublic(path: string, allowed: string[]): boolean
export declare function isAccepted(hit: ScanHit, accepted: Accepted[]): boolean
export declare function blockers(scan: Scan, accepted: Accepted[]): string[]
export declare function privateLinks(texts: [string, string][], tracked: string[], allowed: string[]): string[]
