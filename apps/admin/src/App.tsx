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
import { Rail } from './Rail'
import { FunBox } from './FunBox'
import { Marquee } from './Marquee'
import { WaitStrip } from './WaitStrip'

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

type SongSortColumn = 'title' | 'artist' | 'genre' | 'format' | 'quality'

const SORTABLE_COLUMNS: { key: SongSortColumn; label: string }[] = [
  { key: 'title', label: 'Canción' },
  { key: 'artist', label: 'Artista' },
  { key: 'genre', label: 'Género' },
  { key: 'format', label: 'Formato' },
  { key: 'quality', label: 'Calidad' },
]

const QUALITY_LABEL: Record<Song['syncQuality'], string> = {
  excellent: 'Excelente',
  interpolated: 'Interpolada',
  none: 'Sin letra',
}

const QUALITY_COLOR: Record<Song['syncQuality'], string> = {
  excellent: 'var(--hck-accent-lt)',
  interpolated: '#93C5FD',
  none: 'var(--hck-faint)',
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

/** Tarjeta de acceso a una sub-pantalla, usada por los hubs de Studio y
 * Configuración — mismo patrón que `hubCard()` en la referencia. */
function hubCard(icon: IconName, title: string, body: string, onClick: () => void, tag?: string) {
  return (
    <button
      key={title}
      onClick={onClick}
      className="hck-pressable"
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: 'clamp(20px,1.8vw,30px)',
        borderRadius: 'var(--hck-r-lg)',
        background: 'var(--hck-surface)',
        border: '1px solid var(--hck-line)',
      }}
    >
      <span style={{ color: 'var(--hck-accent-lt)' }}><Icon name={icon} size={28} /></span>
      {tag && <span className="hck-tag hck-tag-outline" style={{ alignSelf: 'flex-start' }}>{tag}</span>}
      <span style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-.025em' }}>{title}</span>
      <span className="hck-muted" style={{ fontSize: '15.5px', lineHeight: 1.5 }}>{body}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--hck-accent-lt)', fontWeight: 600, fontSize: '15px' }}>
        Abrir <Icon name="chevR" size={16} />
      </span>
    </button>
  )
}

/** Cañones de luz violeta detrás de una tarjeta "destacada" (`.hck-stage` +
 * `.hck-card-hi`) — decoración pura, ver hck-theme.css `.hck-beams`. */
function beams(n = 3) {
  return (
    <div className="hck-beams">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ ['--a' as string]: `${-30 + i * 24}deg`, left: `${12 + i * 30}%`, animationDelay: `${i * 1.4}s` }} />
      ))}
    </div>
  )
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
  | 'banners'
  | 'portadas'
  | 'importar'
type WizardStep = 1 | 2 | 3 | 4

/** Trabajo en curso visible desde cualquier pantalla (ver `bgJobs` en App). */
interface BgJob {
  id: string
  label: string
  returnPage: Page
}

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
// llegar ahí desde la UI todavía. Los ítems del rail en sí viven en Rail.tsx
// (ya son su propio componente); acá solo queda el mapeo de atajo de una
// letra → página, que usa el handler de teclado de más abajo.
const NAV_HOTKEYS: Record<string, Page> = {
  i: 'inicio',
  b: 'biblioteca',
  s: 'cola',
  t: 'studio',
  c: 'configuracion',
}

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

  // Inicio: 4 categorías al azar del pool completo en cada carga (REQ-06) —
  // reemplaza la config manual fija que existía antes en Configuración.
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
  // Selección múltiple — OR entre los géneros tildados (ver REQ-11).
  const [genreFilter, setGenreFilter] = useState<Genre[]>([])
  const [sortBy, setSortBy] = useState<SongSortColumn>('title')
  const [sortAsc, setSortAsc] = useState(true)
  const [songsTotal, setSongsTotal] = useState(0)
  const [songsLoading, setSongsLoading] = useState(false)
  const [libraryView, setLibraryView] = useState<'list' | 'grid'>('list')

  function handleSortBy(col: SongSortColumn) {
    if (sortBy === col) setSortAsc((v) => !v)
    else {
      setSortBy(col)
      setSortAsc(true)
    }
  }

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
  // Crear playlist inline desde el modal "Agregar a playlist" (REQ-12) —
  // estado propio, no comparte el de la pantalla Playlists.
  const [quickPlaylistName, setQuickPlaylistName] = useState('')
  const [creatingQuickPlaylist, setCreatingQuickPlaylist] = useState(false)

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
  // Puesto en falso por el instalador (scripts/setup.bat) cuando no detectó
  // GPU NVIDIA — ver getFaceSwapEnabled en el server. Empieza en `true` para
  // no parpadear "deshabilitado" mientras llega la respuesta del fetch.
  const [faceSwapEnabled, setFaceSwapEnabledState] = useState(true)

  // Cola en vivo + puntajes
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [unscored, setUnscored] = useState<QueueItem[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [queueSong, setQueueSong] = useState<Song | null>(null)
  const [queueSingerId, setQueueSingerId] = useState<string | null>(null)
  const [queueSingerName, setQueueSingerName] = useState('')
  const [queueSingerPhoto, setQueueSingerPhoto] = useState<Blob | null>(null)
  const [queueSingerOval, setQueueSingerOval] = useState<Oval | null>(null)

  // Panel "Cola de espera" plegable en Sesión (REQ-18) — alta rápida por N°
  // de canción en vez de buscarla por nombre.
  const [waitStripOpen, setWaitStripOpen] = useState(false)
  const [waitAddNumber, setWaitAddNumber] = useState('')
  const [waitAddSingerId, setWaitAddSingerId] = useState<string | null>(null)
  const [waitAddError, setWaitAddError] = useState<string | null>(null)
  const [waitAdding, setWaitAdding] = useState(false)

  // Badge de puntaje rápido, hotkey P (REQ-14) — no bloqueante, se cierra sin
  // guardar con click afuera, Escape, o P de nuevo.
  const [scoreBadge, setScoreBadge] = useState<{ itemId: string; input: string } | null>(null)
  const scoreBadgeRef = useRef<HTMLDivElement | null>(null)

  // Popover global "Efectos" (Fun Box) — hotkey X, accesible desde
  // cualquier pantalla vía la marquesina (ver plan chrome global).
  const [fxOpen, setFxOpen] = useState(false)
  const fxPanelRef = useRef<HTMLDivElement | null>(null)

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

  // Trabajos en curso visibles desde cualquier pantalla (subida/sincro de
  // canciones) — el fetch sigue corriendo aunque el operador navegue a otra
  // página (App.tsx no se desmonta, es una SPA), así que esto es solo la
  // parte visible: un atajo de vuelta + el estado, colapsable, oculto en
  // modo kiosco.
  const [bgJobs, setBgJobs] = useState<BgJob[]>([])
  const [bgJobsExpanded, setBgJobsExpanded] = useState(false)

  function startBgJob(label: string, returnPage: Page): string {
    const id = crypto.randomUUID()
    setBgJobs((jobs) => [...jobs, { id, label: label.trim() || 'Canción nueva', returnPage }])
    return id
  }

  function endBgJob(id: string) {
    setBgJobs((jobs) => jobs.filter((j) => j.id !== id))
  }

  // Motor de audio real
  const [lyrics, setLyrics] = useState<LyricsDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [paused, setPaused] = useState(false)
  const [scrubValue, setScrubValue] = useState<number | null>(null)
  const [displayPosition, setDisplayPosition] = useState(0)
  const [kioskMode, setKioskMode] = useState(false)
  // Colapso independiente de nav lateral y menú inferior (REQ-09) — cada uno
  // con su propio toggle, sin afectarse entre sí.
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [marqueeCollapsed, setMarqueeCollapsed] = useState(false)
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
    for (const g of genreFilter) params.append('genre', g)
    params.set('sortBy', sortBy)
    params.set('sort', sortAsc ? 'asc' : 'desc')
    params.set('limit', String(SONGS_PAGE_SIZE))
    params.set('offset', String(offset))
    return params.toString()
  }

  /** 4 categorías al azar del pool completo (REQ-06) — se recalcula cada vez
   * que se entra a Inicio, no en cada render (ver el `useEffect` que la
   * llama, guardado por `page === 'inicio'`). */
  function refreshHomeCategories() {
    const shuffled = [...CATEGORIES].sort(() => Math.random() - 0.5)
    setHomeCategories(shuffled.slice(0, 4).map((c) => c.id))
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

  async function handleEnableFaceSwap() {
    const res = await fetch('/api/settings/faceswap-enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    const body: { enabled: boolean } = await res.json()
    setFaceSwapEnabledState(body.enabled)
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
  async function handleUploadTemplate(file: File, kind: 'sticker' | 'faceswap', name: string) {
    setFunboxUploading(true)
    setFunboxError(null)
    try {
      const form = new FormData()
      form.set('video', file)
      form.set('kind', kind)
      if (name.trim()) form.set('name', name.trim())
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

  async function handleRenameTemplate(id: string, name: string) {
    await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    refreshTemplates()
  }

  /** Asignar un hotkey ya tomado libera al template que lo tenía antes — lo
   * resuelve el server en una sola transacción (ver updateTemplateMeta),
   * así que alcanza con refrescar la lista completa. */
  async function handleSetTemplateHotkey(id: string, hotkey: number | null) {
    await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotkey }),
    })
    refreshTemplates()
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

  /** Crea una playlist nueva y le agrega de una la canción que estaba por
   * asignar — sin salir del modal "Agregar a playlist" (REQ-12). */
  async function handleCreatePlaylistAndAdd() {
    const name = quickPlaylistName.trim()
    if (!name || !addToPlaylistSong) return
    setCreatingQuickPlaylist(true)
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const playlist: Playlist = await res.json()
      setQuickPlaylistName('')
      await addSongToPlaylist(playlist.id, addToPlaylistSong.id)
    } finally {
      setCreatingQuickPlaylist(false)
    }
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
    fetch('/api/settings/faceswap-enabled').then((r) => r.json()).then((d) => setFaceSwapEnabledState(d.enabled))
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

  // Re-sortea las categorías de Inicio cada vez que se entra a esa página
  // (REQ-06) — no en cada render, si no cambiarían solas mientras se mira.
  useEffect(() => {
    if (page === 'inicio') refreshHomeCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

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
  }, [searchQuery, qualityFilter, verifiedFilter, genreFilter, sortBy, sortAsc])

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

  // Cierra el badge de puntaje rápido (REQ-14) si se clickea afuera — el
  // Escape/segundo-P que también lo cierran viven en el handler de teclado
  // grande de más abajo, junto con el resto de los atajos globales.
  useEffect(() => {
    if (!scoreBadge) return
    function onClick(e: MouseEvent) {
      if (scoreBadgeRef.current && !scoreBadgeRef.current.contains(e.target as Node)) setScoreBadge(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [scoreBadge])

  useEffect(() => {
    if (!fxOpen) return
    function onClick(e: MouseEvent) {
      if (fxPanelRef.current && !fxPanelRef.current.contains(e.target as Node)) setFxOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [fxOpen])

  // Atajos de teclado: el kiosco se opera de lejos, muchas veces sin mouse a
  // mano. Se ignoran mientras se escribe en un campo, para no robarle la
  // barra espaciadora a la búsqueda ni a la letra pegada en el wizard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // El badge de puntaje (REQ-14) intercepta primero y se come todo lo
      // demás mientras está abierto — ni siquiera el guard de "typing" aplica
      // acá, porque abrirlo nunca enfoca ningún input real.
      if (scoreBadge) {
        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
          setScoreBadge(null)
        } else if (e.key === 'Enter') {
          const n = Number(scoreBadge.input)
          if (scoreBadge.input && Number.isInteger(n) && n >= 1 && n <= 10) handleScoreItem(scoreBadge.itemId, n)
          setScoreBadge(null)
        } else if (e.key === 'Backspace') {
          setScoreBadge((b) => (b ? { ...b, input: b.input.slice(0, -1) } : b))
        } else if (/^[0-9]$/.test(e.key)) {
          setScoreBadge((b) => (b ? { ...b, input: (b.input + e.key).slice(0, 2) } : b))
        }
        return
      }

      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing || modalOpen) return

      if (e.key === ' ') {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === 'Escape' && kioskMode) {
        exitKiosk()
      } else if (e.key === 'Escape' && fxOpen) {
        setFxOpen(false)
      } else if (e.key === 'e' || e.key === 'E') {
        setWaitStripOpen((v) => !v)
      } else if (e.key === 'x' || e.key === 'X') {
        setFxOpen((v) => !v)
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
      } else if ((e.key === 'p' || e.key === 'P') && session && queue[0]?.status === 'playing') {
        setScoreBadge({ itemId: queue[0].id, input: '' })
      } else if (kioskMode && session && e.key >= '1' && e.key <= '9') {
        const template = templates.find((t) => t.hotkey === Number(e.key))
        if (template) triggerFaceSwap(template)
      } else if (kioskMode && e.key === '0') {
        // "0" no mapea a ningún template — es el hotkey explícito para
        // cortar el video de Fun Box en curso y volver al fondo.
        setActiveFaceSwap(null)
      } else if (!kioskMode && e.key === '/') {
        e.preventDefault()
        setPage('biblioteca')
        setTimeout(() => document.getElementById('library-search')?.focus(), 0)
      } else if (!kioskMode && e.key === 'v') {
        // Minúscula nada más: "V" mayúscula (con Shift) no navega — mismo
        // criterio que el resto de los atajos de una letra de acá abajo.
        enterKiosk()
      } else if (!kioskMode && !e.metaKey && !e.ctrlKey && NAV_HOTKEYS[e.key]) {
        setPage(NAV_HOTKEYS[e.key])
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
    const formData = new FormData(form)
    const jobId = startBgJob(String(formData.get('title') ?? ''), 'subir')
    try {
      const res = await fetch('/api/songs', { method: 'POST', body: formData })
      const body = await res.json()
      if (!res.ok) {
        setUploadError(body.error ?? 'Error desconocido')
        return
      }
      setUploadMessage(`"${body.song.title}" agregada — ${body.message}`)
      form.reset()
      refreshSongs()
    } finally {
      endBgJob(jobId)
    }
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

  /** Alta rápida por N° de canción (REQ-18) — a diferencia de
   * `submitAddToQueue`, acá el cantante ya existe en la sesión (se elige de
   * un `<select>`), no hay que crear uno nuevo con foto. */
  async function handleWaitAdd() {
    const n = Number(waitAddNumber)
    if (!waitAddNumber.trim() || !Number.isInteger(n)) {
      setWaitAddError('Escribí un número de canción válido.')
      return
    }
    if (!waitAddSingerId) {
      setWaitAddError('Elegí a quién le toca.')
      return
    }
    setWaitAdding(true)
    setWaitAddError(null)
    try {
      const songRes = await fetch(`/api/songs/by-number/${n}`)
      if (!songRes.ok) {
        setWaitAddError(`No hay ninguna canción con el N° ${n}.`)
        return
      }
      const song: Song = await songRes.json()
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id, singerId: waitAddSingerId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setWaitAddError(body.error ?? 'No se pudo agregar a la cola.')
        return
      }
      setWaitAddNumber('')
      refreshQueue()
    } finally {
      setWaitAdding(false)
    }
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

  // Con hotkey asignado primero (en orden 1-9), el resto después — el panel
  // en vivo de Sesión los muestra todos (clickeables con el mouse igual),
  // pero el número solo lo tienen los que de verdad responden al teclado.
  const templatesByHotkey = [...templates].sort((a, b) => {
    if (a.hotkey != null && b.hotkey != null) return a.hotkey - b.hotkey
    if (a.hotkey != null) return -1
    if (b.hotkey != null) return 1
    return 0
  })

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
    const jobId = startBgJob(wizardTitle, 'generar')
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
      endBgJob(jobId)
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
    <div className="hck-app" style={{ ['--hck-rail-w' as string]: kioskMode ? '0px' : railCollapsed ? '72px' : 'clamp(230px,16vw,300px)' }}>
      {/* Rail y contenido se sacan del árbol por completo en modo kiosco (no
         solo se ocultan por CSS) — .performance necesita ser el único
         contenido visible para que su height:100vh se comporte bien, y
         depender de una clase CSS puntual (como pasaba antes con .sidebar)
         es frágil: si el componente cambia de nombre de clase, la regla deja
         de aplicar en silencio. Esto ya pasó una vez (ver Rail.tsx). */}
      {!kioskMode && (
        <Rail
          page={page}
          onNav={setPage}
          onEnterKiosk={enterKiosk}
          session={session}
          sessionSingers={sessionSingers}
          queue={queue}
          faceswapProgress={faceswapProgress}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onStartSession={handleStartSession}
          onGoToSession={handleGoToSession}
          onEndSession={handleEndSession}
        />
      )}

      {!kioskMode && (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {session && (
          <WaitStrip
            queue={queue}
            sessionSingers={sessionSingers}
            open={waitStripOpen}
            onToggle={() => setWaitStripOpen((v) => !v)}
            waitAddNumber={waitAddNumber}
            onWaitAddNumberChange={setWaitAddNumber}
            waitAddSingerId={waitAddSingerId}
            onWaitAddSingerIdChange={setWaitAddSingerId}
            waitAddError={waitAddError}
            waitAdding={waitAdding}
            onWaitAdd={handleWaitAdd}
          />
        )}
      <main className="hck-scope" style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', background: 'var(--hck-bg)' }}>
        {page === 'inicio' && (
        <div style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '28px', flexWrap: 'wrap' }}>
            <div>
              <h1>High Class Karaoke</h1>
              <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
                Donde el que canta, brilla.
              </p>
            </div>
            <button className="hck-btn hck-btn-primary hck-btn-lg" onClick={() => setPage('biblioteca')}>
              Ver toda la biblioteca
            </button>
          </div>

          <BannerCarousel banners={banners} />

          {/* "La sesión sigue" — acceso rápido de vuelta al show desde
             Inicio mientras hay una sesión corriendo, sin tener que ir a
             buscar el botón "En vivo" del rail. */}
          {session?.status === 'corriendo' && (
            <div
              className="hck-card"
              style={{ flexDirection: 'row', alignItems: 'center', gap: '22px', borderColor: 'var(--hck-accent)', background: 'linear-gradient(100deg,var(--hck-accent-12),transparent 60%),var(--hck-surface)' }}
            >
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  background: 'var(--hck-accent-dk)',
                  border: '2px solid var(--hck-accent)',
                  boxShadow: 'var(--hck-glow)',
                  overflow: 'hidden',
                }}
              >
                {queue[0]?.status === 'playing' && queue[0].singerPhotoUrl ? (
                  <img src={queue[0].singerPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Icon name="mic" size={24} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="hck-kicker">La sesión sigue</span>
                <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-.02em' }}>
                  {nowPlayingSong ? `Está sonando ${nowPlayingSong.title}` : 'Nadie está cantando ahora'}
                </div>
                <div className="hck-muted" style={{ fontSize: '15px' }}>
                  {sessionSingers.length} cantante{sessionSingers.length === 1 ? '' : 's'} · {queue.length} {queue.length === 1 ? 'canción' : 'canciones'} pendiente{queue.length === 1 ? '' : 's'}
                </div>
              </div>
              <button className="hck-btn hck-btn-primary hck-btn-lg" onClick={enterKiosk}>
                Ir a la sesión en curso <span className="hck-kbd" style={{ marginLeft: '4px' }}>V</span>
              </button>
            </div>
          )}

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
        </div>
        )}

        {page === 'biblioteca' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '28px', flexWrap: 'wrap' }}>
            <div>
              <h2>Biblioteca</h2>
              <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
                {songsTotal} canciones{songsTotal !== songs.length ? ` (mostrando ${songs.length})` : ''}. Cada una es
                una oportunidad para ser la estrella de la noche.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="hck-btn hck-btn-secondary hck-btn-lg" onClick={() => setPage('playlists')}>
                <Icon name="playlist" size={19} /> Playlists
              </button>
              <button className="hck-btn hck-btn-primary hck-btn-lg" onClick={() => setPage('generar')}>
                <Icon name="plus" size={19} /> Agregar canción
              </button>
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '26px', top: '50%', transform: 'translateY(-50%)', color: 'var(--hck-faint)', pointerEvents: 'none' }}>
              <Icon name="search" size={24} />
            </div>
            <input
              id="library-search"
              className="hck-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="¿Qué querés cantar?"
              style={{
                paddingLeft: '64px',
                paddingRight: searchQuery ? '56px' : '20px',
                minHeight: 'clamp(60px,5vw,76px)',
                fontSize: 'clamp(18px,1.5vw,24px)',
                fontWeight: 600,
                borderRadius: 'var(--hck-r-xl)',
              }}
            />
            {searchQuery && (
              <button
                className="hck-btn hck-btn-icon hck-btn-ghost"
                style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)' }}
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
              >
                <Icon name="x" size={18} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(20px,2.2vw,40px)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span className="hck-kicker">Sincronía</span>
              <div className="hck-chips">
                {(['todos', 'excellent', 'interpolated', 'none'] as const).map((v) => (
                  <button key={v} className={`hck-chip${qualityFilter === v ? ' hck-chip-on' : ''}`} onClick={() => setQualityFilter(v)}>
                    {v === 'todos' ? 'Toda sincronía' : QUALITY_LABEL[v]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span className="hck-kicker">Verificación</span>
              <div className="hck-chips">
                {(['todos', 'si', 'no'] as const).map((v) => (
                  <button key={v} className={`hck-chip${verifiedFilter === v ? ' hck-chip-on' : ''}`} onClick={() => setVerifiedFilter(v)}>
                    {v === 'todos' ? 'Verificadas y sin verificar' : v === 'si' ? 'Solo verificadas ✓' : 'Solo sin verificar'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span className="hck-kicker">Género</span>
              <div className="hck-chips">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    className={`hck-chip${genreFilter.includes(g) ? ' hck-chip-on' : ''}`}
                    onClick={() => setGenreFilter((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))}
                  >
                    {CATEGORIES.find((c) => c.id === g)?.name ?? g}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '14px' }}>
              {libraryView === 'list' && (
                <span className="hck-faint" style={{ fontSize: '14px' }}>
                  Ordená haciendo click en las columnas de la tabla.
                </span>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className={`hck-btn hck-btn-icon${libraryView === 'list' ? ' hck-btn-on' : ''}`}
                  onClick={() => setLibraryView('list')}
                  aria-label="Vista lista"
                >
                  <Icon name="list" size={18} />
                </button>
                <button
                  className={`hck-btn hck-btn-icon${libraryView === 'grid' ? ' hck-btn-on' : ''}`}
                  onClick={() => setLibraryView('grid')}
                  aria-label="Vista grilla"
                >
                  <Icon name="grid" size={18} />
                </button>
              </div>
            </div>
          </div>

          {libraryView === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 'clamp(14px,1.3vw,22px)' }}>
              {songs.map((s) => {
                const isPlaying = s.id === nowPlayingSong?.id
                const art = s.genre ? categoryImages[s.genre] : null
                return (
                  <div key={s.id} className="hck-card" style={{ padding: '13px', borderRadius: 'var(--hck-r-lg)', gap: '12px' }}>
                    <div style={{ position: 'relative' }}>
                      <div
                        className="hck-art"
                        style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--hck-r-md)', background: art ? 'linear-gradient(160deg,var(--hck-surface-2),var(--hck-bg-deep))' : songColor(s.id) }}
                      >
                        {art && <img src={art} alt="" />}
                      </div>
                      <button
                        className="hck-btn hck-btn-icon"
                        style={{ position: 'absolute', right: '10px', bottom: '10px', background: 'rgba(10,12,16,.55)' }}
                        onClick={() => handlePlay(s.id)}
                        disabled={isPlaying}
                        aria-label="Reproducir"
                      >
                        <Icon name="play" size={16} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span style={{ fontSize: '16.5px', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2 }}>{s.title}</span>
                      <span className="hck-muted" style={{ fontSize: '14px' }}>{s.artist}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="hck-tag hck-tag-outline hck-mono" style={{ fontSize: '12px' }}>#{s.number}</span>
                        <span className="hck-tag" style={{ color: QUALITY_COLOR[s.syncQuality] }}>{QUALITY_LABEL[s.syncQuality]}</span>
                      </div>
                      <button className="hck-btn hck-btn-icon" onClick={() => openAddToQueue(s)} disabled={!session} title="Agregar a la cola">
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
              {songs.length === 0 && !songsLoading && (
                <p className="hck-muted" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>
                  Ninguna canción coincide. Probá otra búsqueda o filtro.
                </p>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="hck-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    {SORTABLE_COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => handleSortBy(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === c.key ? 'var(--hck-accent-lt)' : undefined }}
                      >
                        {c.label}
                        <span style={{ display: 'inline-block', width: '14px', marginLeft: '3px', opacity: sortBy === c.key ? 1 : 0.25 }}>
                          {sortBy === c.key ? (sortAsc ? '↑' : '↓') : '↑'}
                        </span>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {songs.map((s) => {
                    const isPlaying = s.id === nowPlayingSong?.id
                    return (
                      <tr key={s.id} style={isPlaying ? { background: 'var(--hck-accent-06)' } : undefined}>
                        <td className="hck-mono hck-faint">#{s.number}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '3px', flex: 'none', background: songColor(s.id) }} />
                            <span style={{ fontWeight: 700 }}>{s.title}</span>
                          </div>
                        </td>
                        <td className="hck-muted">{s.artist}</td>
                        <td>
                          <select
                            className="hck-input"
                            style={{ minHeight: '38px', padding: '6px 10px', fontSize: '14px', width: 'auto' }}
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
                        </td>
                        <td className="hck-muted">{FORMAT_LABEL[s.sourceFormat]}</td>
                        <td>
                          <span className="hck-tag" style={{ color: QUALITY_COLOR[s.syncQuality] }}>{QUALITY_LABEL[s.syncQuality]}</span>
                          {s.syncVerified && <span className="hck-tag hck-tag-outline" style={{ marginLeft: '6px' }}>verificada</span>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              className={`hck-btn hck-btn-icon${s.syncVerified ? ' hck-btn-on' : ''}`}
                              onClick={() => toggleSyncVerified(s)}
                              title={s.syncVerified ? 'Sincronía verificada — click para desmarcar' : 'Marcar como sincronía verificada'}
                            >
                              <Icon name="check" size={16} />
                            </button>
                            <button className="hck-btn hck-btn-icon" onClick={() => handlePlay(s.id)} disabled={isPlaying} title="Reproducir">
                              <Icon name="play" size={16} />
                            </button>
                            <button
                              className="hck-btn hck-btn-primary"
                              onClick={() => openAddToQueue(s)}
                              disabled={!session}
                              title={session ? 'Agregar a la cola' : 'Iniciá una sesión primero'}
                            >
                              <Icon name="plus" size={15} /> Cola
                            </button>
                            <button
                              className="hck-btn hck-btn-icon"
                              onClick={() => {
                                setAddToPlaylistSong(s)
                                setPlaylistMessage(null)
                              }}
                              title="Agregar a una playlist"
                            >
                              <Icon name="playlist" size={16} />
                            </button>
                            {s.audioUrl && (
                              <button className="hck-btn hck-btn-icon" onClick={() => openResync(s)} title="Re-sincronizar letra">
                                <Icon name="refresh" size={16} />
                              </button>
                            )}
                            <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={() => setDeleteSong(s)} title="Eliminar canción">
                              <Icon name="trash" size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {songs.length === 0 && !songsLoading && (
                <p className="hck-muted" style={{ textAlign: 'center', padding: '40px' }}>Ninguna canción coincide. Probá otra búsqueda o filtro.</p>
              )}
            </div>
          )}
          {songs.length < songsTotal && (
            <button className="hck-btn hck-btn-secondary" style={{ alignSelf: 'center' }} disabled={songsLoading} onClick={loadMoreSongs}>
              {songsLoading ? 'Cargando…' : `Cargar más (${songsTotal - songs.length} restantes)`}
            </button>
          )}
          {playError && <p style={{ color: '#F87171' }}>{playError}</p>}
        </div>
        )}

        {page === 'playlists' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '28px', flexWrap: 'wrap' }}>
            <div>
              <h2>Playlists</h2>
              <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
                Listas armadas de antemano. Cargá una entera a la cola y arrancá la noche sin buscar tema por tema.
              </p>
            </div>
          </div>

          <div className="hck-card" style={{ gap: '14px' }}>
            <div className="hck-field">
              <label>Nueva playlist</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  className="hck-input"
                  style={{ flex: 1 }}
                  type="text"
                  placeholder="Ej: Arranque tranqui"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
                />
                <button className="hck-btn hck-btn-primary" type="button" onClick={createPlaylist}>
                  Crear
                </button>
              </div>
            </div>
            {playlistMessage && <p style={{ color: '#4ADE80', fontSize: '14px' }}>{playlistMessage}</p>}
          </div>

          {playlists.length === 0 ? (
            <p className="hck-muted">Todavía no hay playlists. Creá una y sumale canciones desde la Biblioteca.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 'clamp(16px,1.5vw,24px)' }}>
              {playlists.map((p) => {
                const isOpen = openPlaylist?.id === p.id
                return (
                  <div key={p.id} className="hck-card" style={{ gap: '14px', ...(isOpen ? { borderColor: 'var(--hck-accent)' } : {}) }}>
                    <div>
                      <div style={{ fontSize: '19px', fontWeight: 700, letterSpacing: '-.02em' }}>{p.name}</div>
                      <div className="hck-faint" style={{ fontSize: '14.5px' }}>{p.songCount} canciones</div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <button
                        className="hck-btn hck-btn-primary"
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
                      <button className="hck-btn hck-btn-secondary" onClick={() => (isOpen ? setOpenPlaylist(null) : showPlaylist(p.id))}>
                        {isOpen ? 'Cerrar' : 'Ver'}
                      </button>
                      <button className="hck-btn hck-btn-ghost" onClick={() => deletePlaylist(p.id)}>
                        <Icon name="trash" size={15} /> Borrar
                      </button>
                    </div>

                    {isOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--hck-line)' }}>
                        {openPlaylist.songs.length === 0 ? (
                          <p className="hck-muted" style={{ fontSize: '14px' }}>Vacía. Agregale canciones con "+ Playlist" desde la Biblioteca.</p>
                        ) : (
                          openPlaylist.songs.map((s) => (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '3px', flex: 'none', background: songColor(s.id) }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: '14.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                              <span className="hck-faint" style={{ fontSize: '13.5px' }}>{s.artist}</span>
                              <button
                                className="hck-btn hck-btn-icon hck-btn-ghost"
                                style={{ width: '30px', height: '30px' }}
                                onClick={() => removeSongFromPlaylist(p.id, s.id)}
                                title="Quitar de la playlist"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}

        {page === 'cola' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '28px', flexWrap: 'wrap' }}>
            <div>
              <h2>Sesión</h2>
              <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>Quién canta qué, en qué orden, y quién va ganando.</p>
            </div>
            {session && (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  className={`hck-btn ${autoAdvance ? 'hck-btn-on' : 'hck-btn-secondary'}`}
                  onClick={() => setAutoAdvance((v) => !v)}
                  title="Al terminar cada canción, pasar solo a la siguiente de la cola"
                >
                  Auto-avance {autoAdvance ? 'sí' : 'no'}
                </button>
                <button className="hck-btn hck-btn-secondary" onClick={() => setPage('playlists')}>
                  <Icon name="playlist" size={15} /> Agregar playlist
                </button>
              </div>
            )}
          </div>

          {!session ? (
            <div className="hck-stage hck-card" style={{ alignItems: 'center', textAlign: 'center', gap: '18px', padding: 'clamp(40px,5vw,70px)' }}>
              {beams(3)}
              <span style={{ color: 'var(--hck-accent-lt)' }}><Icon name="mic" size={40} /></span>
              <h3>No hay ninguna sesión activa</h3>
              <p className="hck-muted" style={{ maxWidth: '52ch' }}>
                Una sesión agrupa a los cantantes de la noche, sus fotos, la cola de canciones y los puntajes.
                Arrancá una y te guío para cargar al primero.
              </p>
              <button className="hck-btn hck-btn-primary hck-btn-xl" onClick={handleStartSession}>
                <Icon name="mic" size={17} /> Iniciar sesión de karaoke
              </button>
            </div>
          ) : (
            <>
          {session.status === 'armando' && !showWizard && (
            <div className="hck-card" style={{ flexDirection: 'row', alignItems: 'center', gap: '18px', borderColor: 'var(--hck-accent)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '17px' }}>Estás armando la sesión</div>
                <div className="hck-muted" style={{ fontSize: '14.5px' }}>El show todavía no arrancó — sumá cantantes y sus canciones.</div>
              </div>
              <button className="hck-btn hck-btn-primary" onClick={() => setShowWizard(true)}>
                Seguir armando
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr)', gap: 'clamp(20px,2vw,36px)', alignItems: 'start' }}>
            <div className="hck-card" style={{ gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                <span className="hck-kicker">Cantantes</span>
                <button className="hck-btn hck-btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setShowWizard(true)}>
                  <Icon name="plus" size={14} /> Registrar cantante
                </button>
              </div>
              {sessionSingers.length === 0 ? (
                <p className="hck-muted" style={{ fontSize: '14.5px' }}>Todavía no hay ninguno.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {sessionSingers.map((s) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface-2)' }}>
                      {s.photoUrl ? (
                        <img src={s.photoUrl} alt="" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
                      ) : (
                        <span style={{ width: '44px', height: '44px', flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '17px', fontWeight: 700, background: 'var(--hck-surface-3)' }}>
                          {s.name[0]?.toUpperCase()}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '17px', letterSpacing: '-.02em' }}>{s.name}</div>
                        <div className="hck-faint" style={{ fontSize: '13.5px' }}>
                          {s.photoUrl ? 'con foto' : 'sin foto'} · {songCounts[s.id] ?? 0} canción{(songCounts[s.id] ?? 0) === 1 ? '' : 'es'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(18px,1.8vw,28px)' }}>
              <div className="hck-card hck-card-hi hck-stage" style={{ gap: '16px' }}>
                {beams(2)}
                <div style={{ display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '260px' }}>
                    {queue[0]?.status === 'playing' ? (
                      <>
                        <span className="hck-kicker">Cantando ahora</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                          {queue[0].singerPhotoUrl && <img src={queue[0].singerPhotoUrl} alt="" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--hck-accent)' }} />}
                          <span style={{ fontSize: 'clamp(22px,1.9vw,32px)', fontWeight: 800, letterSpacing: '-.03em' }}>{queue[0].singer}</span>
                        </div>
                        <div className="hck-muted" style={{ fontSize: '16px', marginTop: '4px' }}>{queue[0].song.title} · {queue[0].song.artist}</div>
                        {/* Puntaje en el momento — editable hasta "Siguiente", no
                            hace falta esperar a que termine para calificar. */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '14px' }}>
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                            <button
                              key={n}
                              className={`hck-btn hck-btn-icon${queue[0].score === n ? ' hck-btn-on' : ''}`}
                              style={{ width: '38px', height: '38px' }}
                              onClick={() => handleScoreItem(queue[0].id, n)}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="hck-muted" style={{ fontSize: '19px' }}>Nadie está cantando todavía</div>
                    )}
                  </div>
                  <button className="hck-btn hck-btn-primary hck-btn-lg" onClick={handleAdvanceQueue} disabled={queue.length === 0}>
                    Siguiente <Icon name="chevR" size={17} />
                  </button>
                </div>
              </div>

              <div className="hck-card" style={{ gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
                  <h4>En espera</h4>
                  <span className="hck-faint" style={{ fontSize: '14.5px' }}>{queue.filter((q) => q.status === 'queued').length} turnos</span>
                  <button
                    className="hck-btn hck-btn-ghost"
                    style={{ marginLeft: 'auto' }}
                    disabled={queue.filter((q) => q.status === 'queued').length < 2}
                    title="Reparte lo que falta cantar alternando entre cantantes"
                    onClick={handleInterleaveQueue}
                  >
                    <Icon name="sync" size={13} /> Alternar turnos
                  </button>
                </div>
                {queue.filter((q) => q.status === 'queued').length === 0 ? (
                  <p className="hck-muted" style={{ fontSize: '14.5px' }}>No hay nadie en espera — agregá cantantes desde la Biblioteca ("+ Cola").</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {queue
                      .filter((q) => q.status === 'queued')
                      .map((item, i, arr) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 12px', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface-2)' }}>
                          <span className="hck-mono hck-faint" style={{ width: '20px', textAlign: 'center', fontWeight: 700 }}>{i + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15.5px' }}>
                              {item.singerPhotoUrl && <img src={item.singerPhotoUrl} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} />}
                              {item.singer}
                            </div>
                            <div className="hck-muted" style={{ fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.song.title} · {item.song.artist}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="hck-btn hck-btn-icon hck-btn-ghost" style={{ width: '32px', height: '32px' }} onClick={() => handleMoveQueueItem(item.id, 'up')} disabled={i === 0} aria-label="Subir">
                              <Icon name="up" size={14} />
                            </button>
                            <button className="hck-btn hck-btn-icon hck-btn-ghost" style={{ width: '32px', height: '32px' }} onClick={() => handleMoveQueueItem(item.id, 'down')} disabled={i === arr.length - 1} aria-label="Bajar">
                              <Icon name="down" size={14} />
                            </button>
                            <button className="hck-btn hck-btn-ghost" onClick={() => handleRemoveFromQueue(item.id)}>Quitar</button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {unscored.length > 0 && (
                <div className="hck-card" style={{ gap: '14px', borderColor: 'var(--hck-accent)' }}>
                  <h4>Falta puntuar</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {unscored.map((item) => (
                      <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface-2)' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15.5px' }}>
                            {item.singerPhotoUrl && <img src={item.singerPhotoUrl} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} />}
                            {item.singer}
                          </div>
                          <div className="hck-muted" style={{ fontSize: '13.5px' }}>{item.song.title} · {item.song.artist}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                            <button key={n} className="hck-btn hck-btn-icon" style={{ width: '32px', height: '32px', fontSize: '13px' }} onClick={() => handleScoreItem(item.id, n)}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="hck-card" style={{ gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h4><Icon name="wand" size={16} /> Cara en el escenario</h4>
              <button className="hck-btn hck-btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setPage('funbox')}>
                Administrar en Fun Box <Icon name="chevR" size={13} />
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="hck-muted">Todavía no hay templates — subí uno desde Studio → Fun Box.</p>
            ) : (
              <>
                <p className="hck-muted" style={{ fontSize: '14.5px' }}>
                  Con pantalla completa activa, apretá el número para mostrarlo sobre quien está cantando.
                </p>
                {faceswapProgress && faceswapProgress.ready < faceswapProgress.total && (
                  <div>
                    <p className="hck-faint" style={{ fontSize: '13.5px', marginBottom: '6px' }}>
                      Preparando caras: {faceswapProgress.ready}/{faceswapProgress.total}
                    </p>
                    <div className="hck-jobbar">
                      <i style={{ width: `${(faceswapProgress.ready / faceswapProgress.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                {queue[0]?.status === 'playing' && !queue[0].singerPhotoUrl && (
                  <p className="hck-faint" style={{ fontSize: '13.5px' }}>
                    {queue[0].singer} no tiene foto cargada — el hotkey no va a mostrar nada hasta que le carguen una.
                  </p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '12px' }}>
                  {templatesByHotkey.map((t) => {
                    const playingSingerId = queue[0]?.status === 'playing' ? queue[0].singerId : undefined
                    const status = t.kind === 'faceswap' && playingSingerId ? faceswapStatus[playingSingerId]?.[t.id] : undefined
                    const notReady = t.kind === 'faceswap' && status !== 'ready'
                    // Fuera de pantalla completa el hotkey no dispara nada real
                    // — en vez de dejar la tarjeta muerta, click lleva a Fun Box
                    // (REQ-13). Adentro, sigue disparando como siempre.
                    const disabled = kioskMode && notReady
                    const title = !kioskMode
                      ? 'Ir a Fun Box'
                      : notReady
                        ? status === 'disabled'
                          ? 'Face swap deshabilitado en esta instalación (sin GPU NVIDIA) — activalo desde Fun Box'
                          : status === 'failed'
                            ? 'No se pudo generar el swap para este cantante'
                            : 'Preparando el swap para este cantante…'
                        : undefined
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={disabled}
                        title={title}
                        onClick={() => (kioskMode ? triggerFaceSwap(t) : setPage('funbox'))}
                        style={{
                          all: 'unset',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          position: 'relative',
                          aspectRatio: '16/10',
                          borderRadius: 'var(--hck-r-md)',
                          overflow: 'hidden',
                          border: '1px solid var(--hck-line)',
                          opacity: disabled ? 0.5 : 1,
                        }}
                      >
                        <span className={`hck-tag ${t.hotkey != null ? 'hck-tag-accent' : 'hck-tag-outline'}`} style={{ position: 'absolute', left: '8px', top: '8px', zIndex: 2, fontSize: '11.5px', padding: '3px 9px' }}>
                          {t.hotkey ?? 'sin tecla'}
                        </span>
                        <video src={t.videoUrl} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {notReady && (
                          <span
                            className="hck-tag"
                            style={{ position: 'absolute', right: '8px', bottom: '8px', zIndex: 2, background: status === 'failed' ? '#7F1D1D' : 'var(--hck-surface-3)' }}
                          >
                            {status === 'disabled' ? 'Sin GPU' : status === 'failed' ? 'Error' : 'Preparando…'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {leaderboard.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
                <h3>Ranking de la noche</h3>
                <span className="hck-faint" style={{ fontSize: '14.5px' }}>Puntaje de 1 a 10 por canción</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 'clamp(14px,1.4vw,24px)' }}>
                {[...leaderboard]
                  .sort((a, b) => b.totalScore - a.totalScore)
                  .slice(0, 3)
                  .map((l, i) => (
                    <div
                      key={l.singerId}
                      className={`hck-card hck-stage${i === 0 ? ' hck-card-hi' : ''}`}
                      style={{ alignItems: 'center', textAlign: 'center', gap: '12px', padding: 'clamp(20px,2vw,30px)' }}
                    >
                      {i === 0 && beams(2)}
                      <div style={{ fontSize: 'clamp(32px,3.4vw,54px)', fontWeight: 800, letterSpacing: '-.05em', color: i === 0 ? 'var(--hck-accent-lt)' : 'var(--hck-faint)' }}>
                        {i + 1}
                      </div>
                      {l.singerPhotoUrl ? (
                        <img src={l.singerPhotoUrl} alt="" style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ width: '56px', height: '56px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '20px', fontWeight: 700, background: 'var(--hck-surface-3)' }}>
                          {l.singer[0]?.toUpperCase()}
                        </span>
                      )}
                      <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-.02em' }}>{l.singer}</div>
                      <div className="hck-mono" style={{ fontSize: '22px', fontWeight: 800 }}>{l.totalScore}</div>
                      <div className="hck-faint" style={{ fontSize: '13px' }}>{l.songsScored} canción{l.songsScored === 1 ? '' : 'es'}</div>
                    </div>
                  ))}
              </div>
              <table className="hck-table">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>#</th>
                    <th>Cantante</th>
                    <th>Canciones</th>
                    <th>Puntos</th>
                  </tr>
                </thead>
                <tbody>
                  {[...leaderboard]
                    .sort((a, b) => b.totalScore - a.totalScore)
                    .map((l, i) => (
                      <tr key={l.singerId}>
                        <td className="hck-mono">{i + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {l.singerPhotoUrl ? (
                              <img src={l.singerPhotoUrl} alt="" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                              <span style={{ width: '30px', height: '30px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '13px', fontWeight: 700, background: 'var(--hck-surface-3)' }}>
                                {l.singer[0]?.toUpperCase()}
                              </span>
                            )}
                            <span style={{ fontWeight: 600 }}>{l.singer}</span>
                          </div>
                        </td>
                        <td className="hck-muted">{l.songsScored}</td>
                        <td className="hck-mono" style={{ fontWeight: 700 }}>{l.totalScore}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

            </>
          )}
        </div>
        )}

        {page === 'studio' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <div>
            <h2>Studio</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>Herramientas para armar y curar el material del kiosco.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(260px,22vw,340px),1fr))', gap: 'clamp(16px,1.6vw,26px)' }}>
            {hubCard('wand', 'Crear canción en la biblioteca', 'Subís audio + letra pegada y se sincroniza sola con WhisperX.', () => setPage('generar'))}
            {hubCard('upload', 'Subir canción a la biblioteca', 'Para karaoke ya armado — LRC, JSON propio, CD+G o video con letra quemada.', () => setPage('subir'))}
            {hubCard('film', 'Fondo de video', 'El video de fondo detrás de la letra en pantalla completa.', () => setPage('fondo'))}
            {hubCard('star', 'Fun Box', 'Pack de templates para la animación de cara en el escenario — subí un video y se mapea solo.', () => setPage('funbox'))}
            {hubCard('grid', 'Editor de templates', 'Marcá a mano el "slot" de cara sobre un video, para templates sin mapeo automático.', () => window.location.assign('/template-editor'))}
          </div>
        </div>
        )}

        {page === 'generar' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('studio')}>
            <Icon name="chevL" size={15} /> Studio
          </button>
          <div>
            <h2>Agregar canción nueva</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>En cuatro pasos, tu próxima estrella tendrá una canción más para brillar.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'clamp(10px,1vw,20px)' }}>
            {(
              [
                [1, 'Subir audio'],
                [2, 'Pegar letra'],
                [3, 'Sincronizar'],
                [4, 'Guardar'],
              ] as const
            ).map(([n, label]) => {
              const done = wizardStep > n
              const cur = wizardStep === n
              return (
                <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ height: '5px', borderRadius: '99px', background: cur || done ? 'var(--hck-accent)' : 'var(--hck-surface-3)', boxShadow: cur ? 'var(--hck-glow)' : 'none' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: cur ? 1 : 0.5 }}>
                    <span style={{ width: '28px', height: '28px', flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '14px', fontWeight: 700, border: `1.5px solid ${cur || done ? 'var(--hck-accent)' : 'var(--hck-line-2)'}`, color: cur || done ? 'var(--hck-accent-lt)' : 'inherit' }}>
                      {done ? '✓' : n}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '16px' }}>{label}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="hck-card" style={{ gap: '20px' }}>
            {wizardStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div className="hck-field" style={{ flex: 1, minWidth: '220px' }}>
                    <label>Título</label>
                    <input className="hck-input" type="text" value={wizardTitle} onChange={(e) => setWizardTitle(e.target.value)} />
                  </div>
                  <div className="hck-field" style={{ flex: 1, minWidth: '220px' }}>
                    <label>Artista</label>
                    <input className="hck-input" type="text" value={wizardArtist} onChange={(e) => setWizardArtist(e.target.value)} />
                  </div>
                </div>
                <div className="hck-field">
                  <label>Idioma de la letra</label>
                  <select className="hck-input" value={wizardLanguage} onChange={(e) => setWizardLanguage(e.target.value)}>
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="hck-faint" style={{ fontSize: '13.5px', marginTop: '8px' }}>
                    El modelo de alineación es específico por idioma — si no coincide con lo que se canta, la letra
                    sincroniza mal en toda la canción.
                  </p>
                </div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={wizardSeparateVocals} onChange={(e) => setWizardSeparateVocals(e.target.checked)} style={{ marginTop: '4px', accentColor: 'var(--hck-accent)' }} />
                  <span style={{ fontSize: '15px' }}>
                    Separar voz del instrumental antes de sincronizar (Demucs)
                    <span className="hck-faint"> — mejor precisión con mucha base instrumental, tarda más.</span>
                  </span>
                </label>

                <div
                  className="hck-dropzone"
                  style={wizardDragOver ? { borderColor: 'var(--hck-accent)' } : undefined}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setWizardDragOver(true)
                  }}
                  onDragLeave={() => setWizardDragOver(false)}
                  onDrop={handleDropAudio}
                  onClick={() => audioFileInputRef.current?.click()}
                >
                  <span className="hck-ico"><Icon name="upload" size={44} w={2.2} /></span>
                  <div style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-.02em' }}>Arrastrá el archivo acá</div>
                  <div className="hck-muted">o hacé clic para buscarlo en tu equipo</div>
                  {wizardAudioFile && <div className="hck-tag hck-tag-accent">{wizardAudioFile.name}</div>}
                  <input ref={audioFileInputRef} type="file" accept=".mp3,.mp4,.ogg,.wav,.webm" hidden onChange={handleBrowseAudio} />
                </div>

                <div style={{ display: 'flex', gap: '14px' }}>
                  <button className="hck-btn hck-btn-primary hck-btn-lg" disabled={!wizardAudioFile} onClick={() => setWizardStep(2)}>Continuar</button>
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div className="hck-field">
                  <label>Pegá la letra completa, una línea por renglón</label>
                  <textarea
                    className="hck-input"
                    rows={10}
                    value={wizardLyricsText}
                    onChange={(e) => setWizardLyricsText(e.target.value)}
                    placeholder={'Bajo las luces se enciende tu voz\ny esta noche el escenario es tuyo...'}
                  />
                  <p className="hck-faint" style={{ fontSize: '13.5px', marginTop: '8px' }}>No la pegues como un solo párrafo — hacen falta los saltos de línea reales.</p>
                </div>
                <div style={{ display: 'flex', gap: '14px' }}>
                  <button className="hck-btn hck-btn-secondary hck-btn-lg" onClick={() => setWizardStep(1)}>Atrás</button>
                  <button className="hck-btn hck-btn-primary hck-btn-lg" disabled={!wizardLyricsText.trim()} onClick={() => setWizardStep(3)}>Continuar</button>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="hck-stage" style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: 'clamp(20px,2vw,32px)', borderRadius: 'var(--hck-r-lg)', background: 'var(--hck-surface-2)' }}>
                {syncing && beams(3)}
                <p className="hck-muted">Sincronizá la letra con el audio para un karaoke perfecto.</p>
                <div className={syncing ? 'hck-jobbar hck-jobbar-idle' : 'hck-jobbar'}>
                  {!syncing && <i style={{ width: '0%' }} />}
                  {syncing && <i />}
                </div>
                <p className="hck-muted" style={{ fontSize: '15px' }}>
                  {syncing ? 'Analizando el audio y ajustando tiempos… (puede tardar unos minutos)' : 'Presioná Sincronizar para comenzar.'}
                </p>
                {syncError && <p style={{ color: '#F87171' }}>{syncError}</p>}
                <div style={{ display: 'flex', gap: '14px' }}>
                  <button className="hck-btn hck-btn-secondary hck-btn-lg" disabled={syncing} onClick={() => setWizardStep(2)}>Atrás</button>
                  <button className="hck-btn hck-btn-primary hck-btn-lg" disabled={syncing} onClick={submitWizardSync}>
                    {syncing ? 'Sincronizando…' : 'Sincronizar'}
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 4 && (
              <div className="hck-stage" style={{ alignItems: 'flex-start', gap: '20px', padding: 'clamp(30px,3vw,56px)' }}>
                {beams(4)}
                <span style={{ color: 'var(--hck-accent-lt)' }}><Icon name="check" size={44} w={2.2} /></span>
                <h3>Todo listo para brillar</h3>
                <p className="hck-muted" style={{ fontSize: '17px', maxWidth: '56ch' }}>{syncMessage ?? 'La canción quedará disponible en tu biblioteca.'}</p>
                <button className="hck-btn hck-btn-primary hck-btn-lg" onClick={finishWizard}>Ir a la biblioteca</button>
              </div>
            )}
          </div>
        </div>
        )}

        {page === 'subir' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('studio')}>
            <Icon name="chevL" size={15} /> Studio
          </button>
          <div>
            <h2>Subir canción armada</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
              Para cuando ya tenés un karaoke armado — LRC, JSON propio, CD+G o un video con letra quemada.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 'clamp(18px,1.8vw,30px)', alignItems: 'start' }}>
            <form onSubmit={handleUpload} className="hck-card" style={{ gap: '16px' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="hck-field" style={{ flex: 1 }}><label>Título</label><input className="hck-input" type="text" name="title" /></div>
                <div className="hck-field" style={{ flex: 1 }}><label>Artista</label><input className="hck-input" type="text" name="artist" /></div>
              </div>
              {[
                { label: 'Audio (mp3/ogg/opus/wav)', name: 'audio', accept: '.mp3,.ogg,.opus,.wav' },
                { label: 'Letra (.lrc, .json o .cdg)', name: 'lyrics', accept: '.lrc,.json,.cdg' },
                { label: 'Video (karaoke con letra quemada, sin audio aparte)', name: 'video', accept: '.mp4,.webm,.mov' },
              ].map((f) => (
                <div className="hck-field" key={f.name}>
                  <label>{f.label}</label>
                  <input className="hck-input" type="file" name={f.name} accept={f.accept} style={{ padding: '12px 16px' }} />
                </div>
              ))}
              <button className="hck-btn hck-btn-primary hck-btn-lg" type="submit">Subir al catálogo</button>
              {uploadMessage && <p style={{ color: '#4ADE80', fontSize: '14px' }}>{uploadMessage}</p>}
              {uploadError && <p style={{ color: '#F87171', fontSize: '14px' }}>{uploadError}</p>}
            </form>
            <div className="hck-card" style={{ gap: '14px', background: 'var(--hck-surface-2)' }}>
              <h4>Qué detecta el kiosco</h4>
              {[
                ['LRC', 'línea por línea'],
                ['JSON propio', 'palabra por palabra'],
                ['CD+G', 'video generado del gráfico'],
                ['Video quemado', 'se usa tal cual, sin letra propia'],
              ].map(([a, b]) => (
                <div key={a} style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
                  <span className="hck-tag hck-tag-outline">{a}</span>
                  <span className="hck-muted" style={{ fontSize: '15px' }}>{b}</span>
                </div>
              ))}
              <p className="hck-faint" style={{ fontSize: '14px', marginTop: '6px' }}>
                Un <span className="hck-mono">.m4a</span> es audio aunque el contenedor sea MP4: si viene con letra aparte, se respeta.
              </p>
            </div>
          </div>
        </div>
        )}

        {page === 'fondo' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('studio')}>
            <Icon name="chevL" size={15} /> Studio
          </button>
          <div>
            <h2>Fondo de video</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
              El clip detrás de la letra en la pantalla grande. La letra siempre queda encima, elijas el que elijas.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 'clamp(18px,1.8vw,30px)', alignItems: 'start' }}>
            <form onSubmit={handleBackgroundVideo} className="hck-card" style={{ gap: '16px' }}>
              <div className="hck-field">
                <label>Video de fondo (mp4/webm/mov)</label>
                <input className="hck-input" type="file" name="video" accept=".mp4,.webm,.mov" required style={{ padding: '12px 16px' }} />
              </div>
              <button className="hck-btn hck-btn-primary hck-btn-lg" type="submit">Actualizar fondo</button>
              {backgroundMessage && <p style={{ color: '#4ADE80', fontSize: '14px' }}>{backgroundMessage}</p>}
            </form>

            <div className="hck-card" style={{ gap: '14px' }}>
              <h4>Fuente en vivo (OBS)</h4>
              <p className="hck-muted" style={{ fontSize: '15px' }}>
                Muestra lo que esté saliendo de una cámara en vivo detrás de la letra — pensado para la cámara virtual
                de OBS ("Iniciar cámara virtual"), pero funciona con cualquier webcam. Mientras esté activa, tapa al
                video de fondo subido arriba.
              </p>
              <div className="hck-field">
                <label>Dispositivo</label>
                <select className="hck-input" value={selectedCameraId} onChange={(e) => setSelectedCameraId(e.target.value)}>
                  <option value="">Cámara por default</option>
                  {cameraDevices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Cámara ${i + 1}`}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="hck-btn hck-btn-secondary" onClick={refreshCameraDevices}>
                  <Icon name="refresh" size={14} /> Actualizar lista
                </button>
                {liveCameraStream ? (
                  <button type="button" className="hck-btn hck-btn-on" onClick={stopLiveCamera}>Apagar cámara en vivo</button>
                ) : (
                  <button type="button" className="hck-btn hck-btn-primary" onClick={startLiveCamera}>Usar cámara en vivo</button>
                )}
              </div>
              {liveCameraStream && (
                <p style={{ color: '#4ADE80', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name="camera" size={13} /> Cámara en vivo activa — así se ve ahora en pantalla completa.
                </p>
              )}
              {liveCameraError && <p style={{ color: '#F87171', fontSize: '14px' }}>{liveCameraError}</p>}
            </div>
          </div>
        </div>
        )}

        {page === 'funbox' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('studio')}>
            <Icon name="chevL" size={15} /> Studio
          </button>
          <div>
            <h2>Fun Box</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
              Pack de templates para la animación de cara en el escenario — subí un video y se mapea solo.
            </p>
          </div>

          <FunBox
            templates={templates}
            faceswapStatus={faceswapStatus}
            faceSwapEnabled={faceSwapEnabled}
            onEnableFaceSwap={handleEnableFaceSwap}
            singersWithPhoto={singersWithPhoto}
            testSingerId={testSingerId}
            onSetTestSingerId={setTestSingerId}
            uploading={funboxUploading}
            error={funboxError}
            onUpload={handleUploadTemplate}
            onTest={testFunboxTemplate}
            onRename={handleRenameTemplate}
            onSetHotkey={handleSetTemplateHotkey}
            onDelete={handleDeleteTemplate}
          />
        </div>
        )}

        {page === 'configuracion' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <div>
            <h2>Configuración</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>Ajustes generales del kiosco.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(260px,22vw,340px),1fr))', gap: 'clamp(16px,1.6vw,26px)' }}>
            {hubCard('folder', 'Importar carpetas', 'Carpetas del disco con karaokes ya armados, sin copiar los archivos pesados.', () => setPage('importar'))}
            {hubCard('grid', 'Banners de inicio', 'El carrusel panorámico arriba de las categorías en Inicio.', () => setPage('banners'))}
            {hubCard('camera', 'Portadas de categoría', 'Una imagen por categoría, para identificarlas de un vistazo en Inicio.', () => setPage('portadas'))}
          </div>
        </div>
        )}

        {page === 'banners' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('configuracion')}>
            <Icon name="chevL" size={15} /> Configuración
          </button>
          <div>
            <h2>Banners de inicio</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>El carrusel panorámico arriba de las categorías en Inicio.</p>
          </div>

          <div className="hck-card" style={{ maxWidth: '640px', gap: '12px' }}>
            <div className="hck-field">
              <label>Subir banner nuevo</label>
              <input
                className="hck-input"
                type="file"
                accept="image/*"
                disabled={bannerUploading}
                style={{ padding: '12px 16px' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleUploadBanner(file)
                  e.target.value = ''
                }}
              />
              <p className="hck-faint" style={{ fontSize: '13.5px', marginTop: '8px' }}>
                Subilo en <strong>2100×900px</strong> (relación de aspecto 21:9, panorámico) — es como se recorta en
                pantalla, y si el texto ya viene quemado en la imagen (ver PROMPTS-BANNERS.md) conviene generarlo
                directamente en esa proporción para que no quede nada importante cerca de los bordes.
              </p>
            </div>
            {bannerUploading && <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span className="hck-spinner" /><span className="hck-muted" style={{ fontSize: '14.5px' }}>Subiendo…</span></div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '640px' }}>
            {banners.map((b, i) => (
              <div key={b.id} className="hck-card" style={{ flexDirection: 'row', alignItems: 'center', gap: '16px', padding: '12px' }}>
                <img src={b.imageUrl} alt="" style={{ width: '120px', height: '52px', objectFit: 'cover', borderRadius: 'var(--hck-r-md)', flex: 'none' }} />
                <div style={{ flex: 1 }} />
                <button className="hck-btn hck-btn-icon hck-btn-ghost" disabled={i === 0} onClick={() => reorderBanner(b.id, 'up')} aria-label="Subir">
                  <Icon name="up" size={15} />
                </button>
                <button className="hck-btn hck-btn-icon hck-btn-ghost" disabled={i === banners.length - 1} onClick={() => reorderBanner(b.id, 'down')} aria-label="Bajar">
                  <Icon name="down" size={15} />
                </button>
                <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={() => handleDeleteBanner(b.id)} aria-label="Eliminar">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            {banners.length === 0 && <p className="hck-muted">Todavía no hay ningún banner — subí el primero arriba.</p>}
          </div>
        </div>
        )}

        {page === 'portadas' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('configuracion')}>
            <Icon name="chevL" size={15} /> Configuración
          </button>
          <div>
            <h2>Portadas de categoría</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
              Una imagen por categoría — se achica y recorta sola a un cuadrado parejo al subirla.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 'clamp(14px,1.3vw,20px)', maxWidth: '900px' }}>
            {CATEGORIES.map((c) => {
              const imageUrl = categoryImages[c.id]
              const uploading = categoryImageUploading === c.id
              return (
                <div key={c.id} className="hck-card" style={{ padding: '14px', gap: '12px', alignItems: 'center' }}>
                  <div
                    className="hck-art"
                    style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--hck-r-md)', background: imageUrl ? 'transparent' : 'var(--hck-surface-2)' }}
                  >
                    {imageUrl && <img src={imageUrl} alt="" />}
                  </div>
                  <span style={{ fontSize: '15.5px', fontWeight: 700, textAlign: 'center' }}>{c.name}</span>
                  <label className="hck-btn hck-btn-secondary hck-btn-block" style={{ textAlign: 'center', cursor: 'pointer' }}>
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
                    <button className="hck-btn hck-btn-ghost hck-btn-block" onClick={() => handleDeleteCategoryImage(c.id)}>
                      Quitar
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        )}

        {page === 'importar' && (
        <div className="hck-scope hck-enter" style={{ padding: 'clamp(24px,2.2vw,44px) clamp(24px,3vw,68px) 160px', display: 'flex', flexDirection: 'column', gap: 'clamp(24px,2.4vw,44px)' }}>
          <button className="hck-btn hck-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPage('configuracion')}>
            <Icon name="chevL" size={15} /> Configuración
          </button>
          <div>
            <h2>Importar carpetas</h2>
            <p className="hck-muted" style={{ marginTop: '10px', fontSize: 'clamp(15px,1.1vw,19px)' }}>
              Agregá carpetas del disco con karaokes ya armados (audio + letra, o video con letra quemada). No se
              copian los archivos pesados — se sirven desde su ubicación original.
            </p>
          </div>
          <div className="hck-card" style={{ gap: '14px', maxWidth: '780px' }}>
            <div className="hck-field">
              <label>Agregar carpeta</label>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  className="hck-input hck-mono"
                  style={{ flex: 1 }}
                  type="text"
                  placeholder="C:\Karaoke\Repertorio"
                  value={newImportRoot}
                  onChange={(e) => setNewImportRoot(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addImportRoot()}
                />
                <button className="hck-btn hck-btn-primary" type="button" onClick={addImportRoot}>Agregar</button>
              </div>
            </div>

            {importRoots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {importRoots.map((root) => (
                  <div key={root} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface-2)' }}>
                    <span className="hck-faint"><Icon name="folder" size={18} /></span>
                    <span className="hck-mono" style={{ flex: 1, fontSize: '14.5px' }}>{root}</span>
                    <button className="hck-btn hck-btn-icon hck-btn-ghost" type="button" onClick={() => removeImportRoot(root)} aria-label="Quitar">
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {importError && <p style={{ color: '#F87171', fontSize: '14px' }}>{importError}</p>}
            {importMessage && <p style={{ color: '#4ADE80', fontSize: '14px' }}>{importMessage}</p>}

            <button className="hck-btn hck-btn-primary hck-btn-lg" type="button" disabled={importRoots.length === 0 || importScanning} onClick={scanImportFolders}>
              {importScanning ? 'Escaneando…' : 'Buscar karaokes nuevos'}
            </button>
          </div>

          {importCandidates && (
            <div>
              {importCandidates.length === 0 ? (
                <p className="hck-muted">No se encontraron karaokes nuevos en las carpetas configuradas.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                    <h4>{importCandidates.length} encontrados</h4>
                    <button
                      className="hck-btn hck-btn-primary"
                      style={{ marginLeft: 'auto' }}
                      type="button"
                      disabled={importRunning || !importCandidates.some((c) => c.detection.ok)}
                      onClick={() => runImportCandidates(importCandidates.filter((c) => c.detection.ok))}
                    >
                      {importRunning ? 'Importando…' : 'Importar todos los válidos'}
                    </button>
                  </div>
                  <table className="hck-table">
                    <thead>
                      <tr><th>Canción</th><th>Artista</th><th>Detección</th><th style={{ width: '200px' }} /></tr>
                    </thead>
                    <tbody>
                      {importCandidates.map((c) => (
                        <tr key={c.key}>
                          <td style={{ fontWeight: 700 }}>{c.title}</td>
                          <td className="hck-muted">{c.artist}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span className={`hck-tag ${c.detection.ok ? 'hck-tag-accent' : 'hck-tag-outline'}`}>{c.detection.ok ? 'listo' : 'no se puede'}</span>
                              <span className="hck-muted" style={{ fontSize: '14px' }}>{c.detection.ok ? c.detection.message : c.detection.reason}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="hck-btn hck-btn-secondary"
                              type="button"
                              disabled={!c.detection.ok || importRunning}
                              onClick={() => runImportCandidates([c])}
                            >
                              Importar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
        )}
      </main>
      </div>
      )}

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
        <div className="hck-scope hck-dialog-back" onClick={closeResync}>
          <div className="hck-dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px,100%)', maxHeight: '86vh', overflowY: 'auto' }}>
            <h2>Re-sincronizar "{resyncSong.title}"</h2>
            <p className="hck-faint" style={{ fontSize: '14.5px', marginTop: '-8px' }}>
              El audio no cambia — solo se vuelve a correr el reconocimiento con la letra y el idioma que pongas acá.
              Usalo si la letra quedó desincronizada o se sincronizó con el idioma equivocado.
            </p>
            <div className="hck-field">
              <label>Idioma de la letra</label>
              <select
                className="hck-input"
                value={resyncLanguage}
                onChange={(e) => setResyncLanguage(e.target.value)}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={resyncSeparateVocals}
                onChange={(e) => setResyncSeparateVocals(e.target.checked)}
                style={{ marginTop: '3px' }}
              />
              <span style={{ fontSize: '15px' }}>
                Separar voz del instrumental antes de sincronizar (Demucs)
                <span className="hck-faint" style={{ fontSize: '13.5px' }}>
                  {' '}
                  — mejor precisión con mucha base instrumental, tarda más.
                </span>
              </span>
            </label>
            <div className="hck-field">
              <label>Letra completa (una línea por renglón)</label>
              <textarea
                className="hck-input"
                rows={10}
                value={resyncLyricsText}
                onChange={(e) => setResyncLyricsText(e.target.value)}
                placeholder={'Pegá acá la letra completa,\nuna línea por renglón...'}
              />
            </div>
            {resyncError && <p style={{ color: '#FCA5A5', fontSize: '14.5px' }}>{resyncError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={closeResync} disabled={resyncing}>
                Cancelar
              </button>
              <button className="hck-btn hck-btn-primary" onClick={submitResync} disabled={resyncing || !resyncLyricsText.trim()}>
                {resyncing ? 'Sincronizando…' : 'Re-sincronizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addToPlaylistSong && (
        <div className="hck-scope hck-dialog-back" onClick={() => setAddToPlaylistSong(null)}>
          <div className="hck-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Agregar "{addToPlaylistSong.title}" a…</h2>
            {playlists.length === 0 ? (
              <p className="hck-faint" style={{ fontSize: '14.5px' }}>
                No hay playlists todavía — creá la primera acá mismo.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {playlists.map((p) => (
                  <button
                    key={p.id}
                    className="hck-btn hck-btn-secondary hck-btn-block"
                    style={{ justifyContent: 'space-between' }}
                    onClick={() => addSongToPlaylist(p.id, addToPlaylistSong.id)}
                  >
                    {p.name} <span className="hck-faint">({p.songCount})</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', paddingTop: '10px', borderTop: '1px solid var(--hck-line)' }}>
              <div className="hck-field" style={{ flex: 1 }}>
                <label>Nueva playlist</label>
                <input
                  className="hck-input"
                  value={quickPlaylistName}
                  onChange={(e) => setQuickPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylistAndAdd()}
                  placeholder="Nombre de la playlist"
                />
              </div>
              <button className="hck-btn hck-btn-primary" disabled={!quickPlaylistName.trim() || creatingQuickPlaylist} onClick={handleCreatePlaylistAndAdd}>
                {creatingQuickPlaylist ? 'Creando…' : 'Crear y agregar'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="hck-btn hck-btn-secondary" onClick={() => setAddToPlaylistSong(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {pushPlaylist && (
        <div className="hck-scope hck-dialog-back" onClick={() => setPushPlaylist(null)}>
          <div className="hck-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Agregar "{pushPlaylist.name}" a la sesión</h2>
            <p className="hck-faint" style={{ fontSize: '14.5px', marginTop: '-8px' }}>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={() => setPushPlaylist(null)}>
                Cancelar
              </button>
              <button className="hck-btn hck-btn-primary" onClick={submitPushPlaylist}>
                Agregar a la cola
              </button>
            </div>
          </div>
        </div>
      )}

      {queueSong && (
        <div className="hck-scope hck-dialog-back" onClick={() => setQueueSong(null)}>
          <div className="hck-dialog" onClick={(e) => e.stopPropagation()}>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={() => setQueueSong(null)}>
                Cancelar
              </button>
              <button className="hck-btn hck-btn-primary" onClick={submitAddToQueue}>
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
        <div className="hck-scope hck-dialog-back" onClick={() => !deleting && setDeleteSong(null)}>
          <div className="hck-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>¿Eliminar "{deleteSong.title}"?</h2>
            <p className="hck-faint" style={{ fontSize: '14.5px', marginTop: '-8px' }}>
              Se borra el audio, la letra y cualquier cola/puntaje asociado. Esta acción no se puede deshacer.
              El N° {deleteSong.number} queda invalidado para siempre — ninguna canción futura va a reutilizarlo.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={() => setDeleteSong(null)} disabled={deleting}>
                Cancelar
              </button>
              <button className="hck-btn hck-btn-danger" onClick={confirmDeleteSong} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!kioskMode && bgJobs.length > 0 && (
        <div
          className="hck-scope hck-card"
          style={{
            position: 'fixed',
            left: 'calc(var(--hck-rail-w, 0px) + 24px)',
            bottom: marqueeCollapsed ? '80px' : '150px',
            zIndex: 20,
            gap: '10px',
            padding: bgJobsExpanded ? '16px 20px' : '10px 16px',
            minWidth: bgJobsExpanded ? '260px' : undefined,
            borderColor: 'var(--hck-accent)',
          }}
        >
          {!bgJobsExpanded ? (
            <button className="hck-btn hck-btn-ghost" style={{ padding: 0 }} onClick={() => setBgJobsExpanded(true)}>
              <span className="hck-spinner" /> {bgJobs.length} trabajo{bgJobs.length === 1 ? '' : 's'} en curso
            </button>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="hck-kicker">Trabajos en curso</span>
                <button
                  className="hck-btn hck-btn-icon hck-btn-ghost"
                  style={{ marginLeft: 'auto', width: '26px', height: '26px' }}
                  onClick={() => setBgJobsExpanded(false)}
                  title="Ocultar"
                >
                  <Icon name="collapse" size={14} />
                </button>
              </div>
              {bgJobs.map((j) => (
                <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="hck-spinner" />
                  <span style={{ flex: 1, minWidth: 0, fontSize: '14.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {j.label}
                  </span>
                  <button
                    className="hck-btn hck-btn-secondary"
                    style={{ fontSize: '13px', padding: '6px 10px' }}
                    onClick={() => {
                      setPage(j.returnPage)
                      setBgJobsExpanded(false)
                    }}
                  >
                    Volver
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {scoreBadge && (
        <div
          ref={scoreBadgeRef}
          className="hck-scope hck-card"
          style={{
            position: 'fixed',
            right: '24px',
            bottom: kioskMode ? '24px' : marqueeCollapsed ? '80px' : '150px',
            zIndex: 20,
            gap: '8px',
            padding: '16px 20px',
            minWidth: '220px',
            borderColor: 'var(--hck-accent)',
            boxShadow: 'var(--hck-glow)',
          }}
        >
          <span className="hck-kicker">Cargando puntuación</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span className="hck-muted" style={{ fontSize: '15px' }}>
              {queue.find((q) => q.id === scoreBadge.itemId)?.singer ?? 'Cantante'}
            </span>
            <span className="hck-mono" style={{ fontSize: '28px', fontWeight: 800, color: 'var(--hck-accent-lt)' }}>
              {scoreBadge.input || '_'}
            </span>
          </div>
          <span className="hck-faint" style={{ fontSize: '13px' }}>
            <span className="hck-kbd">Enter</span> confirma · <span className="hck-kbd">Esc</span> cancela
          </span>
        </div>
      )}

      {fxOpen && (
        <div
          ref={fxPanelRef}
          className="hck-scope hck-card"
          style={{
            position: 'fixed',
            right: 'clamp(16px,2vw,34px)',
            bottom: kioskMode ? '90px' : marqueeCollapsed ? '80px' : '150px',
            zIndex: 20,
            width: 'min(720px,92vw)',
            maxHeight: '62vh',
            overflowY: 'auto',
            gap: '16px',
            boxShadow: '0 30px 70px rgba(0,0,0,.7), var(--hck-glow)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <h4>Efectos de Fun Box</h4>
            <span className="hck-faint" style={{ fontSize: '14px' }}>Apretá el número o tocá el cuadro</span>
            <button className="hck-btn hck-btn-ghost" style={{ marginLeft: 'auto', fontSize: '14.5px' }} onClick={() => { setPage('funbox'); setFxOpen(false) }}>
              Administrar en Studio
            </button>
            <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={() => setFxOpen(false)}>
              <Icon name="x" size={18} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: '12px' }}>
            {Array.from({ length: 9 }, (_, i) => templatesByHotkey.find((t) => t.hotkey === i + 1) ?? null).map((t, i) => {
              if (!t) {
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setPage('funbox'); setFxOpen(false) }}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}
                  >
                    <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--hck-r-sm)', border: '1.5px dashed var(--hck-line-2)', display: 'grid', placeItems: 'center', color: 'var(--hck-deco)' }}>
                      <Icon name="plus" size={22} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span className="hck-kbd">{i + 1}</span>
                      <span className="hck-faint" style={{ fontSize: '13px' }}>Libre</span>
                    </div>
                  </button>
                )
              }
              const playingSingerId = queue[0]?.status === 'playing' ? queue[0].singerId : undefined
              const status = t.kind === 'faceswap' && playingSingerId ? faceswapStatus[playingSingerId]?.[t.id] : undefined
              const notReady = t.kind === 'faceswap' && status !== 'ready'
              const disabled = kioskMode && notReady
              const isActive = !!activeFaceSwap && (activeFaceSwap.kind === 'sticker' ? activeFaceSwap.template.id === t.id : activeFaceSwap.templateId === t.id)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  title={status === 'disabled' ? 'Face swap deshabilitado en esta instalación (sin GPU NVIDIA) — activalo desde Fun Box' : undefined}
                  onClick={() => {
                    if (kioskMode) triggerFaceSwap(t)
                    else { setPage('funbox'); setFxOpen(false) }
                  }}
                  style={{ all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: '8px', opacity: disabled ? 0.5 : 1 }}
                >
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 'var(--hck-r-sm)', overflow: 'hidden', border: `1.5px solid ${isActive ? 'var(--hck-accent)' : 'var(--hck-line)'}`, boxShadow: isActive ? 'var(--hck-glow)' : undefined }}>
                    <video src={t.videoUrl} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                    <span className="hck-kbd">{i + 1}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <Marquee
        page={page}
        kioskMode={kioskMode}
        nowPlayingSong={nowPlayingSong}
        isLocalReady={isLocalReady}
        paused={paused}
        duration={duration}
        scrubValue={scrubValue}
        displayPosition={displayPosition}
        onScrubDrag={handleScrubDrag}
        onScrubCommit={handleScrubCommit}
        onTogglePlay={isLocalReady ? togglePlayPause : beginLocalPlayback}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        vocalsOff={vocalsOff}
        onToggleVocals={toggleVocals}
        hasInstrumental={!!nowPlayingSong?.instrumentalUrl}
        showSyncEditor={showSyncEditor}
        onToggleSyncEditor={() => setShowSyncEditor((v) => !v)}
        hasLyrics={!!lyrics}
        showLyricsOverlay={showLyricsOverlay}
        onToggleLyricsOverlay={() => setShowLyricsOverlay((v) => !v)}
        autoAdvance={autoAdvance}
        onToggleAutoAdvance={() => setAutoAdvance((v) => !v)}
        onEnterKiosk={enterKiosk}
        collapsed={marqueeCollapsed}
        onToggleCollapse={() => setMarqueeCollapsed((v) => !v)}
        fxOpen={fxOpen}
        onToggleFx={() => setFxOpen((v) => !v)}
      />

      {showSyncEditor && lyrics && (
        <div
          className="hck-scope"
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: '150px',
            width: 'min(460px,100vw)',
            zIndex: 400,
            background: 'var(--hck-surface)',
            borderLeft: '1px solid var(--hck-line-2)',
            boxShadow: '-30px 0 60px rgba(0,0,0,.4)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '16px',
              padding: '22px 22px 16px',
              borderBottom: '1px solid var(--hck-line)',
            }}
          >
            <div>
              <h3>Corregir sincronía</h3>
              <p className="hck-faint" style={{ fontSize: '13.5px', marginTop: '8px', lineHeight: 1.5 }}>
                Escuchá y, cuando una línea suene en un momento distinto al que dice, tocá "Fijar acá" en ese
                instante. "Fijar desde acá" además corre todo lo que sigue por el mismo desfasaje.
              </p>
            </div>
            <button
              className="hck-btn hck-btn-ghost hck-btn-icon"
              onClick={() => setShowSyncEditor(false)}
              aria-label="Cerrar"
              style={{ flex: 'none' }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {lyrics.lines.map((line, i) => {
              const isActive = displayPosition >= line.start && displayPosition < line.end
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '11px',
                    padding: '9px 12px',
                    borderRadius: 'var(--hck-r-sm)',
                    ...(isActive
                      ? { background: 'var(--hck-accent-12)', boxShadow: 'inset 0 0 0 1px var(--hck-accent)' }
                      : {}),
                  }}
                >
                  <span className="hck-mono hck-faint" style={{ fontSize: '12.5px', flex: 'none', width: '44px' }}>
                    {formatTime(line.start)}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: '14.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {line.words.map((w) => w.t).join(' ')}
                  </span>
                  <div style={{ display: 'flex', gap: '6px', flex: 'none' }}>
                    <button
                      className="hck-btn hck-btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => fixLineHere(i, false)}
                    >
                      Fijar acá
                    </button>
                    <button
                      className="hck-btn hck-btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => fixLineHere(i, true)}
                    >
                      Fijar desde acá →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '16px 22px',
              borderTop: '1px solid var(--hck-line)',
            }}
          >
            {syncEdited ? (
              <>
                <span className="hck-faint" style={{ flex: 1, fontSize: '13.5px' }}>
                  Hay cambios sin guardar.
                </span>
                <button className="hck-btn hck-btn-secondary" onClick={discardSyncEdits} disabled={savingSyncEdits}>
                  Descartar
                </button>
                <button className="hck-btn hck-btn-primary" onClick={saveSyncEdits} disabled={savingSyncEdits}>
                  {savingSyncEdits ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </>
            ) : (
              <span className="hck-faint" style={{ flex: 1, fontSize: '13.5px' }}>
                Sin cambios sin guardar.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
