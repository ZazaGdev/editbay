// Types for scripts/test-pick.mjs, so test/unit/test-pick.test.ts type-checks.
export declare const FULL_RUN_FILES: { pattern: RegExp; reason: string }[]
export declare const PICKED_DIRS: string[]
export declare const HISTORY_TOP: number
export declare const HISTORY_MIN: number
export declare function canAffectTests(file: string): boolean
export declare function nameWords(file: string): string[]
export declare function namedAfter(testFile: string, file: string): boolean
export interface PickInput {
  changed: string[]
  tests: string[]
  importsOf: (file: string) => string[]
  coChanged: (file: string) => Map<string, number>
  commitsOf: (file: string) => number
  sources: string[]
}
export interface Picked {
  full: string[]
  picked: Map<string, string[]>
  unit: boolean
}
export declare function pickTests(input: PickInput): Picked
export declare function byFolder(picked: Map<string, string[]>): Record<string, string[]>
