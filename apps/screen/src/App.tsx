import { useEffect, useRef, useState } from 'react'
import type { ServerMsg, Song, LyricsDoc } from '@kiosco/shared'
import { LyricsView } from './LyricsView'

const EMPTY_LYRICS: LyricsDoc = { lines: [] }

export function App() {
  const [nowPlaying, setNowPlaying] = useState<Song | null>(null)
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(null)
  const [lyrics, setLyrics] = useState<LyricsDoc | null>(null)
  const [started, setStarted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startTimeRef = useRef(0)
  const playingIdRef = useRef<string | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`ws://${location.hostname}:8080/ws`)
    ws.onmessage = (ev) => {
      const msg: ServerMsg = JSON.parse(ev.data)
      if (msg.t === 'snapshot') {
        setNowPlaying(msg.nowPlaying)
        setBackgroundVideoUrl(msg.backgroundVideoUrl)
      }
    }
    return () => ws.close()
  }, [])

  // El navegador puede crear el AudioContext en estado 'suspended' incluso
  // dentro de un gesto del usuario, o suspenderlo solo (pestaña en segundo
  // plano). Si no se llama a resume() explícitamente, todo el código de
  // reproducción corre sin errores pero no sale ningún sonido.
  async function ensureAudioRunning(ctx: AudioContext): Promise<boolean> {
    if (ctx.state !== 'running') {
      try {
        await ctx.resume()
      } catch {
        // se refleja igual en el chequeo de estado de abajo
      }
    }
    return ctx.state === 'running'
  }

  async function playSong(song: Song, ctx: AudioContext) {
    if (!song.audioUrl) return
    playingIdRef.current = song.id
    setLoading(true)
    setLoadError(null)

    try {
      const [audioBuffer, lyricsDoc] = await Promise.all([
        fetch(song.audioUrl)
          .then((r) => r.arrayBuffer())
          .then((buf) => ctx.decodeAudioData(buf)),
        song.lyricsUrl
          ? fetch(song.lyricsUrl).then((r) => r.json() as Promise<LyricsDoc>)
          : Promise.resolve(EMPTY_LYRICS),
      ])

      // si mientras cargaba llegó otra canción más nueva, no pisarla con esta
      if (playingIdRef.current !== song.id) return

      const running = await ensureAudioRunning(ctx)
      setAudioBlocked(!running)

      sourceRef.current?.stop()
      setLyrics(lyricsDoc)

      // Reloj maestro: AudioContext.currentTime, nunca Date.now()/setInterval — §7b.
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      startTimeRef.current = ctx.currentTime
      source.start()
      sourceRef.current = source
      setStarted(true)
    } catch (err) {
      if (playingIdRef.current === song.id) {
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (playingIdRef.current === song.id) setLoading(false)
    }
  }

  // Una vez desbloqueado el AudioContext (primer click), los cambios de
  // canción posteriores (ej. "Reproducir" desde el admin) avanzan solos.
  useEffect(() => {
    const ctx = audioCtxRef.current
    if (!ctx || !nowPlaying || nowPlaying.playbackMode !== 'overlay') return
    if (nowPlaying.id === playingIdRef.current) return
    playSong(nowPlaying, ctx)
  }, [nowPlaying])

  function start() {
    if (!nowPlaying) return
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    // Disparado directo desde el click: es el intento con más chances de
    // que el navegador lo acepte sin más preguntas.
    ctx.resume().catch(() => {})
    playSong(nowPlaying, ctx)
  }

  async function retryAudio() {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const running = await ensureAudioRunning(ctx)
    setAudioBlocked(!running)
  }

  const getPositionSeconds = () => {
    const ctx = audioCtxRef.current
    return ctx ? ctx.currentTime - startTimeRef.current : 0
  }

  const isOverlayMode = nowPlaying?.playbackMode === 'overlay'

  return (
    <div className="screen">
      {backgroundVideoUrl && isOverlayMode && (
        <video className="background-video" src={backgroundVideoUrl} loop muted autoPlay playsInline />
      )}

      {!nowPlaying ? (
        <button className="start-button" disabled>
          Conectando…
        </button>
      ) : !isOverlayMode ? (
        <p className="line line--waiting">
          Modo completo ({nowPlaying.sourceFormat}) — reproducción nativa pendiente
        </p>
      ) : loading ? (
        <p className="line line--waiting">Cargando "{nowPlaying.title}"…</p>
      ) : loadError ? (
        <p className="line line--waiting">
          Error al cargar "{nowPlaying.title}": {loadError}
        </p>
      ) : !started ? (
        <button className="start-button" onClick={start}>
          {`Iniciar: ${nowPlaying.title}`}
        </button>
      ) : audioBlocked ? (
        <button className="start-button" onClick={retryAudio}>
          El navegador bloqueó el audio — click para activarlo
        </button>
      ) : lyrics ? (
        <LyricsView lyrics={lyrics} getPositionSeconds={getPositionSeconds} />
      ) : null}
    </div>
  )
}
