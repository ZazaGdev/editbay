import {
  AlertCircle,
  RectangleHorizontal,
  ArrowDownToLine,
  ArrowUpDown,
  CircleHelp,
  AudioLines,
  Check,
  Shapes,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clapperboard,
  Copy,
  Paintbrush,
  Palette,
  PictureInPicture2,
  Sparkles,
  ZoomIn,
  Eye,
  EyeOff,
  Film,
  FolderOpen,
  Grid3x3,
  Info,
  Keyboard,
  Link2,
  Link2Off,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  Mic,
  Monitor,
  Minus,
  MoreVertical,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  Rows3,
  Save,
  Scissors,
  Search,
  Settings,
  LayoutGrid,
  List,
  LayoutList,
  SkipBack,
  SkipForward,
  Square,
  Smartphone,
  StepBack,
  StepForward,
  ScanFace,
  Trash2,
  Type,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
  type LucideIcon
} from 'lucide-react'
import type { JSX } from 'react'
import { radius } from '../theme'

/**
 * Every icon the window uses, chosen once, under the app's own names. Nothing
 * else in the renderer imports `lucide-react`, so swapping the set, or drawing
 * them by hand instead, is a change to this file alone.
 */
const icons = {
  play: Play,
  pause: Pause,
  toStart: SkipBack,
  toEnd: SkipForward,
  frameBack: StepBack,
  frameOn: StepForward,
  record: Circle,
  stopRecording: Square,
  loop: Repeat,
  volume: Volume2,
  muted: VolumeX,
  microphone: Mic,
  sound: AudioLines,
  music: Music,

  undo: Undo2,
  redo: Redo2,
  search: Search,
  export: Upload,
  save: Save,
  open: FolderOpen,
  download: ArrowDownToLine,
  shortcuts: Keyboard,

  add: Plus,
  remove: Minus,
  close: X,
  more: MoreVertical,
  copy: Copy,
  paint: Paintbrush,
  discard: Trash2,

  down: ChevronDown,
  up: ChevronUp,
  left: ChevronLeft,
  right: ChevronRight,

  split: Scissors,
  snap: Magnet,
  fullScreen: Maximize2,
  guides: Grid3x3,
  hidden: EyeOff,
  shown: Eye,
  locked: Lock,
  unlocked: LockOpen,
  linked: Link2,
  unlinked: Link2Off,

  picture: Film,
  text: Type,
  blackScreen: RectangleHorizontal,
  sequence: Clapperboard,
  vertical: Smartphone,

  warning: AlertCircle,
  note: Info,
  tutorials: BookOpen,
  settings: Settings,
  timeline: Rows3,
  monitor: Monitor,
  viewCards: LayoutList,
  viewList: List,
  viewGrid: LayoutGrid,
  // What has been done to a clip, on its name strip.
  zoomed: ZoomIn,
  look: Palette,
  framing: PictureInPicture2,
  effects: Sparkles,
  check: Check,
  shape: Shapes,
  sort: ArrowUpDown,
  help: CircleHelp,
  face: ScanFace
} as const

export type IconName = keyof typeof icons

/** The default, matching `type.body`'s line, and the stroke the set is drawn at. */
const SIZE = 15
const STROKE = 1.8

/**
 * An icon, at the app's size and stroke unless told otherwise. It takes the
 * colour of the text around it, so it belongs to whatever it sits in.
 */
export function Icon(props: { name: IconName; size?: number; strokeWidth?: number }): JSX.Element {
  const Drawn: LucideIcon = icons[props.name]
  return (
    <Drawn
      size={props.size ?? SIZE}
      strokeWidth={props.strokeWidth ?? STROKE}
      color="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    />
  )
}

/** The record dot, which is filled rather than drawn, and is always the stop colour. */
export function RecordDot(props: { size?: number }): JSX.Element {
  const size = props.size ?? 11
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: size,
        height: size,
        borderRadius: radius.round,
        background: 'var(--meaning-stop)',
        flexShrink: 0
      }}
    />
  )
}
