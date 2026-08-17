import { useEffect, useState } from 'react'
import type { Song, CategoryId } from '@kiosco/shared'
import { CATEGORIES } from '@kiosco/shared'
import { Icon } from './icons'
import { songColor } from './songColor'

interface Props {
  categoryId: CategoryId
  nowPlayingId: string | null
  sessionActive: boolean
  onPlay: (id: string) => void
  onAddQueue: (song: Song) => void
  onViewAll: () => void
}

const PAGE_SIZE = 6

/** Carrusel de una categoría de Inicio — 6 visibles, navega hasta 15 (las
 * que devuelva /api/songs/category/:id) con flechas y puntos. */
export function CategoryCarousel({ categoryId, nowPlayingId, sessionActive, onPlay, onAddQueue, onViewAll }: Props) {
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
    <div className="carousel">
      <div className="carousel-head">
        <h3>{category?.name ?? categoryId}</h3>
        <span className="carousel-count">{total} canciones</span>
        <button className="btn-ghost carousel-viewall" onClick={onViewAll}>
          Ver todas <Icon name="chevR" size={13} />
        </button>
        {pages > 1 && (
          <div className="carousel-nav">
            <button className="btn-icon" onClick={() => setPage((p) => (p - 1 + pages) % pages)} aria-label="Anterior">
              <Icon name="chevL" size={15} />
            </button>
            <button className="btn-icon" onClick={() => setPage((p) => (p + 1) % pages)} aria-label="Siguiente">
              <Icon name="chevR" size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="carousel-grid">
        {visible.map((s) => {
          const isPlaying = s.id === nowPlayingId
          return (
            <div className="card carousel-card" key={s.id}>
              <div className="carousel-cover-wrap">
                <div className="carousel-cover" style={{ background: songColor(s.id) }} />
                <button className="btn-icon carousel-play" onClick={() => onPlay(s.id)} disabled={isPlaying} aria-label="Reproducir">
                  <Icon name="play" size={14} />
                </button>
              </div>
              <div className="card-title">{s.title}</div>
              <div className="card-meta">{s.artist}</div>
              <button
                className="btn-secondary btn-block carousel-queue-btn"
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
        <div className="carousel-dots">
          {Array.from({ length: pages }).map((_, i) => (
            <span key={i} className={`carousel-dot${i === page ? ' active' : ''}`} onClick={() => setPage(i)} />
          ))}
        </div>
      )}
    </div>
  )
}
