import { useEffect, useRef, useState } from 'react'
import type { LyricsDoc } from '@kiosco/shared'

interface Props {
  lyrics: LyricsDoc
  getPositionSeconds: () => number
}

/**
 * Barrido de karaoke vía CSS (background-clip: text) sobre una custom
 * property `--p` actualizada por rAF, en vez de Canvas — ver DECISIONES-STACK.md §8.
 * Solo la línea activa se re-renderiza con React (cambia pocas veces por canción);
 * el avance palabra por palabra dentro de la línea muta el DOM directo cada frame.
 */
export function LyricsView({ lyrics, getPositionSeconds }: Props) {
  const [activeLineIndex, setActiveLineIndex] = useState(-1)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rafRef = useRef(0)

  useEffect(() => {
    const tick = () => {
      const pos = getPositionSeconds()
      const idx = lyrics.lines.findIndex((l) => pos >= l.start && pos < l.end)

      setActiveLineIndex((prev) => (prev !== idx ? idx : prev))

      const line = idx >= 0 ? lyrics.lines[idx] : null
      if (line) {
        line.words.forEach((w, i) => {
          const el = wordRefs.current[i]
          if (!el) return
          const p =
            pos <= w.start ? 0 : pos >= w.end ? 100 : ((pos - w.start) / (w.end - w.start)) * 100
          el.style.setProperty('--p', `${p}%`)
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [lyrics, getPositionSeconds])

  const line = activeLineIndex >= 0 ? lyrics.lines[activeLineIndex] : null

  return (
    <div className="lyrics">
      {line ? (
        <p className="line">
          {line.words.map((w, i) => (
            <span
              key={i}
              ref={(el) => {
                wordRefs.current[i] = el
              }}
              className="word"
              style={{ '--p': '0%' } as React.CSSProperties}
            >
              {w.t}{' '}
            </span>
          ))}
        </p>
      ) : (
        <p className="line line--waiting">♪</p>
      )}
    </div>
  )
}
