import { useEffect, useRef, useState } from 'react'
import type { LyricsDoc } from '@kiosco/shared'

interface Props {
  lyrics: LyricsDoc
  getPositionSeconds: () => number
  /** Se dispara solo cuando cambia la línea activa (no en cada rAF) — la usan
   * los overlays (flotante y pantalla completa) para mostrar el preview de
   * la próxima línea sin duplicar la lógica de timing acá. */
  onActiveLineChange?: (nextLineText: string | null) => void
}

// Un hueco se trata como "pausa real" (instrumental, intro larga, sin letra
// detectada) recién a partir de este umbral — evita que la barra de espera
// parpadee en los huecos naturales cortos entre líneas consecutivas.
const MIN_GAP_SECONDS = 1.2

export function LyricsView({ lyrics, getPositionSeconds, onActiveLineChange }: Props) {
  const [activeLineIndex, setActiveLineIndex] = useState(-1)
  const [waitingForNext, setWaitingForNext] = useState(false)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const waitFillRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)
  const lastReportedRef = useRef<number>(-2)

  useEffect(() => {
    const tick = () => {
      const pos = getPositionSeconds()
      const idx = lyrics.lines.findIndex((l) => pos >= l.start && pos < l.end)

      setActiveLineIndex((prev) => (prev !== idx ? idx : prev))

      if (idx !== lastReportedRef.current) {
        lastReportedRef.current = idx
        const nextLine = lyrics.lines[idx + 1]
        onActiveLineChange?.(nextLine ? nextLine.words.map((w) => w.t).join(' ') : null)
      }

      const line = idx >= 0 ? lyrics.lines[idx] : null
      if (line) {
        setWaitingForNext(false)
        line.words.forEach((w, i) => {
          const el = wordRefs.current[i]
          if (!el) return
          const p =
            pos <= w.start ? 0 : pos >= w.end ? 100 : ((pos - w.start) / (w.end - w.start)) * 100
          el.style.setProperty('--p', `${p}%`)
        })
      } else {
        // Sin línea activa: si falta bastante para la próxima, es un hueco
        // real (instrumental/intro) y mostramos "esperá, todavía no cantás".
        const nextIdx = lyrics.lines.findIndex((l) => l.start > pos)
        const gapEnd = nextIdx >= 0 ? lyrics.lines[nextIdx].start : null
        const gapStart = nextIdx > 0 ? lyrics.lines[nextIdx - 1].end : 0
        const isRealGap = gapEnd !== null && gapEnd - gapStart > MIN_GAP_SECONDS

        setWaitingForNext((prev) => (prev !== isRealGap ? isRealGap : prev))

        if (isRealGap && gapEnd !== null && waitFillRef.current) {
          const p = (Math.min(Math.max((pos - gapStart) / (gapEnd - gapStart), 0), 1) * 100).toFixed(2)
          waitFillRef.current.style.setProperty('--wait-p', `${p}%`)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [lyrics, getPositionSeconds, onActiveLineChange])

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
      ) : waitingForNext ? (
        <div className="waiting">
          <p className="waiting-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </p>
          <div className="wait-progress" ref={waitFillRef}>
            <div className="wait-progress-fill" />
          </div>
        </div>
      ) : (
        <p className="line line--waiting">♪</p>
      )}
    </div>
  )
}
