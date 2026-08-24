import { useEffect, useState } from 'react'
import type { Song, CategoryId } from '@kiosco/shared'
import { CATEGORIES } from '@kiosco/shared'
import { Icon } from './icons'
import { songColor } from './songColor'

interface Props {
  categoryId: CategoryId
  imageUrl: string | null
  nowPlayingId: string | null
  sessionActive: boolean
  onPlay: (id: string) => void
  onAddQueue: (song: Song) => void
  onViewAll: () => void
}

const PAGE_SIZE = 6

/** Carrusel de una categoría de Inicio — 6 visibles, navega hasta 15 (las
 * que devuelva /api/songs/category/:id) con flechas y puntos. Las canciones
 * no tienen portada propia (no hay arte por canción en el catálogo) — cada
 * card usa la portada de la CATEGORÍA como fondo decorativo (el mismo
 * `imageUrl` del encabezado), y solo si no hay ninguna cae al color
 * determinístico de siempre. */
export function CategoryCarousel({ categoryId, imageUrl, nowPlayingId, sessionActive, onPlay, onAddQueue, onViewAll }: Props) {
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPage(0)
    fetch(`/api/songs/category/${categoryId}?limit=15`)
      .then((r) => r.json())
      .then((body: { items: Song[]; total: number }) => {
        if (cancelled) return
        setSongs(body.items)
        setTotal(body.total)
      })
    return () => {
      cancelled = true
    }
  }, [categoryId])

  if (songs.length === 0) return null // categoría vacía (ej. género sin etiquetar todavía) no ocupa lugar

  const category = CATEGORIES.find((c) => c.id === categoryId)
  const pages = Math.max(1, Math.ceil(songs.length / PAGE_SIZE))
  const visible = songs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        <div
          className="hck-art"
          style={{ width: '60px', height: '60px', flex: 'none', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface)', border: '1px solid var(--hck-line)' }}
        >
          {imageUrl && <img src={imageUrl} alt="" />}
        </div>
        <div>
          <h3>{category?.name ?? categoryId}</h3>
          <span className="hck-faint" style={{ fontSize: '14.5px' }}>{total} canciones</span>
        </div>
        <button className="hck-btn hck-btn-ghost" style={{ marginLeft: 'auto' }} onClick={onViewAll}>
          Ver todas <Icon name="chevR" size={13} />
        </button>
        {pages > 1 && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={() => setPage((p) => (p - 1 + pages) % pages)} aria-label="Anterior">
              <Icon name="chevL" size={15} />
            </button>
            <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={() => setPage((p) => (p + 1) % pages)} aria-label="Siguiente">
              <Icon name="chevR" size={15} />
            </button>
          </div>
        )}
      </div>
      <div key={page} className="hck-enter" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 'clamp(12px,1.2vw,20px)' }}>
        {visible.map((s) => {
          const isPlaying = s.id === nowPlayingId
          return (
            <div
              key={s.id}
              className="hck-card"
              style={{ padding: '13px', borderRadius: 'var(--hck-r-lg)', gap: '12px' }}
            >
              <div style={{ position: 'relative' }}>
                <div
                  className="hck-art"
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    borderRadius: 'var(--hck-r-md)',
                    background: imageUrl ? 'linear-gradient(160deg,var(--hck-surface-2),var(--hck-bg-deep))' : songColor(s.id),
                  }}
                >
                  {imageUrl && <img src={imageUrl} alt="" />}
                </div>
                <button
                  className="hck-btn hck-btn-icon"
                  style={{ position: 'absolute', right: '10px', bottom: '10px', background: 'rgba(10,12,16,.55)' }}
                  onClick={() => onPlay(s.id)}
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
              <button
                className="hck-btn hck-btn-secondary hck-btn-block"
                onClick={() => onAddQueue(s)}
                disabled={!sessionActive}
                title={sessionActive ? 'Agregar a la cola' : 'Iniciá una sesión primero'}
              >
                <Icon name="plus" size={13} /> Cola
              </button>
            </div>
          )
        })}
      </div>
      {pages > 1 && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          {Array.from({ length: pages }).map((_, i) => (
            <span
              key={i}
              onClick={() => setPage(i)}
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                cursor: 'pointer',
                background: i === page ? 'var(--hck-accent)' : 'var(--hck-line-2)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
