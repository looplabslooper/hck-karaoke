import { eq } from 'drizzle-orm'
import type { Song, PlaybackMode, SourceFormat, SyncQuality } from '@kiosco/shared'
import { db } from './client.js'
import { songs, settings } from './schema.js'

function toWireSong(row: typeof songs.$inferSelect): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    playbackMode: row.playbackMode as PlaybackMode,
    sourceFormat: row.sourceFormat as SourceFormat,
    syncQuality: row.syncQuality as SyncQuality,
    audioUrl: row.audioPath ? `/library/${row.audioPath}` : null,
    lyricsUrl: row.lyricsPath ? `/library/${row.lyricsPath}` : null,
    videoUrl: row.videoPath ? `/library/${row.videoPath}` : null,
  }
}

export function listSongs(): Song[] {
  return db.select().from(songs).all().map(toWireSong)
}

export function getNowPlaying(): Song | null {
  const setting = db.select().from(settings).where(eq(settings.key, 'nowPlayingId')).get()
  if (!setting) return null
  const row = db.select().from(songs).where(eq(songs.id, setting.value)).get()
  return row ? toWireSong(row) : null
}

/** @returns false si el id no existe en el catálogo. */
export function setNowPlaying(songId: string): boolean {
  const row = db.select().from(songs).where(eq(songs.id, songId)).get()
  if (!row) return false
  db.insert(settings)
    .values({ key: 'nowPlayingId', value: songId })
    .onConflictDoUpdate({ target: settings.key, set: { value: songId } })
    .run()
  return true
}

export interface NewSong {
  id: string
  title: string
  artist: string
  playbackMode: PlaybackMode
  sourceFormat: SourceFormat
  syncQuality: SyncQuality
  audioPath: string | null
  lyricsPath: string | null
  videoPath: string | null
}

export function createSong(song: NewSong): Song {
  db.insert(songs)
    .values({ ...song, createdAt: Date.now() })
    .run()
  return toWireSong({ ...song, createdAt: Date.now() })
}

export function getBackgroundVideoUrl(): string | null {
  const row = db.select().from(settings).where(eq(settings.key, 'backgroundVideoPath')).get()
  return row ? `/library/${row.value}` : null
}

export function setBackgroundVideo(relativePath: string): void {
  db.insert(settings)
    .values({ key: 'backgroundVideoPath', value: relativePath })
    .onConflictDoUpdate({ target: settings.key, set: { value: relativePath } })
    .run()
}
