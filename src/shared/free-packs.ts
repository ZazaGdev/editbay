/**
 * Task 44: free asset packs Editbay suggests, for you to download yourself
 * into your assets folder. Each licence checked on
 * 2026-10-02: whether a video using them needs a credit in its description,
 * and the exact line when it does. Editbay never downloads them; the window
 * opens only these pages, in the browser.
 */

export interface FreePack {
  id: string
  name: string
  /** The page to download from. */
  url: string
  /** What is in it, in a few words. */
  contains: string
  /** How it comes: one download, or a file at a time. */
  download: string
  /** The line your video's description must carry, or null when no credit is needed. */
  credit: string | null
  /** Anything else worth knowing before using it. */
  note?: string
}

export const FREE_PACKS: readonly FreePack[] = [
  {
    id: 'kenney',
    name: 'Kenney audio packs',
    url: 'https://kenney.nl/assets/category:Audio',
    contains: 'Clicks, pops, dings, UI blips, impacts and jingles',
    download: 'One zip per pack, no account',
    credit: null
  },
  {
    id: 'oga-512',
    name: '512 Sound Effects (8-bit style)',
    url: 'https://opengameart.org/content/512-sound-effects-8-bit-style',
    contains: 'Retro game sounds: jumps, coins, power-ups, explosions, menu blips',
    download: 'One zip, 512 WAV files',
    credit: null
  },
  {
    id: 'oga-100',
    name: '100 CC0 SFX',
    url: 'https://opengameart.org/content/100-cc0-sfx',
    contains: 'Everyday sounds: bells, glass, door slams, splashes, plops, switches',
    download: 'One zip, 100 OGG files',
    credit: null
  },
  {
    id: 'sonniss',
    name: 'Sonniss GDC Game Audio Bundles',
    url: 'https://gdc.sonniss.com/',
    contains: 'Large professional bundles: ambience, impacts, foley, whooshes',
    download: 'A few large zips each year, no signup',
    credit: null,
    note: 'Mostly realistic, cinematic sound, and the files are large.'
  },
  {
    id: 'bigsoundbank',
    name: 'BigSoundBank',
    url: 'https://bigsoundbank.com/',
    contains: 'Over 3,500 real-world sound effects',
    download: 'A file at a time, or every result of a search',
    credit: null
  },
  {
    id: 'pixabay',
    name: 'Pixabay',
    url: 'https://pixabay.com/sound-effects/',
    contains: 'Sound effects, and green screen and overlay videos',
    download: 'A file at a time',
    credit: null,
    note: 'Uploaded by anyone: keep the page address of each file in case of a claim.'
  },
  {
    id: 'mixkit',
    name: 'Mixkit',
    url: 'https://mixkit.co/free-sound-effects/',
    contains: 'Whooshes, pops, cartoon and game sounds, and 365 green screen clips',
    download: 'A file at a time, no account',
    credit: null,
    note: 'Skip any video marked with the Restricted License: it is for personal use only.'
  },
  {
    id: 'zapsplat',
    name: 'ZapSplat (free account)',
    url: 'https://www.zapsplat.com/',
    contains: 'A large library: cartoon, whoosh and UI sounds',
    download: 'A file at a time, 3 every 10 minutes, account needed',
    credit: 'Sound effects obtained from https://www.zapsplat.com'
  },
  {
    id: 'freesound',
    name: 'Freesound (CC0 and CC BY sounds only)',
    url: 'https://freesound.org/',
    contains: 'Hundreds of thousands of sounds of every kind',
    download: 'A file at a time, account needed',
    credit: '"<sound name>" by <user> licensed under CC BY 4.0, for each CC BY sound',
    note: 'CC0 sounds need no credit. Leave out CC BY-NC sounds: they are for non-commercial use only.'
  }
]

/** The page of a suggested pack, by its id: nothing else is ever opened from the list. */
export function packUrl(id: string): string | null {
  return FREE_PACKS.find((p) => p.id === id)?.url ?? null
}
