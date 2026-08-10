import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import type {
  LeaderboardEntry,
  LyricsDoc,
  Playlist,
  PlaylistDetail,
  QueueItem,
  ServerMsg,
  Session,
  Singer,
  Song,
  Template,
} from '@kiosco/shared'
import { LyricsView } from './LyricsView'
import { CdgPlayer } from './CdgPlayer'
import { SingerPicker } from './SingerPicker'
import { FaceSwapOverlay } from './FaceSwapOverlay'

// Kiosco de karaoke de una sola pantalla: navegación/biblioteca y el motor
// de audio real (Web Audio) conviven en esta misma app — ver ROADMAP.md.
// "Pantalla completa" es solo un modo visual (más Fullscreen API nativa),
// no un proceso ni una pestaña distinta.

const EMPTY_LYRICS: LyricsDoc = { lines: [] }

const QUALITY_LABEL: Record<Song['syncQuality'], string> = {
  excellent: 'Excelente',
  interpolated: 'Interpolada',
  none: 'Sin letra',
}

const QUALITY_COLOR: Record<Song['syncQuality'], string> = {
  excellent: 'var(--accent)',
  interpolated: 'var(--info)',
  none: 'var(--text-dim)',
}

const FORMAT_LABEL: Record<Song['sourceFormat'], string> = {
  json: 'JSON',
  'lrc-word': 'LRC · palabra',
  'lrc-line': 'LRC · línea',
  cdg: 'CD+G',
  'baked-video': 'Video completo',
  'audio-only': 'Solo audio',
  'auto-sync': 'Auto-sincronizada',
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Color determinístico por canción (no tenemos un campo "color" en el
// dominio) — mismo id, mismo tono, sin necesidad de guardarlo en la DB.
function songColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 62%, 58%)`
}

// CD+G tiene su propia animación (canvas), pero el audio sigue siendo un
// archivo aparte que necesita el motor de Web Audio de siempre — a
// diferencia de 'baked-video', que trae todo (audio+letra) en un solo video
// y no pasa por acá. Ver ROADMAP.md, "formatos estándar de karaoke".
function usesWebAudioEngine(song: Song): boolean {
  return song.playbackMode === 'overlay' || song.sourceFormat === 'cdg'
}

type Page = 'biblioteca' | 'playlists' | 'cola' | 'generar' | 'subir' | 'fondo' | 'importar'
type WizardStep = 1 | 2 | 3 | 4

interface ImportCandidate {
  key: string
  title: string
  artist: string
  audioPath: string | null
  lyricsPath: string | null
  videoPath: string | null
  detection: { ok: true; message: string } | { ok: false; reason: string }
}

const NAV_ITEMS: { id: Page; label: string; icon: JSX.Element }[] = [
  {
    id: 'biblioteca',
    label: 'Biblioteca de canciones',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="7" height="16" rx="1.5" />
        <rect x="14" y="4" width="7" height="10" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'playlists',
    label: 'Playlists',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h11M4 11h11M4 16h7" />
        <circle cx="18" cy="16" r="3" />
        <path d="M21 16V8l-3 1" />
      </svg>
    ),
  },
  {
    id: 'cola',
    label: 'Cola en vivo',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16M4 12h10M4 18h16" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: 'generar',
    label: 'Agregar canción nueva',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12h4l2-7 4 14 2-7h6" />
      </svg>
    ),
  },
  {
    id: 'subir',
    label: 'Subir canción armada',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 20h16" />
      </svg>
    ),
  },
  {
    id: 'fondo',
    label: 'Fondo de video',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="14" rx="1.5" />
        <path d="M3 15l5-5 4 4 4-5 5 6" />
      </svg>
    ),
  },
  {
    id: 'importar',
    label: 'Importar carpetas',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    ),
  },
]

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'fr', label: 'Francés' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Alemán' },
]

export function App() {
  const [page, setPage] = useState<Page>('biblioteca')
  const [songs, setSongs] = useState<Song[]>([])
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [backgroundMessage, setBackgroundMessage] = useState<string | null>(null)

  // Importar carpetas externas (biblioteca ya armada en disco, sin copiar)
  const [importRoots, setImportRootsState] = useState<string[]>([])
  const [newImportRoot, setNewImportRoot] = useState('')
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[] | null>(null)
  const [importScanning, setImportScanning] = useState(false)
  const [importRunning, setImportRunning] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // El objeto completo viaja en el snapshot del WS — guardarlo tal cual evita
  // depender de que la canción sonando esté en la página actual de `songs`
  // (que ahora es paginada/filtrada, ver Biblioteca más abajo).
  const [nowPlayingSong, setNowPlayingSong] = useState<Song | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(null)

  // Biblioteca: búsqueda + filtro por calidad de sincronía + orden + paginado
  // server-side — con catálogos de miles de canciones (ej. un importado
  // legado), filtrar/ordenar/renderizar todo del lado del cliente tilda la UI.
  const SONGS_PAGE_SIZE = 60
  const [searchQuery, setSearchQuery] = useState('')
  const [qualityFilter, setQualityFilter] = useState<Song['syncQuality'] | 'todos'>('todos')
  // 'todos' | 'si' | 'no' — para curar un pack chico de canciones con la
  // sincronía ya confirmada a oído, y probar cambios contra ese pack.
  const [verifiedFilter, setVerifiedFilter] = useState<'todos' | 'si' | 'no'>('todos')
  const [sortAsc, setSortAsc] = useState(true)
  const [songsTotal, setSongsTotal] = useState(0)
  const [songsLoading, setSongsLoading] = useState(false)

  // Modal de re-sincronización (letra y/o idioma mal — sin tocar el audio)
  const [resyncSong, setResyncSong] = useState<Song | null>(null)
  const [resyncLyricsText, setResyncLyricsText] = useState('')
  const [resyncLanguage, setResyncLanguage] = useState('es')
  const [resyncSeparateVocals, setResyncSeparateVocals] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [resyncError, setResyncError] = useState<string | null>(null)

  // Confirmación de borrado
  const [deleteSong, setDeleteSong] = useState<Song | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Playlists
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [openPlaylist, setOpenPlaylist] = useState<PlaylistDetail | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null)
  const [pushPlaylist, setPushPlaylist] = useState<Playlist | null>(null)
  const [pushSingerId, setPushSingerId] = useState<string | null>(null)
  const [pushSingerName, setPushSingerName] = useState('')
  const [pushSingerPhoto, setPushSingerPhoto] = useState<Blob | null>(null)
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null)

  // Sesión de karaoke: agrupa cantantes+fotos+cola+puntajes, como mucho una
  // activa a la vez, efímera — ver ROADMAP.md.
  const [session, setSession] = useState<Session | null>(null)
  const [sessionSingers, setSessionSingers] = useState<Singer[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  // Cola en vivo + puntajes
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [unscored, setUnscored] = useState<QueueItem[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [queueSong, setQueueSong] = useState<Song | null>(null)
  const [queueSingerId, setQueueSingerId] = useState<string | null>(null)
  const [queueSingerName, setQueueSingerName] = useState('')
  const [queueSingerPhoto, setQueueSingerPhoto] = useState<Blob | null>(null)

  // Wizard "Agregar canción nueva"
  const [wizardStep, setWizardStep] = useState<WizardStep>(1)
  const [wizardTitle, setWizardTitle] = useState('')
  const [wizardArtist, setWizardArtist] = useState('')
  const [wizardLanguage, setWizardLanguage] = useState('es')
  const [wizardSeparateVocals, setWizardSeparateVocals] = useState(false)
  const [wizardAudioFile, setWizardAudioFile] = useState<File | null>(null)
  const [wizardLyricsText, setWizardLyricsText] = useState('')
  const [wizardDragOver, setWizardDragOver] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Motor de audio real
  const [lyrics, setLyrics] = useState<LyricsDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [paused, setPaused] = useState(false)
  const [scrubValue, setScrubValue] = useState<number | null>(null)
  const [displayPosition, setDisplayPosition] = useState(0)
  const [kioskMode, setKioskMode] = useState(false)
  const [dimBackground, setDimBackground] = useState(true)
  const [volume, setVolume] = useState(70)
  const [showLyricsOverlay, setShowLyricsOverlay] = useState(false)
  const [nextLineText, setNextLineText] = useState<string | null>(null)
  const [vocalsOff, setVocalsOff] = useState(false)

  // Corrección manual de sincronía (línea por línea)
  const [showSyncEditor, setShowSyncEditor] = useState(false)
  const [syncEdited, setSyncEdited] = useState(false)
  const [savingSyncEdits, setSavingSyncEdits] = useState(false)
  const originalLyricsRef = useRef<LyricsDoc | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const instrumentalBufferRef = useRef<AudioBuffer | null>(null)
  const vocalsOffRef = useRef(false)
  const startTimeRef = useRef(0)
  const pausedAtRef = useRef(0)
  const pausedRef = useRef(false)
  const playingIdRef = useRef<string | null>(null)
  const audioFileInputRef = useRef<HTMLInputElement | null>(null)
  // 'baked-video' no pasa por Web Audio — el propio <video> trae audio+letra
  // quemados, así que es su propio motor de reproducción (ver usesWebAudioEngine).
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  // Espejo en estado de `playingIdRef` — el ref solo no sirve para decidir
  // qué renderizar: tocarlo no dispara re-render, así que la UI se quedaba
  // sin montar el reproductor hasta que algún otro setState la despertara.
  const [localReadyId, setLocalReadyId] = useState<string | null>(null)

  // Auto-avance de la cola al terminar una canción. Los refs son para que los
  // callbacks del motor de audio/video (creados una sola vez) no lean valores
  // viejos — el mismo motivo por el que ya existen pausedRef/vocalsOffRef.
  const ADVANCE_GAP_SECONDS = 5
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [advanceCountdown, setAdvanceCountdown] = useState<number | null>(null)
  const autoAdvanceRef = useRef(true)
  const queueRef = useRef<QueueItem[]>([])

  function songsQueryString(offset: number) {
    const params = new URLSearchParams()
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    if (qualityFilter !== 'todos') params.set('quality', qualityFilter)
    if (verifiedFilter !== 'todos') params.set('verified', String(verifiedFilter === 'si'))
    params.set('sort', sortAsc ? 'asc' : 'desc')
    params.set('limit', String(SONGS_PAGE_SIZE))
    params.set('offset', String(offset))
    return params.toString()
  }

  /** Vuelve a pedir la primera página con los filtros actuales — se usa al
   * cambiar búsqueda/filtro/orden y después de cualquier mutación (subir,
   * borrar, importar, etc). */
  async function refreshSongs() {
    setSongsLoading(true)
    try {
      const res = await fetch(`/api/songs?${songsQueryString(0)}`)
      const body: { items: Song[]; total: number } = await res.json()
      setSongs(body.items)
      setSongsTotal(body.total)
    } finally {
      setSongsLoading(false)
    }
  }

  async function loadMoreSongs() {
    setSongsLoading(true)
    try {
      const res = await fetch(`/api/songs?${songsQueryString(songs.length)}`)
      const body: { items: Song[]; total: number } = await res.json()
      setSongs((prev) => [...prev, ...body.items])
      setSongsTotal(body.total)
    } finally {
      setSongsLoading(false)
    }
  }

  async function refreshQueue() {
    const [queueRes, unscoredRes, leaderboardRes] = await Promise.all([
      fetch('/api/queue'),
      fetch('/api/queue/unscored'),
      fetch('/api/leaderboard'),
    ])
    setQueue(await queueRes.json())
    setUnscored(await unscoredRes.json())
    setLeaderboard(await leaderboardRes.json())
  }

  // --- Sesión de karaoke ----------------------------------------------------

  async function refreshSession() {
    const res = await fetch('/api/sessions/current')
    const body: { session: Session | null; singers: Singer[] } = await res.json()
    setSession(body.session)
    setSessionSingers(body.singers)
  }

  async function refreshTemplates() {
    const res = await fetch('/api/templates')
    setTemplates(await res.json())
  }

  async function handleStartSession() {
    await fetch('/api/sessions/start', { method: 'POST' })
    refreshSession()
    refreshQueue()
  }

  async function handleEndSession() {
    if (!confirm('¿Terminar la sesión? Se borran los cantantes, sus fotos y la cola/puntajes — no se puede deshacer.')) return
    await fetch('/api/sessions/end', { method: 'POST' })
    refreshSession()
    refreshQueue()
  }

  // --- Playlists ----------------------------------------------------------

  async function refreshPlaylists() {
    const res = await fetch('/api/playlists')
    setPlaylists(await res.json())
  }

  async function createPlaylist() {
    const name = newPlaylistName.trim()
    if (!name) return
    await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setNewPlaylistName('')
    refreshPlaylists()
  }

  async function deletePlaylist(id: string) {
    await fetch(`/api/playlists/${id}`, { method: 'DELETE' })
    if (openPlaylist?.id === id) setOpenPlaylist(null)
    refreshPlaylists()
  }

  async function showPlaylist(id: string) {
    const res = await fetch(`/api/playlists/${id}`)
    setOpenPlaylist(res.ok ? await res.json() : null)
  }

  async function addSongToPlaylist(playlistId: string, songId: string) {
    await fetch(`/api/playlists/${playlistId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId }),
    })
    setAddToPlaylistSong(null)
    setPlaylistMessage('Canción agregada a la playlist.')
    refreshPlaylists()
    if (openPlaylist?.id === playlistId) showPlaylist(playlistId)
  }

  async function removeSongFromPlaylist(playlistId: string, songId: string) {
    await fetch(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' })
    refreshPlaylists()
    showPlaylist(playlistId)
  }

  async function submitPushPlaylist() {
    if (!pushPlaylist) return
    const singerId = await resolveSingerId(pushSingerName, pushSingerId, pushSingerPhoto)
    const res = await fetch(`/api/playlists/${pushPlaylist.id}/add-to-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ singerId }),
    })
    const body = await res.json()
    setPushPlaylist(null)
    setPushSingerId(null)
    setPushSingerName('')
    setPushSingerPhoto(null)
    if (res.ok) {
      setPlaylistMessage(`${body.added} canciones agregadas a la cola.`)
      refreshQueue()
      refreshSession()
    } else {
      setPlaylistMessage(body.error ?? 'No se pudo agregar a la cola.')
    }
  }

  async function refreshImportRoots() {
    const res = await fetch('/api/import/roots')
    setImportRootsState(await res.json())
  }

  useEffect(() => {
    // La carga inicial de canciones la dispara el efecto de búsqueda/filtro
    // de abajo (corre también al montar) — acá solo lo que no depende de eso.
    refreshQueue()
    refreshImportRoots()
    refreshPlaylists()
    refreshSession()
    refreshTemplates()

    const ws = new WebSocket(`ws://${location.hostname}:8080/ws`)
    wsRef.current = ws
    ws.onmessage = (ev) => {
      const msg: ServerMsg = JSON.parse(ev.data)
      if (msg.t === 'snapshot') {
        setNowPlayingSong(msg.nowPlaying ?? null)
        setBackgroundVideoUrl(msg.backgroundVideoUrl)
      }
    }
    return () => ws.close()
  }, [])

  // Búsqueda/filtro/orden pegan al server — debounce para no mandar un
  // request por tecla mientras se escribe.
  useEffect(() => {
    const id = setTimeout(() => refreshSongs(), 250)
    return () => clearTimeout(id)
  }, [searchQuery, qualityFilter, verifiedFilter, sortAsc])

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance
  }, [autoAdvance])

  // Atajos de teclado: el kiosco se opera de lejos, muchas veces sin mouse a
  // mano. Se ignoran mientras se escribe en un campo, para no robarle la
  // barra espaciadora a la búsqueda ni a la letra pegada en el wizard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return

      if (e.key === ' ') {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === 'Escape' && kioskMode) {
        exitKiosk()
      } else if (e.key === 'f' || e.key === 'F') {
        kioskMode ? exitKiosk() : enterKiosk()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekPlayback(getPositionSeconds() + 5)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekPlayback(getPositionSeconds() - 5)
      } else if (e.key === 'n' || e.key === 'N') {
        handleAdvanceQueue()
      } else if ((e.key === 't' || e.key === 'T') && kioskMode) {
        triggerFaceSwapOverlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Sin lista de dependencias a propósito: el handler tiene que ver el
    // estado fresco en cada render. Re-suscribir un listener es barato y
    // evita el clásico bug de closure vieja que ya mordió en este proyecto.
  })

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  // Cuenta regresiva entre canciones. Se cancela sola si el operador toca
  // algo (pone play, salta de tema) — ver el reset en handlePlay/togglePlayPause.
  useEffect(() => {
    if (advanceCountdown === null) return
    if (advanceCountdown <= 0) {
      setAdvanceCountdown(null)
      handleAdvanceQueue()
      return
    }
    const id = setTimeout(() => setAdvanceCountdown((n) => (n === null ? null : n - 1)), 1000)
    return () => clearTimeout(id)
  }, [advanceCountdown])

  // Refresca la posición mostrada en el scrubber ~5 veces por segundo. No
  // toca nada mientras el usuario está arrastrando (scrubValue !== null).
  useEffect(() => {
    const id = setInterval(() => {
      if (scrubValue !== null) return
      setDisplayPosition(getPositionSeconds())
    }, 200)
    return () => clearInterval(id)
  }, [scrubValue])

  useEffect(() => {
    function onFullscreenChange() {
      setKioskMode(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
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

  // Se crea/reanuda siempre dentro de un gesto directo del usuario (click en
  // "Reproducir" o en el botón de recuperación de la vista de pantalla
  // completa) — es el intento con más chances de que el navegador lo acepte.
  // El GainNode se crea una sola vez por contexto y todas las fuentes pasan
  // por él — así el volumen se puede tocar en caliente sin recrear nada.
  function ensureAudioContext(): AudioContext {
    let ctx = audioCtxRef.current
    if (!ctx) {
      ctx = new AudioContext()
      audioCtxRef.current = ctx
      const gain = ctx.createGain()
      gain.gain.value = volume / 100
      gain.connect(ctx.destination)
      gainNodeRef.current = gain
    }
    ctx.resume().catch(() => {})
    return ctx
  }

  async function playSong(song: Song, ctx: AudioContext) {
    if (!song.audioUrl) return
    playingIdRef.current = song.id
    setLocalReadyId(song.id)
    setLoading(true)
    setLoadError(null)

    try {
      const [audioBuffer, lyricsDoc, instrumentalBuffer] = await Promise.all([
        fetch(song.audioUrl)
          .then((r) => r.arrayBuffer())
          .then((buf) => ctx.decodeAudioData(buf)),
        // El CD+G también vive en lyricsUrl, pero es binario — lo decodifica
        // <CdgPlayer> por su cuenta, acá no hay que tocarlo como JSON.
        song.lyricsUrl && song.sourceFormat !== 'cdg'
          ? fetch(song.lyricsUrl).then((r) => r.json() as Promise<LyricsDoc>)
          : Promise.resolve(EMPTY_LYRICS),
        song.instrumentalUrl
          ? fetch(song.instrumentalUrl)
              .then((r) => r.arrayBuffer())
              .then((buf) => ctx.decodeAudioData(buf))
          : Promise.resolve(null),
      ])

      // si mientras cargaba llegó otra canción más nueva, no pisarla con esta
      if (playingIdRef.current !== song.id) return

      const running = await ensureAudioRunning(ctx)
      setAudioBlocked(!running)

      sourceRef.current?.stop()
      setLyrics(lyricsDoc)
      originalLyricsRef.current = lyricsDoc
      setSyncEdited(false)
      audioBufferRef.current = audioBuffer
      instrumentalBufferRef.current = instrumentalBuffer
      pausedAtRef.current = 0
      pausedRef.current = false
      setPaused(false)
      // Cada canción nueva arranca con la voz original, aunque la anterior
      // se haya escuchado en modo instrumental.
      vocalsOffRef.current = false
      setVocalsOff(false)

      // Reloj maestro: AudioContext.currentTime, nunca Date.now()/setInterval — §7b.
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNodeRef.current ?? ctx.destination)
      startTimeRef.current = ctx.currentTime
      attachEndHandler(source)
      source.start()
      sourceRef.current = source
    } catch (err) {
      if (playingIdRef.current === song.id) {
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (playingIdRef.current === song.id) setLoading(false)
    }
  }

  /** `onended` de un AudioBufferSourceNode dispara tanto al terminar la pista
   * como en cada `.stop()` nuestro (pausar, buscar, apagar la voz, cambiar de
   * canción). Distinguimos por la posición: solo cuenta como final real si el
   * reloj llegó al fondo del buffer. */
  function attachEndHandler(source: AudioBufferSourceNode) {
    source.onended = () => {
      if (sourceRef.current !== source) return
      const total = audioBufferRef.current?.duration ?? 0
      if (total > 0 && getPositionSeconds() >= total - 0.4) handleSongEnded()
    }
  }

  // Web Audio no tiene pause/resume nativo en un AudioBufferSourceNode: una
  // vez parado con .stop() queda inutilizable. "Pausar" es parar el nodo
  // actual guardando el offset alcanzado; "reanudar"/"buscar" es crear un
  // nodo nuevo con .start(0, offset) — ver ROADMAP.md.
  function startSourceAt(offset: number) {
    const ctx = audioCtxRef.current
    const buffer = vocalsOffRef.current ? instrumentalBufferRef.current : audioBufferRef.current
    if (!ctx || !buffer) return
    sourceRef.current?.stop()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gainNodeRef.current ?? ctx.destination)
    attachEndHandler(source)
    source.start(0, Math.max(0, offset))
    sourceRef.current = source
    startTimeRef.current = ctx.currentTime - offset
  }

  function pausePlayback() {
    if (pausedRef.current || !audioBufferRef.current) return
    pausedAtRef.current = getPositionSeconds()
    pausedRef.current = true
    setPaused(true)
    sourceRef.current?.stop()
    sourceRef.current = null
  }

  function resumePlayback() {
    if (!pausedRef.current) return
    pausedRef.current = false
    setPaused(false)
    startSourceAt(pausedAtRef.current)
  }

  function seekPlayback(position: number) {
    if (nowPlayingSong && !usesWebAudioEngine(nowPlayingSong)) {
      const el = videoRef.current
      const clamped = Math.min(Math.max(position, 0), videoDuration || position)
      if (el) el.currentTime = clamped
      setDisplayPosition(clamped)
      return
    }
    const duration = audioBufferRef.current?.duration ?? position
    const clamped = Math.min(Math.max(position, 0), duration)
    pausedAtRef.current = clamped
    setDisplayPosition(clamped)
    if (!pausedRef.current) startSourceAt(clamped)
  }

  function togglePlayPause() {
    setAdvanceCountdown(null)
    if (nowPlayingSong && !usesWebAudioEngine(nowPlayingSong)) {
      const el = videoRef.current
      if (!el) return
      if (el.paused) el.play().catch(() => {})
      else el.pause()
      return
    }
    if (pausedRef.current) resumePlayback()
    else pausePlayback()
  }

  // Apaga/prende la voz original a mitad de canción, preservando la posición
  // — mismo truco que pausar/buscar: parar la fuente actual y arrancar una
  // nueva (ahora del buffer instrumental) desde el mismo offset.
  function toggleVocals() {
    if (!instrumentalBufferRef.current) return
    const pos = getPositionSeconds()
    vocalsOffRef.current = !vocalsOffRef.current
    setVocalsOff(vocalsOffRef.current)
    if (!pausedRef.current) startSourceAt(pos)
  }

  // --- Corrección manual de sincronía (línea por línea) -------------------
  // Para coros repetidos que confunden al alineador automático: en vez de
  // re-sincronizar la canción entera, el operador escucha, nota que una
  // línea puntual quedó desfasada, y la "fija" en la posición real donde
  // suena — se desplaza esa línea (y sus palabras, para no perder el barrido
  // interno) por la diferencia entre su tiempo viejo y el nuevo. "Fijar desde
  // acá" además aplica el mismo desplazamiento a todo lo que sigue, para el
  // caso típico de un desfasaje que se arrastra hasta el final.
  function fixLineHere(lineIndex: number, shiftRest: boolean) {
    if (!lyrics) return
    const pos = getPositionSeconds()
    const delta = pos - lyrics.lines[lineIndex].start
    const newLines = lyrics.lines.map((line, i) => {
      if (i < lineIndex || (i > lineIndex && !shiftRest)) return line
      return {
        start: line.start + delta,
        end: line.end + delta,
        words: line.words.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta })),
      }
    })
    setLyrics({ lines: newLines })
    setSyncEdited(true)
  }

  function discardSyncEdits() {
    if (originalLyricsRef.current) setLyrics(originalLyricsRef.current)
    setSyncEdited(false)
  }

  async function saveSyncEdits() {
    if (!nowPlayingSong || !lyrics || savingSyncEdits) return
    setSavingSyncEdits(true)
    try {
      await fetch(`/api/songs/${nowPlayingSong.id}/lyrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lyrics),
      })
      originalLyricsRef.current = lyrics
      setSyncEdited(false)
    } finally {
      setSavingSyncEdits(false)
    }
  }

  function handleVolumeChange(e: FormEvent<HTMLInputElement>) {
    const value = Number(e.currentTarget.value)
    setVolume(value)
    if (gainNodeRef.current) gainNodeRef.current.gain.value = value / 100
    if (videoRef.current) videoRef.current.volume = value / 100
  }

  // Dispara el motor local para la canción ya seleccionada del lado del
  // servidor. Cubre dos casos: arrancar directo desde la vista de pantalla
  // completa, y recuperar reproducción tras un reload de página.
  function beginLocalPlayback() {
    if (!nowPlayingSong) return
    if (!usesWebAudioEngine(nowPlayingSong)) {
      // 'baked-video': no hay nada que decodificar, el <video> es su propio
      // motor — esto solo marca "listo" para que el render monte el <video
      // autoPlay> dentro del mismo gesto de click (necesario para que el
      // navegador permita el autoplay con sonido).
      playingIdRef.current = nowPlayingSong.id
      setLocalReadyId(nowPlayingSong.id)
      pausedRef.current = false
      setPaused(false)
      setDisplayPosition(0)
      setVideoDuration(0)
      return
    }
    const ctx = ensureAudioContext()
    playSong(nowPlayingSong, ctx)
  }

  async function retryAudio() {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const running = await ensureAudioRunning(ctx)
    setAudioBlocked(!running)
  }

  const getPositionSeconds = () => {
    if (nowPlayingSong && !usesWebAudioEngine(nowPlayingSong)) return videoRef.current?.currentTime ?? 0
    if (pausedRef.current) return pausedAtRef.current
    const ctx = audioCtxRef.current
    return ctx ? ctx.currentTime - startTimeRef.current : 0
  }

  // Una vez creado el AudioContext (primer click en "Reproducir"), los
  // cambios de canción posteriores avanzan solos.
  useEffect(() => {
    if (!nowPlayingSong) return
    if (nowPlayingSong.id === playingIdRef.current) return

    // 'baked-video' no usa AudioContext: alcanza con marcarlo listo para que
    // se monte el <video autoPlay>, ande o no el motor de Web Audio.
    if (!usesWebAudioEngine(nowPlayingSong)) {
      playingIdRef.current = nowPlayingSong.id
      setLocalReadyId(nowPlayingSong.id)
      pausedRef.current = false
      setPaused(false)
      setDisplayPosition(0)
      setVideoDuration(0)
      return
    }

    const ctx = audioCtxRef.current
    if (!ctx) return
    playSong(nowPlayingSong, ctx)
  }, [nowPlayingSong])

  function enterKiosk() {
    setKioskMode(true)
    setShowLyricsOverlay(false)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  function exitKiosk() {
    setKioskMode(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }

  function handleScrubDrag(e: FormEvent<HTMLInputElement>) {
    setScrubValue(Number(e.currentTarget.value))
  }

  function handleScrubCommit(e: FormEvent<HTMLInputElement>) {
    const value = Number(e.currentTarget.value)
    seekPlayback(value)
    setScrubValue(null)
  }

  async function handlePlay(id: string) {
    setPlayError(null)
    setAdvanceCountdown(null) // el operador eligió a mano: se cancela el auto-avance en curso
    ensureAudioContext()
    const res = await fetch(`/api/play/${id}`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setPlayError(body.error ?? `No se pudo reproducir (HTTP ${res.status})`)
    }
  }

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setUploadMessage(null)
    setUploadError(null)
    const form = e.currentTarget
    const res = await fetch('/api/songs', { method: 'POST', body: new FormData(form) })
    const body = await res.json()
    if (!res.ok) {
      setUploadError(body.error ?? 'Error desconocido')
      return
    }
    setUploadMessage(`"${body.song.title}" agregada — ${body.message}`)
    form.reset()
    refreshSongs()
  }

  async function handleBackgroundVideo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBackgroundMessage(null)
    const form = e.currentTarget
    const res = await fetch('/api/settings/background-video', { method: 'POST', body: new FormData(form) })
    setBackgroundMessage(res.ok ? 'Fondo actualizado' : 'Error al subir el fondo')
    if (res.ok) form.reset()
  }

  // --- Importar carpetas externas (biblioteca en disco, sin copiar) --------

  async function addImportRoot() {
    const root = newImportRoot.trim()
    if (!root) return
    setImportError(null)
    const res = await fetch('/api/import/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: [...importRoots, root] }),
    })
    const body = await res.json()
    if (!res.ok) {
      setImportError(body.error ?? 'Error desconocido')
      return
    }
    setImportRootsState(body.roots)
    if (!body.roots.includes(root)) {
      setImportError(`No se encontró la carpeta "${root}" — revisá la ruta.`)
    }
    setNewImportRoot('')
    setImportCandidates(null)
  }

  async function removeImportRoot(root: string) {
    const next = importRoots.filter((r) => r !== root)
    const res = await fetch('/api/import/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: next }),
    })
    setImportRootsState(await res.json().then((b) => b.roots))
    setImportCandidates(null)
  }

  async function scanImportFolders() {
    setImportScanning(true)
    setImportError(null)
    setImportMessage(null)
    try {
      const res = await fetch('/api/import/scan', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setImportError(body.error ?? 'Error al escanear')
        return
      }
      setImportCandidates(body.candidates)
    } finally {
      setImportScanning(false)
    }
  }

  async function runImportCandidates(candidates: ImportCandidate[]) {
    if (importRunning || candidates.length === 0) return
    setImportRunning(true)
    setImportError(null)
    setImportMessage(null)
    try {
      const res = await fetch('/api/import/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates }),
      })
      const body = await res.json()
      if (!res.ok) {
        setImportError(body.error ?? 'Error al importar')
        return
      }
      setImportMessage(
        `${body.imported} canción${body.imported === 1 ? '' : 'es'} importada${body.imported === 1 ? '' : 's'}` +
          (body.failed.length ? `, ${body.failed.length} sin poder importarse.` : '.'),
      )
      setImportCandidates((prev) => prev?.filter((c) => !candidates.includes(c)) ?? null)
      refreshSongs()
    } finally {
      setImportRunning(false)
    }
  }

  // --- Re-sincronizar (letra y/o idioma mal, sin tocar el audio) ----------

  function openResync(song: Song) {
    setResyncSong(song)
    setResyncLyricsText('')
    setResyncLanguage('es')
    setResyncSeparateVocals(false)
    setResyncError(null)
  }

  function closeResync() {
    if (resyncing) return
    setResyncSong(null)
  }

  async function submitResync() {
    if (!resyncSong || !resyncLyricsText.trim() || resyncing) return
    setResyncing(true)
    setResyncError(null)
    try {
      const res = await fetch(`/api/songs/${resyncSong.id}/resync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics: resyncLyricsText,
          language: resyncLanguage,
          separateVocals: resyncSeparateVocals,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setResyncError(body.error ?? 'Error desconocido')
        return
      }
      setResyncSong(null)
      refreshSongs()
    } catch (err) {
      setResyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setResyncing(false)
    }
  }

  // --- Borrado ---------------------------------------------------------

  async function confirmDeleteSong() {
    if (!deleteSong || deleting) return
    setDeleting(true)
    try {
      await fetch(`/api/songs/${deleteSong.id}`, { method: 'DELETE' })
      setDeleteSong(null)
      refreshSongs()
    } finally {
      setDeleting(false)
    }
  }

  // --- Cola en vivo + puntajes ---------------------------------------------

  function openAddToQueue(song: Song) {
    setQueueSong(song)
    setQueueSingerId(null)
    setQueueSingerName('')
    setQueueSingerPhoto(null)
  }

  /** Si ya se eligió un cantante existente (singerId), lo usa tal cual. Si
   * no, crea uno nuevo con el nombre/foto tipeados — así el operador no
   * tiene que pasar por un paso separado de "registrar cantante". */
  async function resolveSingerId(name: string, singerId: string | null, photo: Blob | null): Promise<string | null> {
    if (singerId) return singerId
    const trimmed = name.trim()
    if (!trimmed) return null
    const form = new FormData()
    form.set('name', trimmed)
    if (photo) form.set('photo', photo, 'photo.jpg')
    const res = await fetch('/api/singers', { method: 'POST', body: form })
    if (!res.ok) return null
    const singer: Singer = await res.json()
    return singer.id
  }

  async function submitAddToQueue() {
    if (!queueSong) return
    const singerId = await resolveSingerId(queueSingerName, queueSingerId, queueSingerPhoto)
    if (!singerId) return
    await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId: queueSong.id, singerId }),
    })
    setQueueSong(null)
    refreshQueue()
    refreshSession()
  }

  async function handleRemoveFromQueue(id: string) {
    await fetch(`/api/queue/${id}`, { method: 'DELETE' })
    refreshQueue()
  }

  async function handleMoveQueueItem(id: string, direction: 'up' | 'down') {
    await fetch(`/api/queue/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    })
    refreshQueue()
  }

  async function toggleSyncVerified(song: Song) {
    await fetch(`/api/songs/${song.id}/sync-verified`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: !song.syncVerified }),
    })
    // Optimista: evita re-pedir la página entera solo por un toggle.
    setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, syncVerified: !song.syncVerified } : s)))
  }

  async function handleAdvanceQueue() {
    await fetch('/api/queue/advance', { method: 'POST' })
    refreshQueue()
  }

  // Animación de "cara en el escenario": atajo de teclado en pantalla
  // completa (T), invisible para el público. Se guarda photoUrl junto al
  // template en vez de re-derivarlo de `queue` en cada render — si la
  // canción avanza mientras el overlay está en pantalla, no queremos que la
  // cara cambie a mitad de la animación.
  const [activeFaceSwap, setActiveFaceSwap] = useState<{ template: Template; photoUrl: string } | null>(null)

  function triggerFaceSwapOverlay() {
    if (activeFaceSwap) return
    const playingItem = queue.find((q) => q.status === 'playing')
    if (!playingItem?.singerPhotoUrl) return
    if (templates.length === 0) return
    const template = templates[Math.floor(Math.random() * templates.length)]
    setActiveFaceSwap({ template, photoUrl: playingItem.singerPhotoUrl })
  }

  // Fin natural de la canción. El motor de audio y el <video> llegan acá por
  // caminos distintos, pero el efecto es el mismo: si hay gente esperando en
  // la cola y el auto-avance está prendido, se pasa al siguiente tras una
  // pausa corta (para aplaudir y que cambie el cantante). Sin esto el
  // operador tiene que tocar "siguiente" después de cada tema.
  function handleSongEnded() {
    pausedRef.current = true
    setPaused(true)
    if (!autoAdvanceRef.current) return
    const hasNext = queueRef.current.some((item) => item.status === 'queued')
    if (!hasNext) return
    setAdvanceCountdown(ADVANCE_GAP_SECONDS)
  }

  async function handleScoreItem(id: string, score: number) {
    await fetch(`/api/queue/${id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    })
    refreshQueue()
  }

  // --- Wizard "Agregar canción nueva" -------------------------------------

  function resetWizard() {
    setWizardStep(1)
    setWizardTitle('')
    setWizardArtist('')
    setWizardLanguage('es')
    setWizardSeparateVocals(false)
    setWizardAudioFile(null)
    setWizardLyricsText('')
    setSyncMessage(null)
    setSyncError(null)
  }

  function handleDropAudio(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setWizardDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) setWizardAudioFile(file)
  }

  function handleBrowseAudio(e: FormEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    if (file) setWizardAudioFile(file)
  }

  async function submitWizardSync() {
    if (!wizardAudioFile || !wizardLyricsText.trim() || syncing) return
    setSyncError(null)
    setSyncing(true)
    try {
      const form = new FormData()
      form.set('title', wizardTitle)
      form.set('artist', wizardArtist)
      form.set('language', wizardLanguage)
      form.set('separateVocals', String(wizardSeparateVocals))
      form.set('audio', wizardAudioFile)
      form.set('lyrics', wizardLyricsText)
      const res = await fetch('/api/songs/sync', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) {
        setSyncError(body.error ?? 'Error desconocido')
        return
      }
      setSyncMessage(`"${body.song.title}" agregada — ${body.message}`)
      setWizardStep(4)
      refreshSongs()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  function finishWizard() {
    resetWizard()
    setPage('biblioteca')
  }

  const duration =
    nowPlayingSong && !usesWebAudioEngine(nowPlayingSong) ? videoDuration : (audioBufferRef.current?.duration ?? 0)
  const isLocalReady = nowPlayingSong ? localReadyId === nowPlayingSong.id : false
  const isBakedVideo = !!nowPlayingSong && !usesWebAudioEngine(nowPlayingSong) && !!nowPlayingSong.videoUrl

  return (
    <div className={`app${kioskMode ? ' kiosk-mode' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-row">
            <span className="brand-mark">HCK</span>
            <span className="brand-kicker">Karaoke</span>
          </div>
          <div className="brand-sub">High Class Karaoke</div>
          <div className="brand-tagline">Donde el que canta, brilla.</div>
        </div>

        <nav>
          <div className="nav-eyebrow">Backstage</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-btn${page === item.id ? ' active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <button className="nav-btn" onClick={() => window.location.assign('/walk-on')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="5" r="2.4" />
              <path d="M12 8v6l-3 7M12 14l3 7M8 11l4-2 4 2" />
            </svg>
            Entrada en vivo
          </button>
          <button className="nav-btn" onClick={() => window.location.assign('/template-editor')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <ellipse cx="12" cy="12" rx="6" ry="8" />
              <path d="M4 6l3 2M20 6l-3 2M4 18l3-2M20 18l-3-2" />
            </svg>
            Editor de templates
          </button>
        </nav>

        <div className="session-box">
          {session ? (
            <>
              <div className="session-status">
                <span className="session-dot active" />
                Sesión activa · {sessionSingers.length} cantante{sessionSingers.length === 1 ? '' : 's'}
              </div>
              <button className="btn-secondary" onClick={handleEndSession}>
                Terminar sesión
              </button>
            </>
          ) : (
            <>
              <div className="session-status">
                <span className="session-dot" />
                Sesión: no iniciada
              </div>
              <button className="btn-primary" onClick={handleStartSession}>
                Iniciar sesión
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="stage">
        <section className={`page${page === 'biblioteca' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Biblioteca de canciones</h1>
              <p>
                {songsTotal} canciones{songsTotal !== songs.length ? ` (mostrando ${songs.length})` : ''}. Cada una es
                una oportunidad para ser la estrella de la noche.
              </p>
            </div>
            <button className="btn-primary" onClick={() => setPage('generar')}>
              + Agregar canción
            </button>
          </div>

          <div className="library-toolbar">
            <div className="search-wrap">
              <input
                className="search-input"
                placeholder="Buscar canción o artista..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
                  ✕
                </button>
              )}
            </div>
            <select
              className="filter-select"
              value={qualityFilter}
              onChange={(e) => setQualityFilter(e.target.value as Song['syncQuality'] | 'todos')}
            >
              <option value="todos">Toda calidad de sincronía</option>
              <option value="excellent">Excelente</option>
              <option value="interpolated">Interpolada</option>
              <option value="none">Sin letra</option>
            </select>
            <select
              className="filter-select"
              value={verifiedFilter}
              onChange={(e) => setVerifiedFilter(e.target.value as 'todos' | 'si' | 'no')}
              title="Canciones cuya sincronía ya escuchaste y confirmaste"
            >
              <option value="todos">Verificadas y sin verificar</option>
              <option value="si">Solo verificadas ✓</option>
              <option value="no">Solo sin verificar</option>
            </select>
            <button className="btn-toolbar" onClick={() => setSortAsc((v) => !v)}>
              Ordenar {sortAsc ? 'A→Z' : 'Z→A'}
            </button>
          </div>

          <div className="library-table">
            <div className="library-row library-row--head">
              <div>Canción</div>
              <div>Artista</div>
              <div>Formato</div>
              <div>Calidad</div>
              <div />
            </div>
            {songs.map((s) => {
              const isPlaying = s.id === nowPlayingSong?.id
              return (
                <div key={s.id} className={`library-row${isPlaying ? ' is-playing' : ''}`}>
                  <div className="song-cell">
                    <div className="song-swatch" style={{ background: songColor(s.id) }} />
                    {s.title}
                  </div>
                  <div className="dim-cell">{s.artist}</div>
                  <div className="dim-cell">{FORMAT_LABEL[s.sourceFormat]}</div>
                  <div>
                    <span className="badge" style={{ ['--quality-color' as string]: QUALITY_COLOR[s.syncQuality] }}>
                      {QUALITY_LABEL[s.syncQuality]}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button
                      className={`row-verify-btn${s.syncVerified ? ' is-verified' : ''}`}
                      onClick={() => toggleSyncVerified(s)}
                      title={
                        s.syncVerified
                          ? 'Sincronía verificada — click para desmarcar'
                          : 'Marcar como sincronía verificada'
                      }
                    >
                      ✓
                    </button>
                    <button className="row-play-btn" onClick={() => handlePlay(s.id)} disabled={isPlaying}>
                      {isPlaying ? 'Reproduciendo' : '▶ Reproducir'}
                    </button>
                    <button
                      className="row-queue-btn"
                      onClick={() => openAddToQueue(s)}
                      disabled={!session}
                      title={session ? 'Agregar a la cola' : 'Iniciá una sesión primero'}
                    >
                      + Cola
                    </button>
                    <button
                      className="row-queue-btn"
                      onClick={() => {
                        setAddToPlaylistSong(s)
                        setPlaylistMessage(null)
                      }}
                      title="Agregar a una playlist"
                    >
                      + Playlist
                    </button>
                    {s.audioUrl && (
                      <button className="row-resync-btn" onClick={() => openResync(s)} title="Re-sincronizar letra">
                        ⟳
                      </button>
                    )}
                    <button className="row-delete-btn" onClick={() => setDeleteSong(s)} title="Eliminar canción">
                      🗑
                    </button>
                  </div>
                </div>
              )
            })}
            {songs.length === 0 && !songsLoading && (
              <div className="no-results">Ninguna canción coincide. Probá otra búsqueda o filtro.</div>
            )}
          </div>
          {songs.length < songsTotal && (
            <button className="btn-secondary" style={{ marginTop: '0.75rem' }} disabled={songsLoading} onClick={loadMoreSongs}>
              {songsLoading ? 'Cargando…' : `Cargar más (${songsTotal - songs.length} restantes)`}
            </button>
          )}
          {playError && <p className="error">{playError}</p>}
        </section>

        <section className={`page${page === 'playlists' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Playlists</h1>
              <p>Listas armadas de antemano. Cargá una entera a la cola y arrancá la noche sin buscar tema por tema.</p>
            </div>
          </div>

          <div className="panel">
            <div className="field">
              <label>Nueva playlist</label>
              <div className="import-add-row">
                <input
                  type="text"
                  placeholder="Ej: Arranque tranqui"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
                />
                <button className="btn-primary" type="button" onClick={createPlaylist}>
                  Crear
                </button>
              </div>
            </div>
            {playlistMessage && <p className="ok">{playlistMessage}</p>}
          </div>

          {playlists.length === 0 ? (
            <p className="hint">Todavía no hay playlists. Creá una y sumale canciones desde la Biblioteca.</p>
          ) : (
            <div className="playlist-grid">
              {playlists.map((p) => (
                <div key={p.id} className={`playlist-card${openPlaylist?.id === p.id ? ' is-open' : ''}`}>
                  <div className="playlist-card-head">
                    <div>
                      <div className="playlist-name">{p.name}</div>
                      <div className="hint">{p.songCount} canciones</div>
                    </div>
                  </div>
                  <div className="playlist-card-actions">
                    <button
                      className="btn-primary"
                      disabled={p.songCount === 0 || !session}
                      title={session ? undefined : 'Iniciá una sesión primero'}
                      onClick={() => {
                        setPushPlaylist(p)
                        setPushSingerId(null)
                        setPushSingerName('')
                        setPushSingerPhoto(null)
                      }}
                    >
                      Agregar a la sesión
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => (openPlaylist?.id === p.id ? setOpenPlaylist(null) : showPlaylist(p.id))}
                    >
                      {openPlaylist?.id === p.id ? 'Cerrar' : 'Ver'}
                    </button>
                    <button className="btn-danger" onClick={() => deletePlaylist(p.id)}>
                      Borrar
                    </button>
                  </div>

                  {openPlaylist?.id === p.id && (
                    <div className="playlist-songs">
                      {openPlaylist.songs.length === 0 ? (
                        <p className="hint">Vacía. Agregale canciones con "+ Playlist" desde la Biblioteca.</p>
                      ) : (
                        openPlaylist.songs.map((s) => (
                          <div key={s.id} className="playlist-song-row">
                            <span className="song-swatch" style={{ background: songColor(s.id) }} />
                            <span className="playlist-song-title">{s.title}</span>
                            <span className="dim-cell">{s.artist}</span>
                            <button
                              className="row-delete-btn"
                              onClick={() => removeSongFromPlaylist(p.id, s.id)}
                              title="Quitar de la playlist"
                            >
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`page${page === 'cola' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Cola en vivo</h1>
              <p>Quién canta qué, en qué orden, y quién va ganando.</p>
            </div>
          </div>

          <div className="queue-now-card">
            <div className="queue-now-info">
              {queue[0]?.status === 'playing' ? (
                <>
                  <div className="queue-now-label">Cantando ahora</div>
                  <div className="queue-now-singer">
                    {queue[0].singerPhotoUrl && <img className="singer-thumb" src={queue[0].singerPhotoUrl} alt="" />}
                    {queue[0].singer}
                  </div>
                  <div className="queue-now-song">
                    {queue[0].song.title} · {queue[0].song.artist}
                  </div>
                </>
              ) : (
                <div className="queue-now-empty">Nadie está cantando todavía</div>
              )}
            </div>
            <button
              className="btn-primary"
              onClick={handleAdvanceQueue}
              disabled={queue.length === 0}
            >
              Siguiente ▶
            </button>
          </div>

          <div className="queue-columns">
            <div className="queue-panel">
              <h2>Próximos en la cola</h2>
              {queue.filter((q) => q.status === 'queued').length === 0 ? (
                <p className="hint">No hay nadie en espera — agregá cantantes desde la Biblioteca ("+ Cola").</p>
              ) : (
                <div className="queue-list">
                  {queue
                    .filter((q) => q.status === 'queued')
                    .map((item, i, arr) => (
                      <div className="queue-row" key={item.id}>
                        <div className="queue-row-position">{i + 1}</div>
                        <div className="queue-row-info">
                          <div className="queue-row-singer">
                            {item.singerPhotoUrl && <img className="singer-thumb" src={item.singerPhotoUrl} alt="" />}
                            {item.singer}
                          </div>
                          <div className="queue-row-song">
                            {item.song.title} · {item.song.artist}
                          </div>
                        </div>
                        <div className="queue-row-actions">
                          <button
                            className="queue-move-btn"
                            onClick={() => handleMoveQueueItem(item.id, 'up')}
                            disabled={i === 0}
                            aria-label="Subir"
                          >
                            ▲
                          </button>
                          <button
                            className="queue-move-btn"
                            onClick={() => handleMoveQueueItem(item.id, 'down')}
                            disabled={i === arr.length - 1}
                            aria-label="Bajar"
                          >
                            ▼
                          </button>
                          <button className="queue-remove-btn" onClick={() => handleRemoveFromQueue(item.id)}>
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="queue-panel">
              <h2>Falta puntuar</h2>
              {unscored.length === 0 ? (
                <p className="hint">Nada pendiente de puntaje.</p>
              ) : (
                <div className="queue-list">
                  {unscored.map((item) => (
                    <div className="queue-row" key={item.id}>
                      <div className="queue-row-info">
                        <div className="queue-row-singer">
                          {item.singerPhotoUrl && <img className="singer-thumb" src={item.singerPhotoUrl} alt="" />}
                          {item.singer}
                        </div>
                        <div className="queue-row-song">
                          {item.song.title} · {item.song.artist}
                        </div>
                      </div>
                      <div className="score-buttons">
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <button key={n} className="score-btn" onClick={() => handleScoreItem(item.id, n)}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="leaderboard-panel">
            <h2>Tabla de posiciones</h2>
            {leaderboard.length === 0 ? (
              <p className="hint">Todavía no hay puntajes cargados.</p>
            ) : (
              <div className="leaderboard-list">
                {leaderboard.map((entry, i) => (
                  <div className={`leaderboard-row${i === 0 ? ' is-leader' : ''}`} key={entry.singerId}>
                    <div className="leaderboard-rank">{i + 1}</div>
                    <div className="leaderboard-singer">
                      {entry.singerPhotoUrl && <img className="singer-thumb" src={entry.singerPhotoUrl} alt="" />}
                      {entry.singer}
                    </div>
                    <div className="leaderboard-songs">
                      {entry.songsScored} canción{entry.songsScored === 1 ? '' : 'es'}
                    </div>
                    <div className="leaderboard-score">{entry.totalScore} pts</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={`page${page === 'generar' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Agregar canción nueva</h1>
              <p>En cuatro pasos, tu próxima estrella tendrá una canción más para brillar.</p>
            </div>
          </div>

          <div className="wizard-steps">
            {(
              [
                [1, 'Subir audio'],
                [2, 'Pegar letra'],
                [3, 'Sincronizar'],
                [4, 'Guardar'],
              ] as const
            ).map(([n, label], i) => (
              <div className="wizard-step-wrap" key={n}>
                {i > 0 && <div className="wizard-connector" />}
                <div className={`wizard-step${wizardStep === n ? ' is-active' : ''}${wizardStep > n ? ' is-done' : ''}`}>
                  <div className="wizard-step-circle">{n}</div>
                  <span className="wizard-step-label">{label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="panel wizard-panel">
            {wizardStep === 1 && (
              <div>
                <div className="field">
                  <label>Título</label>
                  <input type="text" value={wizardTitle} onChange={(e) => setWizardTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label>Artista</label>
                  <input type="text" value={wizardArtist} onChange={(e) => setWizardArtist(e.target.value)} />
                </div>
                <div className="field">
                  <label>Idioma de la letra</label>
                  <select value={wizardLanguage} onChange={(e) => setWizardLanguage(e.target.value)}>
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="hint">
                    El modelo de alineación es específico por idioma — si no coincide con lo que se canta, la letra
                    sincroniza mal en toda la canción.
                  </div>
                </div>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={wizardSeparateVocals}
                    onChange={(e) => setWizardSeparateVocals(e.target.checked)}
                  />
                  <span>
                    Separar voz del instrumental antes de sincronizar (Demucs)
                    <span className="hint"> — mejor precisión con mucha base instrumental, tarda más.</span>
                  </span>
                </label>

                <div
                  className={`dropzone${wizardDragOver ? ' is-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setWizardDragOver(true)
                  }}
                  onDragLeave={() => setWizardDragOver(false)}
                  onDrop={handleDropAudio}
                  onClick={() => audioFileInputRef.current?.click()}
                >
                  <div className="dropzone-icon">MP3</div>
                  <div className="dropzone-title">Arrastrá el archivo acá</div>
                  <div className="dropzone-sub">o hacé clic para buscarlo en tu equipo</div>
                  {wizardAudioFile && <div className="dropzone-file">{wizardAudioFile.name}</div>}
                  <input
                    ref={audioFileInputRef}
                    type="file"
                    accept=".mp3,.mp4,.ogg,.wav,.webm"
                    hidden
                    onChange={handleBrowseAudio}
                  />
                </div>

                <div className="step-actions">
                  <button className="btn-primary" disabled={!wizardAudioFile} onClick={() => setWizardStep(2)}>
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div>
                <div className="field">
                  <label>Pegá la letra completa, una línea por renglón</label>
                  <textarea
                    rows={10}
                    value={wizardLyricsText}
                    onChange={(e) => setWizardLyricsText(e.target.value)}
                    placeholder={'Bajo las luces se enciende tu voz\ny esta noche el escenario es tuyo...'}
                  />
                  <div className="hint">No la pegues como un solo párrafo — hacen falta los saltos de línea reales.</div>
                </div>
                <div className="step-actions">
                  <button className="btn-secondary" onClick={() => setWizardStep(1)}>
                    Atrás
                  </button>
                  <button className="btn-primary" disabled={!wizardLyricsText.trim()} onClick={() => setWizardStep(3)}>
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div>
                <div className="hint" style={{ marginBottom: '1rem' }}>
                  Sincronizá la letra con el audio para un karaoke perfecto.
                </div>
                <div className="progress-track">
                  <div className={`progress-fill${syncing ? ' is-indeterminate' : ''}`} style={{ width: syncing ? '40%' : '0%' }} />
                </div>
                <div className="hint" style={{ marginTop: '0.5rem' }}>
                  {syncing ? 'Analizando el audio y ajustando tiempos… (puede tardar unos minutos)' : 'Presioná Sincronizar para comenzar.'}
                </div>
                {syncError && <p className="error">{syncError}</p>}
                <div className="step-actions">
                  <button className="btn-secondary" disabled={syncing} onClick={() => setWizardStep(2)}>
                    Atrás
                  </button>
                  <button className="btn-primary" disabled={syncing} onClick={submitWizardSync}>
                    {syncing ? 'Sincronizando…' : 'Sincronizar'}
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 4 && (
              <div className="wizard-done">
                <div className="wizard-done-icon">✓</div>
                <div className="wizard-done-title">Todo listo para brillar</div>
                <div className="hint">{syncMessage ?? 'La canción quedará disponible en tu biblioteca.'}</div>
                <button className="btn-primary" onClick={finishWizard}>
                  Ir a la biblioteca
                </button>
              </div>
            )}
          </div>
        </section>

        <section className={`page${page === 'subir' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Subir canción armada</h1>
              <p>Para cuando ya tenés un karaoke armado — LRC, JSON propio, CD+G o un video con letra quemada.</p>
            </div>
          </div>
          <div className="panel">
            <form onSubmit={handleUpload}>
              <div className="field">
                <label>Título</label>
                <input type="text" name="title" />
              </div>
              <div className="field">
                <label>Artista</label>
                <input type="text" name="artist" />
              </div>
              <div className="field">
                <label>Audio (mp3/ogg/opus/wav)</label>
                <input type="file" name="audio" accept=".mp3,.ogg,.opus,.wav" />
              </div>
              <div className="field">
                <label>Letra (.lrc, .json o .cdg)</label>
                <input type="file" name="lyrics" accept=".lrc,.json,.cdg" />
              </div>
              <div className="field">
                <label>Video (karaoke con letra quemada, sin audio aparte)</label>
                <input type="file" name="video" accept=".mp4,.webm,.mov" />
              </div>
              <button className="btn-primary" type="submit">
                Subir
              </button>
            </form>
            {uploadMessage && <p className="ok">{uploadMessage}</p>}
            {uploadError && <p className="error">{uploadError}</p>}
          </div>
        </section>

        <section className={`page${page === 'fondo' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Fondo de video</h1>
              <p>El clip detrás de la letra en la pantalla grande. La letra siempre queda encima, elijas el que elijas.</p>
            </div>
          </div>
          <div className="panel">
            <form onSubmit={handleBackgroundVideo}>
              <div className="field">
                <label>Video de fondo (mp4/webm/mov)</label>
                <input type="file" name="video" accept=".mp4,.webm,.mov" required />
              </div>
              <button className="btn-primary" type="submit">
                Actualizar fondo
              </button>
            </form>
            {backgroundMessage && <p className="ok">{backgroundMessage}</p>}
          </div>
        </section>

        <section className={`page${page === 'importar' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Importar carpetas</h1>
              <p>
                Agregá carpetas del disco con karaokes ya armados (audio + letra, o video con letra quemada). No se
                copian los archivos pesados — se sirven desde su ubicación original.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="field">
              <label>Agregar carpeta</label>
              <div className="import-add-row">
                <input
                  type="text"
                  placeholder="C:\Karaoke\Repertorio"
                  value={newImportRoot}
                  onChange={(e) => setNewImportRoot(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addImportRoot()}
                />
                <button className="btn-primary" type="button" onClick={addImportRoot}>
                  Agregar
                </button>
              </div>
            </div>

            {importRoots.length > 0 && (
              <ul className="import-roots-list">
                {importRoots.map((root) => (
                  <li key={root}>
                    <span>{root}</span>
                    <button className="btn-secondary" type="button" onClick={() => removeImportRoot(root)}>
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {importError && <p className="error">{importError}</p>}
            {importMessage && <p className="ok">{importMessage}</p>}

            <button
              className="btn-primary"
              type="button"
              disabled={importRoots.length === 0 || importScanning}
              onClick={scanImportFolders}
            >
              {importScanning ? 'Escaneando…' : 'Buscar karaokes nuevos'}
            </button>
          </div>

          {importCandidates && (
            <div className="panel panel--wide">
              {importCandidates.length === 0 ? (
                <p className="hint">No se encontraron karaokes nuevos en las carpetas configuradas.</p>
              ) : (
                <>
                  <div className="stage-head">
                    <h2>{importCandidates.length} encontrados</h2>
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={importRunning || !importCandidates.some((c) => c.detection.ok)}
                      onClick={() => runImportCandidates(importCandidates.filter((c) => c.detection.ok))}
                    >
                      {importRunning ? 'Importando…' : 'Importar todos los válidos'}
                    </button>
                  </div>
                  <div className="library-table import-table">
                    <div className="library-row library-row--head import-row">
                      <div>Canción</div>
                      <div>Artista</div>
                      <div>Detección</div>
                      <div />
                    </div>
                    {importCandidates.map((c) => (
                      <div key={c.key} className="library-row import-row">
                        <div className="song-cell">{c.title}</div>
                        <div className="dim-cell">{c.artist}</div>
                        <div className="dim-cell">
                          {c.detection.ok ? (
                            <span className="ok">{c.detection.message}</span>
                          ) : (
                            <span className="error">{c.detection.reason}</span>
                          )}
                        </div>
                        <div className="row-actions">
                          <button
                            className="btn-secondary"
                            type="button"
                            disabled={!c.detection.ok || importRunning}
                            onClick={() => runImportCandidates([c])}
                          >
                            Importar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </main>

      {kioskMode && (
        <div className="performance">
          {activeFaceSwap && (
            <FaceSwapOverlay
              template={activeFaceSwap.template}
              photoUrl={activeFaceSwap.photoUrl}
              onDone={() => setActiveFaceSwap(null)}
            />
          )}
          {backgroundVideoUrl && (
            <video className="background-video" src={backgroundVideoUrl} loop muted autoPlay playsInline />
          )}
          {dimBackground && <div className="performance-scrim" />}
          <div className="performance-content">
            {!nowPlayingSong ? (
              <p className="line line--waiting">Elegí una canción desde la biblioteca</p>
            ) : !usesWebAudioEngine(nowPlayingSong) ? (
              // El <video> real vive fuera de este bloque (ver más abajo) para
              // que entrar/salir de pantalla completa no lo remonte y corte la
              // reproducción — acá solo queda el botón de arranque.
              !isLocalReady ? (
                <button className="start-button" onClick={beginLocalPlayback}>
                  {`Reproducir: ${nowPlayingSong.title}`}
                </button>
              ) : !nowPlayingSong.videoUrl ? (
                <p className="line line--waiting">A "{nowPlayingSong.title}" le falta el archivo de video.</p>
              ) : null
            ) : loading ? (
              <p className="line line--waiting">Cargando "{nowPlayingSong.title}"…</p>
            ) : loadError ? (
              <p className="line line--waiting">
                Error al cargar "{nowPlayingSong.title}": {loadError}
              </p>
            ) : audioBlocked ? (
              <button className="start-button" onClick={retryAudio}>
                El navegador bloqueó el audio — click para activarlo
              </button>
            ) : !isLocalReady ? (
              <button className="start-button" onClick={beginLocalPlayback}>
                {`Reproducir: ${nowPlayingSong.title}`}
              </button>
            ) : nowPlayingSong.sourceFormat === 'cdg' && nowPlayingSong.lyricsUrl ? (
              <>
                <CdgPlayer cdgUrl={nowPlayingSong.lyricsUrl} getPositionSeconds={getPositionSeconds} />
                {paused && <p className="paused-badge">Pausado</p>}
              </>
            ) : lyrics ? (
              <>
                <LyricsView lyrics={lyrics} getPositionSeconds={getPositionSeconds} onActiveLineChange={setNextLineText} />
                {nextLineText && <p className="next-line-preview">{nextLineText}</p>}
                {paused && <p className="paused-badge">Pausado</p>}
              </>
            ) : null}
          </div>
          <button
            className={`dim-toggle-btn${dimBackground ? ' active' : ''}`}
            onClick={() => setDimBackground((v) => !v)}
            aria-label="Oscurecer el fondo para que se lea mejor la letra"
            title="Oscurecer el fondo para que se lea mejor la letra"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill={dimBackground ? 'currentColor' : 'none'} />
            </svg>
          </button>
          <button className="exit-kiosk-btn" onClick={exitKiosk} aria-label="Salir de pantalla completa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4" />
            </svg>
          </button>
        </div>
      )}

      {advanceCountdown !== null && (
        <div className="advance-toast">
          <span>Siguiente en {advanceCountdown}…</span>
          <button className="pill-btn" onClick={() => setAdvanceCountdown(0)}>
            Ahora
          </button>
          <button className="pill-btn" onClick={() => setAdvanceCountdown(null)}>
            Cancelar
          </button>
        </div>
      )}

      {/* Reproductor de video quemado: se monta una sola vez, fuera del bloque
          de kiosco, para que alternar pantalla completa no lo remonte (eso
          reiniciaría la canción). En modo backstage queda como mini-preview
          para que el operador vea y escuche lo que está sonando; en kiosco
          pasa a ocupar toda la pantalla. */}
      {isBakedVideo && isLocalReady && (
        <div className={`baked-video-stage${kioskMode ? ' is-kiosk' : ' is-mini'}`}>
          <video
            key={nowPlayingSong!.id}
            ref={(el) => {
              videoRef.current = el
              if (el) el.volume = volume / 100
            }}
            className="baked-video-player"
            src={nowPlayingSong!.videoUrl!}
            autoPlay
            playsInline
            controls={!kioskMode}
            onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onEnded={handleSongEnded}
          />
        </div>
      )}

      {!kioskMode && showLyricsOverlay && lyrics && (
        <div className="lyrics-overlay">
          <LyricsView lyrics={lyrics} getPositionSeconds={getPositionSeconds} onActiveLineChange={setNextLineText} />
          {nextLineText && <p className="next-line-preview next-line-preview--overlay">{nextLineText}</p>}
          <button className="lyrics-overlay-close" onClick={() => setShowLyricsOverlay(false)}>
            Ocultar letras
          </button>
        </div>
      )}

      {resyncSong && (
        <div className="modal-backdrop" onClick={closeResync}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Re-sincronizar "{resyncSong.title}"</h2>
            <p className="hint">
              El audio no cambia — solo se vuelve a correr el reconocimiento con la letra y el idioma que pongas acá.
              Usalo si la letra quedó desincronizada o se sincronizó con el idioma equivocado.
            </p>
            <div className="field">
              <label>Idioma de la letra</label>
              <select value={resyncLanguage} onChange={(e) => setResyncLanguage(e.target.value)}>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={resyncSeparateVocals}
                onChange={(e) => setResyncSeparateVocals(e.target.checked)}
              />
              <span>
                Separar voz del instrumental antes de sincronizar (Demucs)
                <span className="hint"> — mejor precisión con mucha base instrumental, tarda más.</span>
              </span>
            </label>
            <div className="field">
              <label>Letra completa (una línea por renglón)</label>
              <textarea
                rows={10}
                value={resyncLyricsText}
                onChange={(e) => setResyncLyricsText(e.target.value)}
                placeholder={'Pegá acá la letra completa,\nuna línea por renglón...'}
              />
            </div>
            {resyncError && <p className="error">{resyncError}</p>}
            <div className="step-actions">
              <button className="btn-secondary" onClick={closeResync} disabled={resyncing}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={submitResync} disabled={resyncing || !resyncLyricsText.trim()}>
                {resyncing ? 'Sincronizando…' : 'Re-sincronizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addToPlaylistSong && (
        <div className="modal-backdrop" onClick={() => setAddToPlaylistSong(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Agregar "{addToPlaylistSong.title}" a…</h2>
            {playlists.length === 0 ? (
              <p className="hint">No hay playlists todavía. Creá una desde la pantalla Playlists.</p>
            ) : (
              <div className="playlist-picker">
                {playlists.map((p) => (
                  <button
                    key={p.id}
                    className="btn-secondary"
                    onClick={() => addSongToPlaylist(p.id, addToPlaylistSong.id)}
                  >
                    {p.name} <span className="hint">({p.songCount})</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setAddToPlaylistSong(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {pushPlaylist && (
        <div className="modal-backdrop" onClick={() => setPushPlaylist(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Agregar "{pushPlaylist.name}" a la sesión</h2>
            <p className="hint">
              Se van a encolar sus {pushPlaylist.songCount} canciones, en orden, al final de la cola.
            </p>
            <SingerPicker
              sessionSingers={sessionSingers}
              allowBlank
              value={{ singerId: pushSingerId, name: pushSingerName, photo: pushSingerPhoto }}
              onChange={(v) => {
                setPushSingerId(v.singerId)
                setPushSingerName(v.name)
                setPushSingerPhoto(v.photo)
              }}
              onEnter={submitPushPlaylist}
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setPushPlaylist(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={submitPushPlaylist}>
                Agregar a la cola
              </button>
            </div>
          </div>
        </div>
      )}

      {queueSong && (
        <div className="modal-backdrop" onClick={() => setQueueSong(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Agregar "{queueSong.title}" a la cola</h2>
            <SingerPicker
              sessionSingers={sessionSingers}
              autoFocus
              value={{ singerId: queueSingerId, name: queueSingerName, photo: queueSingerPhoto }}
              onChange={(v) => {
                setQueueSingerId(v.singerId)
                setQueueSingerName(v.name)
                setQueueSingerPhoto(v.photo)
              }}
              onEnter={submitAddToQueue}
            />
            <div className="step-actions">
              <button className="btn-secondary" onClick={() => setQueueSong(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={submitAddToQueue}>
                Agregar a la cola
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteSong && (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteSong(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>¿Eliminar "{deleteSong.title}"?</h2>
            <p className="hint">
              Se borra el audio, la letra y cualquier cola/puntaje asociado. Esta acción no se puede deshacer.
            </p>
            <div className="step-actions">
              <button className="btn-secondary" onClick={() => setDeleteSong(null)} disabled={deleting}>
                Cancelar
              </button>
              <button className="btn-danger" onClick={confirmDeleteSong} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="player-bar">
        {nowPlayingSong && (
          <input
            type="range"
            className="scrubber"
            min={0}
            max={duration || 0}
            step={0.1}
            disabled={!duration}
            value={scrubValue ?? displayPosition}
            style={{ ['--fill' as string]: `${duration ? ((scrubValue ?? displayPosition) / duration) * 100 : 0}%` }}
            onChange={handleScrubDrag}
            onMouseUp={handleScrubCommit}
            onTouchEnd={handleScrubCommit}
          />
        )}
        <div className="now-playing">
          {nowPlayingSong ? (
            <>
              <div className="player-thumb" style={{ background: songColor(nowPlayingSong.id) }} />
              <div className="now-playing-text">
                <div className="now-playing-title">{nowPlayingSong.title}</div>
                <div className="now-playing-artist">{nowPlayingSong.artist}</div>
              </div>
              <button
                className="playpause-btn"
                // Con una canción elegida pero sin arrancar (ej. después de
                // recargar la página), el botón la pone en marcha en vez de
                // quedar muerto y obligar a volver a la Biblioteca.
                onClick={isLocalReady ? togglePlayPause : beginLocalPlayback}
                aria-label={!isLocalReady || paused ? 'Reproducir' : 'Pausar'}
              >
                {!isLocalReady || paused ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4l14 8-14 8z" />
                  </svg>
                ) : (
                  <div className="eq">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </button>
              {duration > 0 && (
                <div className="now-playing-time">
                  {formatTime(scrubValue ?? displayPosition)} / {formatTime(duration)}
                </div>
              )}
            </>
          ) : (
            <div className="now-playing-empty">Nadie está cantando todavía</div>
          )}
        </div>

        <div className="player-side">
          <input
            type="range"
            className="volume-slider"
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            aria-label="Volumen"
          />
          <button
            className={`pill-btn${showLyricsOverlay ? ' active' : ''}`}
            onClick={() => setShowLyricsOverlay((v) => !v)}
            disabled={!lyrics || kioskMode}
          >
            {showLyricsOverlay ? 'Ocultar letras' : 'Mostrar letras'}
          </button>
          {nowPlayingSong?.instrumentalUrl && (
            <button
              className={`pill-btn${vocalsOff ? ' active' : ''}`}
              onClick={toggleVocals}
              title="Apagar la voz original y cantar sobre la base sola"
            >
              {vocalsOff ? 'Voz original: apagada' : 'Apagar voz original'}
            </button>
          )}
          {lyrics && !kioskMode && (
            <button
              className={`pill-btn${showSyncEditor ? ' active' : ''}`}
              onClick={() => setShowSyncEditor((v) => !v)}
              title="Corregir líneas que quedaron desincronizadas (ej. un coro repetido)"
            >
              Corregir sincronía
            </button>
          )}
          <button
            className={`pill-btn${autoAdvance ? ' active' : ''}`}
            onClick={() => setAutoAdvance((v) => !v)}
            title="Al terminar cada canción, pasar solo a la siguiente de la cola"
          >
            {autoAdvance ? 'Auto-avance: sí' : 'Auto-avance: no'}
          </button>
          {!kioskMode && (
            <button className="pill-btn" onClick={enterKiosk}>
              Pantalla completa
            </button>
          )}
        </div>
      </div>

      {showSyncEditor && lyrics && (
        <div className="sync-editor-panel">
          <div className="sync-editor-head">
            <div>
              <h2>Corregir sincronía</h2>
              <p className="hint">
                Escuchá y, cuando una línea suene en un momento distinto al que dice, tocá "Fijar acá" en ese
                instante. "Fijar desde acá" además corre todo lo que sigue por el mismo desfasaje.
              </p>
            </div>
            <button className="pill-btn" onClick={() => setShowSyncEditor(false)}>
              Cerrar
            </button>
          </div>
          <div className="sync-editor-list">
            {lyrics.lines.map((line, i) => {
              const isActive = displayPosition >= line.start && displayPosition < line.end
              return (
                <div key={i} className={`sync-editor-row${isActive ? ' is-active' : ''}`}>
                  <span className="sync-editor-time">{formatTime(line.start)}</span>
                  <span className="sync-editor-text">{line.words.map((w) => w.t).join(' ')}</span>
                  <div className="sync-editor-row-actions">
                    <button className="sync-fix-btn" onClick={() => fixLineHere(i, false)}>
                      Fijar acá
                    </button>
                    <button className="sync-fix-btn" onClick={() => fixLineHere(i, true)}>
                      Fijar desde acá →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="sync-editor-footer">
            {syncEdited ? (
              <>
                <span className="hint">Hay cambios sin guardar.</span>
                <button className="btn-secondary" onClick={discardSyncEdits} disabled={savingSyncEdits}>
                  Descartar
                </button>
                <button className="btn-primary" onClick={saveSyncEdits} disabled={savingSyncEdits}>
                  {savingSyncEdits ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </>
            ) : (
              <span className="hint">Sin cambios sin guardar.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
