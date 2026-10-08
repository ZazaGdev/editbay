/** Characters Windows refuses in a filename, plus control characters. */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g

/** Names Windows reserves whatever the extension. */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

const MAX_STEM = 120

/**
 * Make a string safe to use as a filename.
 *
 * An export writes to a path the user chose, so a source name containing a colon
 * or a slash must not be able to send the file somewhere else or fail the write.
 */
export function sanitiseFilename(name: string): string {
  const cleaned = name
    .replace(ILLEGAL, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, MAX_STEM)
  if (cleaned === '') return 'untitled'
  return RESERVED.has(cleaned.toLowerCase()) ? `${cleaned}_` : cleaned
}

export interface FilenameFields {
  project: string
  /** The sequence being exported. */
  sequence: string
  index: number
  clip: string
}

/**
 * Fill in an export filename pattern.
 *
 * Supported fields are {project}, {sequence}, {index} and {clip}. The index is one based and
 * padded to two digits, so a folder of exports sorts the way it was cut.
 */
export function formatFilename(pattern: string, fields: FilenameFields, extension: string): string {
  const filled = pattern.replace(/\{(project|sequence|index|clip)\}/g, (_, key: string) => {
    if (key === 'project') return sanitiseFilename(fields.project)
    if (key === 'sequence') return sanitiseFilename(fields.sequence)
    if (key === 'clip') return sanitiseFilename(fields.clip)
    return String(fields.index).padStart(2, '0')
  })
  const stem = sanitiseFilename(filled)
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  return `${stem}${ext}`
}

/** The source file's name without its extension, for the {clip} field. */
export function clipNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}
