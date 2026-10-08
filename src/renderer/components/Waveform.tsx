import { useEffect, useRef, useState, type JSX } from 'react'
import { peaksForRange, waveHeight, waveTiles } from '../../shared/peaks'
import type { PeaksData } from '../../shared/types'

/**
 * How wide one tile of a waveform is, in CSS pixels. Even at three device
 * pixels to one that is a canvas far under the size a canvas may be.
 */
const TILE_WIDTH = 2048

/**
 * A waveform, drawn in tiles. A clip at the closest zoom can be hundreds of
 * thousands of pixels wide, past the size one canvas may be, so it is cut
 * into tiles and only the tiles on screen are drawn: the work, and the
 * memory, follow what is visible rather than how long the clip is.
 */
export function Waveform(props: {
  data: PeaksData | undefined
  startSec: number
  endSec: number
  width: number
  height: number
  color: string
}): JSX.Element {
  const span = props.endSec - props.startSec
  return (
    <div style={{ position: 'relative', width: props.width, height: props.height }}>
      {waveTiles(props.width, TILE_WIDTH).map((t) => (
        <WaveTile
          key={t.left}
          data={props.data}
          left={t.left}
          width={t.width}
          height={props.height}
          startSec={props.startSec + (span * t.left) / props.width}
          endSec={props.startSec + (span * (t.left + t.width)) / props.width}
          color={props.color}
        />
      ))}
    </div>
  )
}

function WaveTile(props: {
  data: PeaksData | undefined
  left: number
  width: number
  height: number
  startSec: number
  endSec: number
  color: string
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  // Without an observer to ask, every tile counts as on screen.
  const [onScreen, setOnScreen] = useState(typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || typeof IntersectionObserver === 'undefined') return
    // Against the window, which also clips to the timeline's scrolled view.
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      if (last) setOnScreen(last.isIntersecting)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (!onScreen) {
      // Off screen a tile holds no pixels, so a long clip costs only what shows.
      canvas.width = 0
      canvas.height = 0
      return
    }
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(props.width * dpr))
    canvas.height = Math.max(1, Math.round(props.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, props.width, props.height)
    if (!props.data) return

    const columns = peaksForRange(
      props.data.peaks,
      props.data.peaksPerSecond,
      props.startSec,
      props.endSec,
      Math.max(1, Math.round(props.width))
    )

    const mid = props.height / 2
    ctx.fillStyle = props.color
    // On a decibel scale: quiet material is still a wave rather than a line.
    columns.forEach((col, x) => {
      const top = mid - waveHeight(col.max) * mid
      const bottom = mid + waveHeight(col.min) * mid
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
    })
  }, [onScreen, props.data, props.startSec, props.endSec, props.width, props.height, props.color])

  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', left: props.left, top: 0, width: props.width, height: props.height, display: 'block' }}
    />
  )
}
