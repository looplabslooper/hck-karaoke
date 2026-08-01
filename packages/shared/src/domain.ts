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
}

/** 'queued' espera turno, 'playing' es la que está sonando ahora, 'done' ya
 * se cantó (con o sin puntaje todavía). */
export type QueueStatus = 'queued' | 'playing' | 'done'

export interface QueueItem {
  id: string
  singer: string
  status: QueueStatus
  /** null hasta que el operador la puntúa (después de que termina). */
  score: number | null
  song: { id: string; title: string; artist: string }
}

export interface LeaderboardEntry {
  singer: string
  totalScore: number
  songsScored: number
}
