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
  createdAt: integer('created_at').notNull(),
})

/** Config global tipo key-value (ej. backgroundVideoPath, nowPlayingId). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
