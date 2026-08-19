import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import type {
  Banner,
  CategoryId,
  Genre,
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
  TemplateRenderStatus,
} from '@kiosco/shared'
import { GENRES, CATEGORIES } from '@kiosco/shared'
import { LyricsView } from './LyricsView'
import { CdgPlayer } from './CdgPlayer'
import { SingerPicker, type SingerPickerValue } from './SingerPicker'
import { FaceSwapOverlay } from './FaceSwapOverlay'
import { FaceSwapVideoOverlay } from './FaceSwapVideoOverlay'
import { warmFaceCutout, type Oval } from './faceSwapCache'
import { CategoryCarousel } from './CategoryCarousel'
import { BannerCarousel } from './BannerCarousel'
import { SessionSetupWizard } from './SessionSetupWizard'
import { SessionResults } from './SessionResults'
import { songColor } from './songColor'
import { Icon, type IconName } from './icons'

// Kiosco de karaoke de una sola pantalla: navegación/biblioteca y el motor
// de audio real (Web Audio) conviven en esta misma app — ver ROADMAP.md.
// "Pantalla completa" es solo un modo visual (más Fullscreen API nativa),
// no un proceso ni una pestaña distinta.

const EMPTY_LYRICS: LyricsDoc = { lines: [] }

/** Lo que dispara un overlay de "cara en el escenario" — dos formas según el
 * `kind` del template (ver domain.ts): `sticker` sigue componiendo en vivo
 * con FaceSwapOverlay; `faceswap` solo reproduce el clip ya renderizado por
 * el server (FaceSwapVideoOverlay), identificado por singerId+templateId. */
type FaceSwapTrigger =
  | { kind: 'sticker'; template: Extract<Template, { kind: 'sticker' }>; photoUrl: string; oval: Singer['oval'] }
  | { kind: 'faceswap'; singerId: string; templateId: string }

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


// CD+G tiene su propia animación (canvas), pero el audio sigue siendo un
// archivo aparte que necesita el motor de Web Audio de siempre — a
// diferencia de 'baked-video', que trae todo (audio+letra) en un solo video
// y no pasa por acá. Ver ROADMAP.md, "formatos estándar de karaoke".
function usesWebAudioEngine(song: Song): boolean {
  return song.playbackMode === 'overlay' || song.sourceFormat === 'cdg'
}

type Page =
  | 'inicio'
  | 'biblioteca'
  | 'playlists'
  | 'cola'
  | 'studio'
  | 'generar'
  | 'subir'
  | 'fondo'
  | 'funbox'
  | 'configuracion'
  | 'categorias'
  | 'banners'
  | 'portadas'
  | 'importar'
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

// Playlists queda fuera de la nav por ahora (a pedido explícito, "después
// refinamos esto") — el código/página sigue vivo, solo no hay forma de
// llegar ahí desde la UI todavía.
const NAV_ITEMS: { id: Page; label: string; icon: IconName }[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'biblioteca', label: 'Biblioteca de canciones', icon: 'search' },
  { id: 'cola', label: 'Sesión de Karaoke', icon: 'list' },
  { id: 'studio', label: 'Studio', icon: 'wand' },
  { id: 'configuracion', label: 'Configuración', icon: 'gear' },
]

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'fr', label: 'Francés' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Alemán' },
]

/** `srcObject` no es una prop de JSX — hay que asignarlo a mano sobre el
 * elemento montado, mismo patrón que ya usa SingerPicker para la cámara. */
function LiveBackgroundVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={videoRef} className="background-video" muted autoPlay playsInline />
}

export function App() {
  const [page, setPage] = useState<Page>('inicio')
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

  // Fondo en vivo (cámara virtual de OBS u otra cámara/captura): cuando está
  // activa tapa al video de fondo subido, mientras dure — se apaga a mano,
  // no se ata al ciclo de vida de la sesión ni de pantalla completa.
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [liveCameraStream, setLiveCameraStream] = useState<MediaStream | null>(null)
  const [liveCameraError, setLiveCameraError] = useState<string | null>(null)

  // Inicio: hasta 3 categorías elegidas en Configuración → Categorías de inicio.
  const [homeCategories, setHomeCategories] = useState<CategoryId[]>([])
  // Banners del carrusel de Inicio (ver PROMPTS-BANNERS.md) — lista abierta,
  // se suben/borran/reordenan desde Configuración → Banners de inicio.
  const [banners, setBanners] = useState<Banner[]>([])
  const [bannerUploading, setBannerUploading] = useState(false)
  // Portada de cada categoría (ver CATEGORIES) — `null` si esa categoría
  // todavía no tiene imagen subida. Se sube/borra desde Configuración →
  // Portadas de categoría; CategoryCarousel la usa para el ícono de Inicio.
  const [categoryImages, setCategoryImages] = useState<Record<string, string | null>>({})
  const [categoryImageUploading, setCategoryImageUploading] = useState<CategoryId | null>(null)

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
  const [libraryView, setLibraryView] = useState<'list' | 'grid'>('list')

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
  const [pushSingerOval, setPushSingerOval] = useState<Oval | null>(null)
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null)

  // Sesión de karaoke: agrupa cantantes+fotos+cola+puntajes, como mucho una
  // activa a la vez, efímera — ver ROADMAP.md.
  const [session, setSession] = useState<Session | null>(null)
  const [sessionSingers, setSessionSingers] = useState<Singer[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  // El wizard de armado se abre solo mientras la sesión está en 'armando',
  // pero se puede cerrar para mirar la Biblioteca y volver — de ahí que sea
  // estado propio y no derivado puro de session.status.
  const [showWizard, setShowWizard] = useState(false)
  // Pantalla de resultados al terminar — separado de session.status porque
  // se abre ANTES de borrar nada (ver handleEndSession/handleCloseSession).
  const [showResults, setShowResults] = useState(false)
  const [songCounts, setSongCounts] = useState<Record<string, number>>({})
  const [funboxUploading, setFunboxUploading] = useState(false)
  const [funboxError, setFunboxError] = useState<string | null>(null)
  const [funboxKind, setFunboxKind] = useState<'sticker' | 'faceswap'>('sticker')
  // Probar un template con la foto de un cantante real, sin depender de
  // pantalla completa ni de una canción sonando — para poder distinguir "no
  // mapea bien" de "no se ve nada" de "se queda en el primer frame".
  const [testSingerId, setTestSingerId] = useState<string | null>(null)
  const [testFaceSwap, setTestFaceSwap] = useState<FaceSwapTrigger | null>(null)
  // Estado de los renders `faceswap` en curso — { singerId: { templateId:
  // status } }, poblado por polling mientras haya sesión (ver
  // GET /api/sessions/current/faceswap-status). Determina qué hotkeys del
  // panel en vivo están habilitados.
  const [faceswapStatus, setFaceswapStatus] = useState<Record<string, Record<string, TemplateRenderStatus>>>({})

  // Cola en vivo + puntajes
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [unscored, setUnscored] = useState<QueueItem[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [queueSong, setQueueSong] = useState<Song | null>(null)
  const [queueSingerId, setQueueSingerId] = useState<string | null>(null)
  const [queueSingerName, setQueueSingerName] = useState('')
  const [queueSingerPhoto, setQueueSingerPhoto] = useState<Blob | null>(null)
  const [queueSingerOval, setQueueSingerOval] = useState<Oval | null>(null)

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

  async function refreshHomeCategories() {
    const res = await fetch('/api/settings/home-categories')
    setHomeCategories(await res.json())
  }

  async function refreshBanners() {
    const res = await fetch('/api/banners')
    setBanners(await res.json())
  }

  async function handleUploadBanner(file: File) {
    setBannerUploading(true)
    try {
      const form = new FormData()
      form.set('image', file)
      await fetch('/api/banners', { method: 'POST', body: form })
      refreshBanners()
    } finally {
      setBannerUploading(false)
    }
  }

  async function handleDeleteBanner(id: string) {
    await fetch(`/api/banners/${id}`, { method: 'DELETE' })
    refreshBanners()
  }

  async function reorderBanner(id: string, dir: 'up' | 'down') {
    const i = banners.findIndex((b) => b.id === id)
    const j = dir === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= banners.length) return
    const next = [...banners]
    ;[next[i], next[j]] = [next[j], next[i]]
    setBanners(next)
    await fetch('/api/banners/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: next.map((b) => b.id) }),
    })
  }

  async function refreshCategoryImages() {
    const res = await fetch('/api/settings/category-images')
    setCategoryImages(await res.json())
  }

  async function handleUploadCategoryImage(categoryId: CategoryId, file: File) {
    setCategoryImageUploading(categoryId)
    try {
      const form = new FormData()
      form.set('image', file)
      const res = await fetch(`/api/settings/category-image/${categoryId}`, { method: 'POST', body: form })
      const body = await res.json()
      if (res.ok) setCategoryImages(body.images)
    } finally {
      setCategoryImageUploading(null)
    }
  }

  async function handleDeleteCategoryImage(categoryId: CategoryId) {
    const res = await fetch(`/api/settings/category-image/${categoryId}`, { method: 'DELETE' })
    const body = await res.json()
    if (res.ok) setCategoryImages(body.images)
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
    const [queueRes, unscoredRes, leaderboardRes, countsRes] = await Promise.all([
      fetch('/api/queue'),
      fetch('/api/queue/unscored'),
      fetch('/api/leaderboard'),
      fetch('/api/queue/counts'),
    ])
    setQueue(await queueRes.json())
    setUnscored(await unscoredRes.json())
    setLeaderboard(await leaderboardRes.json())
    setSongCounts(await countsRes.json())
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

  async function refreshFaceswapStatus() {
    const res = await fetch('/api/sessions/current/faceswap-status')
    setFaceswapStatus(await res.json())
  }

  // Mientras haya sesión, pollea el estado de los renders `faceswap` en curso
  // — no hay bus de eventos por WS para esto (ver protocol.ts), mismo
  // criterio que el resto de los refrescos de esta app. Cada pocos segundos
  // alcanza: no es algo que tenga que reflejarse al instante.
  useEffect(() => {
    if (!session) return
    refreshFaceswapStatus()
    const interval = window.setInterval(refreshFaceswapStatus, 3000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id])

  /** Sube un video crudo — `kind: 'sticker'` corre el tracking por color en
   * el server (pipeline/track_color.py); `kind: 'faceswap'` corre el
   * análisis de cara real (pipeline/analyze_template_face.py), más lento.
   * Sin esto habría que pasar por /template-editor o la terminal a mano. */
  async function handleUploadTemplate(file: File, kind: 'sticker' | 'faceswap') {
    setFunboxUploading(true)
    setFunboxError(null)
    try {
      const form = new FormData()
      form.set('video', file)
      form.set('kind', kind)
      const res = await fetch('/api/templates', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'No se pudo mapear el video')
      refreshTemplates()
      if (kind === 'faceswap') refreshFaceswapStatus()
    } catch (err) {
      setFunboxError(err instanceof Error ? err.message : String(err))
    } finally {
      setFunboxUploading(false)
    }
  }

  async function handleDeleteTemplate(id: string) {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    refreshTemplates()
  }

  /** Crea la sesión en estado 'armando' y abre el armado guiado — antes esto
   * solo creaba la fila y dejaba al operador en una pantalla vacía sin
   * ninguna acción evidente para cargar al primer cantante. */
  async function handleStartSession() {
    await fetch('/api/sessions/start', { method: 'POST' })
    await Promise.all([refreshSession(), refreshQueue()])
    setPage('cola')
    setShowWizard(true)
  }

  /** Vuelve a la sesión en curso desde cualquier pantalla; si todavía se está
   * armando, reabre el wizard donde había quedado. */
  function handleGoToSession() {
    setPage('cola')
    if (session?.status === 'armando') setShowWizard(true)
  }

  async function handleBeginSession() {
    const res = await fetch('/api/sessions/begin', { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'No se pudo comenzar la sesión.')
    }
    await Promise.all([refreshSession(), refreshQueue()])
    setShowWizard(false)
  }

  /** "Terminar sesión" ya no borra directo: abre los resultados primero
   * (calculados con los datos todavía vivos), y el borrado real queda para
   * cuando el admin los cierra — ver handleCloseSession. */
  function handleEndSession() {
    if (!session) return
    setShowResults(true)
  }

  async function handleCloseSession() {
    await fetch('/api/sessions/end', { method: 'POST' })
    setShowResults(false)
    setShowWizard(false)
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
    const singerId = await resolveSingerId(pushSingerName, pushSingerId, pushSingerPhoto, pushSingerOval)
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
    setPushSingerOval(null)
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
    refreshHomeCategories()
    refreshBanners()
    refreshCategoryImages()
    refreshCameraDevices()

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

  // Recién conectada la cámara virtual (OBS recién abierta, por ejemplo) el
  // navegador no la lista hasta este evento — sin esto había que refrescar
  // la página para verla en el selector.
  useEffect(() => {
    navigator.mediaDevices?.addEventListener('devicechange', refreshCameraDevices)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshCameraDevices)
  }, [])

  // Suelta la cámara si el stream cambia o se desmonta el componente —
  // sin esto el ícono de "cámara en uso" del navegador/OBS queda prendido.
  useEffect(() => {
    return () => {
      liveCameraStream?.getTracks().forEach((t) => t.stop())
    }
  }, [liveCameraStream])

  // Búsqueda/filtro/orden pegan al server — debounce para no mandar un
  // request por tecla mientras se escribe.
  useEffect(() => {
    const id = setTimeout(() => refreshSongs(), 250)
    return () => clearTimeout(id)
  }, [searchQuery, qualityFilter, verifiedFilter, sortAsc])

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance
  }, [autoAdvance])

  // Un modal abierto se lleva el teclado: Escape lo cierra, y los atajos
  // globales (espacio, flechas, hotkeys de cara) quedan en pausa para no
  // dispararse por accidente mientras el operador está en un formulario.
  const openModal = resyncSong ?? addToPlaylistSong ?? pushPlaylist ?? queueSong ?? deleteSong ?? null
  const modalOpen = openModal !== null || showWizard || showResults

  useEffect(() => {
    if (openModal === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || deleting) return
      setResyncSong(null)
      setAddToPlaylistSong(null)
      setPushPlaylist(null)
      setQueueSong(null)
      setDeleteSong(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openModal, deleting])

  useEffect(() => {
    if (!testFaceSwap) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTestFaceSwap(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [testFaceSwap])

  // Atajos de teclado: el kiosco se opera de lejos, muchas veces sin mouse a
  // mano. Se ignoran mientras se escribe en un campo, para no robarle la
  // barra espaciadora a la búsqueda ni a la letra pegada en el wizard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing || modalOpen) return

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
      } else if (kioskMode && session && e.key >= '1' && e.key <= '9') {
        const template = templates[Number(e.key) - 1]
        if (template) triggerFaceSwap(template)
      } else if (kioskMode && e.key === '0') {
        // "0" no mapea a ningún template — es el hotkey explícito para
        // cortar el video de Fun Box en curso y volver al fondo.
        setActiveFaceSwap(null)
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

  /** Los labels de los dispositivos (ej. "OBS Virtual Camera") solo vienen
   * poblados después de que el sitio tuvo permiso de cámara alguna vez —
   * por eso se reintenta después de un getUserMedia exitoso, además de al
   * montar y cada vez que el SO conecta/desconecta un dispositivo. */
  async function refreshCameraDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameraDevices(devices.filter((d) => d.kind === 'videoinput'))
    } catch {
      // Sin permiso todavía o API no disponible — el selector queda vacío.
    }
  }

  async function startLiveCamera() {
    setLiveCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
      })
      liveCameraStream?.getTracks().forEach((t) => t.stop())
      setLiveCameraStream(stream)
      refreshCameraDevices()
    } catch {
      setLiveCameraError(
        'No se pudo acceder a la cámara — revisá el permiso del navegador y que OBS tenga la cámara virtual iniciada.',
      )
    }
  }

  function stopLiveCamera() {
    liveCameraStream?.getTracks().forEach((t) => t.stop())
    setLiveCameraStream(null)
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
    setQueueSingerOval(null)
  }

  /** Si ya se eligió un cantante existente (singerId), lo usa tal cual. Si
   * no, crea uno nuevo con el nombre/foto tipeados — así el operador no
   * tiene que pasar por un paso separado de "registrar cantante". */
  async function resolveSingerId(
    name: string,
    singerId: string | null,
    photo: Blob | null,
    oval: Oval | null,
  ): Promise<string | null> {
    if (singerId) return singerId
    const trimmed = name.trim()
    if (!trimmed) return null
    const form = new FormData()
    form.set('name', trimmed)
    if (photo) form.set('photo', photo, 'photo.jpg')
    if (oval) {
      form.set('ovalCx', String(oval.cx))
      form.set('ovalCy', String(oval.cy))
      form.set('ovalScale', String(oval.scale))
    }
    const res = await fetch('/api/singers', { method: 'POST', body: form })
    if (!res.ok) return null
    const singer: Singer = await res.json()
    return singer.id
  }

  async function submitAddToQueue() {
    if (!queueSong) return
    const singerId = await resolveSingerId(queueSingerName, queueSingerId, queueSingerPhoto, queueSingerOval)
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

  /** Reparte lo que queda en espera alternando cantante por cantante — para
   * cuando se sumaron canciones en vivo y la cola quedó despareja. El show
   * ya arranca alternado solo (ver handleBeginSession); esto es para
   * después. */
  async function handleInterleaveQueue() {
    await fetch('/api/queue/interleave', { method: 'POST' })
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

  /** Etiquetado de género a mano — ningún importador lo trae (ver Categorías de inicio). */
  async function handleSetGenre(songId: string, genre: Genre | null) {
    await fetch(`/api/songs/${songId}/genre`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre }),
    })
    setSongs((prev) => prev.map((s) => (s.id === songId ? { ...s, genre } : s)))
  }

  async function handleAdvanceQueue() {
    await fetch('/api/queue/advance', { method: 'POST' })
    refreshQueue()
  }

  // Animación de "cara en el escenario": atajo de teclado en pantalla
  // completa (T), invisible para el público. Se guarda el trigger completo
  // en vez de re-derivarlo de `queue` en cada render — si la canción avanza
  // mientras el overlay está en pantalla, no queremos que la cara cambie a
  // mitad de la animación.
  const [activeFaceSwap, setActiveFaceSwap] = useState<FaceSwapTrigger | null>(null)
  // Se suma en cada trigger nuevo y se usa como `key` del overlay: sin esto,
  // tocar otro número mientras un video de Fun Box ya está sonando cambiaba
  // el `videoUrl`/`template` del mismo <video> montado, y un <video> ya
  // montado no relanza `autoPlay` solo con que cambie su `src` — quedaba
  // congelado en el cuadro viejo en vez de arrancar el nuevo. Forzando un
  // remount (key distinta) por cada trigger, sea el mismo template de nuevo
  // o uno distinto, siempre arranca limpio.
  const [activeFaceSwapNonce, setActiveFaceSwapNonce] = useState(0)

  // Cierra el video de Fun Box en vuelo y vuelve al fondo — el fondo ya está
  // montado debajo en todo momento (ver el JSX de `.performance` más abajo),
  // así que alcanza con soltar el trigger. Se dispara solo: al salir de
  // pantalla completa, y al cambiar la canción que está sonando (el hotkey
  // "0" y "tocar otro número" se manejan aparte, en el handler de teclado).
  useEffect(() => {
    if (!kioskMode) setActiveFaceSwap(null)
  }, [kioskMode])

  const playingQueueItemId = queue.find((q) => q.status === 'playing')?.id ?? null
  useEffect(() => {
    setActiveFaceSwap(null)
  }, [playingQueueItemId])

  const stickerTemplates = templates.filter((t): t is Extract<Template, { kind: 'sticker' }> => t.kind === 'sticker')
  const faceswapTemplates = templates.filter((t): t is Extract<Template, { kind: 'faceswap' }> => t.kind === 'faceswap')

  // Progreso agregado de los renders faceswap en curso — cada combinación
  // cantante-con-foto × template `faceswap` cuenta una vez. Sirve para un
  // indicador ambiente (no hace falta ir tarjeta por tarjeta para saber
  // cuánto falta), y como prueba visible de que agregar un cantante nuevo
  // solo suma SUS combinaciones al total, no reprocesa las que ya estaban
  // listas (ver triggerFaceSwapRendersForSinger en el server, ya es
  // incremental).
  const faceswapProgress = (() => {
    if (faceswapTemplates.length === 0) return null
    const singers = sessionSingers.filter((s) => s.photoUrl)
    if (singers.length === 0) return null
    let ready = 0
    const total = singers.length * faceswapTemplates.length
    for (const s of singers) {
      for (const t of faceswapTemplates) {
        if (faceswapStatus[s.id]?.[t.id] === 'ready') ready++
      }
    }
    return { ready, total }
  })()

  function triggerFaceSwap(template: Template) {
    // El panel se ve también fuera de pantalla completa (para previsualizar
    // el mapeo antes de arrancar), pero el overlay solo se monta dentro de
    // `{kioskMode && <div className="performance">...}` — sin este chequeo,
    // clickear una tarjeta afuera de pantalla completa dejaba activeFaceSwap
    // seteado para siempre (el overlay nunca montaba, `onDone` nunca se
    // disparaba), bloqueando todo intento posterior hasta recargar la página.
    if (!kioskMode) return
    const playingItem = queue.find((q) => q.status === 'playing')
    if (!playingItem?.singerPhotoUrl) return
    const singer = sessionSingers.find((s) => s.id === playingItem.singerId)
    // A propósito, sin chequear si ya hay un activeFaceSwap en curso: tocar
    // un número mientras otro video de Fun Box está sonando tiene que
    // cambiar directo al nuevo (como un soundboard), no ignorar el toque.
    // El remount limpio lo garantiza activeFaceSwapNonce, no este chequeo.
    setActiveFaceSwapNonce((n) => n + 1)
    if (template.kind === 'sticker') {
      setActiveFaceSwap({ kind: 'sticker', template, photoUrl: playingItem.singerPhotoUrl, oval: singer?.oval ?? null })
    } else {
      if (!singer || faceswapStatus[singer.id]?.[template.id] !== 'ready') return
      setActiveFaceSwap({ kind: 'faceswap', singerId: singer.id, templateId: template.id })
    }
  }

  const singersWithPhoto = sessionSingers.filter((s): s is Singer & { photoUrl: string } => !!s.photoUrl)

  /** Prueba un template de Fun Box con la foto de un cantante real de la
   * sesión — mismo componente que el overlay en vivo, pero disparado desde
   * Studio y sin pantalla completa, así se puede ver si mapea bien sin
   * tener que estar en medio de un show para probarlo. */
  function testFunboxTemplate(template: Template) {
    if (testFaceSwap) return
    const singer = singersWithPhoto.find((s) => s.id === testSingerId) ?? singersWithPhoto[0]
    if (!singer) return
    if (template.kind === 'sticker') {
      setTestFaceSwap({ kind: 'sticker', template, photoUrl: singer.photoUrl, oval: singer.oval })
    } else {
      if (faceswapStatus[singer.id]?.[template.id] !== 'ready') return
      setTestFaceSwap({ kind: 'faceswap', singerId: singer.id, templateId: template.id })
    }
  }

  /** Ruta del clip ya renderizado para este cantante+template `faceswap` —
   * cae dentro de library/_sessions/, así que express.static ya lo sirve sin
   * ninguna ruta nueva (ver /api/templates y app.use('/library', ...)). */
  function faceSwapVideoUrl(singerId: string, templateId: string): string | null {
    if (!session) return null
    return `/library/_sessions/${session.id}/faceswap/${singerId}/${templateId}.mp4`
  }

  function renderFaceSwap(trigger: FaceSwapTrigger, onDone: () => void, key?: number) {
    if (trigger.kind === 'sticker') {
      return <FaceSwapOverlay key={key} template={trigger.template} photoUrl={trigger.photoUrl} oval={trigger.oval} onDone={onDone} />
    }
    const videoUrl = faceSwapVideoUrl(trigger.singerId, trigger.templateId)
    if (!videoUrl) return null
    return <FaceSwapVideoOverlay key={key} videoUrl={videoUrl} onDone={onDone} />
  }

  // Precalentado de "cara en el escenario": arranca solo al crear/recargar
  // una sesión o al registrar un cantante nuevo (ambos casos cambian
  // sessionSingers), para que el hotkey en vivo no tenga que esperar a
  // recortar la foto en óvalo la primera vez que se dispara.
  useEffect(() => {
    sessionSingers.forEach((s) => {
      if (s.photoUrl) warmFaceCutout(s.photoUrl, s.oval)
    })
  }, [sessionSingers])

  // Mismo criterio para los videos de los templates: no dependen de qué
  // cantante sea, así que alcanza con precalentarlos una vez al arrancar una
  // sesión. Uno a la vez, con fetch() (no <video preload="auto">): un
  // <video> buffereando queda con una conexión abierta indefinidamente, y
  // Chrome limita a ~6 conexiones por origen — el <video> real del overlay
  // terminaba en cola detrás de esas descargas y se quedaba colgado en el
  // primer frame. fetch() completa y suelta la conexión antes de arrancar
  // la siguiente, y deja el archivo en la cache HTTP para cuando se pida.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    async function warmTemplateVideos() {
      for (const t of templates) {
        if (cancelled) return
        try {
          await fetch(t.videoUrl)
        } catch {
          // Sin conexión momentánea, no importa — se vuelve a pedir al reproducir.
        }
      }
    }
    warmTemplateVideos()
    return () => {
      cancelled = true
    }
  }, [session, templates])

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
              <Icon name={item.icon} size={17} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Único punto de entrada a la sesión, y visible en todas las
            pantallas porque el sidebar es persistente: arranca una, o
            devuelve a la que está en curso desde donde sea que esté el
            operador. */}
        <div className={`session-box${session ? ` is-${session.status}` : ''}`}>
          {!session ? (
            <>
              <div className="session-status">
                <span className="session-dot" />
                Sesión: no iniciada
              </div>
              <button className="btn-primary btn-block" onClick={handleStartSession}>
                <Icon name="mic" size={15} /> Iniciar sesión
              </button>
            </>
          ) : (
            <>
              <button className="session-return" onClick={handleGoToSession}>
                <div className="session-status">
                  <span className={`session-dot${session.status === 'corriendo' ? ' active' : ' armando'}`} />
                  {session.status === 'armando' ? 'Armando sesión' : 'En vivo'}
                </div>
                <div className="session-meta">
                  {sessionSingers.length} cantante{sessionSingers.length === 1 ? '' : 's'} · {queue.length} en cola
                </div>
              </button>
              {session.status === 'armando' && (
                <button className="btn-primary btn-block" onClick={handleGoToSession}>
                  Seguir armando
                </button>
              )}
              <button className="btn-secondary btn-block" onClick={handleEndSession}>
                Terminar sesión
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="stage">
        <section className={`page${page === 'inicio' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>High Class Karaoke</h1>
              <p>Donde el que canta, brilla.</p>
            </div>
            <button className="btn-primary" onClick={() => setPage('biblioteca')}>
              Ver toda la biblioteca
            </button>
          </div>

          <BannerCarousel banners={banners} />

          {homeCategories.map((catId) => (
            <CategoryCarousel
              key={catId}
              categoryId={catId}
              imageUrl={categoryImages[catId] ?? null}
              nowPlayingId={nowPlayingSong?.id ?? null}
              sessionActive={!!session}
              onPlay={handlePlay}
              onAddQueue={openAddToQueue}
              onViewAll={() => setPage('biblioteca')}
            />
          ))}
          <div className="hint">Las categorías se eligen en Configuración → Categorías de inicio.</div>
        </section>

        <section className={`page${page === 'biblioteca' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Biblioteca de canciones</h1>
              <p>
                {songsTotal} canciones{songsTotal !== songs.length ? ` (mostrando ${songs.length})` : ''}. Cada una es
                una oportunidad para ser la estrella de la noche.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-secondary" onClick={() => setPage('playlists')}>
                <Icon name="playlist" size={15} /> Playlists
              </button>
              <button className="btn-primary" onClick={() => setPage('generar')}>
                + Agregar canción
              </button>
            </div>
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
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
              <button
                className="btn-icon"
                onClick={() => setLibraryView('list')}
                aria-label="Vista lista"
                style={libraryView === 'list' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                <Icon name="list" size={16} />
              </button>
              <button
                className="btn-icon"
                onClick={() => setLibraryView('grid')}
                aria-label="Vista grilla"
                style={libraryView === 'grid' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                <Icon name="grid" size={16} />
              </button>
            </div>
          </div>

          {libraryView === 'grid' ? (
            <div className="carousel-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {songs.map((s) => {
                const isPlaying = s.id === nowPlayingSong?.id
                return (
                  <div key={s.id} className="card carousel-card">
                    <div className="carousel-cover-wrap">
                      <div className="carousel-cover" style={{ background: songColor(s.id) }} />
                      <button className="btn-icon carousel-play" onClick={() => handlePlay(s.id)} disabled={isPlaying} aria-label="Reproducir">
                        <Icon name="play" size={14} />
                      </button>
                    </div>
                    <div className="card-title">{s.title}</div>
                    <div className="card-meta">{s.artist}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem' }}>
                      <span className="badge" style={{ ['--quality-color' as string]: QUALITY_COLOR[s.syncQuality] }}>
                        {QUALITY_LABEL[s.syncQuality]}
                      </span>
                      <button className="btn-icon" onClick={() => openAddToQueue(s)} disabled={!session} title="Agregar a la cola">
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
              {songs.length === 0 && !songsLoading && (
                <div className="no-results">Ninguna canción coincide. Probá otra búsqueda o filtro.</div>
              )}
            </div>
          ) : (
            <div className="library-table">
              <div className="library-row library-row--head">
                <div>Canción</div>
                <div>Artista</div>
                <div>Género</div>
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
                    <div>
                      <select
                        className="genre-select"
                        value={s.genre ?? ''}
                        onChange={(e) => handleSetGenre(s.id, (e.target.value || null) as Genre | null)}
                        title="Género (para las categorías de Inicio)"
                      >
                        <option value="">Sin género</option>
                        {GENRES.map((g) => (
                          <option key={g} value={g}>
                            {CATEGORIES.find((c) => c.id === g)?.name ?? g}
                          </option>
                        ))}
                      </select>
                    </div>
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
          )}
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
                        setPushSingerOval(null)
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
              <h1>Sesión de Karaoke</h1>
              <p>Quién canta qué, en qué orden, y quién va ganando.</p>
            </div>
            {session && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className={autoAdvance ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setAutoAdvance((v) => !v)}
                  title="Al terminar cada canción, pasar solo a la siguiente de la cola"
                >
                  Auto-avance {autoAdvance ? 'ON' : 'OFF'}
                </button>
                <button className="btn-secondary" onClick={() => setPage('playlists')}>
                  <Icon name="playlist" size={15} /> Agregar playlist
                </button>
              </div>
            )}
          </div>

          {!session ? (
            <div className="session-cta">
              <Icon name="mic" size={28} />
              <h2>No hay ninguna sesión activa</h2>
              <p className="hint">
                Una sesión agrupa a los cantantes de la noche, sus fotos, la cola de canciones y los puntajes.
                Arrancá una y te guío para cargar al primero.
              </p>
              <button className="btn-primary" onClick={handleStartSession}>
                <Icon name="mic" size={15} /> Iniciar sesión de karaoke
              </button>
            </div>
          ) : (
            <>
          {session.status === 'armando' && !showWizard && (
            <div className="session-armando-banner">
              <div>
                <strong>Estás armando la sesión</strong>
                <div className="hint">El show todavía no arrancó — sumá cantantes y sus canciones.</div>
              </div>
              <button className="btn-primary" onClick={() => setShowWizard(true)}>
                Seguir armando
              </button>
            </div>
          )}

          <div className="singer-chip-row">
            <span className="singer-chip-label">Cantantes</span>
            {sessionSingers.map((s) => (
              <div className="singer-chip" key={s.id}>
                {s.photoUrl ? (
                  <img className="singer-thumb" src={s.photoUrl} alt="" />
                ) : (
                  <span className="singer-chip-avatar">{s.name[0]?.toUpperCase()}</span>
                )}
                <span>{s.name}</span>
                {s.photoUrl && <Icon name="camera" size={12} />}
              </div>
            ))}
            {sessionSingers.length === 0 && <span className="hint">Todavía no hay ninguno.</span>}
            <button
              className="btn-ghost"
              disabled={!session}
              title={session ? undefined : 'Iniciá una sesión primero'}
              onClick={() => setShowWizard(true)}
            >
              <Icon name="plus" size={14} /> Registrar cantante
            </button>
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
                  {/* Puntaje en el momento — editable hasta "Siguiente", no
                      hace falta esperar a que termine para calificar. */}
                  <div className="score-buttons queue-now-score">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        className={`score-btn${queue[0].score === n ? ' is-active' : ''}`}
                        onClick={() => handleScoreItem(queue[0].id, n)}
                      >
                        {n}
                      </button>
                    ))}
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

          {session && (
            <div className="queue-panel facepanel">
              <h2>
                <Icon name="wand" size={16} /> Cara en el escenario
              </h2>
              {templates.length === 0 ? (
                <p className="hint">
                  Todavía no hay templates — subí uno desde Studio → Fun Box.
                </p>
              ) : (
                <>
                  <p className="hint">
                    Con pantalla completa activa, apretá el número para mostrarlo sobre quien está cantando.
                  </p>
                  {faceswapProgress && faceswapProgress.ready < faceswapProgress.total && (
                    <div className="facepanel-progress">
                      <p className="hint">
                        Preparando caras: {faceswapProgress.ready}/{faceswapProgress.total}
                      </p>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${(faceswapProgress.ready / faceswapProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {queue[0]?.status === 'playing' && !queue[0].singerPhotoUrl && (
                    <p className="hint facepanel-nophoto">
                      {queue[0].singer} no tiene foto cargada — el hotkey no va a mostrar nada hasta que le carguen una.
                    </p>
                  )}
                  <div className="facepanel-grid">
                    {templates.slice(0, 9).map((t, i) => {
                      const playingSingerId = queue[0]?.status === 'playing' ? queue[0].singerId : undefined
                      const status = t.kind === 'faceswap' && playingSingerId ? faceswapStatus[playingSingerId]?.[t.id] : undefined
                      const notReady = t.kind === 'faceswap' && status !== 'ready'
                      const disabled = !kioskMode || notReady
                      const title = !kioskMode
                        ? 'Solo funciona con pantalla completa activa'
                        : notReady
                          ? status === 'failed'
                            ? 'No se pudo generar el swap para este cantante'
                            : 'Preparando el swap para este cantante…'
                          : undefined
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className="facepanel-card"
                          disabled={disabled}
                          title={title}
                          onClick={() => triggerFaceSwap(t)}
                        >
                          <span className="tag tag-accent facepanel-key">{i + 1}</span>
                          <video src={t.videoUrl} muted loop autoPlay playsInline />
                          {notReady && (
                            <span className={`facepanel-status${status === 'failed' ? ' facepanel-status-error' : ''}`}>
                              {status === 'failed' ? 'Error' : 'Preparando…'}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="queue-columns">
            <div className="queue-panel">
              <div className="queue-panel-head">
                <h2>Próximos en la cola</h2>
                <button
                  className="btn-ghost"
                  disabled={queue.filter((q) => q.status === 'queued').length < 2}
                  title="Reparte lo que falta cantar alternando entre cantantes"
                  onClick={handleInterleaveQueue}
                >
                  <Icon name="sync" size={13} /> Alternar turnos
                </button>
              </div>
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

            </>
          )}
        </section>

        <section className={`page${page === 'studio' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Studio</h1>
              <p>Herramientas para armar y curar el material del kiosco.</p>
            </div>
          </div>
          <div className="playlist-grid">
            <div className="card hub-card" onClick={() => setPage('generar')}>
              <Icon name="wand" size={22} />
              <div className="card-title">Crear canción en la biblioteca</div>
              <div className="card-body">Subís audio + letra pegada y se sincroniza sola con WhisperX.</div>
            </div>
            <div className="card hub-card" onClick={() => setPage('subir')}>
              <Icon name="upload" size={22} />
              <div className="card-title">Subir canción a la biblioteca</div>
              <div className="card-body">Para karaoke ya armado — LRC, JSON propio, CD+G o video con letra quemada.</div>
            </div>
            <div className="card hub-card" onClick={() => setPage('fondo')}>
              <Icon name="film" size={22} />
              <div className="card-title">Fondo de video</div>
              <div className="card-body">El video de fondo detrás de la letra en pantalla completa.</div>
            </div>
            <div className="card hub-card" onClick={() => setPage('funbox')}>
              <Icon name="star" size={22} />
              <div className="card-title">Fun Box</div>
              <div className="card-body">Pack de templates para la animación de cara en el escenario — subí un video y se mapea solo.</div>
            </div>
            <div className="card hub-card" onClick={() => window.location.assign('/template-editor')}>
              <Icon name="grid" size={22} />
              <div className="card-title">Editor de templates</div>
              <div className="card-body">Marcá a mano el "slot" de cara sobre un video, para templates sin mapeo automático.</div>
            </div>
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

          <div className="panel live-camera-panel">
            <div className="card-title">Fuente en vivo (OBS)</div>
            <p className="hint">
              Muestra lo que esté saliendo de una cámara en vivo detrás de la letra — pensado para la cámara virtual
              de OBS ("Iniciar cámara virtual"), pero funciona con cualquier webcam. Mientras esté activa, tapa al
              video de fondo subido arriba.
            </p>
            <div className="field">
              <label>Dispositivo</label>
              <select value={selectedCameraId} onChange={(e) => setSelectedCameraId(e.target.value)}>
                <option value="">Cámara por default</option>
                {cameraDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Cámara ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="live-camera-actions">
              <button type="button" className="btn-secondary" onClick={refreshCameraDevices}>
                <Icon name="refresh" size={14} /> Actualizar lista
              </button>
              {liveCameraStream ? (
                <button type="button" className="btn-danger" onClick={stopLiveCamera}>
                  Apagar cámara en vivo
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={startLiveCamera}>
                  Usar cámara en vivo
                </button>
              )}
            </div>
            {liveCameraStream && (
              <p className="ok">
                <Icon name="camera" size={13} /> Cámara en vivo activa — así se ve ahora en pantalla completa.
              </p>
            )}
            {liveCameraError && <p className="error">{liveCameraError}</p>}
          </div>
        </section>

        <section className={`page${page === 'funbox' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Fun Box</h1>
              <p>Pack de templates para la animación de cara en el escenario — subí un video y se mapea solo.</p>
            </div>
          </div>
          <div className="panel" style={{ maxWidth: '640px' }}>
            <div className="field">
              <label>Tipo de template</label>
              <div className="funbox-kind-picker">
                <label>
                  <input
                    type="radio"
                    name="funboxKind"
                    checked={funboxKind === 'sticker'}
                    onChange={() => setFunboxKind('sticker')}
                  />
                  Sticker por color
                </label>
                <label>
                  <input
                    type="radio"
                    name="funboxKind"
                    checked={funboxKind === 'faceswap'}
                    onChange={() => setFunboxKind('faceswap')}
                  />
                  Face swap con IA
                </label>
              </div>
            </div>
            <div className="field">
              <label>Subir video nuevo</label>
              <input
                type="file"
                accept=".mp4,.webm,.mov"
                disabled={funboxUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleUploadTemplate(file, funboxKind)
                  e.target.value = ''
                }}
              />
              {funboxKind === 'sticker' ? (
                <p className="hint">
                  Corre el tracking por color automáticamente (unos segundos) — el video tiene que tener la
                  máscara/capucha de color saturado que pide el director de escenas.
                </p>
              ) : (
                <p className="hint">
                  Corre el análisis de cara real automáticamente (puede tardar uno o dos minutos, no bloquea nada
                  mientras tanto) — el video tiene que mostrar la cara del protagonista bien visible, de frente o
                  3/4, con buena luz.
                </p>
              )}
            </div>
            {funboxUploading && <p className="hint">{funboxKind === 'sticker' ? 'Mapeando…' : 'Analizando la cara…'}</p>}
            {funboxError && <p className="error">{funboxError}</p>}
          </div>

          {/* Probar el mapeo con una cara real, sin depender de estar en
              pantalla completa en medio de un show — para distinguir "no
              mapea bien" de "no se ve nada" de "se queda en el primer
              frame". */}
          {singersWithPhoto.length === 0 ? (
            <p className="hint funbox-test-hint">
              Para probar cómo queda mapeada la cara necesitás al menos un cantante con foto — registrá uno desde
              Sesión de Karaoke.
            </p>
          ) : (
            <div className="field funbox-test-picker">
              <label>Probar con</label>
              <select
                value={testSingerId ?? singersWithPhoto[0].id}
                onChange={(e) => setTestSingerId(e.target.value)}
              >
                {singersWithPhoto.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="playlist-grid">
            {templates.map((t) => {
              const testSinger = singersWithPhoto.find((s) => s.id === testSingerId) ?? singersWithPhoto[0]
              const testStatus = t.kind === 'faceswap' && testSinger ? faceswapStatus[testSinger.id]?.[t.id] : undefined
              const testNotReady = t.kind === 'faceswap' && testStatus !== 'ready'
              const testDisabled = singersWithPhoto.length === 0 || testNotReady
              const testTitle =
                singersWithPhoto.length === 0
                  ? 'Necesitás un cantante con foto para probar'
                  : testNotReady
                    ? testStatus === 'failed'
                      ? 'No se pudo generar el swap para este cantante'
                      : 'Preparando el swap para este cantante…'
                    : undefined
              return (
                <div className="card" key={t.id}>
                  <video src={t.videoUrl} muted controls style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
                  <div className="card-meta" style={{ marginTop: '0.5rem' }}>
                    <span className="tag">{t.kind === 'faceswap' ? 'Face swap IA' : 'Sticker'}</span> {t.id}
                  </div>
                  <div className="funbox-card-actions">
                    <button className="btn-secondary" disabled={testDisabled} title={testTitle} onClick={() => testFunboxTemplate(t)}>
                      <Icon name="wand" size={14} /> Probar
                    </button>
                    <button className="btn-danger" onClick={() => handleDeleteTemplate(t.id)}>
                      <Icon name="trash" size={14} /> Eliminar
                    </button>
                  </div>
                </div>
              )
            })}
            {templates.length === 0 && <p className="hint">Todavía no hay ningún template — subí el primero arriba.</p>}
          </div>
        </section>

        <section className={`page${page === 'configuracion' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Configuración</h1>
              <p>Ajustes generales del kiosco.</p>
            </div>
          </div>
          <h2 className="config-section-title">Configuración general</h2>
          <div className="playlist-grid">
            <div className="card hub-card" onClick={() => setPage('importar')}>
              <Icon name="folder" size={22} />
              <div className="card-title">Importar carpetas</div>
              <div className="card-body">Carpetas del disco con karaokes ya armados, sin copiar los archivos pesados.</div>
            </div>
            <div className="card hub-card" onClick={() => setPage('categorias')}>
              <Icon name="home" size={22} />
              <div className="card-title">Categorías de inicio</div>
              <div className="card-body">Qué categorías se muestran en Inicio, y en qué orden — hasta 3.</div>
            </div>
            <div className="card hub-card" onClick={() => setPage('banners')}>
              <Icon name="grid" size={22} />
              <div className="card-title">Banners de inicio</div>
              <div className="card-body">El carrusel panorámico arriba de las categorías en Inicio.</div>
            </div>
            <div className="card hub-card" onClick={() => setPage('portadas')}>
              <Icon name="camera" size={22} />
              <div className="card-title">Portadas de categoría</div>
              <div className="card-body">Una imagen por categoría, para identificarlas de un vistazo en Inicio.</div>
            </div>
          </div>
        </section>

        <section className={`page${page === 'banners' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Banners de inicio</h1>
              <p>El carrusel panorámico arriba de las categorías en Inicio.</p>
            </div>
          </div>
          <button className="btn-ghost" style={{ width: 'fit-content' }} onClick={() => setPage('configuracion')}>
            <Icon name="chevL" size={15} /> Configuración
          </button>

          <div className="panel" style={{ maxWidth: '640px' }}>
            <div className="field">
              <label>Subir banner nuevo</label>
              <input
                type="file"
                accept="image/*"
                disabled={bannerUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleUploadBanner(file)
                  e.target.value = ''
                }}
              />
              <p className="hint">
                Subilo en <strong>2100×900px</strong> (relación de aspecto 21:9, panorámico) — es como se recorta en
                pantalla, y si el texto ya viene quemado en la imagen (ver PROMPTS-BANNERS.md) conviene generarlo
                directamente en esa proporción para que no quede nada importante cerca de los bordes.
              </p>
            </div>
            {bannerUploading && <p className="hint">Subiendo…</p>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '640px' }}>
            {banners.map((b, i) => (
              <div className="card banner-manage-card" key={b.id}>
                <img className="banner-manage-thumb" src={b.imageUrl} alt="" />
                <div style={{ flex: 1 }} />
                <button className="btn-icon" disabled={i === 0} onClick={() => reorderBanner(b.id, 'up')} aria-label="Subir">
                  <Icon name="up" size={15} />
                </button>
                <button
                  className="btn-icon"
                  disabled={i === banners.length - 1}
                  onClick={() => reorderBanner(b.id, 'down')}
                  aria-label="Bajar"
                >
                  <Icon name="down" size={15} />
                </button>
                <button className="btn-icon" onClick={() => handleDeleteBanner(b.id)} aria-label="Eliminar">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            {banners.length === 0 && <p className="hint">Todavía no hay ningún banner — subí el primero arriba.</p>}
          </div>
        </section>

        <section className={`page${page === 'categorias' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Categorías de inicio</h1>
              <p>Elegí hasta tres. Cada una muestra hasta 15 canciones en Inicio.</p>
            </div>
          </div>
          <button className="btn-ghost" style={{ width: 'fit-content' }} onClick={() => setPage('configuracion')}>
            <Icon name="chevL" size={15} /> Configuración
          </button>
          <div style={{ maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="hint">En Inicio, en este orden</div>
            {homeCategories.map((catId, i) => {
              const cat = CATEGORIES.find((c) => c.id === catId)
              return (
                <div className="card" key={catId} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.9rem' }}>
                  <span className="card-meta" style={{ width: '20px' }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="card-title" style={{ fontSize: '0.9rem' }}>
                      {cat?.name ?? catId}
                    </div>
                    <div className="card-meta">{cat?.desc}</div>
                  </div>
                  <button
                    className="btn-icon"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...homeCategories]
                      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                      setHomeCategories(next)
                      fetch('/api/settings/home-categories', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: next }),
                      })
                    }}
                    aria-label="Subir"
                  >
                    <Icon name="up" size={15} />
                  </button>
                  <button
                    className="btn-icon"
                    disabled={i === homeCategories.length - 1}
                    onClick={() => {
                      const next = [...homeCategories]
                      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                      setHomeCategories(next)
                      fetch('/api/settings/home-categories', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: next }),
                      })
                    }}
                    aria-label="Bajar"
                  >
                    <Icon name="down" size={15} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => {
                      const next = homeCategories.filter((id) => id !== catId)
                      setHomeCategories(next)
                      fetch('/api/settings/home-categories', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: next }),
                      })
                    }}
                    aria-label="Quitar"
                  >
                    <Icon name="x" size={15} />
                  </button>
                </div>
              )
            })}
          </div>
          <div style={{ maxWidth: '620px' }}>
            <div className="hint" style={{ marginBottom: '0.5rem' }}>
              Disponibles
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {CATEGORIES.filter((c) => !homeCategories.includes(c.id)).map((c) => (
                <button
                  key={c.id}
                  className="btn-secondary"
                  disabled={homeCategories.length >= 3}
                  title={c.desc}
                  onClick={() => {
                    const next = [...homeCategories, c.id]
                    setHomeCategories(next)
                    fetch('/api/settings/home-categories', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ids: next }),
                    })
                  }}
                >
                  <Icon name="plus" size={14} /> {c.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={`page${page === 'portadas' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Portadas de categoría</h1>
              <p>Una imagen por categoría — se achica y recorta sola a un cuadrado parejo al subirla.</p>
            </div>
          </div>
          <button className="btn-ghost" style={{ width: 'fit-content' }} onClick={() => setPage('configuracion')}>
            <Icon name="chevL" size={15} /> Configuración
          </button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', maxWidth: '780px' }}>
            {CATEGORIES.map((c) => {
              const imageUrl = categoryImages[c.id]
              const uploading = categoryImageUploading === c.id
              return (
                <div
                  className="card"
                  key={c.id}
                  style={{ width: '160px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}
                >
                  <div
                    style={{
                      width: '96px',
                      height: '96px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: imageUrl ? 'transparent' : songColor(c.id),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {imageUrl && <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                  </div>
                  <div className="card-title" style={{ fontSize: '0.85rem', textAlign: 'center' }}>
                    {c.name}
                  </div>
                  <label className="btn-secondary" style={{ width: '100%', textAlign: 'center', cursor: 'pointer' }}>
                    {uploading ? 'Subiendo…' : imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUploadCategoryImage(c.id, file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {imageUrl && (
                    <button className="btn-ghost" style={{ width: '100%' }} onClick={() => handleDeleteCategoryImage(c.id)}>
                      Quitar
                    </button>
                  )}
                </div>
              )
            })}
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

      {/* Prueba de Fun Box: fuera del gate de kioskMode a propósito — se
          dispara desde Studio, no desde una sesión en vivo. */}
      {testFaceSwap && renderFaceSwap(testFaceSwap, () => setTestFaceSwap(null))}

      {kioskMode && (
        <div className="performance">
          {activeFaceSwap && renderFaceSwap(activeFaceSwap, () => setActiveFaceSwap(null), activeFaceSwapNonce)}
          {liveCameraStream ? (
            <LiveBackgroundVideo stream={liveCameraStream} />
          ) : (
            backgroundVideoUrl && (
              <video className="background-video" src={backgroundVideoUrl} loop muted autoPlay playsInline />
            )
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
            <div className="step-actions">
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
              value={{ singerId: pushSingerId, name: pushSingerName, photo: pushSingerPhoto, oval: pushSingerOval }}
              onChange={(v) => {
                setPushSingerId(v.singerId)
                setPushSingerName(v.name)
                setPushSingerPhoto(v.photo)
                setPushSingerOval(v.oval)
              }}
              onEnter={submitPushPlaylist}
              previewTemplate={stickerTemplates[0]}
            />
            <div className="step-actions">
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
              value={{ singerId: queueSingerId, name: queueSingerName, photo: queueSingerPhoto, oval: queueSingerOval }}
              onChange={(v) => {
                setQueueSingerId(v.singerId)
                setQueueSingerName(v.name)
                setQueueSingerPhoto(v.photo)
                setQueueSingerOval(v.oval)
              }}
              onEnter={submitAddToQueue}
              previewTemplate={stickerTemplates[0]}
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

      {/* Un solo camino para sumar cantantes: el armado guiado. Antes había un
          modal suelto de "Registrar cantante" que dejaba al cantante sin
          canciones y sin decir qué seguía. */}
      {session && showWizard && (
        <SessionSetupWizard
          sessionSingers={sessionSingers}
          songCounts={songCounts}
          queuedTotal={queue.length}
          templates={templates}
          faceswapStatus={faceswapStatus}
          onSingerCreated={refreshSession}
          onSongsQueued={refreshQueue}
          onBegin={handleBeginSession}
          onClose={() => setShowWizard(false)}
        />
      )}

      {showResults && (
        <SessionResults
          sessionSingers={sessionSingers}
          leaderboard={leaderboard}
          songCounts={songCounts}
          onBack={() => setShowResults(false)}
          onEndSession={handleCloseSession}
        />
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
