export type PlaybackMode = 'overlay' | 'complete'
export type SourceFormat = 'json' | 'lrc-word' | 'lrc-line' | 'cdg' | 'baked-video' | 'audio-only' | 'auto-sync'
export type SyncQuality = 'excellent' | 'interpolated' | 'none'

export interface Song {
  id: string
  title: string
  artist: string
  playbackMode: PlaybackMode
  sourceFormat: SourceFormat
  syncQuality: SyncQuality
  /** null solo cuando sourceFormat = 'baked-video' (todo vive en el video). */
  audioUrl: string | null
  /** null si la canción no tiene letra propia (audio-only, cdg, baked-video). */
  lyricsUrl: string | null
  /** null salvo sourceFormat = 'baked-video'. */
  videoUrl: string | null
  /** null salvo que se haya sincronizado con la opción "separar voz" (Demucs)
   * activada — la pista instrumental que dejó ese paso, para apagar la voz
   * original y cantar sobre la base sola. */
  instrumentalUrl: string | null
  /** El operador escuchó la canción y confirmó que la letra va sincronizada.
   * Distinto de `syncQuality`, que es una expectativa según el origen de los
   * tiempos: esto es verificación humana. */
  syncVerified: boolean
}

/** 'queued' espera turno, 'playing' es la que está sonando ahora, 'done' ya
 * se cantó (con o sin puntaje todavía). */
export type QueueStatus = 'queued' | 'playing' | 'done'

export interface QueueItem {
  id: string
  singerId: string
  singer: string
  /** null si el cantante no cargó foto al registrarse. */
  singerPhotoUrl: string | null
  status: QueueStatus
  /** null hasta que el operador la puntúa (después de que termina). */
  score: number | null
  song: { id: string; title: string; artist: string }
}

export interface LeaderboardEntry {
  singerId: string
  singer: string
  singerPhotoUrl: string | null
  totalScore: number
  songsScored: number
}

/** Sesión de karaoke activa. Como mucho una a la vez — ver ROADMAP.md. */
export interface Session {
  id: string
  startedAt: number
}

export interface Singer {
  id: string
  name: string
  /** null si no cargó foto (es opcional al registrarse). */
  photoUrl: string | null
}

/** Pista de posición/ángulo/escala del "slot" de cara en un video-template
 * (ver pipeline/track_color.py y pipeline/track_face.py) — cx/cy/scale
 * normalizados contra width/height, angle en radianes. `visible: false`
 * indica un tramo sin detección; el consumidor sostiene el último valor
 * visible en esos huecos. */
export interface Template {
  id: string
  videoUrl: string
  transform: {
    fps: number
    width: number
    height: number
    frames: { t: number; cx: number | null; cy: number | null; angle: number | null; scale: number | null; visible: boolean }[]
  }
}

/** Lista curada de antemano, para empujar varias canciones a la cola de una vez. */
export interface Playlist {
  id: string
  name: string
  songCount: number
}

/** Una playlist con sus canciones resueltas, para la vista de detalle. */
export interface PlaylistDetail extends Playlist {
  songs: Song[]
}
