import { useLayoutEffect, useState } from 'react'

/** Measure an element, keeping up with window resizes. */
export function useBoxSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box) setSize({ width: box.width, height: box.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}
