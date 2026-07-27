import { useEffect, useState, type FormEvent } from 'react'
import type { ServerMsg, Song } from '@kiosco/shared'

const QUALITY_LABEL: Record<Song['syncQuality'], string> = {
  excellent: 'Excelente',
  interpolated: 'Interpolada',
  none: 'Sin letra',
}

const QUALITY_COLOR: Record<Song['syncQuality'], string> = {
  excellent: 'var(--marquee)',
  interpolated: 'var(--teal)',
  none: 'var(--muted-2)',
}

const MODE_LABEL: Record<Song['playbackMode'], string> = {
  overlay: 'Overlay',
  complete: 'Completo',
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

type Page = 'biblioteca' | 'generar' | 'subir' | 'fondo'

const NAV_ITEMS: { id: Page; label: string; icon: JSX.Element }[] = [
  {
    id: 'biblioteca',
    label: 'Biblioteca',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="7" height="16" rx="1.5" />
        <rect x="14" y="4" width="7" height="10" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'generar',
    label: 'Generar karaoke',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12h4l2-7 4 14 2-7h6" />
      </svg>
    ),
  },
  {
    id: 'subir',
    label: 'Subir canción',
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
]

export function App() {
  const [page, setPage] = useState<Page>('biblioteca')
  const [songs, setSongs] = useState<Song[]>([])
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [backgroundMessage, setBackgroundMessage] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [nowPlayingId, setNowPlayingId] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)

  const nowPlayingSong = songs.find((s) => s.id === nowPlayingId) ?? null

  async function refreshSongs() {
    const res = await fetch('/api/songs')
    setSongs(await res.json())
  }

  useEffect(() => {
    refreshSongs()

    const ws = new WebSocket(`ws://${location.hostname}:8080/ws`)
    ws.onmessage = (ev) => {
      const msg: ServerMsg = JSON.parse(ev.data)
      if (msg.t === 'snapshot') setNowPlayingId(msg.nowPlaying?.id ?? null)
    }
    return () => ws.close()
  }, [])

  async function handlePlay(id: string) {
    setPlayError(null)
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

  async function handleSync(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSyncMessage(null)
    setSyncError(null)
    setSyncing(true)
    const form = e.currentTarget
    try {
      const res = await fetch('/api/songs/sync', { method: 'POST', body: new FormData(form) })
      const body = await res.json()
      if (!res.ok) {
        setSyncError(body.error ?? 'Error desconocido')
        return
      }
      setSyncMessage(`"${body.song.title}" agregada — ${body.message}`)
      form.reset()
      refreshSongs()
    } finally {
      setSyncing(false)
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Kiosco</span>
        </div>
        <div className="brand-sub">de Karaoke — Admin</div>

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
        </nav>
      </aside>

      <main className="stage">
        <section className={`page${page === 'biblioteca' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Biblioteca</h1>
              <p>{songs.length} canciones. El color del borde es la calidad de sincronía.</p>
            </div>
          </div>

          <div className="library-grid">
            {songs.map((s) => {
              const isPlaying = s.id === nowPlayingId
              return (
                <article
                  key={s.id}
                  className={`song-card${isPlaying ? ' is-playing' : ''}`}
                  style={{ ['--quality-color' as string]: QUALITY_COLOR[s.syncQuality] }}
                >
                  <div className="song-top">
                    <div>
                      <div className="song-title">{s.title}</div>
                      <div className="song-artist">{s.artist}</div>
                    </div>
                    <span className="badge">{QUALITY_LABEL[s.syncQuality]}</span>
                  </div>
                  <div className="song-meta">
                    <span>{FORMAT_LABEL[s.sourceFormat]}</span>
                    <span>·</span>
                    <span>{MODE_LABEL[s.playbackMode]}</span>
                  </div>
                  <div className="song-actions">
                    <button className="play-btn" onClick={() => handlePlay(s.id)} disabled={isPlaying}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 4l14 8-14 8z" />
                      </svg>
                      {isPlaying ? 'Reproduciendo' : 'Reproducir'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          {playError && <p className="error">{playError}</p>}
        </section>

        <section className={`page${page === 'generar' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Generar karaoke</h1>
              <p>Subí el audio o video y pegá la letra completa — el sistema calcula el tiempo de cada palabra.</p>
            </div>
          </div>
          <div className="panel">
            <form onSubmit={handleSync}>
              <div className="field">
                <label>Título</label>
                <input type="text" name="title" />
              </div>
              <div className="field">
                <label>Artista</label>
                <input type="text" name="artist" />
              </div>
              <div className="field">
                <label>Audio o video (mp3/mp4)</label>
                <input type="file" name="audio" accept=".mp3,.mp4,.ogg,.wav,.webm" required />
              </div>
              <div className="field">
                <label>Letra completa (una línea por renglón)</label>
                <textarea
                  name="lyrics"
                  rows={10}
                  required
                  placeholder={'Pegá acá la letra completa,\nuna línea por renglón,\ntal como se ve en una página de letras.'}
                />
                <div className="hint">No la pegues como un solo párrafo — hacen falta los saltos de línea reales.</div>
              </div>
              <button className="submit-btn" type="submit" disabled={syncing}>
                {syncing ? 'Sincronizando… (puede tardar)' : 'Sincronizar y agregar a la biblioteca'}
              </button>
            </form>
            {syncMessage && <p className="ok">{syncMessage}</p>}
            {syncError && <p className="error">{syncError}</p>}
          </div>
        </section>

        <section className={`page${page === 'subir' ? ' active' : ''}`}>
          <div className="stage-head">
            <div>
              <h1>Subir canción</h1>
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
              <button className="submit-btn" type="submit">
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
              <button className="submit-btn" type="submit">
                Actualizar fondo
              </button>
            </form>
            {backgroundMessage && <p className="ok">{backgroundMessage}</p>}
          </div>
        </section>
      </main>

      <div className="marquee-bar">
        <div className="marquee-bulbs" aria-hidden="true" />
        <div className="now-playing">
          {nowPlayingSong ? (
            <>
              <div className="eq">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="now-playing-text">
                <div className="now-playing-title">{nowPlayingSong.title}</div>
                <div className="now-playing-artist">{nowPlayingSong.artist}</div>
              </div>
            </>
          ) : (
            <div className="now-playing-empty">Nadie está cantando todavía</div>
          )}
        </div>
      </div>
    </div>
  )
}
