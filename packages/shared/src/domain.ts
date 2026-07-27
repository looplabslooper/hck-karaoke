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
}
