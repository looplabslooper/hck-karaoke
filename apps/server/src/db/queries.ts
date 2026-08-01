import crypto from 'node:crypto'
import { eq, and, asc, desc, sql } from 'drizzle-orm'
import type {
  Song,
  PlaybackMode,
  SourceFormat,
  SyncQuality,
  QueueItem,
  QueueStatus,
  LeaderboardEntry,
} from '@kiosco/shared'
import { db } from './client.js'
import { songs, settings, queueItems } from './schema.js'

/** Prefijo que distingue un path "importado en el lugar" (carpeta externa del
 * usuario, nunca copiado a library/) de uno normal relativo a library/. Ver
 * ROADMAP.md — importar carpetas enteras (potencialmente muchos GB) copiando
 * todo a library/ duplicaría el disco al pedo. */
export const EXTERNAL_PREFIX = 'external:'

function resolveMediaUrl(storedPath: string | null): string | null {
  if (!storedPath) return null
  if (storedPath.startsWith(EXTERNAL_PREFIX)) {
    const absPath = storedPath.slice(EXTERNAL_PREFIX.length)
    return `/api/external-file?path=${encodeURIComponent(absPath)}`
  }
  return `/library/${storedPath}`
}

function toWireSong(row: typeof songs.$inferSelect): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    playbackMode: row.playbackMode as PlaybackMode,
    sourceFormat: row.sourceFormat as SourceFormat,
    syncQuality: row.syncQuality as SyncQuality,
    audioUrl: resolveMediaUrl(row.audioPath),
    lyricsUrl: resolveMediaUrl(row.lyricsPath),
    videoUrl: resolveMediaUrl(row.videoPath),
    // El instrumental siempre lo genera Demucs en library/ — nunca es externo.
    instrumentalUrl: row.instrumentalPath ? `/library/${row.instrumentalPath}` : null,
  }
}

export function listSongs(): Song[] {
  return db.select().from(songs).all().map(toWireSong)
}

export interface SongSearchParams {
  q?: string
  quality?: SyncQuality
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** Versión paginada/filtrada de listSongs para la biblioteca del admin — con
 * miles de canciones (ej. un catálogo legado importado), devolver todo de
 * una y filtrar/ordenar del lado del cliente tilda la UI (recalcula sobre
 * miles de filas en cada render, incluido el tick de posición cada 200ms).
 * Filtra y ordena en SQLite, nunca carga más de `limit` filas en memoria. */
export function searchSongs(params: SongSearchParams): { items: Song[]; total: number } {
  const { q, quality, sortDir = 'asc', limit = 60, offset = 0 } = params
  const conditions = []
  if (q && q.trim()) {
    const like = `%${q.trim()}%`
    conditions.push(sql`(${songs.title} LIKE ${like} OR ${songs.artist} LIKE ${like})`)
  }
  if (quality) conditions.push(eq(songs.syncQuality, quality))
  const whereClause = conditions.length ? and(...conditions) : sql`1=1`
  const orderExpr =
    sortDir === 'desc' ? desc(sql`${songs.title} COLLATE NOCASE`) : asc(sql`${songs.title} COLLATE NOCASE`)

  const rows = db.select().from(songs).where(whereClause).orderBy(orderExpr).limit(limit).offset(offset).all()
  const total = db.select({ count: sql<number>`count(*)` }).from(songs).where(whereClause).get()?.count ?? 0

  return { items: rows.map(toWireSong), total }
}

export function getSongById(id: string): Song | null {
  const row = db.select().from(songs).where(eq(songs.id, id)).get()
  return row ? toWireSong(row) : null
}

/** Borra la canción y cualquier lugar de la cola que la mencionara (pasada
 * o pendiente) — no tiene sentido dejar entradas de cola apuntando a un
 * songId que ya no existe. No toca los archivos en disco, eso lo hace el
 * caller (acá solo vive la parte de DB). */
export function deleteSong(id: string): boolean {
  db.delete(queueItems).where(eq(queueItems.songId, id)).run()
  const result = db.delete(songs).where(eq(songs.id, id)).run()
  return result.changes > 0
}

/** Re-sincronizar pisa el resultado de WhisperX de una canción ya cargada —
 * nunca cambia el audio, solo la letra/calidad/formato (y el instrumental,
 * si esta vez se pidió separar voz con Demucs). */
export function updateSongSync(
  id: string,
  patch: {
    lyricsPath: string
    sourceFormat: SourceFormat
    syncQuality: SyncQuality
    instrumentalPath?: string
  },
): boolean {
  const result = db.update(songs).set(patch).where(eq(songs.id, id)).run()
  return result.changes > 0
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
  instrumentalPath: string | null
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

// --- carpetas de importación (bibliotecas externas, sin copiar a library/) --

export function getImportRoots(): string[] {
  const row = db.select().from(settings).where(eq(settings.key, 'importRoots')).get()
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function setImportRoots(roots: string[]): void {
  const value = JSON.stringify(roots)
  db.insert(settings)
    .values({ key: 'importRoots', value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

/** Paths absolutos ya importados (prefijo 'external:' en audio/video) — para
 * que un segundo escaneo de las mismas carpetas no duplique canciones. */
export function listExternalPaths(): Set<string> {
  const rows = db.select({ audioPath: songs.audioPath, videoPath: songs.videoPath }).from(songs).all()
  const paths = new Set<string>()
  for (const row of rows) {
    for (const p of [row.audioPath, row.videoPath]) {
      if (p?.startsWith(EXTERNAL_PREFIX)) paths.add(p.slice(EXTERNAL_PREFIX.length))
    }
  }
  return paths
}

// --- cola en vivo ------------------------------------------------------

function toWireQueueItem(row: typeof queueItems.$inferSelect, song: Song): QueueItem {
  return {
    id: row.id,
    singer: row.singer,
    status: row.status as QueueStatus,
    score: row.score,
    song: { id: song.id, title: song.title, artist: song.artist },
  }
}

/** 'queued' + 'playing' — nunca 'done' (eso vive en listUnscored/leaderboard). */
export function listQueue(): QueueItem[] {
  const rows = db
    .select()
    .from(queueItems)
    .where(sql`${queueItems.status} != 'done'`)
    .orderBy(asc(queueItems.position))
    .all()
  const allSongs = new Map(listSongs().map((s) => [s.id, s]))
  const playing = rows.filter((r) => r.status === 'playing')
  const queued = rows.filter((r) => r.status === 'queued')
  return [...playing, ...queued]
    .map((row) => {
      const song = allSongs.get(row.songId)
      return song ? toWireQueueItem(row, song) : null
    })
    .filter((x): x is QueueItem => x !== null)
}

/** Ya cantadas, todavía sin puntaje — para que el operador las puntúe. */
export function listUnscored(): QueueItem[] {
  const rows = db
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.status, 'done'), sql`${queueItems.score} is null`))
    .orderBy(desc(queueItems.createdAt))
    .all()
  const allSongs = new Map(listSongs().map((s) => [s.id, s]))
  return rows
    .map((row) => {
      const song = allSongs.get(row.songId)
      return song ? toWireQueueItem(row, song) : null
    })
    .filter((x): x is QueueItem => x !== null)
}

/** @returns null si songId no existe en el catálogo. */
export function addToQueue(songId: string, singer: string): QueueItem | null {
  const song = getSongById(songId)
  if (!song) return null
  const maxPos = db
    .select({ max: sql<number>`max(${queueItems.position})` })
    .from(queueItems)
    .where(eq(queueItems.status, 'queued'))
    .get()
  const position = (maxPos?.max ?? -1) + 1
  const id = crypto.randomUUID()
  const cleanSinger = singer.trim() || 'Invitado'
  db.insert(queueItems)
    .values({ id, songId, singer: cleanSinger, status: 'queued', score: null, position, createdAt: Date.now() })
    .run()
  return toWireQueueItem(
    { id, songId, singer: cleanSinger, status: 'queued', score: null, position, createdAt: Date.now() },
    song,
  )
}

/** Solo se puede sacar de la cola algo que todavía no empezó a cantarse. */
export function removeFromQueue(id: string): boolean {
  const result = db
    .delete(queueItems)
    .where(and(eq(queueItems.id, id), eq(queueItems.status, 'queued')))
    .run()
  return result.changes > 0
}

/** Intercambia posición con el vecino de arriba/abajo dentro de 'queued'. */
export function moveQueueItem(id: string, direction: 'up' | 'down'): boolean {
  const current = db.select().from(queueItems).where(eq(queueItems.id, id)).get()
  if (!current || current.status !== 'queued') return false

  const neighbor =
    direction === 'up'
      ? db
          .select()
          .from(queueItems)
          .where(and(eq(queueItems.status, 'queued'), sql`${queueItems.position} < ${current.position}`))
          .orderBy(desc(queueItems.position))
          .get()
      : db
          .select()
          .from(queueItems)
          .where(and(eq(queueItems.status, 'queued'), sql`${queueItems.position} > ${current.position}`))
          .orderBy(asc(queueItems.position))
          .get()
  if (!neighbor) return false

  db.update(queueItems).set({ position: neighbor.position }).where(eq(queueItems.id, current.id)).run()
  db.update(queueItems).set({ position: current.position }).where(eq(queueItems.id, neighbor.id)).run()
  return true
}

/** Marca 'done' lo que estaba sonando (si había algo) y sube lo próximo en
 * la cola a 'playing'. @returns el nuevo item 'playing', o null si no había
 * nada esperando en la cola. */
export function advanceQueue(): QueueItem | null {
  const playing = db.select().from(queueItems).where(eq(queueItems.status, 'playing')).get()
  if (playing) {
    db.update(queueItems).set({ status: 'done' }).where(eq(queueItems.id, playing.id)).run()
  }

  const next = db
    .select()
    .from(queueItems)
    .where(eq(queueItems.status, 'queued'))
    .orderBy(asc(queueItems.position))
    .get()
  if (!next) return null

  db.update(queueItems).set({ status: 'playing' }).where(eq(queueItems.id, next.id)).run()
  const song = getSongById(next.songId)
  return song ? toWireQueueItem({ ...next, status: 'playing' }, song) : null
}

/** Solo se puntúa algo que ya terminó de cantarse. */
export function scoreQueueItem(id: string, score: number): boolean {
  const result = db
    .update(queueItems)
    .set({ score })
    .where(and(eq(queueItems.id, id), eq(queueItems.status, 'done')))
    .run()
  return result.changes > 0
}

/** Suma de puntajes por cantante, de mayor a menor — "quién va ganando". */
export function getLeaderboard(): LeaderboardEntry[] {
  const rows = db
    .select({
      singer: queueItems.singer,
      totalScore: sql<number>`sum(${queueItems.score})`,
      songsScored: sql<number>`count(*)`,
    })
    .from(queueItems)
    .where(and(eq(queueItems.status, 'done'), sql`${queueItems.score} is not null`))
    .groupBy(queueItems.singer)
    .orderBy(sql`sum(${queueItems.score}) desc`)
    .all()
  return rows.map((r) => ({ singer: r.singer, totalScore: r.totalScore, songsScored: r.songsScored }))
}
