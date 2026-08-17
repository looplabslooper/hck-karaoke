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
    <div className="banner-carousel">
      <img className="banner-carousel-img" src={current.imageUrl} alt="" />
      {banners.length > 1 && (
        <>
          <button className="btn-icon banner-carousel-nav prev" onClick={() => setIndex((i) => (i - 1 + banners.length) % banners.length)} aria-label="Anterior">
            <Icon name="chevL" size={16} />
          </button>
          <button className="btn-icon banner-carousel-nav next" onClick={() => setIndex((i) => (i + 1) % banners.length)} aria-label="Siguiente">
            <Icon name="chevR" size={16} />
          </button>
          <div className="carousel-dots banner-carousel-dots">
            {banners.map((b, i) => (
              <span key={b.id} className={`carousel-dot${i === index ? ' active' : ''}`} onClick={() => setIndex(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
