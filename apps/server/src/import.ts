import fs from 'node:fs'
import path from 'node:path'
import { detectFormat, AUDIO_EXT, VIDEO_EXT, LYRICS_EXT } from '@kiosco/shared'
import type { DetectedFormat, DetectionRejected } from '@kiosco/shared'

export interface ImportCandidate {
  /** Identifica el candidato dentro de un mismo escaneo (carpeta+nombre-base) — se usa para elegir qué importar. */
  key: string
  title: string
  artist: string
  audioPath: string | null
  lyricsPath: string | null
  videoPath: string | null
  detection: DetectedFormat | DetectionRejected
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
}

function stripExt(filename: string): string {
  return filename.slice(0, filename.length - path.extname(filename).length)
}

/** "Artista - Titulo.mp3" es la convención más común en catálogos de karaoke
 * descargados sueltos — si no matchea, mejor dejar el nombre entero como
 * título que adivinar mal. */
function titleArtistFromFilename(base: string): { title: string; artist: string } {
  for (const sep of [' - ', ' – ']) {
    const idx = base.indexOf(sep)
    if (idx > 0) {
      return { artist: base.slice(0, idx).trim(), title: base.slice(idx + sep.length).trim() }
    }
  }
  return { title: base.trim(), artist: 'Desconocido' }
}

/**
 * Escanea carpetas externas buscando karaokes ya armados (audio + letra
 * opcional, o video con letra quemada) sin copiar nada a disco todavía —
 * eso lo hace runImport contra los candidatos que el operador confirme.
 * Agrupa archivos por carpeta+nombre-base para que "Cancion.mp3" +
 * "Cancion.lrc" se reconozcan como un solo karaoke.
 */
export function scanFolders(rootPaths: string[], alreadyImported: Set<string>): ImportCandidate[] {
  const files: string[] = []
  for (const root of rootPaths) {
    if (fs.existsSync(root)) walk(root, files)
  }

  const groups = new Map<string, { dir: string; base: string; audio?: string; lyrics?: string; video?: string }>()
  for (const file of files) {
    const dir = path.dirname(file)
    const filename = path.basename(file)
    const base = stripExt(filename)
    const key = `${dir}::${base}`
    if (!groups.has(key)) groups.set(key, { dir, base })
    const group = groups.get(key)!
    if (AUDIO_EXT.test(filename)) group.audio = file
    else if (VIDEO_EXT.test(filename)) group.video = file
    else if (LYRICS_EXT.test(filename)) group.lyrics = file
  }

  const candidates: ImportCandidate[] = []
  for (const group of groups.values()) {
    if (!group.audio && !group.video) continue
    const mediaPath = group.audio ?? group.video!
    if (alreadyImported.has(mediaPath)) continue

    const isTextLyrics = group.lyrics && /\.(lrc|json)$/i.test(group.lyrics)
    let lyricsText: string | null = null
    if (isTextLyrics) {
      try {
        lyricsText = fs.readFileSync(group.lyrics!, 'utf-8')
      } catch {
        lyricsText = null
      }
    }

    const detection = detectFormat({
      audioFilename: group.audio ? path.basename(group.audio) : null,
      lyricsFilename: group.lyrics ? path.basename(group.lyrics) : null,
      lyricsText,
      videoFilename: group.video ? path.basename(group.video) : null,
    })

    const { title, artist } = titleArtistFromFilename(group.base)

    candidates.push({
      key: `${group.dir}/${group.base}`,
      title,
      artist,
      audioPath: group.audio ?? null,
      lyricsPath: group.lyrics ?? null,
      videoPath: group.video ?? null,
      detection,
    })
  }

  return candidates
}
