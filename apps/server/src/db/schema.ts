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
  /**
   * 0/1 puesto a mano por el operador: "escuché esta canción y la letra va
   * sincronizada". `syncQuality` dice qué *tan bueno se espera* que sea el
   * origen de los tiempos; esto dice que alguien lo confirmó de verdad.
   * Sirve para curar un pack chico contra el cual probar cambios de
   * sincronía antes de replicarlos al catálogo entero.
   */
  syncVerified: integer('sync_verified').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

/** Config global tipo key-value (ej. backgroundVideoPath, nowPlayingId). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * Sesión de karaoke: como mucho una activa a la vez. No guarda historial —
 * al terminarla se borra la fila entera (junto con singers/queue_items, ver
 * queries.ts endSession) en vez de marcarla con un endedAt. Es deliberadamente
 * efímera: cada evento arranca de cero.
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  startedAt: integer('started_at').notNull(),
})

/**
 * Cantante registrado dentro de una sesión, con foto opcional. Reemplaza el
 * string suelto que vivía en queue_items.singer — ahora la cola referencia
 * un singerId, lo que permite reusar el mismo cantante en varias canciones
 * sin re-tipear el nombre ni re-sacar la foto.
 */
export const singers = sqliteTable('singers', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  name: text('name').notNull(),
  photoPath: text('photo_path'), // relativo a library/_sessions/<sessionId>/, null = sin foto
  createdAt: integer('created_at').notNull(),
})

/**
 * Cola en vivo: quién canta qué, en qué orden, y con qué puntaje quedó una
 * vez cantada. `position` solo ordena los `status='queued'` (arrastrar/subir/
 * bajar); una vez que pasa a 'playing'/'done' ya no se reordena.
 */
export const queueItems = sqliteTable('queue_items', {
  id: text('id').primaryKey(),
  songId: text('song_id').notNull(),
  singerId: text('singer_id').notNull(),
  status: text('status').notNull(), // 'queued' | 'playing' | 'done'
  score: integer('score'), // null hasta puntuarla; 1-10
  position: integer('position').notNull(),
  createdAt: integer('created_at').notNull(),
})

/**
 * Listas curadas de antemano ("Arranque tranqui", "Éxitos 2000s") para no
 * tener que buscar canción por canción en el momento. Se pueden empujar
 * enteras a la cola en vivo.
 */
export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** Tabla puente playlist↔canción. `position` define el orden dentro de la lista. */
export const playlistSongs = sqliteTable('playlist_songs', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull(),
  songId: text('song_id').notNull(),
  position: integer('position').notNull(),
})
