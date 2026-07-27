import { createServer } from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerMsg } from '@kiosco/shared'
import { detectFormat } from '@kiosco/shared'
import {
  listSongs,
  getNowPlaying,
  setNowPlaying,
  createSong,
  getBackgroundVideoUrl,
  setBackgroundVideo,
} from './db/queries.js'
import { runAlignment } from './sync/align.js'
import { transcodeToMp3 } from './sync/transcode.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const libraryDir = path.resolve(__dirname, '../../../library')
const port = Number(process.env.PORT ?? 8080)

const app = express()
app.use(express.json())
app.get('/health', (_req, res) => res.send('ok'))
app.use('/library', express.static(libraryDir))

app.get('/api/songs', (_req, res) => res.json(listSongs()))

app.post('/api/play/:id', (req, res) => {
  const ok = setNowPlaying(req.params.id)
  if (!ok) return res.status(404).json({ error: 'song not found' })
  broadcastSnapshot()
  res.json({ ok: true })
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
    const lyrics = await runAlignment({ audioPath: audioMp3Path, lyricsText, language })
    fs.writeFileSync(path.join(songDir, 'lyrics.json'), JSON.stringify(lyrics))

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
    })

    const wordCount = lyrics.lines.reduce((n, l) => n + l.words.length, 0)
    res.json({ song, message: `Sincronizado: ${lyrics.lines.length} líneas, ${wordCount} palabras.` })
  } catch (err) {
    cleanup()
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
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

  // 'control' (admin -> pantalla) y 'playback-status' (pantalla -> admin) son
  // retransmisión pura: el servidor no interpreta ni guarda ese estado.
  socket.on('message', (raw) => {
    for (const client of wss.clients) {
      if (client !== socket && client.readyState === WebSocket.OPEN) client.send(raw.toString())
    }
  })
})

httpServer.listen(port, () => {
  console.log(`[server] http://localhost:${port} (health, /library, /api/songs, /api/play/:id, ws:/ws)`)
})
