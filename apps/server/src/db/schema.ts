import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * playbackMode/sourceFormat/syncQuality son texto libre (SQLite no tiene enum),
 * validados en la capa de aplicación contra los tipos en @kiosco/shared.
 */
export const songs = sqliteTable('songs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  playbackMode: text('playback_mode').notNull(), // 'overlay' | 'complete'
  sourceFormat: text('source_format').notNull(), // 'json' | 'lrc-word' | 'lrc-line' | 'cdg' | 'baked-video' | 'audio-only'
  syncQuality: text('sync_quality').notNull(), // 'excellent' | 'interpolated' | 'none'
  audioPath: text('audio_path'), // relativo a library/; null solo si playbackMode='complete' y sourceFormat='baked-video'
  lyricsPath: text('lyrics_path'),
  videoPath: text('video_path'), // solo playbackMode = 'complete' con sourceFormat = 'baked-video'
  instrumentalPath: text('instrumental_path'), // solo si se sincronizó con Demucs (separar voz) — "modo karaoke real"
  createdAt: integer('created_at').notNull(),
})

/** Config global tipo key-value (ej. backgroundVideoPath, nowPlayingId). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * Cola en vivo: quién canta qué, en qué orden, y con qué puntaje quedó una
 * vez cantada. `position` solo ordena los `status='queued'` (arrastrar/subir/
 * bajar); una vez que pasa a 'playing'/'done' ya no se reordena.
 */
export const queueItems = sqliteTable('queue_items', {
  id: text('id').primaryKey(),
  songId: text('song_id').notNull(),
  singer: text('singer').notNull(),
  status: text('status').notNull(), // 'queued' | 'playing' | 'done'
  score: integer('score'), // null hasta puntuarla; 1-10
  position: integer('position').notNull(),
  createdAt: integer('created_at').notNull(),
})
