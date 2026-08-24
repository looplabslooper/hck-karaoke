import { useEffect, useState } from 'react'
import type { Banner } from '@kiosco/shared'
import { Icon } from './icons'

const AUTO_ROTATE_MS = 6000

/** Carrusel panorámico arriba de Inicio (ver PROMPTS-BANNERS.md) — rota
 * sola cada 6s, con flechas y puntos. No ocupa lugar si no hay banners. */
export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (banners.length <= 1) return
    const t = setInterval(() => setIndex((i) => (i + 1) % banners.length), AUTO_ROTATE_MS)
    return () => clearInterval(t)
  }, [banners.length])

  if (banners.length === 0) return null

  const current = banners[Math.min(index, banners.length - 1)]

  return (
    <div
      className="hck-stage"
      style={{ position: 'relative', borderRadius: 'var(--hck-r-xl)', border: '1px solid var(--hck-line)', overflow: 'hidden' }}
    >
      <img src={current.imageUrl} alt="" style={{ width: '100%', aspectRatio: '21/6', objectFit: 'cover', display: 'block' }} />
      {banners.length > 1 && (
        <>
          <button
            className="hck-btn hck-btn-icon"
            style={{ position: 'absolute', left: '18px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(10,12,16,.55)' }}
            onClick={() => setIndex((i) => (i - 1 + banners.length) % banners.length)}
            aria-label="Anterior"
          >
            <Icon name="chevL" size={18} />
          </button>
          <button
            className="hck-btn hck-btn-icon"
            style={{ position: 'absolute', right: '18px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(10,12,16,.55)' }}
            onClick={() => setIndex((i) => (i + 1) % banners.length)}
            aria-label="Siguiente"
          >
            <Icon name="chevR" size={18} />
          </button>
          <div style={{ position: 'absolute', right: '26px', bottom: '20px', display: 'flex', gap: '8px' }}>
            {banners.map((b, i) => (
              <span
                key={b.id}
                onClick={() => setIndex(i)}
                style={{
                  width: '34px',
                  height: '5px',
                  borderRadius: '99px',
                  cursor: 'pointer',
                  background: i === index ? 'var(--hck-accent)' : 'var(--hck-line-2)',
                  boxShadow: i === index ? 'var(--hck-glow)' : 'none',
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
