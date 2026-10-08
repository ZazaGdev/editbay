import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: (): string => '' } }))
const { proxyArgs, proxySize } = await import('../../src/main/media/proxy')

/** Plan 67: the lighter copy's size and how it is made. */
describe('a lighter copy', () => {
  it('is 540 on its shorter side, even on both, and none for a recording no bigger', () => {
    expect(proxySize(1920, 1080)).toEqual({ w: 960, h: 540 })
    expect(proxySize(1080, 1920)).toEqual({ w: 540, h: 960 })
    expect(proxySize(3840, 1080)).toEqual({ w: 1920, h: 540 })
    expect(proxySize(2560, 1440)).toEqual({ w: 960, h: 540 })
    expect(proxySize(1000, 562)).toEqual({ w: 960, h: 540 })
    expect(proxySize(960, 540)).toBeNull()
    expect(proxySize(640, 360)).toBeNull()
  })

  it("keeps the recording's times and copies its sound as it is, so the preview stays in sync", () => {
    const args = proxyArgs('in.mp4', 'out.mp4', { w: 960, h: 540 })
    expect(args.indexOf('-copyts')).toBeLessThan(args.indexOf('-i'))
    expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2)).toEqual(['-c:a', 'copy'])
    expect(args).toContain('scale=960:540:flags=bilinear,format=yuv420p')
    // A keyframe twice a second or so, for quick seeks.
    expect(args.slice(args.indexOf('-g'), args.indexOf('-g') + 2)).toEqual(['-g', '15'])
    expect(args.at(-1)).toBe('out.mp4')
  })
})
