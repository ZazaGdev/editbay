/**
 * The preview engine kept up with the monitor's props: what it plays, how, and where the playhead is.
 */

import { useEffect, useRef, type RefObject } from 'react'
import { HtmlVideoEngine } from '../../preview/htmlVideo'
import type { MonitorProps } from './monitor-props'

/** No lighter copies: the recordings themselves are played. */
const NO_COPIES: ReadonlyMap<string, string> = new Map()

export function useMonitorEngine(
  props: MonitorProps,
  stageRef: RefObject<HTMLDivElement | null>,
  engineRef: RefObject<HtmlVideoEngine | null>
): void {
  // One engine for the life of the monitor.
  useEffect(() => {
    const engine = new HtmlVideoEngine()
    engineRef.current = engine
    if (stageRef.current) engine.mount(stageRef.current)
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const offPosition = engine.onPosition(props.onPositionChange)
    const offEnded = engine.onEnded(props.onEnded)
    const offClock = props.onClock ? engine.onClock(props.onClock) : null
    return () => {
      offPosition()
      offEnded()
      offClock?.()
    }
  }, [props.onPositionChange, props.onEnded, props.onClock])

  useEffect(() => {
    engineRef.current?.setMuted(props.muted === true)
  }, [props.muted])

  useEffect(() => {
    engineRef.current?.setSolo(props.solo ?? [])
  }, [props.solo])

  useEffect(() => {
    engineRef.current?.setMonitorVolume(props.monitorVolume ?? 1)
  }, [props.monitorVolume])

  useEffect(() => {
    engineRef.current?.setProxies(props.proxies ?? NO_COPIES)
  }, [props.proxies])

  useEffect(() => {
    engineRef.current?.setVoice(props.voice ?? [])
  }, [props.voice])

  useEffect(() => {
    engineRef.current?.setWallClock(props.wallClock === true)
  }, [props.wallClock])

  // Before playing starts, so it starts at the right speed and the right way.
  useEffect(() => {
    engineRef.current?.setRate(props.rate ?? 1)
  }, [props.rate])
  useEffect(() => {
    engineRef.current?.setLoop(props.loop ?? null)
  }, [props.loop])

  // Effects run in the order they are written, and this one must come before the timeline's:
  // a switch of sequence stops playback and moves the playhead in the same
  // render, and the engine has to be paused before it is handed the new
  // timeline and asked to seek, or it stays at the old one's time.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (props.playing && !engine.isPlaying()) engine.play()
    if (!props.playing && engine.isPlaying()) engine.pause()
  }, [props.playing])

  useEffect(() => {
    engineRef.current?.setTimeline(props.timeline)
  }, [props.timeline])

  // Not on every step of the playhead: the engine lays its pictures out again
  // itself whenever what is under the playhead changes, and this laid every
  // one out on every frame (audit 2026-10-01).
  useEffect(() => {
    engineRef.current?.setFocus(props.selectedClipId)
  }, [props.selectedClipId, props.timeline])

  /**
   * Read rather than depended on: a drag turning on must not, on its own, send
   * the playhead anywhere. The move that follows it is what does that.
   */
  const scrubbing = useRef(false)
  scrubbing.current = props.scrubbing === true
  const wasScrubbing = useRef(false)

  // While playing, the engine owns the playhead; while stopped, it follows it.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || engine.isPlaying()) return
    if (scrubbing.current) engine.scrub(props.playhead)
    else engine.seek(props.playhead)
  }, [props.playhead, props.timeline])

  // Letting go stops the sound and parks everything back on the playhead.
  useEffect(() => {
    const on = props.scrubbing === true
    if (!on && wasScrubbing.current) engineRef.current?.endScrub()
    wasScrubbing.current = on
  }, [props.scrubbing])

  // After the seek above, so a skim held across a change of the sequence is
  // put back rather than left on whatever the playhead just moved to.
  useEffect(() => {
    engineRef.current?.showFrame(props.skim ?? null)
  }, [props.skim, props.playhead, props.timeline])
}
