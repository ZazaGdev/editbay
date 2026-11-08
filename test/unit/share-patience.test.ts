import { describe, it, expect } from 'vitest'
import { silentShares, type ShareProbe } from '../../src/main/project/share-patience'

/**
 * A computer on the network that is switched off makes Windows wait about 21
 * seconds before saying so, and Editbay used to wait with it before showing a
 * window at all (audit 2026-11-07). Each is given a few seconds instead.
 */

const never: ShareProbe = () => new Promise(() => undefined)
const answers: ShareProbe = async () => undefined
const refuses: ShareProbe = async () => {
  throw Object.assign(new Error('no such share'), { code: 'ENOENT' })
}

describe('silentShares', () => {
  it('names a share whose computer does not answer within the patience, and only that one', async () => {
    const probe: ShareProbe = (share) => (share === '\\\\off.invalid\\video' ? never(share) : answers(share))
    const started = performance.now()
    expect(await silentShares(['\\\\nas.invalid\\video', '\\\\off.invalid\\video'], 50, probe)).toEqual(['\\\\off.invalid\\video'])
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('counts any answer, even that the share is not there, as an answer', async () => {
    expect(await silentShares(['\\\\nas.invalid\\gone'], 50, refuses)).toEqual([])
  })

  it('does not ask again about another share on a computer that did not answer', async () => {
    const asked: string[] = []
    const probe: ShareProbe = (share) => {
      asked.push(share)
      return never(share)
    }
    expect(await silentShares(['\\\\off.invalid\\video', '\\\\OFF.invalid\\audio'], 50, probe)).toEqual(['\\\\off.invalid\\video', '\\\\OFF.invalid\\audio'])
    expect(asked).toEqual(['\\\\off.invalid\\video'])
  })

  it('asks one computer at a time, so computers that are off cannot take every thread files are read with', async () => {
    let asking = 0
    let most = 0
    const probe: ShareProbe = async () => {
      asking++
      most = Math.max(most, asking)
      await new Promise((r) => setTimeout(r, 10))
      asking--
    }
    expect(await silentShares(['\\\\a.invalid\\s', '\\\\b.invalid\\s', '\\\\c.invalid\\s'], 1000, probe)).toEqual([])
    expect(most).toBe(1)
  })
})
