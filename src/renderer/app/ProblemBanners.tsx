/**
 * What stops the window working as it should, said across the top: ffmpeg
 * that cannot be used, and source files that cannot be found.
 */

import type { JSX } from 'react'
import { danger } from '../theme'
import { Button } from '../ui/Button'
import { banner } from './styles'
import type { AppState } from './app-state'
import { HelpTip } from '../ui/HelpTip'

export function ProblemBanners({ app }: { app: AppState }): JSX.Element {
  const { ffmpeg, missingMedia, proj, project } = app
  return (
    <>
      {!ffmpeg.ok && (
        <div
          data-testid="ffmpeg-banner"
          style={{ ...banner, background: danger.fill, borderBottom: `1px solid ${danger.line}`, color: danger.ink }}
        >
          ffmpeg cannot be used, so nothing can be imported or exported: {ffmpeg.message}
        </div>
      )}

      {missingMedia.length > 0 && (
        <div
          data-testid="missing-media"
          style={{ ...banner, background: danger.fill, borderBottom: `1px solid ${danger.line}`, color: danger.ink }}
        >
          <span>
            {missingMedia.length === 1
              ? '1 source file could not be found.'
              : `${missingMedia.length} source files could not be found.`}
          </span>
          <HelpTip testid="missing-media-help" text="Finding one looks for the others in the same folder." tutorial="065-missing-files" />
          {missingMedia.map((id) => (
            <Button
              key={id}
              testid="relink"
              data={{ 'data-media-id': id }}
              size="small"
              icon="open"
              onClick={() => proj.relink(id)}
            >
              Find {project?.media.find((m) => m.id === id)?.originalPath.split(/[\\/]/).pop()}
            </Button>
          ))}
        </div>
      )}
    </>
  )
}
