import type { LyricsDoc, LyricLine, LyricWord } from './lyrics.js'

const LINE_TAG = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/
const HAS_WORD_TAG = /<\d+:\d+(?:\.\d+)?>/

function tagToSeconds(min: string, sec: string): number {
  return Number(min) * 60 + Number(sec)
}

export interface ParsedLrc {
  wordLevel: boolean
  lines: { start: number; text: string }[]
}

/**
 * Parseo crudo de un .lrc: separa metadata ([ar:], [ti:], etc.) y líneas sin
 * timestamp reconocible, y detecta si trae tags <mm:ss.xx> por palabra
 * (LRC "enhanced"/word-level) o es solo un timestamp por línea.
 */
export function parseLrc(raw: string): ParsedLrc {
  const rawLines = raw.split(/\r?\n/)
  const lines: { start: number; text: string }[] = []
  let wordLevel = false

  for (const rawLine of rawLines) {
    const match = LINE_TAG.exec(rawLine.trim())
    if (!match) continue
    const [, min, sec, rest] = match
    if (HAS_WORD_TAG.test(rest)) wordLevel = true
    lines.push({ start: tagToSeconds(min, sec), text: rest })
  }
  return { wordLevel, lines }
}

/**
 * LRC de línea (un timestamp por línea): reparte el tiempo entre palabras
 * proporcional a su longitud en caracteres — DECISIONES-STACK.md §12(A).
 */
export function lineLrcToLyricsDoc(parsed: ParsedLrc, audioDurationSeconds?: number): LyricsDoc {
  const lines: LyricLine[] = parsed.lines.map((line, i) => {
    const next = parsed.lines[i + 1]
    const end = next ? next.start : (audioDurationSeconds ?? line.start + 6)
    const duration = Math.max(end - line.start, 0)

    const wordsText = line.text.trim().split(/\s+/).filter(Boolean)
    const totalChars = wordsText.reduce((sum, w) => sum + w.length, 0) || 1

    let cursor = line.start
    const words: LyricWord[] = wordsText.map((t) => {
      const start = cursor
      const end = start + (t.length / totalChars) * duration
      cursor = end
      return { t, start, end }
    })
    return { start: line.start, end, words }
  })
  return { lines }
}

/**
 * LRC "enhanced"/word-level: cada <mm:ss.xx> dentro de la línea es el inicio
 * real de la palabra siguiente. Sin interpolar — son los tiempos que trae el archivo.
 */
export function wordLrcToLyricsDoc(parsed: ParsedLrc, audioDurationSeconds?: number): LyricsDoc {
  const tagRegex = /<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g

  const lines: LyricLine[] = parsed.lines.map((line, i) => {
    const next = parsed.lines[i + 1]
    const lineEnd = next ? next.start : (audioDurationSeconds ?? line.start + 6)

    const matches: { time: number; text: string }[] = []
    let m: RegExpExecArray | null
    tagRegex.lastIndex = 0
    while ((m = tagRegex.exec(line.text))) {
      matches.push({ time: tagToSeconds(m[1], m[2]), text: m[3].trim() })
    }

    const words: LyricWord[] = matches
      .map((word, idx) => ({
        t: word.text,
        start: word.time,
        end: matches[idx + 1] ? matches[idx + 1].time : lineEnd,
      }))
      .filter((w) => w.t.length > 0)

    return { start: line.start, end: lineEnd, words }
  })
  return { lines }
}
