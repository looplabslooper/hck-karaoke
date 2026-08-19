import { createServer } from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerMsg, LyricsDoc, SyncQuality, Genre, CategoryId, Singer } from '@kiosco/shared'
import { detectFormat, GENRES, CATEGORIES } from '@kiosco/shared'
import {
  searchSongs,
  getRandomSongs,
  getCategorySongs,
  getHomeCategories,
  setHomeCategories,
  getSongById,
  getNowPlaying,
  setNowPlaying,
  clearNowPlaying,
  createSong,
  updateSongSync,
  setSyncVerified,
  setSongGenre,
  deleteSong,
  getBackgroundVideoUrl,
  setBackgroundVideo,
  getCategoryImages,
  setCategoryImage,
  deleteCategoryImage,
  listQueue,
  listUnscored,
  addToQueue,
  addSongsToQueue,
  countQueuedSongsBySinger,
  interleaveQueue,
  removeFromQueue,
  moveQueueItem,
  advanceQueue,
  scoreQueueItem,
  getLeaderboard,
  getImportRoots,
  setImportRoots,
  listExternalPaths,
  EXTERNAL_PREFIX,
  listPlaylists,
  createPlaylist,
  getPlaylist,
  renamePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  addPlaylistToQueue,
  getActiveSession,
  createSession,
  beginSession,
  endSession,
  listSessionSingers,
  createSinger,
  listBanners,
  createBanner,
  deleteBanner,
  setBannerOrder,
} from './db/queries.js'
import { runAlignment } from './sync/align.js'
import { transcodeToMp3 } from './sync/transcode.js'
import { runColorTracking } from './sync/templateTracking.js'
import { runTemplateFaceAnalysis } from './sync/faceSwapRender.js'
import { resizeSquareImage } from './sync/resizeImage.js'
import { getFaceSwapStatus, triggerFaceSwapRender } from './sync/faceSwapJobs.js'
import { scanFolders, type ImportCandidate } from './import.js'
import { listTemplates } from './templates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const libraryDir = path.resolve(__dirname, '../../../library')
/** Subcarpeta para las letras de canciones importadas de carpetas externas —
 * gitignored, a diferencia de las letras de canciones propias. */
const IMPORTED_DIR = '_imported'
/** Fotos de cantantes de la sesión activa — library/_sessions/<sessionId>/,
 * mismo patrón underscore que _background/_imported. Se borra entera al
 * terminar la sesión (ver /api/sessions/end). */
const SESSIONS_DIR = '_sessions'
/** Pack de templates (video.mp4 + transform.json por carpeta) — hermana de
 * library/, gitignored, el operador la puebla a mano. Ver
 * .claude/agents/director-escenas.md y pipeline/track_color.py. */
const templatesDir = path.resolve(__dirname, '../../../templates')
const port = Number(process.env.PORT ?? 8080)

const app = express()
app.use(express.json({ limit: '20mb' }))
app.get('/health', (_req, res) => res.send('ok'))
app.use('/library', express.static(libraryDir))
app.use('/templates', express.static(templatesDir))

// Editor de templates: arma a mano la curva de posición/ángulo/escala del
// "slot" de cara sobre un video (transform.json), en vez de extraerla
// trackeando la cara de quien sale en el video — ver .claude/agents/director-escenas.md
// para el porqué. HTML/JS autocontenido, sin dependencias, se sirve tal cual
// en vez de portarlo a un componente React.
app.get('/template-editor', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/template-editor.html'))
})

// Paginado/filtrado en SQLite — con catálogos de miles de canciones (ej. un
// importado legado) no tiene sentido mandar todo de una por HTTP.
app.get('/api/songs', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined
  const qualityParam = typeof req.query.quality === 'string' ? req.query.quality : undefined
  const quality =
    qualityParam && qualityParam !== 'todos' ? (qualityParam as SyncQuality) : undefined
  const sortDir = req.query.sort === 'desc' ? 'desc' : 'asc'
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const verified =
    req.query.verified === 'true' ? true : req.query.verified === 'false' ? false : undefined
  res.json(searchSongs({ q, quality, verified, sortDir, limit, offset }))
})

// Muestra al azar para la página de Inicio.
app.get('/api/songs/random', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50)
  res.json(getRandomSongs(limit))
})

// Marca/desmarca "escuché esta canción y la letra va sincronizada".
app.post('/api/songs/:id/sync-verified', (req, res) => {
  const verified = req.body.verified === true
  if (!setSyncVerified(req.params.id, verified)) return res.status(404).json({ error: 'song not found' })
  res.json({ ok: true })
})

// Etiquetado de género a mano — ningún importador lo trae (ver plan de rediseño).
app.post('/api/songs/:id/genre', (req, res) => {
  const genre = req.body.genre as Genre | null
  if (genre !== null && !GENRES.includes(genre)) return res.status(400).json({ error: 'género inválido' })
  if (!setSongGenre(req.params.id, genre)) return res.status(404).json({ error: 'song not found' })
  res.json({ ok: true })
})

// Canciones de una categoría de Inicio (nuevas/verificadas/género) — Inicio y
// Configuración → Categorías de inicio.
app.get('/api/songs/category/:id', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 50)
  res.json(getCategorySongs(req.params.id as CategoryId, limit))
})

app.get('/api/settings/home-categories', (_req, res) => res.json(getHomeCategories()))

app.post('/api/settings/home-categories', (req, res) => {
  const ids = req.body.ids as unknown
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array' })
  setHomeCategories(ids as CategoryId[])
  res.json({ ok: true })
})

app.delete('/api/songs/:id', (req, res) => {
  const song = getSongById(req.params.id)
  if (!song) return res.status(404).json({ error: 'song not found' })

  const ok = deleteSong(req.params.id)
  if (!ok) return res.status(404).json({ error: 'song not found' })

  // Todo lo que subió esta canción (audio/letra/video) vive en su propia
  // carpeta library/<id>/ — borrarla entera es seguro, nada más la comparte.
  // Si vino de una importación, su letra vive en library/_imported/<id>/;
  // `force` hace que la que no exista se ignore sin romper.
  fs.rmSync(path.join(libraryDir, req.params.id), { recursive: true, force: true })
  fs.rmSync(path.join(libraryDir, IMPORTED_DIR, req.params.id), { recursive: true, force: true })

  broadcastSnapshot()
  res.json({ ok: true })
})

app.post('/api/play/:id', (req, res) => {
  const ok = setNowPlaying(req.params.id)
  if (!ok) return res.status(404).json({ error: 'song not found' })
  broadcastSnapshot()
  res.json({ ok: true })
})

// --- sesión y cantantes ------------------------------------------------
// Ver ROADMAP.md: agrupa cantantes+fotos+cola+puntajes, como mucho una
// sesión activa a la vez, efímera — terminarla borra todo.

app.get('/api/sessions/current', (_req, res) => {
  const session = getActiveSession()
  res.json({ session, singers: session ? listSessionSingers(session.id) : [] })
})

// Estado de los renders de swap por cantante+template `faceswap` — el
// cliente pollea esto para saber qué hotkeys habilitar (ver
// triggerFaceSwapRendersForSinger/triggerFaceSwapRendersForTemplate).
app.get('/api/sessions/current/faceswap-status', (_req, res) => {
  const session = getActiveSession()
  if (!session) return res.json({})
  const singers = listSessionSingers(session.id)
  const templates = listTemplates(templatesDir).filter((t) => t.kind === 'faceswap')
  const status: Record<string, Record<string, string>> = {}
  for (const singer of singers) {
    if (!singer.photoUrl) continue
    status[singer.id] = {}
    for (const t of templates) {
      status[singer.id][t.id] = getFaceSwapStatus(faceSwapOutPath(session.id, singer.id, t.id), singer.id, t.id)
    }
  }
  res.json(status)
})

// Si ya había una sesión activa, la termina (borra DB + fotos en disco)
// antes de arrancar la nueva — mismo resultado que terminar-y-arrancar,
// un click menos para el operador.
app.post('/api/sessions/start', (_req, res) => {
  const previous = getActiveSession()
  if (previous) {
    endSession(previous.id)
    fs.rmSync(path.join(libraryDir, SESSIONS_DIR, previous.id), { recursive: true, force: true })
  }
  const session = createSession()
  broadcastSnapshot()
  res.json(session)
})

// Pasa del armado guiado al show en vivo. Se valida acá (y no solo en la UI)
// para que la sesión nunca quede 'corriendo' sin nadie a quien llamar.
app.post('/api/sessions/begin', (_req, res) => {
  const active = getActiveSession()
  if (!active) return res.status(400).json({ error: 'no hay sesión activa' })
  if (active.status === 'corriendo') return res.json(active)
  if (listSessionSingers(active.id).length === 0) {
    return res.status(400).json({ error: 'no hay ningún cantante cargado' })
  }
  if (listQueue().length === 0) {
    return res.status(400).json({ error: 'no hay ninguna canción en la cola' })
  }
  // El show arranca ya alternado por cantante — ver interleaveQueue.
  interleaveQueue()
  res.json(beginSession(active.id))
})

app.post('/api/sessions/end', (_req, res) => {
  const active = getActiveSession()
  if (!active) return res.status(400).json({ error: 'no hay sesión activa' })
  endSession(active.id)
  fs.rmSync(path.join(libraryDir, SESSIONS_DIR, active.id), { recursive: true, force: true })
  broadcastSnapshot()
  res.json({ ok: true })
})

app.get('/api/singers', (_req, res) => {
  const session = getActiveSession()
  res.json(session ? listSessionSingers(session.id) : [])
})

function requireActiveSession(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!getActiveSession()) return res.status(400).json({ error: 'no hay sesión activa' })
  next()
}

const singerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      // requireActiveSession ya corrió antes que este middleware, así que
      // acá siempre hay una sesión activa.
      const session = getActiveSession()!
      const dir = path.join(libraryDir, SESSIONS_DIR, session.id)
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname) || '.jpg'}`),
  }),
})

app.post('/api/singers', requireActiveSession, singerUpload.single('photo'), (req, res) => {
  const session = getActiveSession()!
  const name = (req.body.name as string | undefined) ?? ''
  const photoPath = req.file ? `${SESSIONS_DIR}/${session.id}/${req.file.filename}` : null
  const ovalCx = parseFloat(req.body.ovalCx)
  const ovalCy = parseFloat(req.body.ovalCy)
  const ovalScale = parseFloat(req.body.ovalScale)
  const oval =
    Number.isFinite(ovalCx) && Number.isFinite(ovalCy) && Number.isFinite(ovalScale)
      ? { cx: ovalCx, cy: ovalCy, scale: ovalScale }
      : null
  const singer = createSinger(session.id, name, photoPath, oval)
  res.json(singer)
  triggerFaceSwapRendersForSinger(singer)
})

/** `Singer.photoUrl` sale de resolveMediaUrl() en queries.ts como
 * `/library/<ruta>` — nunca es una foto externa (solo se sube por acá), así
 * que alcanza con sacarle el prefijo para volver a la ruta real en disco. */
function singerPhotoAbsPath(photoUrl: string): string {
  return path.join(libraryDir, photoUrl.replace(/^\/library\//, ''))
}

function faceSwapOutPath(sessionId: string, singerId: string, templateId: string): string {
  return path.join(libraryDir, SESSIONS_DIR, sessionId, 'faceswap', singerId, `${templateId}.mp4`)
}

/** Dispara (en segundo plano) el render de este cantante contra todos los
 * templates `faceswap` que ya existen — se llama apenas se registra un
 * cantante con foto, para que esté listo antes de que le toque cantar. */
function triggerFaceSwapRendersForSinger(singer: Singer): void {
  const session = getActiveSession()
  if (!session || !singer.photoUrl) return
  const photoPath = singerPhotoAbsPath(singer.photoUrl)
  for (const t of listTemplates(templatesDir)) {
    if (t.kind !== 'faceswap') continue
    const dir = path.join(templatesDir, t.id)
    const outPath = faceSwapOutPath(session.id, singer.id, t.id)
    triggerFaceSwapRender(
      singer.id,
      t.id,
      path.join(dir, 'video.mp4'),
      path.join(dir, 'analysis.json'),
      photoPath,
      outPath,
      path.dirname(outPath),
    )
  }
}

/** Contraparte: al subir un template `faceswap` nuevo a mitad de sesión, lo
 * dispara contra todos los cantantes ya cargados con foto — así no hace
 * falta re-registrar a nadie para que el template nuevo esté disponible. */
function triggerFaceSwapRendersForTemplate(templateId: string): void {
  const session = getActiveSession()
  if (!session) return
  const dir = path.join(templatesDir, templateId)
  for (const singer of listSessionSingers(session.id)) {
    if (!singer.photoUrl) continue
    const photoPath = singerPhotoAbsPath(singer.photoUrl)
    const outPath = faceSwapOutPath(session.id, singer.id, templateId)
    triggerFaceSwapRender(
      singer.id,
      templateId,
      path.join(dir, 'video.mp4'),
      path.join(dir, 'analysis.json'),
      photoPath,
      outPath,
      path.dirname(outPath),
    )
  }
}

// --- templates (animación de cara en el escenario, "Fun Box") -----------

app.get('/api/templates', (_req, res) => res.json(listTemplates(templatesDir)))

const templateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const id = crypto.randomUUID()
      req.res!.locals.templateId = id
      const dir = path.join(templatesDir, id)
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    // Se fuerza .mp4 siempre — listTemplates() espera ese nombre exacto, y
    // en la práctica el video sube ya en mp4 (salida típica de Gemini/Veo,
    // ver .claude/agents/director-escenas.md). Si algún día hace falta
    // aceptar otros contenedores, acá es donde transcodificar primero.
    filename: (_req, _file, cb) => cb(null, 'video.mp4'),
  }),
})

// Sube un video crudo y lo mapea automáticamente — el operador no toca la
// terminal ni /template-editor para esto. `kind: 'sticker'` corre el
// tracking por color (pipeline/track_color.py, unos segundos); `kind:
// 'faceswap'` corre el análisis de cara real (pipeline/analyze_template_face.py,
// más lento — recorre el video entero con un modelo de detección — pero no
// está en el camino crítico de un show en vivo).
app.post('/api/templates', templateUpload.single('video'), async (req, res) => {
  const id: string = res.locals.templateId
  const dir = path.join(templatesDir, id)
  const kind = req.body.kind === 'faceswap' ? 'faceswap' : 'sticker'
  if (!req.file) {
    fs.rmSync(dir, { recursive: true, force: true })
    return res.status(400).json({ error: 'falta el archivo de video' })
  }

  const videoPath = path.join(dir, 'video.mp4')
  try {
    if (kind === 'faceswap') {
      const analysisPath = path.join(dir, 'analysis.json')
      await runTemplateFaceAnalysis(videoPath, analysisPath)
      res.json({ id, videoUrl: `/templates/${id}/video.mp4`, kind })
      triggerFaceSwapRendersForTemplate(id)
    } else {
      const transformPath = path.join(dir, 'transform.json')
      await runColorTracking(videoPath, transformPath)
      const transform = JSON.parse(fs.readFileSync(transformPath, 'utf-8'))
      res.json({ id, videoUrl: `/templates/${id}/video.mp4`, kind, transform })
    }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/api/templates/:id', (req, res) => {
  const dir = path.join(templatesDir, req.params.id)
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'template not found' })
  fs.rmSync(dir, { recursive: true, force: true })
  res.json({ ok: true })
})

// --- cola en vivo + puntajes ------------------------------------------------

app.get('/api/queue', (_req, res) => res.json(listQueue()))

app.post('/api/queue', (req, res) => {
  const songId = req.body.songId as string | undefined
  const singerId = req.body.singerId as string | undefined
  if (!songId || !singerId) return res.status(400).json({ error: 'falta songId o singerId' })
  const item = addToQueue(songId, singerId)
  if (!item) return res.status(404).json({ error: 'song o singer not found' })
  res.json(item)
})

// Varias canciones para un mismo cantante de una — el paso "elegí sus
// canciones" del armado guiado, que si no tendría que hacer N requests.
app.post('/api/queue/batch', requireActiveSession, (req, res) => {
  const songIds = req.body.songIds as unknown
  const singerId = req.body.singerId as string | undefined
  if (!singerId || !Array.isArray(songIds)) {
    return res.status(400).json({ error: 'falta singerId o songIds' })
  }
  const added = addSongsToQueue(songIds.filter((id): id is string => typeof id === 'string'), singerId)
  res.json({ added })
})

app.get('/api/queue/counts', (_req, res) => res.json(countQueuedSongsBySinger()))

// Botón "Alternar turnos": para cuando se sumaron canciones en vivo y la
// cola quedó despareja. El reordenamiento manual del admin manda después —
// esto nunca se dispara solo.
app.post('/api/queue/interleave', requireActiveSession, (_req, res) => {
  interleaveQueue()
  res.json({ ok: true })
})

app.delete('/api/queue/:id', (req, res) => {
  const ok = removeFromQueue(req.params.id)
  if (!ok) return res.status(404).json({ error: 'no se pudo quitar (¿ya empezó a cantarse?)' })
  res.json({ ok: true })
})

app.post('/api/queue/:id/move', (req, res) => {
  const direction = req.body.direction as string | undefined
  if (direction !== 'up' && direction !== 'down') return res.status(400).json({ error: 'direction debe ser up|down' })
  const ok = moveQueueItem(req.params.id, direction)
  if (!ok) return res.status(400).json({ error: 'no se pudo mover (¿es el primero/último?)' })
  res.json({ ok: true })
})

// Pasa lo que estaba 'playing' a 'done' y sube lo próximo de la cola a
// 'playing' — y ESE es el que arranca a sonar de verdad (mismo mecanismo que
// /api/play/:id: nowPlayingId + snapshot por WS).
app.post('/api/queue/advance', (_req, res) => {
  const next = advanceQueue()
  if (next) {
    setNowPlaying(next.song.id)
    broadcastSnapshot()
  }
  res.json({ next })
})

app.post('/api/queue/:id/score', (req, res) => {
  const score = Number(req.body.score)
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    return res.status(400).json({ error: 'score debe ser un número entre 1 y 10' })
  }
  const ok = scoreQueueItem(req.params.id, score)
  if (!ok) return res.status(400).json({ error: 'no se pudo puntuar (¿ya terminó de cantarse?)' })
  res.json({ ok: true })
})

app.get('/api/queue/unscored', (_req, res) => res.json(listUnscored()))

app.get('/api/leaderboard', (_req, res) => res.json(getLeaderboard()))

// --- playlists ---------------------------------------------------------

app.get('/api/playlists', (_req, res) => res.json(listPlaylists()))

app.post('/api/playlists', (req, res) => {
  const name = (req.body.name as string | undefined)?.trim()
  if (!name) return res.status(400).json({ error: 'falta el nombre' })
  res.json(createPlaylist(name))
})

app.get('/api/playlists/:id', (req, res) => {
  const detail = getPlaylist(req.params.id)
  if (!detail) return res.status(404).json({ error: 'playlist not found' })
  res.json(detail)
})

app.patch('/api/playlists/:id', (req, res) => {
  const name = (req.body.name as string | undefined)?.trim()
  if (!name) return res.status(400).json({ error: 'falta el nombre' })
  if (!renamePlaylist(req.params.id, name)) return res.status(404).json({ error: 'playlist not found' })
  res.json({ ok: true })
})

app.delete('/api/playlists/:id', (req, res) => {
  if (!deletePlaylist(req.params.id)) return res.status(404).json({ error: 'playlist not found' })
  res.json({ ok: true })
})

app.post('/api/playlists/:id/songs', (req, res) => {
  const songId = req.body.songId as string | undefined
  if (!songId) return res.status(400).json({ error: 'falta songId' })
  if (!addSongToPlaylist(req.params.id, songId)) {
    return res.status(404).json({ error: 'no existe la playlist o la canción' })
  }
  res.json({ ok: true })
})

app.delete('/api/playlists/:id/songs/:songId', (req, res) => {
  if (!removeSongFromPlaylist(req.params.id, req.params.songId)) {
    return res.status(404).json({ error: 'esa canción no está en la playlist' })
  }
  res.json({ ok: true })
})

// Empuja la playlist entera al final de la cola en vivo — el atajo para no
// cargar 20 canciones a mano al arrancar la noche. singerId ausente cae en
// el sentinel "Sin asignar" de la sesión activa (ver addPlaylistToQueue).
app.post('/api/playlists/:id/add-to-queue', (req, res) => {
  const singerId = (req.body.singerId as string | undefined) ?? null
  const added = addPlaylistToQueue(req.params.id, singerId)
  if (added === 0) return res.status(404).json({ error: 'playlist vacía/inexistente, o no hay sesión activa' })
  res.json({ added })
})

// --- subida de canciones -----------------------------------------------

const songUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      // el mismo uploadId sirve para los 3 campos (audio/lyrics/video) de una misma subida
      cb(null, path.join(libraryDir, ensureUploadDir(_req)))
    },
    filename: (_req, file, cb) => cb(null, `${file.fieldname}${path.extname(file.originalname)}`),
  }),
})

function ensureUploadDir(req: express.Request): string {
  if (!req.res!.locals.uploadId) {
    req.res!.locals.uploadId = crypto.randomUUID()
    fs.mkdirSync(path.join(libraryDir, req.res!.locals.uploadId), { recursive: true })
  }
  return req.res!.locals.uploadId
}

app.post(
  '/api/songs',
  songUpload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'lyrics', maxCount: 1 },
    { name: 'video', maxCount: 1 },
  ]),
  (req, res) => {
    const uploadId: string = res.locals.uploadId
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const audioFile = files?.audio?.[0] ?? null
    const lyricsFile = files?.lyrics?.[0] ?? null
    const videoFile = files?.video?.[0] ?? null

    const cleanup = () => fs.rmSync(path.join(libraryDir, uploadId), { recursive: true, force: true })

    const isTextLyrics = lyricsFile && /\.(lrc|json)$/i.test(lyricsFile.originalname)
    const lyricsText = isTextLyrics ? fs.readFileSync(lyricsFile!.path, 'utf-8') : null

    const detection = detectFormat({
      audioFilename: audioFile?.originalname ?? null,
      lyricsFilename: lyricsFile?.originalname ?? null,
      lyricsText,
      videoFilename: videoFile?.originalname ?? null,
    })

    if (!detection.ok) {
      cleanup()
      return res.status(400).json({ error: detection.reason })
    }

    // Si el detector produjo un LyricsDoc (json/lrc-*), lo normalizamos y
    // guardamos como lyrics.json — no nos quedamos con el .lrc crudo.
    let lyricsPath: string | null = null
    if (detection.lyrics) {
      lyricsPath = `${uploadId}/lyrics.json`
      fs.writeFileSync(path.join(libraryDir, uploadId, 'lyrics.json'), JSON.stringify(detection.lyrics))
      if (lyricsFile && path.extname(lyricsFile.path).toLowerCase() !== '.json') {
        fs.rmSync(lyricsFile.path)
      }
    } else if (detection.sourceFormat === 'cdg' && lyricsFile) {
      lyricsPath = `${uploadId}/${lyricsFile.filename}`
    }

    const title = (req.body.title as string | undefined)?.trim() || audioFile?.originalname || 'Sin título'
    const artist = (req.body.artist as string | undefined)?.trim() || 'Desconocido'

    const song = createSong({
      id: uploadId,
      title,
      artist,
      playbackMode: detection.playbackMode,
      sourceFormat: detection.sourceFormat,
      syncQuality: detection.syncQuality,
      audioPath: audioFile ? `${uploadId}/${audioFile.filename}` : null,
      lyricsPath,
      videoPath: videoFile ? `${uploadId}/${videoFile.filename}` : null,
      instrumentalPath: null,
    })

    res.json({ song, message: detection.message })
  },
)

// --- generador de karaoke: audio (mp3/mp4) + letra pegada -> sincronizada --

const syncUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(libraryDir, ensureUploadDir(_req))),
    filename: (_req, file, cb) => cb(null, `source${path.extname(file.originalname)}`),
  }),
})

app.post('/api/songs/sync', syncUpload.single('audio'), async (req, res) => {
  const uploadId: string = res.locals.uploadId
  const songDir = path.join(libraryDir, uploadId)
  const cleanup = () => fs.rmSync(songDir, { recursive: true, force: true })

  const audioFile = req.file
  const lyricsText = (req.body.lyrics as string | undefined)?.trim()

  if (!audioFile) {
    cleanup()
    return res.status(400).json({ error: 'Falta el archivo de audio/video.' })
  }
  if (!lyricsText) {
    cleanup()
    return res.status(400).json({ error: 'Falta pegar la letra.' })
  }

  const audioMp3Path = path.join(songDir, 'audio.mp3')

  try {
    await transcodeToMp3(audioFile.path, audioMp3Path)
    fs.rmSync(audioFile.path)

    const language = (req.body.language as string | undefined) || 'es'
    const separateVocals = req.body.separateVocals === 'true'

    // Si se separa voz, el instrumental.wav que deja Demucs se transcodea a
    // mp3 (mismo criterio que el audio principal) y queda como "modo
    // karaoke real" — apagar la voz original y cantar sobre la base sola.
    const instrumentalWav = path.join(songDir, 'instrumental.wav')
    const lyrics = await runAlignment({
      audioPath: audioMp3Path,
      lyricsText,
      language,
      separateVocals,
      instrumentalOutputPath: separateVocals ? instrumentalWav : undefined,
    })
    fs.writeFileSync(path.join(songDir, 'lyrics.json'), JSON.stringify(lyrics))

    let instrumentalPath: string | null = null
    if (separateVocals && fs.existsSync(instrumentalWav)) {
      await transcodeToMp3(instrumentalWav, path.join(songDir, 'instrumental.mp3'))
      fs.rmSync(instrumentalWav)
      instrumentalPath = `${uploadId}/instrumental.mp3`
    }

    const title = (req.body.title as string | undefined)?.trim() || 'Sin título'
    const artist = (req.body.artist as string | undefined)?.trim() || 'Desconocido'

    const song = createSong({
      id: uploadId,
      title,
      artist,
      playbackMode: 'overlay',
      sourceFormat: 'auto-sync',
      syncQuality: 'excellent',
      audioPath: `${uploadId}/audio.mp3`,
      lyricsPath: `${uploadId}/lyrics.json`,
      videoPath: null,
      instrumentalPath,
    })

    const wordCount = lyrics.lines.reduce((n, l) => n + l.words.length, 0)
    res.json({ song, message: `Sincronizado: ${lyrics.lines.length} líneas, ${wordCount} palabras.` })
  } catch (err) {
    cleanup()
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// --- re-sincronizar una canción ya cargada ---------------------------------
// A diferencia de /api/songs/sync, nunca toca el audio: solo corre WhisperX
// de nuevo contra el archivo que ya está en disco, con letra y/o idioma
// nuevos. Pensado para el caso real de esta sesión: una canción quedó mal
// sincronizada (típicamente idioma equivocado) y hace falta corregirla sin
// perder el ID ni duplicarla en la biblioteca.
app.post('/api/songs/:id/resync', express.json(), async (req, res) => {
  const song = getSongById(req.params.id)
  if (!song) return res.status(404).json({ error: 'song not found' })
  if (!song.audioUrl) {
    return res.status(400).json({ error: 'Esta canción no tiene un archivo de audio propio para re-sincronizar.' })
  }

  const lyricsText = (req.body.lyrics as string | undefined)?.trim()
  if (!lyricsText) return res.status(400).json({ error: 'Falta pegar la letra.' })
  const language = (req.body.language as string | undefined) || 'es'
  const separateVocals = req.body.separateVocals === true

  // audioUrl es "/library/<uploadId>/audio.mp3" (o el nombre original) —
  // reconstruimos la ruta real en disco a partir de esa misma carpeta.
  const relativeAudioPath = song.audioUrl.replace(/^\/library\//, '')
  const audioPath = path.join(libraryDir, relativeAudioPath)
  if (!fs.existsSync(audioPath)) {
    return res.status(500).json({ error: `No se encontró el audio en disco (${relativeAudioPath}).` })
  }
  const songDir = path.dirname(audioPath)

  try {
    const instrumentalWav = path.join(songDir, 'instrumental.wav')
    const lyrics = await runAlignment({
      audioPath,
      lyricsText,
      language,
      separateVocals,
      instrumentalOutputPath: separateVocals ? instrumentalWav : undefined,
    })
    fs.writeFileSync(path.join(songDir, 'lyrics.json'), JSON.stringify(lyrics))

    const relSongDir = path.relative(libraryDir, songDir).split(path.sep).join('/')
    const lyricsPath = `${relSongDir}/lyrics.json`

    let instrumentalPath: string | undefined
    if (separateVocals && fs.existsSync(instrumentalWav)) {
      await transcodeToMp3(instrumentalWav, path.join(songDir, 'instrumental.mp3'))
      fs.rmSync(instrumentalWav)
      instrumentalPath = `${relSongDir}/instrumental.mp3`
    }

    updateSongSync(song.id, { lyricsPath, sourceFormat: 'auto-sync', syncQuality: 'excellent', instrumentalPath })

    const wordCount = lyrics.lines.reduce((n, l) => n + l.words.length, 0)
    res.json({ message: `Re-sincronizado: ${lyrics.lines.length} líneas, ${wordCount} palabras.` })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// --- corrección manual de sincronía (línea por línea) ----------------------
// El operador escucha la canción y, cuando nota que una línea (típicamente
// un coro repetido) quedó desincronizada, la "fija" en la posición real de
// reproducción — el cliente ya hizo el cálculo de desplazamiento, acá solo
// se persiste el JSON corregido tal cual llega.
app.put('/api/songs/:id/lyrics', express.json({ limit: '2mb' }), (req, res) => {
  const song = getSongById(req.params.id)
  if (!song || !song.lyricsUrl) {
    return res.status(404).json({ error: 'Esta canción no tiene letra propia para corregir.' })
  }

  const lyrics = req.body as LyricsDoc
  if (!lyrics || !Array.isArray(lyrics.lines)) {
    return res.status(400).json({ error: 'El cuerpo tiene que ser un LyricsDoc válido ({ lines: [...] }).' })
  }

  const relativeLyricsPath = song.lyricsUrl.replace(/^\/library\//, '')
  fs.writeFileSync(path.join(libraryDir, relativeLyricsPath), JSON.stringify(lyrics))
  res.json({ ok: true })
})

// --- fondo de video global -----------------------------------------------

const backgroundUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(libraryDir, '_background')
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => cb(null, `video${path.extname(file.originalname)}`),
  }),
})

app.post('/api/settings/background-video', backgroundUpload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'falta el archivo de video' })
  setBackgroundVideo(`_background/${req.file.filename}`)
  broadcastSnapshot()
  res.json({ ok: true })
})

// --- banners del carrusel de Inicio ---------------------------------------
// Ver PROMPTS-BANNERS.md — lista abierta, solo imagen (sin título/subtítulo).

const BANNERS_DIR = '_banners'

const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(libraryDir, BANNERS_DIR)
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname) || '.jpg'}`),
  }),
})

app.get('/api/banners', (_req, res) => res.json(listBanners()))

app.post('/api/banners', bannerUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'falta la imagen' })
  res.json(createBanner(`${BANNERS_DIR}/${req.file.filename}`))
})

app.delete('/api/banners/:id', (req, res) => {
  const imagePath = deleteBanner(req.params.id)
  if (!imagePath) return res.status(404).json({ error: 'banner not found' })
  fs.rmSync(path.join(libraryDir, imagePath), { force: true })
  res.json({ ok: true })
})

app.post('/api/banners/reorder', express.json(), (req, res) => {
  const ids = req.body.ids as unknown
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array' })
  setBannerOrder(ids as string[])
  res.json({ ok: true })
})

// --- portadas de categoría ---------------------------------------------
// CATEGORIES (shared/domain.ts) es un conjunto fijo de 7 — una imagen cada
// una, redimensionada a un cuadrado parejo (resizeSquareImage) para que se
// vean consistentes sin importar tamaño/proporción del archivo original.

const CATEGORY_IMAGES_DIR = '_categories'
const categoryUploadTmpDir = path.join(libraryDir, CATEGORY_IMAGES_DIR, '_tmp')

const categoryImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(categoryUploadTmpDir, { recursive: true })
      cb(null, categoryUploadTmpDir)
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname) || '.png'}`),
  }),
})

app.get('/api/settings/category-images', (_req, res) => {
  res.json(getCategoryImages())
})

app.post('/api/settings/category-image/:categoryId', categoryImageUpload.single('image'), async (req, res) => {
  const categoryId = req.params.categoryId as CategoryId
  if (!CATEGORIES.some((c) => c.id === categoryId)) {
    if (req.file) fs.rmSync(req.file.path, { force: true })
    return res.status(400).json({ error: `categoría desconocida: ${categoryId}` })
  }
  if (!req.file) return res.status(400).json({ error: 'falta la imagen' })

  const outDir = path.join(libraryDir, CATEGORY_IMAGES_DIR)
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${categoryId}.png`)
  try {
    await resizeSquareImage(req.file.path, outPath)
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'no se pudo procesar la imagen' })
  } finally {
    fs.rmSync(req.file.path, { force: true })
  }
  setCategoryImage(categoryId, `${CATEGORY_IMAGES_DIR}/${categoryId}.png`)
  res.json({ ok: true, images: getCategoryImages() })
})

app.delete('/api/settings/category-image/:categoryId', (req, res) => {
  const categoryId = req.params.categoryId as CategoryId
  if (!CATEGORIES.some((c) => c.id === categoryId)) return res.status(400).json({ error: `categoría desconocida: ${categoryId}` })
  deleteCategoryImage(categoryId)
  fs.rmSync(path.join(libraryDir, CATEGORY_IMAGES_DIR, `${categoryId}.png`), { force: true })
  res.json({ ok: true, images: getCategoryImages() })
})

// --- importar carpetas externas --------------------------------------------
// Bibliotecas de karaoke ya armadas (audio + letra, o video quemado) pueden
// vivir en cualquier carpeta del disco — nunca se copian a library/ (podrían
// ser cientos de GB). Solo se copia la letra normalizada (texto, chico); el
// audio/video se sirve al vuelo desde su ubicación original vía
// /api/external-file, validado contra las carpetas configuradas acá.

app.get('/api/import/roots', (_req, res) => res.json(getImportRoots()))

app.post('/api/import/roots', express.json(), (req, res) => {
  const roots = req.body.roots as unknown
  if (!Array.isArray(roots) || !roots.every((r) => typeof r === 'string')) {
    return res.status(400).json({ error: 'roots debe ser un array de strings' })
  }
  const normalized = roots.map((r) => path.resolve(r)).filter((r) => fs.existsSync(r))
  setImportRoots(normalized)
  res.json({ roots: normalized })
})

app.post('/api/import/scan', (_req, res) => {
  const roots = getImportRoots()
  const candidates = scanFolders(roots, listExternalPaths())
  res.json({ candidates })
})

app.post('/api/import/run', express.json({ limit: '10mb' }), (req, res) => {
  const candidates = req.body.candidates as ImportCandidate[] | undefined
  if (!Array.isArray(candidates)) return res.status(400).json({ error: 'falta candidates' })

  const imported: string[] = []
  const failed: { key: string; reason: string }[] = []

  for (const candidate of candidates) {
    if (!candidate.detection.ok) {
      failed.push({ key: candidate.key, reason: candidate.detection.reason })
      continue
    }
    const detection = candidate.detection
    const id = crypto.randomUUID()

    let lyricsPath: string | null = null
    if (detection.lyrics) {
      // Letra normalizada (json/lrc-*): se copia como texto, no pesa nada.
      // Va bajo _imported/ y no en library/<id>/ como las canciones propias:
      // un catálogo importado puede traer miles de letras que no son del
      // usuario (típicamente de un producto comercial), y `library/_imported/`
      // está gitignored justo para que no terminen versionadas. Ver CLAUDE.md.
      fs.mkdirSync(path.join(libraryDir, IMPORTED_DIR, id), { recursive: true })
      fs.writeFileSync(path.join(libraryDir, IMPORTED_DIR, id, 'lyrics.json'), JSON.stringify(detection.lyrics))
      lyricsPath = `${IMPORTED_DIR}/${id}/lyrics.json`
    } else if (detection.sourceFormat === 'cdg' && candidate.lyricsPath) {
      lyricsPath = `${EXTERNAL_PREFIX}${candidate.lyricsPath}`
    }

    createSong({
      id,
      title: candidate.title,
      artist: candidate.artist,
      playbackMode: detection.playbackMode,
      sourceFormat: detection.sourceFormat,
      syncQuality: detection.syncQuality,
      audioPath: candidate.audioPath ? `${EXTERNAL_PREFIX}${candidate.audioPath}` : null,
      lyricsPath,
      videoPath: candidate.videoPath ? `${EXTERNAL_PREFIX}${candidate.videoPath}` : null,
      instrumentalPath: null,
    })
    imported.push(candidate.key)
  }

  broadcastSnapshot()
  res.json({ imported: imported.length, failed })
})

function isWithinRoot(absPath: string, root: string): boolean {
  const a = process.platform === 'win32' ? absPath.toLowerCase() : absPath
  const b = process.platform === 'win32' ? root.toLowerCase() : root
  return a === b || a.startsWith(b + path.sep)
}

app.get('/api/external-file', (req, res) => {
  const rawPath = req.query.path
  if (typeof rawPath !== 'string') return res.status(400).json({ error: 'falta path' })

  const absPath = path.resolve(rawPath)
  const roots = getImportRoots()
  const allowed = roots.some((root) => isWithinRoot(absPath, root))
  if (!allowed) return res.status(403).json({ error: 'path fuera de las carpetas de importación configuradas' })
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'archivo no encontrado' })

  res.sendFile(absPath)
})

// --- frontend en producción ------------------------------------------------
// En dev, `apps/admin` corre su propio Vite (:5175) con proxy hacia acá. Para
// el kiosco empaquetado no hay Vite corriendo — este mismo proceso sirve el
// build ya generado (`pnpm --filter @kiosco/admin build`) para que todo viva
// en un solo origen (:8080). Va al final, después de /api y /library, para
// que nunca les gane el paso a esas rutas.
// En dev NO se sirve el build: `apps/admin/dist` casi siempre está viejo
// respecto del código, y servirlo acá es una trampa silenciosa — la app
// carga y parece andar, pero es una versión de hace días que puede estar
// hablando con una API que ya cambió (pasó de verdad: un build viejo hacía
// `.find()` sobre /api/songs después de que el endpoint pasara a devolver
// `{items,total}`). Mejor un cartel explícito que un bug fantasma.
// `npm_lifecycle_event` lo setea pnpm con el nombre del script que se corrió
// ('dev' o 'start') — evita depender de cross-env, que no está instalado y
// haría falta en Windows para pasar una env var inline.
const adminDistDir = path.resolve(__dirname, '../../admin/dist')
if (process.env.npm_lifecycle_event === 'dev') {
  app.get('*', (_req, res) => {
    res
      .status(503)
      .type('html')
      .send(
        `<body style="font:16px system-ui;background:#0f1115;color:#e8e6f0;padding:3rem;line-height:1.6">
         <h1 style="color:#a78bfa">Modo desarrollo</h1>
         <p>Este puerto (:8080) sirve solo la API y <code>/library</code>.</p>
         <p>La interfaz corre en <a style="color:#a78bfa" href="http://localhost:5175/">http://localhost:5175/</a> (Vite, con hot reload).</p>
         <p style="color:#8b8a99">Para probar el kiosco tal cual se ve en producción: <code>pnpm build && pnpm start</code>.</p>
         </body>`,
      )
  })
} else if (fs.existsSync(adminDistDir)) {
  app.use(express.static(adminDistDir))
}

// --- websocket -------------------------------------------------------------

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

function currentSnapshot(): ServerMsg {
  return { t: 'snapshot', nowPlaying: getNowPlaying(), backgroundVideoUrl: getBackgroundVideoUrl() }
}

function broadcastSnapshot() {
  const payload = JSON.stringify(currentSnapshot())
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify(currentSnapshot()))
})

// Arranque limpio: el kiosco empieza sin nada sonando. `nowPlayingId` es
// persistente, así que sin esto una sesión nueva levanta mostrando la última
// canción de la anterior.
clearNowPlaying()

httpServer.listen(port, () => {
  console.log(`[server] http://localhost:${port} (health, /library, /api/songs, /api/play/:id, ws:/ws)`)
})
