export type PlaybackMode = 'overlay' | 'complete'
export type SourceFormat = 'json' | 'lrc-word' | 'lrc-line' | 'cdg' | 'baked-video' | 'audio-only' | 'auto-sync'
export type SyncQuality = 'excellent' | 'interpolated' | 'none'

export interface Song {
  id: string
  title: string
  artist: string
  playbackMode: PlaybackMode
  sourceFormat: SourceFormat
  syncQuality: SyncQuality
  /** null solo cuando sourceFormat = 'baked-video' (todo vive en el video). */
  audioUrl: string | null
  /** null si la canción no tiene letra propia (audio-only, cdg, baked-video). */
  lyricsUrl: string | null
  /** null salvo sourceFormat = 'baked-video'. */
  videoUrl: string | null
  /** null salvo que se haya sincronizado con la opción "separar voz" (Demucs)
   * activada — la pista instrumental que dejó ese paso, para apagar la voz
   * original y cantar sobre la base sola. */
  instrumentalUrl: string | null
  /** El operador escuchó la canción y confirmó que la letra va sincronizada.
   * Distinto de `syncQuality`, que es una expectativa según el origen de los
   * tiempos: esto es verificación humana. */
  syncVerified: boolean
  /** Uno de `GENRES`, o null hasta que se etiquete a mano — ningún importador
   * trae género (ver .claude/plans, sección "Categorías"). */
  genre: Genre | null
  /** Número visible para el operador — autoincremental, no editable, nunca
   * se reasigna aunque se borre la canción (ver `nextSongNumber`, server). */
  number: number
}

/** Taxonomía fija de géneros — no es texto libre, para que las categorías de
 * Inicio tengan un conjunto conocido de antemano. */
export const GENRES = ['cumbia', 'rock', 'pop', 'balada', 'fiesta'] as const
export type Genre = (typeof GENRES)[number]

/** Id de categoría de Inicio/Biblioteca: 'nuevas' y 'verificadas' son
 * estructurales (no necesitan género), el resto son los `GENRES`. */
export type CategoryId = 'nuevas' | 'verificadas' | Genre

export const CATEGORIES: { id: CategoryId; name: string; desc: string }[] = [
  { id: 'nuevas', name: 'Novedades', desc: 'Últimas canciones agregadas' },
  { id: 'verificadas', name: 'Sincronía verificada', desc: 'Confirmadas a oído por el operador' },
  { id: 'cumbia', name: 'Cumbia', desc: 'Género' },
  { id: 'rock', name: 'Rock nacional', desc: 'Género' },
  { id: 'pop', name: 'Pop', desc: 'Género' },
  { id: 'balada', name: 'Baladas', desc: 'Género' },
  { id: 'fiesta', name: 'Fiesta', desc: 'Género' },
]

/** 'queued' espera turno, 'playing' es la que está sonando ahora, 'done' ya
 * se cantó (con o sin puntaje todavía). */
export type QueueStatus = 'queued' | 'playing' | 'done'

export interface QueueItem {
  id: string
  singerId: string
  singer: string
  /** null si el cantante no cargó foto al registrarse. */
  singerPhotoUrl: string | null
  status: QueueStatus
  /** null hasta que el operador la puntúa (después de que termina). */
  score: number | null
  song: { id: string; title: string; artist: string; number: number }
}

export interface LeaderboardEntry {
  singerId: string
  singer: string
  singerPhotoUrl: string | null
  totalScore: number
  songsScored: number
}

/** 'armando' = el admin está cargando cantantes y sus canciones (el show
 * todavía no arrancó); 'corriendo' = ya está en vivo. */
export type SessionStatus = 'armando' | 'corriendo'

/** Sesión de karaoke activa. Como mucho una a la vez — ver ROADMAP.md. */
export interface Session {
  id: string
  startedAt: number
  status: SessionStatus
}

export interface Singer {
  id: string
  name: string
  /** null si no cargó foto (es opcional al registrarse). */
  photoUrl: string | null
  /** Óvalo de recorte de cara calibrado a mano (fracciones del ancho/alto de
   * la foto, misma convención que Template.transform.frames). null = sin
   * calibrar, el compositor usa un óvalo centrado por default. */
  oval: { cx: number; cy: number; scale: number } | null
}

/**
 * Template de "cara en el escenario" — dos técnicas conviven bajo el mismo tipo:
 * - `sticker`: el protagonista del video NO tiene rostro real (capucha de color,
 *   ver .claude/agents/director-escenas.md); `transform` trackea la posición del
 *   blob de color (pipeline/track_color.py) y el cliente pega un recorte ovalado
 *   de la foto en vivo, cuadro a cuadro (FaceSwapOverlay.tsx). Instantáneo.
 * - `faceswap`: el protagonista SÍ tiene un rostro real, que la IA reemplaza de
 *   verdad (pipeline/analyze_template_face.py + render_singer_faceswap.py). No
 *   hay `transform` — en cambio, cada cantante tiene un clip ya renderizado
 *   (pre-generado en segundo plano al cargar su foto, ver
 *   /api/sessions/current/faceswap-status) que el cliente solo reproduce.
 *
 * `transform.frames[].visible: false` (solo aplica a `sticker`) indica un tramo
 * sin detección; el consumidor sostiene el último valor visible en esos huecos.
 */
export type Template =
  | {
      id: string
      videoUrl: string
      name: string
      hotkey: number | null
      kind: 'sticker'
      transform: {
        fps: number
        width: number
        height: number
        frames: { t: number; cx: number | null; cy: number | null; angle: number | null; scale: number | null; visible: boolean }[]
      }
    }
  | { id: string; videoUrl: string; name: string; hotkey: number | null; kind: 'faceswap' }

/** Estado de render de un clip cantante+template `faceswap` (ver
 * GET /api/sessions/current/faceswap-status) — `ready` es el único estado en
 * que hay algo para reproducir; los demás dejan el hotkey deshabilitado. */
export type TemplateRenderStatus = 'pending' | 'ready' | 'failed' | 'disabled'

/** Lista curada de antemano, para empujar varias canciones a la cola de una vez. */
export interface Playlist {
  id: string
  name: string
  songCount: number
}

/** Una playlist con sus canciones resueltas, para la vista de detalle. */
export interface PlaylistDetail extends Playlist {
  songs: Song[]
}

/** Banner del carrusel de Inicio — solo imagen, sin título/subtítulo (ver
 * PROMPTS-BANNERS.md: el texto, si hace falta, ya viene quemado en la imagen). */
export interface Banner {
  id: string
  imageUrl: string
}
