import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { PICTURE_KINDS, SOUND_KINDS } from '../../shared/transitions'
import type { AppSettings, RecordingsListing } from '../../shared/types'
import { DEFAULT_FILENAME_PATTERN } from '../../shared/workspace'
import { SAFE_ZONE_CHOICES, type SafeZoneChoice } from '../../shared/safe-zones'
import type { SilenceSettings } from '../../shared/silences'
import { effectsFolderOf, setEffectsFolder } from '../../shared/source-folders'
import type { WindowSettings } from '../state/useSettings'
import { microphones, type Microphone } from '../voiceover/recorder'
import { surface, ink, accent, space, radius, type } from '../theme'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Field } from '../ui/Field'
import { Icon, type IconName } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Kbd } from '../ui/Kbd'
import { Select } from '../ui/Select'
import { SectionLabel } from '../ui/SectionLabel'
import { Modal } from './Modal'
import { HelpTip } from '../ui/HelpTip'
import { SettingsStyles } from './SettingsStyles'
import type { SavedShape } from '../../shared/shape'
import { THEMES, switchTheme, type ThemeId } from '../themes'

/** The longest a transition can be set to here, as main keeps it. */
const MAX_TRANSITION_SECONDS = 30

/** How you like exports to go, as the app's settings keep it. */
export type ExportPrefs = Pick<AppSettings, 'exportFolder' | 'exportMode' | 'exportPattern' | 'exportExisting' | 'showAfterExport'>

export function exportPrefsOf(s: AppSettings): ExportPrefs {
  return {
    exportFolder: s.exportFolder,
    exportMode: s.exportMode,
    exportPattern: s.exportPattern,
    exportExisting: s.exportExisting,
    showAfterExport: s.showAfterExport
  }
}

/** The next transition added: how long, and which kind for a picture and for a sound. */
export interface TransitionDefaults {
  seconds: number
  picture: string
  sound: string
}

/** A tab down the left, and the sections it shows. */
interface Tab {
  name: string
  icon: IconName
  sections: string[]
}

const GENERAL: Tab = { name: 'General', icon: 'settings', sections: ['Saving', 'Theme'] }

const TABS: Tab[] = [
  GENERAL,
  { name: 'Timeline', icon: 'timeline', sections: ['Timeline', 'Transitions', 'Remove silences'] },
  { name: 'Monitor', icon: 'monitor', sections: ['Monitor'] },
  { name: 'Sources', icon: 'open', sections: ['Source bin', 'Recordings', 'Assets', 'Media cache'] },
  { name: 'Voice over', icon: 'microphone', sections: ['Voice over'] },
  { name: 'Export', icon: 'export', sections: ['Export'] },
  { name: 'Styles', icon: 'paint', sections: ['Saved styles'] },
  { name: 'Keys', icon: 'shortcuts', sections: ['Keys'] }
]

/**
 * Every setting the search finds: the control it lands on, the section it is
 * in, what it is called, and other words someone might look for it by.
 */
interface Entry {
  id: string
  section: string
  label: string
  words?: string
}

export const SETTINGS: Entry[] = [
  { id: 'setting-save-automatically', section: 'Saving', label: 'Save automatically, a little after each change', words: 'autosave' },
  { id: 'setting-overview', section: 'Timeline', label: 'Show the ALL strip above the ruler', words: 'overview' },
  { id: 'setting-snapping', section: 'Timeline', label: 'Snap what is dragged to edges and the playhead', words: 'snap magnet align' },
  { id: 'setting-skim', section: 'Timeline', label: 'Show the frame under the pointer while paused', words: 'skim hover scrub' },
  { id: 'setting-transition-every-cut', section: 'Transitions', label: 'Put a transition on every cut as it is made' },
  { id: 'setting-transition-length', section: 'Transitions', label: 'Transition length', words: 'duration seconds' },
  { id: 'setting-transition-picture', section: 'Transitions', label: 'Transition picture', words: 'video fade dissolve black' },
  { id: 'setting-transition-sound', section: 'Transitions', label: 'Transition sound', words: 'audio crossfade' },
  { id: 'setting-silence-level', section: 'Remove silences', label: 'Quieter than', words: 'silence pause threshold db loudness' },
  { id: 'setting-silence-shortest', section: 'Remove silences', label: 'Lasting at least', words: 'silence pause shortest' },
  { id: 'setting-silence-leave', section: 'Remove silences', label: 'Breath kept', words: 'silence pause padding' },
  { id: 'setting-bin-view', section: 'Source bin', label: 'Show sources as', words: 'cards list grid view' },
  { id: 'setting-recordings-choose', section: 'Recordings', label: 'Recordings folder', words: 'obs' },
  { id: 'setting-effects-choose', section: 'Assets', label: 'Assets folder', words: 'assets effects fx sound effects overlays green screen memes library video audio images save clip' },
  { id: 'setting-free-cache', section: 'Media cache', label: 'Free the space other projects use', words: 'cache disk space storage clear delete' },
  { id: 'setting-guides', section: 'Monitor', label: 'Show the guides over the Output view' },
  { id: 'setting-thirds', section: 'Monitor', label: 'With the centre and thirds lines', words: 'center rule guides' },
  { id: 'setting-side-by-side', section: 'Monitor', label: 'Show the Source and Output views side by side', words: 'vertical portrait' },
  { id: 'setting-lighter-copies', section: 'Monitor', label: 'Play lighter copies of recordings, for smoother playback', words: 'proxy proxies preview smooth lag performance' },
  { id: 'setting-safe-zone', section: 'Monitor', label: 'Safe zones to shade', words: 'shorts tiktok reels vertical' },
  { id: 'setting-microphone', section: 'Voice over', label: 'Record from', words: 'microphone mic input' },
  { id: 'setting-mute-while-recording', section: 'Voice over', label: 'Mute the sequence while recording', words: 'headphones' },
  { id: 'setting-export-choose', section: 'Export', label: 'Export folder', words: 'output where' },
  { id: 'setting-export-mode', section: 'Export', label: 'A new project writes', words: 'one video file per clip batch' },
  { id: 'setting-export-existing', section: 'Export', label: 'When a file is already there', words: 'overwrite replace keep both' },
  { id: 'setting-export-pattern', section: 'Export', label: 'A new project names its files', words: 'filename name pattern' },
  { id: 'setting-show-after-export', section: 'Export', label: 'Show the file in its folder when an export finishes', words: 'explorer reveal' },
  { id: 'setting-theme', section: 'Theme', label: 'Theme', words: 'colour color look dark appearance accent teal blue electric arctic classic' },
  { id: 'setting-saved-styles', section: 'Saved styles', label: 'Saved caption, text and shape styles', words: 'rename delete forget my style caption text shape' },
  { id: 'setting-shortcuts', section: 'Keys', label: 'Change the keyboard shortcuts', words: 'keys hotkeys keymap bindings' }
]

const tabOf = (section: string): Tab => TABS.find((t) => t.sections.includes(section)) ?? GENERAL

/** The settings every typed word is found in, in the order the window shows them. */
export function findSettings(typed: string): Entry[] {
  const words = typed.toLowerCase().split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) return []
  const order = TABS.flatMap((t) => t.sections)
  return SETTINGS.filter((e) => {
    const text = `${e.label} ${e.section} ${tabOf(e.section).name} ${e.words ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  }).sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
}

/** A number of bytes as a person would say it. */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** The tab open last, so the window opens where it was left while the app is running. */
let lastTab = GENERAL.name

function Section(props: { name: string; children: ReactNode; help?: { text: string; tutorial: string } }): JSX.Element {
  return (
    <section
      data-testid="settings-section"
      data-section={props.name}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space.sm,
        maxWidth: 620,
        paddingBottom: space.lg,
        borderBottom: `1px solid ${surface.line}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, marginBottom: 2 }}>
        <SectionLabel>{props.name}</SectionLabel>
        {props.help && <HelpTip testid="settings-help" text={props.help.text} tutorial={props.help.tutorial} />}
      </div>
      {props.children}
    </section>
  )
}

/** One setting, which the search can point at and light up. */
function Row(props: { id: string; found: string | null; children: ReactNode }): JSX.Element {
  return (
    <div
      data-setting={props.id}
      className={props.found === props.id ? 'ui-setting--found' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: space.xs, borderRadius: radius.control }}
    >
      {props.children}
    </div>
  )
}

const note = { font: type.meta, color: ink.muted, margin: 0 } as const

/**
 * A number typed in and kept when Enter is pressed or the box is left. What is
 * half typed is never sent: "0." on the way to "0.4" is not a setting.
 */
function NumberSetting(props: {
  label: string
  unit: string
  step: number
  value: number
  testid: string
  onCommit: (n: number) => void
}): JSX.Element {
  const [typed, setTyped] = useState<string | null>(null)
  const commit = (text: string): void => {
    setTyped(null)
    const n = Number.parseFloat(text)
    if (Number.isFinite(n) && n !== props.value) props.onCommit(n)
  }
  return (
    <Field
      label={props.label}
      kind="number"
      unit={props.unit}
      step={props.step}
      testid={props.testid}
      value={typed ?? String(props.value)}
      onChange={setTyped}
      onCommit={commit}
    />
  )
}

/**
 * Every preference the app keeps, in one place. Each is also changed where it
 * is used, the save menu, the record menu, a transition's own controls, and
 * this changes the same value, so the two can never disagree.
 *
 * What is here is what you set once and forget. Whether the guides are on
 * and how fast it plays are what the monitor is doing right now, so they stay
 * on the monitor. How an export is named and where it goes belong to each
 * project, so they stay in the Export window.
 *
 * The sections sit under tabs down the left, and the search in the header
 * finds any setting in any tab: its results cover the window until one is
 * picked, which opens its tab and lights it.
 */
export function SettingsDialog(props: {
  saveAutomatically: boolean
  onSaveAutomatically: (on: boolean) => void
  overview: boolean
  skim: boolean
  lighterCopies: boolean
  snapping: boolean
  sideBySide: boolean
  safeZone: SafeZoneChoice
  silence: SilenceSettings
  guides: boolean
  thirds: boolean
  binView: WindowSettings['binView']
  onWindow: (change: Partial<WindowSettings>) => void
  exportPrefs: ExportPrefs
  onExportPrefs: (change: Partial<ExportPrefs>) => void
  /** Close this and open the shortcuts window. */
  onShortcuts: () => void
  transitionOnEveryCut: boolean
  onTransitionOnEveryCut: (on: boolean) => void
  transition: TransitionDefaults
  onTransition: (change: Partial<TransitionDefaults>) => void
  record: { microphoneId: string | null; muteWhileRecording: boolean }
  onRecord: (change: { microphoneId?: string | null; muteWhileRecording?: boolean }) => void
  /** The shapes saved under a name, which the Shape menu offers. */
  savedShapes: SavedShape[]
  /** The window's theme, which a change of loads it again in (task 66). */
  theme: ThemeId
  onSavedShapes: (next: SavedShape[]) => void
  onClose: () => void
}): JSX.Element {
  const [mics, setMics] = useState<Microphone[]>([])
  const [recordings, setRecordings] = useState<RecordingsListing | null>(null)
  /** The effects folder (plan 90), read from the settings, or undefined until they are read. */
  const [effects, setEffects] = useState<string | null | undefined>(undefined)
  const chooseEffects = async (folder: string | null): Promise<void> => {
    const now = (await window.api.appSettings()).sourceFolders
    const kept = await window.api.setAppSettings({ sourceFolders: setEffectsFolder(now, folder) })
    setEffects(effectsFolderOf(kept.sourceFolders)?.folder ?? null)
  }
  /** How much room the media cache takes, once it has been worked out. */
  const [cache, setCache] = useState<number | null>(null)
  const [freeing, setFreeing] = useState(false)
  /** The name pattern while it is being typed in, or null when it shows the setting. */
  const [pattern, setPattern] = useState<string | null>(null)
  const ex = props.exportPrefs
  const [tab, setTab] = useState(lastTab)
  const current = TABS.find((t) => t.name === tab) ?? GENERAL
  /** What is typed in the search, and which of the settings found the arrows are on. */
  const [typed, setTyped] = useState('')
  const [chosen, setChosen] = useState(0)
  const found = useMemo(() => findSettings(typed), [typed])
  /** The setting a search just led to, lit for a moment so the eye finds it. */
  const [lit, setLit] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const open = (name: string): void => {
    lastTab = name
    setTab(name)
    pane.current?.scrollTo({ top: 0 })
  }

  const go = (entry: Entry): void => {
    setTyped('')
    open(tabOf(entry.section).name)
    setLit(entry.id)
  }

  // A new search starts at the top of what it found.
  useEffect(() => setChosen(0), [typed])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${chosen}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [chosen])

  // Once its tab is showing, the setting a search chose is scrolled to and lit.
  useEffect(() => {
    if (lit === null) return
    pane.current?.querySelector(`[data-setting="${lit}"]`)?.scrollIntoView({ block: 'center' })
    const off = window.setTimeout(() => setLit(null), 1600)
    return () => window.clearTimeout(off)
  }, [lit])

  // Escape empties a search before it closes the window. The window's own
  // Escape is held while there is a search, so this is the only one that acts.
  useEffect(() => {
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && typed !== '') {
        setTyped('')
        box.current?.focus()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [typed])


  useEffect(() => {
    let live = true
    void microphones().then((m) => live && setMics(m))
    void window.api.recordings().then((l) => live && setRecordings(l))
    void window.api.appSettings().then((s) => live && setEffects(effectsFolderOf(s.sourceFolders)?.folder ?? null))
    void window.api.cacheSize().then((n) => live && setCache(n))
    return () => {
      live = false
    }
  }, [])

  const commitLength = (seconds: number): void => {
    if (seconds <= 0) return
    props.onTransition({ seconds: Math.min(MAX_TRANSITION_SECONDS, Math.round(seconds * 10) / 10) })
  }

  // A microphone chosen before and not plugged in now is still named, so the
  // list does not quietly show the default instead of what is kept.
  const chosenMic = props.record.microphoneId
  const micChoices = [
    { value: '', label: "The system's default microphone" },
    ...mics.map((m) => ({ value: m.id, label: m.label })),
    ...(chosenMic !== null && !mics.some((m) => m.id === chosenMic) ? [{ value: chosenMic, label: 'A microphone not plugged in now' }] : [])
  ]

  const shows = (section: string): boolean => current.sections.includes(section)

  return (
    <Modal title="Settings" testid="settings" onClose={props.onClose} width={880} bare flush keepOpen={typed !== ''}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          gridTemplateRows: 'auto 1fr',
          height: 'min(620px, calc(100vh - 50px))'
        }}
      >
        <header
          style={{
            gridColumn: '1 / -1',
            display: 'grid',
            gridTemplateColumns: '200px 1fr auto',
            alignItems: 'center',
            gap: space.md,
            padding: `${space.md}px ${space.md}px ${space.md}px 0`,
            borderBottom: `1px solid ${surface.line}`
          }}
        >
          <h2
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              font: type.title,
              color: ink.primary,
              margin: 0,
              paddingLeft: space.lg
            }}
          >
            <Icon name="settings" size={17} />
            Settings
          </h2>
          <div className="ui-field__box" style={{ height: 34, paddingLeft: 10 }}>
            <span style={{ color: ink.muted, display: 'flex' }}>
              <Icon name="search" />
            </span>
            <input
              ref={box}
              data-testid="settings-search"
              autoFocus
              type="text"
              className="ui-field__input"
              placeholder="Search every setting"
              aria-label="Search every setting"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (typed === '') return
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : -1
                  setChosen((i) => (found.length === 0 ? 0 : (i + step + found.length) % found.length))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const entry = found[chosen]
                  if (entry) go(entry)
                }
              }}
              style={{ font: type.body }}
            />
            {typed !== '' && <Kbd>Esc</Kbd>}
          </div>
          <IconButton icon="close" label="Close" size="small" variant="ghost" testid="settings-close" onClick={props.onClose} />
        </header>

        {/* The sidebar and the pane, with the results laid over both while there is a search. */}
        <div style={{ gridColumn: '1 / -1', position: 'relative', display: 'grid', gridTemplateColumns: '200px 1fr', minHeight: 0 }}>
          <nav
            aria-label="Settings sections"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: `${space.md}px ${space.sm}px`,
              borderRight: `1px solid ${surface.line}`,
              overflowY: 'auto'
            }}
          >
            {TABS.map((t) => {
              const on = t.name === current.name
              return (
                <button
                  key={t.name}
                  type="button"
                  className="ui-settings-tab"
                  data-testid="settings-tab"
                  data-tab={t.name}
                  data-active={on ? 'yes' : 'no'}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => open(t.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space.sm,
                    height: 32,
                    padding: `0 ${space.sm}px`,
                    border: 'none',
                    borderRadius: radius.control,
                    font: type.body,
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: on ? ink.primary : ink.secondary,
                    background: on ? accent.wash : 'transparent',
                    boxShadow: on ? `inset 0 0 0 1px ${accent.washLine}` : 'none'
                  }}
                >
                  <span style={{ display: 'flex', color: on ? accent.bright : ink.muted }}>
                    <Icon name={t.icon} />
                  </span>
                  {t.name}
                </button>
              )
            })}
          </nav>

          <div
            ref={pane}
            data-testid="settings-pane"
            data-tab={current.name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: space.lg,
              padding: `${space.lg}px ${space.xl}px`,
              overflowY: 'auto',
              minHeight: 0
            }}
          >
            {shows('Saving') && (
              <Section name="Saving" help={{ text: 'Only a project that has already been saved once, so it has a file to save to.', tutorial: '060-saving-and-undo' }}>
                <Row id="setting-save-automatically" found={lit}>
                  <Check testid="setting-save-automatically" checked={props.saveAutomatically} onChange={props.onSaveAutomatically}>
                    Save automatically, a little after each change
                  </Check>
                </Row>
              </Section>
            )}

            {shows('Theme') && (
              <Section name="Theme">
                <Row id="setting-theme" found={lit}>
                  <Select
                    label="Theme"
                    testid="setting-theme"
                    value={props.theme}
                    choices={THEMES.map((t) => ({ value: t.id, label: t.name }))}
                    onChange={(id) => switchTheme(id as ThemeId)}
                    style={{ maxWidth: 240 }}
                  />
                </Row>
              </Section>
            )}

            {shows('Timeline') && (
              <Section name="Timeline">
                <Row id="setting-overview" found={lit}>
                  <Check testid="setting-overview" checked={props.overview} onChange={(overview) => props.onWindow({ overview })}>
                    Show the ALL strip above the ruler
                  </Check>
                </Row>
                <Row id="setting-snapping" found={lit}>
                  <Check testid="setting-snapping" checked={props.snapping} onChange={(snapping) => props.onWindow({ snapping })}>
                    Snap what is dragged to edges and the playhead
                  </Check>
                </Row>
                <Row id="setting-skim" found={lit}>
                  <Check testid="setting-skim" checked={props.skim} onChange={(skim) => props.onWindow({ skim })}>
                    Show the frame under the pointer while paused
                  </Check>
                </Row>
              </Section>
            )}

            {shows('Source bin') && (
              <Section name="Source bin">
                <Row id="setting-bin-view" found={lit}>
                  <Select
                    label="Show sources as"
                    showLabel
                    testid="setting-bin-view"
                    value={props.binView}
                    choices={[
                      { value: 'cards', label: 'Cards, with everything on them' },
                      { value: 'list', label: 'A list, one line each' },
                      { value: 'grid', label: 'A grid of thumbnails' }
                    ]}
                    onChange={(v) => props.onWindow({ binView: v === 'list' || v === 'grid' ? v : 'cards' })}
                  />
                </Row>
              </Section>
            )}

            {shows('Monitor') && (
              <Section
                name="Monitor"
                help={{
                  text: 'Lighter copies are made in the background and played in the preview; the export always uses the recordings. The safe zones are where each app puts its own buttons over a vertical video, drawn with the guides (G).',
                  tutorial: '240-guides-and-safe-zones'
                }}>
                <Row id="setting-guides" found={lit}>
                  <Check testid="setting-guides" checked={props.guides} onChange={(guides) => props.onWindow({ guides })}>
                    Show the guides over the Output view
                  </Check>
                </Row>
                <Row id="setting-thirds" found={lit}>
                  <Check testid="setting-thirds" checked={props.thirds} onChange={(thirds) => props.onWindow({ thirds })}>
                    With the centre and thirds lines
                  </Check>
                </Row>
                <Row id="setting-side-by-side" found={lit}>
                  <Check testid="setting-side-by-side" checked={props.sideBySide} onChange={(sideBySide) => props.onWindow({ sideBySide })}>
                    Show the Source and Output views side by side, for a frame taller than wide
                  </Check>
                </Row>
                <Row id="setting-lighter-copies" found={lit}>
                  <Check testid="setting-lighter-copies" checked={props.lighterCopies} onChange={(lighterCopies) => props.onWindow({ lighterCopies })}>
                    Play lighter copies of recordings, for smoother playback
                  </Check>
                </Row>
                <Row id="setting-safe-zone" found={lit}>
                  <Select
                    label="Safe zones to shade"
                    showLabel
                    testid="setting-safe-zone"
                    value={props.safeZone}
                    choices={SAFE_ZONE_CHOICES.map((c) => ({ value: c.id, label: c.name }))}
                    onChange={(id) => props.onWindow({ safeZone: id as SafeZoneChoice })}
                  />
                </Row>
              </Section>
            )}

            {shows('Transitions') && (
              <Section name="Transitions">
                <Row id="setting-transition-every-cut" found={lit}>
                  <Check
                    testid="setting-transition-every-cut"
                    checked={props.transitionOnEveryCut}
                    onChange={props.onTransitionOnEveryCut}
                  >
                    Put a transition on every cut as it is made
                  </Check>
                </Row>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: space.sm, alignItems: 'end' }}>
                  <Row id="setting-transition-length" found={lit}>
                    <NumberSetting
                      label="Length"
                      unit="s"
                      step={0.1}
                      testid="setting-transition-length"
                      value={props.transition.seconds}
                      onCommit={commitLength}
                    />
                  </Row>
                  <Row id="setting-transition-picture" found={lit}>
                    <Select
                      label="Picture"
                      showLabel
                      testid="setting-transition-picture"
                      value={props.transition.picture}
                      choices={PICTURE_KINDS.map((k) => ({ value: k.id, label: k.name, group: k.family }))}
                      onChange={(picture) => props.onTransition({ picture })}
                    />
                  </Row>
                  <Row id="setting-transition-sound" found={lit}>
                    <Select
                      label="Sound"
                      showLabel
                      testid="setting-transition-sound"
                      value={props.transition.sound}
                      choices={SOUND_KINDS.map((k) => ({ value: k.id, label: k.name }))}
                      onChange={(sound) => props.onTransition({ sound })}
                    />
                  </Row>
                </div>
              </Section>
            )}

            {shows('Remove silences') && (
              <Section name="Remove silences">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: space.sm, alignItems: 'end' }}>
                  <Row id="setting-silence-level" found={lit}>
                    <NumberSetting
                      label="Quieter than"
                      unit="dB"
                      step={1}
                      testid="setting-silence-level"
                      value={props.silence.levelDb}
                      onCommit={(levelDb) => props.onWindow({ silence: { ...props.silence, levelDb } })}
                    />
                  </Row>
                  <Row id="setting-silence-shortest" found={lit}>
                    <NumberSetting
                      label="Lasting at least"
                      unit="s"
                      step={0.1}
                      testid="setting-silence-shortest"
                      value={props.silence.shortestSec}
                      onCommit={(shortestSec) => props.onWindow({ silence: { ...props.silence, shortestSec } })}
                    />
                  </Row>
                  <Row id="setting-silence-leave" found={lit}>
                    <NumberSetting
                      label="Breath kept"
                      unit="s"
                      step={0.05}
                      testid="setting-silence-leave"
                      value={props.silence.leaveSec}
                      onCommit={(leaveSec) => props.onWindow({ silence: { ...props.silence, leaveSec } })}
                    />
                  </Row>
                </div>
              </Section>
            )}

            {shows('Voice over') && (
              <Section name="Voice over">
                <Row id="setting-microphone" found={lit}>
                  <Select
                    label="Record from"
                    showLabel
                    testid="setting-microphone"
                    value={chosenMic ?? ''}
                    choices={micChoices}
                    onChange={(id) => props.onRecord({ microphoneId: id === '' ? null : id })}
                  />
                </Row>
                <Row id="setting-mute-while-recording" found={lit}>
                  <Check
                    testid="setting-mute-while-recording"
                    checked={props.record.muteWhileRecording}
                    onChange={(muteWhileRecording) => props.onRecord({ muteWhileRecording })}
                  >
                    Mute the sequence while recording, for recording without headphones
                  </Check>
                </Row>
              </Section>
            )}

            {shows('Recordings') && (
              <Section name="Recordings" help={{ text: 'Your other folders, such as a library of sound effects, are added in Sources with +.', tutorial: '022-your-own-folders' }}>
                <p data-testid="setting-recordings-folder" style={{ font: type.body, color: ink.primary, margin: 0, wordBreak: 'break-all' }}>
                  {recordings === null ? 'Looking...' : (recordings.folder ?? 'No folder yet')}
                </p>
                <p style={note}>
                  {recordings?.fromObs ? "Read from OBS's own settings." : recordings?.folder ? 'Chosen by hand.' : "OBS's settings could not be found."}
                </p>
                <Row id="setting-recordings-choose" found={lit}>
                  <Button
                    testid="setting-recordings-choose"
                    size="small"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() =>
                      void window.api.chooseRecordingsFolder().then((l) => {
                        if (l) setRecordings(l)
                      })
                    }
                  >
                    Choose a folder...
                  </Button>
                </Row>
              </Section>
            )}

            {shows('Assets') && (
              <Section
                name="Assets"
                help={{
                  text: 'Your folder of video, sound and pictures to use again, listed in Sources as Assets, with Video, Audio and Images folders in it.',
                  tutorial: '318-effects'
                }}>
                <p data-testid="setting-effects-folder" style={{ font: type.body, color: ink.primary, margin: 0, wordBreak: 'break-all' }}>
                  {effects === undefined ? 'Looking...' : (effects ?? 'No folder yet')}
                </p>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Row id="setting-effects-choose" found={lit}>
                    <Button
                      testid="setting-effects-choose"
                      size="small"
                      onClick={() =>
                        void window.api.pickSourceFolder(effects ?? undefined).then((f) => {
                          if (f) void chooseEffects(f)
                        })
                      }
                    >
                      Choose a folder...
                    </Button>
                  </Row>
                  <Button
                    testid="setting-effects-none"
                    size="small"
                    disabled={!effects}
                    whyDisabled="There is no assets folder to take out"
                    title="The folder and its files are left as they are"
                    onClick={() => void chooseEffects(null)}
                  >
                    Take out of Sources
                  </Button>
                </div>
              </Section>
            )}

            {shows('Media cache') && (
              <Section
                name="Media cache"
                help={{
                  text: 'The copies, waveforms and pictures Editbay makes from your sources, so they play smoothly. What no project has used for two months is removed on its own. Freeing the space keeps what the open project uses; another project makes its copies again the next time it is opened. A copy whose recording is gone is the only one, and is always kept.',
                  tutorial: '070-disk-space'
                }}
              >
                <p data-testid="setting-cache-size" style={{ font: type.body, color: ink.primary, margin: 0 }}>
                  {cache === null ? 'Working out how much room it takes...' : `${sizeText(cache)} on this computer`}
                </p>
                <Row id="setting-free-cache" found={lit}>
                  <Button
                    testid="setting-free-cache"
                    size="small"
                    disabled={freeing}
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => {
                      setFreeing(true)
                      void window.api
                        .freeCache()
                        .then(() => window.api.cacheSize())
                        .then(setCache)
                        .finally(() => setFreeing(false))
                    }}
                  >
                    {freeing ? 'Freeing...' : 'Free the space other projects use'}
                  </Button>
                </Row>
              </Section>
            )}

            {shows('Export') && (
              <Section name="Export" help={{ text: 'Where a project exports until it has exported once. After that it keeps the folder it used.', tutorial: '710-export' }}>
                <p data-testid="setting-export-folder" style={{ font: type.body, color: ink.primary, margin: 0, wordBreak: 'break-all' }}>
                  {ex.exportFolder ?? 'Beside the project file, or in Videos before it is saved'}
                </p>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Row id="setting-export-choose" found={lit}>
                    <Button
                      testid="setting-export-choose"
                      size="small"
                      onClick={() =>
                        void window.api.pickExportFolder(ex.exportFolder ?? undefined).then((f) => {
                          if (f) props.onExportPrefs({ exportFolder: f })
                        })
                      }
                    >
                      Choose a folder...
                    </Button>
                  </Row>
                  <Button
                    testid="setting-export-beside"
                    size="small"
                    disabled={ex.exportFolder === null}
                    whyDisabled="Exports already go beside the project file"
                    onClick={() => props.onExportPrefs({ exportFolder: null })}
                  >
                    Beside the project
                  </Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.sm, alignItems: 'end' }}>
                  <Row id="setting-export-mode" found={lit}>
                    <Select
                      label="A new project writes"
                      showLabel
                      testid="setting-export-mode"
                      value={ex.exportMode}
                      choices={[
                        { value: 'join', label: 'One video' },
                        { value: 'batch', label: 'One file per clip' }
                      ]}
                      onChange={(m) => props.onExportPrefs({ exportMode: m === 'batch' ? 'batch' : 'join' })}
                    />
                  </Row>
                  <Row id="setting-export-existing" found={lit}>
                    <Select
                      label="When a file is already there"
                      showLabel
                      testid="setting-export-existing"
                      value={ex.exportExisting}
                      choices={[
                        { value: 'ask', label: 'Ask' },
                        { value: 'replace', label: 'Replace it' },
                        { value: 'keepBoth', label: 'Keep both' }
                      ]}
                      onChange={(v) => props.onExportPrefs({ exportExisting: v === 'replace' || v === 'keepBoth' ? v : 'ask' })}
                    />
                  </Row>
                </div>
                <Row id="setting-export-pattern" found={lit}>
                  <Field
                    label="A new project names its files"
                    testid="setting-export-pattern"
                    value={pattern ?? ex.exportPattern}
                    onChange={setPattern}
                    onCommit={(text) => {
                      setPattern(null)
                      props.onExportPrefs({ exportPattern: text.trim() === '' ? DEFAULT_FILENAME_PATTERN : text.trim() })
                    }}
                  />
                </Row>
                <p style={note}>The same names the Export window takes, such as {'{project}'} and {'{clip}'}.</p>
                <Row id="setting-show-after-export" found={lit}>
                  <Check
                    testid="setting-show-after-export"
                    checked={ex.showAfterExport}
                    onChange={(showAfterExport) => props.onExportPrefs({ showAfterExport })}
                  >
                    Show the file in its folder when an export finishes
                  </Check>
                </Row>
              </Section>
            )}

            {shows('Saved styles') && (
              <Section name="Saved styles">
                <SettingsStyles shapes={props.savedShapes} onShapes={props.onSavedShapes} />
              </Section>
            )}

            {shows('Keys') && (
              <Section name="Keys">
                <Row id="setting-shortcuts" found={lit}>
                  <Button testid="setting-shortcuts" size="small" style={{ alignSelf: 'flex-start' }} onClick={props.onShortcuts}>
                    Change the keyboard shortcuts...
                  </Button>
                </Row>
              </Section>
            )}
          </div>

          {typed !== '' && (
            <div
              ref={list}
              role="listbox"
              data-testid="settings-results"
              style={{
                position: 'absolute',
                inset: 0,
                background: surface.panel,
                borderBottomLeftRadius: radius.dialog,
                borderBottomRightRadius: radius.dialog,
                overflowY: 'auto',
                padding: `${space.md}px ${space.lg}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
            >
              {found.length === 0 ? (
                <p data-testid="settings-none" style={{ font: type.body, color: ink.muted, margin: `${space.sm}px ${space.xs}px` }}>
                  No setting matches that. Try another word.
                </p>
              ) : (
                <SectionLabel style={{ display: 'block', padding: `${space.xs}px ${space.sm}px` }}>
                  {found.length === 1 ? '1 setting' : `${found.length} settings`}
                </SectionLabel>
              )}
              {found.map((e, i) => {
                const t = tabOf(e.section)
                return (
                  <div
                    key={e.id}
                    role="option"
                    aria-selected={i === chosen}
                    data-testid="settings-result"
                    data-setting={e.id}
                    data-index={i}
                    // Only a pointer that moves chooses: the list moving under a still one does not.
                    onMouseMove={() => i !== chosen && setChosen(i)}
                    // Before the search box loses focus, so the click is not lost to a blur.
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => go(e)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: space.md,
                      padding: space.sm,
                      borderRadius: radius.control,
                      cursor: 'pointer',
                      background: i === chosen ? accent.wash : 'transparent',
                      boxShadow: i === chosen ? `inset 0 0 0 1px ${accent.washLine}` : 'none'
                    }}
                  >
                    <span style={{ display: 'flex', color: i === chosen ? accent.bright : ink.muted }}>
                      <Icon name={t.icon} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ font: type.body, color: ink.primary }}>{e.label}</span>
                      <span style={{ font: type.meta, color: ink.muted }}>
                        {t.name === e.section ? t.name : `${t.name} / ${e.section}`}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
