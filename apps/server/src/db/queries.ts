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
  Playlist,
  PlaylistDetail,
  Session,
  Singer,
} from '@kiosco/shared'
import { db } from './client.js'
import { songs, settings, queueItems, playlists, playlistSongs, sessions, singers } from './schema.js'

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
    syncVerified: row.syncVerified === 1,
  }
}

export function setSyncVerified(id: string, verified: boolean): boolean {
  return db.update(songs).set({ syncVerified: verified ? 1 : 0 }).where(eq(songs.id, id)).run().changes > 0
}

export function listSongs(): Song[] {
  return db.select().from(songs).all().map(toWireSong)
}

export interface SongSearchParams {
  q?: string
  quality?: SyncQuality
  /** true = solo verificadas a mano, false = solo las que faltan verificar. */
  verified?: boolean
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
  const { q, quality, verified, sortDir = 'asc', limit = 60, offset = 0 } = params
  const conditions = []
  if (q && q.trim()) {
    const like = `%${q.trim()}%`
    conditions.push(sql`(${songs.title} LIKE ${like} OR ${songs.artist} LIKE ${like})`)
  }
  if (quality) conditions.push(eq(songs.syncQuality, quality))
  if (verified !== undefined) conditions.push(eq(songs.syncVerified, verified ? 1 : 0))
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

/** Deja el reproductor sin canción seleccionada. Se llama al arrancar el
 * server: `nowPlayingId` vive en `settings`, así que sin esto el kiosco
 * levanta mostrando la última canción de la sesión anterior como si estuviera
 * sonando (pero sin audio, porque el motor arranca vacío). */
export function clearNowPlaying(): void {
  db.delete(settings).where(eq(settings.key, 'nowPlayingId')).run()
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
  const row = { ...song, syncVerified: 0, createdAt: Date.now() }
  db.insert(songs).values(row).run()
  return toWireSong(row)
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

// --- sesión y cantantes --------------------------------------------------
// Ver ROADMAP.md: una sesión de karaoke agrupa cantantes+fotos+cola+puntajes,
// como mucho una activa a la vez, y es deliberadamente efímera — terminarla
// borra todo (acá la parte de DB; la carpeta de fotos en disco la borra el
// caller, mismo criterio que deleteSong con library/<id>/).

function toWireSession(row: typeof sessions.$inferSelect): Session {
  return { id: row.id, startedAt: row.startedAt }
}

function toWireSinger(row: typeof singers.$inferSelect): Singer {
  return { id: row.id, name: row.name, photoUrl: resolveMediaUrl(row.photoPath) }
}

/** @returns null si no hay ninguna sesión activa. Nunca hay más de una. */
export function getActiveSession(): Session | null {
  const row = db.select().from(sessions).get()
  return row ? toWireSession(row) : null
}

export function createSession(): Session {
  const id = crypto.randomUUID()
  const startedAt = Date.now()
  db.insert(sessions).values({ id, startedAt }).run()
  return { id, startedAt }
}

/** Borra (DB) todo lo que pertenece a la sesión: sus cantantes, la cola/
 * puntajes enteros (nunca hay más de una sesión activa, así que `queue_items`
 * no necesita filtrarse por sesión — ver decisión en el plan) y la fila de
 * sesión misma. No toca disco. */
export function endSession(sessionId: string): void {
  db.delete(singers).where(eq(singers.sessionId, sessionId)).run()
  db.delete(queueItems).run()
  db.delete(sessions).where(eq(sessions.id, sessionId)).run()
  clearNowPlaying()
}

export function listSessionSingers(sessionId: string): Singer[] {
  return db
    .select()
    .from(singers)
    .where(eq(singers.sessionId, sessionId))
    .orderBy(asc(sql`${singers.name} COLLATE NOCASE`))
    .all()
    .map(toWireSinger)
}

export function createSinger(sessionId: string, name: string, photoPath: string | null): Singer {
  const id = crypto.randomUUID()
  const cleanName = name.trim() || 'Invitado'
  db.insert(singers).values({ id, sessionId, name: cleanName, photoPath, createdAt: Date.now() }).run()
  return { id, name: cleanName, photoUrl: resolveMediaUrl(photoPath) }
}

const UNASSIGNED_SINGER_NAME = 'Sin asignar'

/** Sentinel reusado para "quedó sin asignar" al empujar una playlist entera
 * sin elegir cantante — una fila por sesión, se crea la primera vez que
 * hace falta (evita que `queue_items.singerId` tenga que admitir null). */
export function getOrCreateUnassignedSinger(sessionId: string): Singer {
  const existing = db
    .select()
    .from(singers)
    .where(and(eq(singers.sessionId, sessionId), eq(singers.name, UNASSIGNED_SINGER_NAME)))
    .get()
  if (existing) return toWireSinger(existing)
  return createSinger(sessionId, UNASSIGNED_SINGER_NAME, null)
}

// --- cola en vivo ------------------------------------------------------

function toWireQueueItem(row: typeof queueItems.$inferSelect, song: Song, singer: Singer): QueueItem {
  return {
    id: row.id,
    singerId: singer.id,
    singer: singer.name,
    singerPhotoUrl: singer.photoUrl,
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
  const allSingers = new Map(db.select().from(singers).all().map((s) => [s.id, toWireSinger(s)]))
  const playing = rows.filter((r) => r.status === 'playing')
  const queued = rows.filter((r) => r.status === 'queued')
  return [...playing, ...queued]
    .map((row) => {
      const song = allSongs.get(row.songId)
      const singer = allSingers.get(row.singerId)
      return song && singer ? toWireQueueItem(row, song, singer) : null
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
  const allSingers = new Map(db.select().from(singers).all().map((s) => [s.id, toWireSinger(s)]))
  return rows
    .map((row) => {
      const song = allSongs.get(row.songId)
      const singer = allSingers.get(row.singerId)
      return song && singer ? toWireQueueItem(row, song, singer) : null
    })
    .filter((x): x is QueueItem => x !== null)
}

/** @returns null si songId o singerId no existen. */
export function addToQueue(songId: string, singerId: string): QueueItem | null {
  const song = getSongById(songId)
  if (!song) return null
  const singerRow = db.select().from(singers).where(eq(singers.id, singerId)).get()
  if (!singerRow) return null
  const singer = toWireSinger(singerRow)
  const maxPos = db
    .select({ max: sql<number>`max(${queueItems.position})` })
    .from(queueItems)
    .where(eq(queueItems.status, 'queued'))
    .get()
  const position = (maxPos?.max ?? -1) + 1
  const id = crypto.randomUUID()
  const row = { id, songId, singerId, status: 'queued' as const, score: null, position, createdAt: Date.now() }
  db.insert(queueItems).values(row).run()
  return toWireQueueItem(row, song, singer)
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
  const singerRow = db.select().from(singers).where(eq(singers.id, next.singerId)).get()
  if (!song || !singerRow) return null
  return toWireQueueItem({ ...next, status: 'playing' }, song, toWireSinger(singerRow))
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

// --- playlists ---------------------------------------------------------

export function listPlaylists(): Playlist[] {
  const rows = db
    .select({
      id: playlists.id,
      name: playlists.name,
      songCount: sql<number>`(select count(*) from ${playlistSongs} where ${playlistSongs.playlistId} = ${playlists.id})`,
    })
    .from(playlists)
    .orderBy(asc(sql`${playlists.name} COLLATE NOCASE`))
    .all()
  return rows.map((r) => ({ id: r.id, name: r.name, songCount: r.songCount }))
}

export function createPlaylist(name: string): Playlist {
  const id = crypto.randomUUID()
  db.insert(playlists).values({ id, name: name.trim(), createdAt: Date.now() }).run()
  return { id, name: name.trim(), songCount: 0 }
}

export function renamePlaylist(id: string, name: string): boolean {
  return db.update(playlists).set({ name: name.trim() }).where(eq(playlists.id, id)).run().changes > 0
}

export function deletePlaylist(id: string): boolean {
  db.delete(playlistSongs).where(eq(playlistSongs.playlistId, id)).run()
  return db.delete(playlists).where(eq(playlists.id, id)).run().changes > 0
}

/** @returns null si la playlist no existe. */
export function getPlaylist(id: string): PlaylistDetail | null {
  const row = db.select().from(playlists).where(eq(playlists.id, id)).get()
  if (!row) return null
  const links = db
    .select()
    .from(playlistSongs)
    .where(eq(playlistSongs.playlistId, id))
    .orderBy(asc(playlistSongs.position))
    .all()
  const songRows = links
    .map((l) => db.select().from(songs).where(eq(songs.id, l.songId)).get())
    .filter((s): s is typeof songs.$inferSelect => !!s)
  return { id: row.id, name: row.name, songCount: songRows.length, songs: songRows.map(toWireSong) }
}

/** Ignora duplicados: agregar dos veces la misma canción no la repite. */
export function addSongToPlaylist(playlistId: string, songId: string): boolean {
  if (!db.select().from(playlists).where(eq(playlists.id, playlistId)).get()) return false
  if (!db.select().from(songs).where(eq(songs.id, songId)).get()) return false
  const existing = db
    .select()
    .from(playlistSongs)
    .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, songId)))
    .get()
  if (existing) return true
  const maxPos = db
    .select({ max: sql<number>`max(${playlistSongs.position})` })
    .from(playlistSongs)
    .where(eq(playlistSongs.playlistId, playlistId))
    .get()
  db.insert(playlistSongs)
    .values({ id: crypto.randomUUID(), playlistId, songId, position: (maxPos?.max ?? -1) + 1 })
    .run()
  return true
}

export function removeSongFromPlaylist(playlistId: string, songId: string): boolean {
  return (
    db
      .delete(playlistSongs)
      .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, songId)))
      .run().changes > 0
  )
}

/**
 * Empuja toda la playlist al final de la cola en vivo, respetando su orden.
 * `singerId` ausente queda asignado al sentinel "Sin asignar" de la sesión
 * activa: cargar una lista de 20 temas no implica saber todavía quién va a
 * cantar cada uno — el operador los asigna a medida que la gente se anota.
 * @returns cuántas se encolaron (0 si la playlist no existe o no hay sesión activa).
 */
export function addPlaylistToQueue(playlistId: string, singerId: string | null): number {
  const detail = getPlaylist(playlistId)
  if (!detail) return 0
  const activeSession = getActiveSession()
  if (!activeSession) return 0
  const resolvedSingerId = singerId ?? getOrCreateUnassignedSinger(activeSession.id).id
  const maxPos = db
    .select({ max: sql<number>`max(${queueItems.position})` })
    .from(queueItems)
    .where(eq(queueItems.status, 'queued'))
    .get()
  let position = (maxPos?.max ?? -1) + 1
  const now = Date.now()
  db.transaction((tx) => {
    for (const song of detail.songs) {
      tx.insert(queueItems)
        .values({
          id: crypto.randomUUID(),
          songId: song.id,
          singerId: resolvedSingerId,
          status: 'queued',
          score: null,
          position: position++,
          createdAt: now,
        })
        .run()
    }
  })
  return detail.songs.length
}

/** Suma de puntajes por cantante, de mayor a menor — "quién va ganando". */
export function getLeaderboard(): LeaderboardEntry[] {
  const rows = db
    .select({
      singerId: queueItems.singerId,
      totalScore: sql<number>`sum(${queueItems.score})`,
      songsScored: sql<number>`count(*)`,
    })
    .from(queueItems)
    .where(and(eq(queueItems.status, 'done'), sql`${queueItems.score} is not null`))
    .groupBy(queueItems.singerId)
    .orderBy(sql`sum(${queueItems.score}) desc`)
    .all()
  const allSingers = new Map(db.select().from(singers).all().map((s) => [s.id, toWireSinger(s)]))
  return rows
    .map((r) => {
      const singer = allSingers.get(r.singerId)
      return singer
        ? { singerId: r.singerId, singer: singer.name, singerPhotoUrl: singer.photoUrl, totalScore: r.totalScore, songsScored: r.songsScored }
        : null
    })
    .filter((x): x is LeaderboardEntry => x !== null)
}
