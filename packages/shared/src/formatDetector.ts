import { parseLrc, lineLrcToLyricsDoc, wordLrcToLyricsDoc } from './lrc.js'
import type { LyricsDoc } from './lyrics.js'
import type { PlaybackMode, SourceFormat, SyncQuality } from './domain.js'

export interface DetectedFormat {
  ok: true
  playbackMode: PlaybackMode
  sourceFormat: SourceFormat
  syncQuality: SyncQuality
  message: string
  lyrics: LyricsDoc | null
}

export interface DetectionRejected {
  ok: false
  reason: string
}

export interface UploadInput {
  audioFilename: string | null
  lyricsFilename: string | null
  /** Contenido de texto del archivo de letra (.lrc o .json), si hay. */
  lyricsText: string | null
  /** Si se subió un único archivo de video (karaoke con letra ya quemada). */
  videoFilename: string | null
  /** Opcional: si ya se conoce la duración real del audio, mejora el fallback de la última línea. */
  audioDurationSeconds?: number
}

const AUDIO_EXT = /\.(mp3|ogg|opus|wav)$/i
const VIDEO_EXT = /\.(mp4|webm|mov)$/i

/**
 * Detecta el formato de un karaoke subido y evalúa qué tan bien queda en el
 * sistema — ver DECISIONES-STACK.md y el plan de "biblioteca + upload".
 * Función pura: no toca disco ni red, recibe el contenido ya leído.
 */
export function detectFormat(input: UploadInput): DetectedFormat | DetectionRejected {
  if (input.videoFilename && !input.audioFilename) {
    if (!VIDEO_EXT.test(input.videoFilename)) {
      return { ok: false, reason: `Extensión de video no reconocida: ${input.videoFilename}` }
    }
    return {
      ok: true,
      playbackMode: 'complete',
      sourceFormat: 'baked-video',
      syncQuality: 'none',
      message: 'Video con letra incrustada: se reproduce tal cual, sin fondo elegible ni letra propia.',
      lyrics: null,
    }
  }

  if (!input.audioFilename || !AUDIO_EXT.test(input.audioFilename)) {
    return { ok: false, reason: 'No se reconoce un archivo de audio válido (mp3/ogg/opus/wav).' }
  }

  if (!input.lyricsFilename) {
    return {
      ok: true,
      playbackMode: 'overlay',
      sourceFormat: 'audio-only',
      syncQuality: 'none',
      message: 'Solo audio, sin letra: se puede reproducir pero queda marcada como incompleta.',
      lyrics: null,
    }
  }

  const lyricsFilenameLower = input.lyricsFilename.toLowerCase()

  if (lyricsFilenameLower.endsWith('.cdg')) {
    return {
      ok: true,
      playbackMode: 'complete',
      sourceFormat: 'cdg',
      syncQuality: 'none',
      message: 'CD+G: se reproduce con su propia animación de letra, sin fondo elegible.',
      lyrics: null,
    }
  }

  if (lyricsFilenameLower.endsWith('.json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.lyricsText ?? '')
    } catch {
      return { ok: false, reason: 'El .json no es JSON válido.' }
    }
    if (!isLyricsDoc(parsed)) {
      return { ok: false, reason: 'El .json no tiene el formato de letra esperado (lines[].words[]).' }
    }
    return {
      ok: true,
      playbackMode: 'overlay',
      sourceFormat: 'json',
      syncQuality: 'excellent',
      message: 'Letra propia (JSON) con timestamps por palabra.',
      lyrics: parsed,
    }
  }

  if (lyricsFilenameLower.endsWith('.lrc')) {
    const parsed = parseLrc(input.lyricsText ?? '')
    if (parsed.lines.length === 0) {
      return { ok: false, reason: 'El .lrc no tiene ninguna línea con timestamp reconocible.' }
    }
    if (parsed.wordLevel) {
      return {
        ok: true,
        playbackMode: 'overlay',
        sourceFormat: 'lrc-word',
        syncQuality: 'excellent',
        message: 'LRC word-level: timestamps reales por palabra.',
        lyrics: wordLrcToLyricsDoc(parsed, input.audioDurationSeconds),
      }
    }
    return {
      ok: true,
      playbackMode: 'overlay',
      sourceFormat: 'lrc-line',
      syncQuality: 'interpolated',
      message: 'LRC de línea: el tiempo de cada palabra se interpola dentro de su línea.',
      lyrics: lineLrcToLyricsDoc(parsed, input.audioDurationSeconds),
    }
  }

  return { ok: false, reason: `Formato de letra no reconocido: ${input.lyricsFilename}` }
}

function isLyricsDoc(x: unknown): x is LyricsDoc {
  return typeof x === 'object' && x !== null && Array.isArray((x as LyricsDoc).lines)
}
