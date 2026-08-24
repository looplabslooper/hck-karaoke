import type { Session, Singer, QueueItem } from '@kiosco/shared'
import { Icon, type IconName } from './icons'

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

interface NavItem {
  id: Page
  label: string
  icon: IconName
  key: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home', key: 'I' },
  { id: 'biblioteca', label: 'Biblioteca', icon: 'search', key: 'B' },
  { id: 'cola', label: 'Sesión', icon: 'list', key: 'S' },
  { id: 'studio', label: 'Studio', icon: 'wand', key: 'T' },
  { id: 'configuracion', label: 'Configuración', icon: 'gear', key: 'C' },
]

interface Props {
  page: Page
  onNav: (id: Page) => void
  onEnterKiosk: () => void
  session: Session | null
  sessionSingers: Singer[]
  queue: QueueItem[]
  faceswapProgress: { ready: number; total: number } | null
  onStartSession: () => void
  onGoToSession: () => void
  onEndSession: () => void
  /** Colapso propio, independiente del de la Marquesina (REQ-09) — cada uno
   * tiene su ícono de toggle y no se afectan entre sí. */
  collapsed: boolean
  onToggleCollapse: () => void
}

/** Rail lateral persistente — nav con atajo de una letra por ítem (más "V"
 * para entrar en vivo, que no es una página sino la acción de pantalla
 * completa), la píldora de "trabajos en curso" (hoy: renders de Fun Box
 * pendientes, ver faceswapProgress en App.tsx) y el estado de la sesión.
 * Reemplaza visualmente al <aside className="sidebar"> viejo, misma lógica
 * real por debajo — ver plan del refactor visual.
 * Colapsado: se angosta a solo íconos (con tooltip) — el ancho fijo acá
 * (72px) es el mismo valor que App.tsx usa para `--hck-rail-w`, para que la
 * Marquesina se corra exactamente lo que ocupa este ancho, nunca más ni menos. */
export function Rail({
  page,
  onNav,
  onEnterKiosk,
  session,
  sessionSingers,
  queue,
  faceswapProgress,
  onStartSession,
  onGoToSession,
  onEndSession,
  collapsed,
  onToggleCollapse,
}: Props) {
  const isNavActive = (id: Page) => page === id
  const jobsPending = faceswapProgress && faceswapProgress.ready < faceswapProgress.total

  return (
    <aside
      className="hck-scope"
      style={{
        width: collapsed ? '72px' : 'clamp(230px,16vw,300px)',
        flex: 'none',
        borderRight: '1px solid var(--hck-line)',
        display: 'flex',
        flexDirection: 'column',
        padding: collapsed ? '26px 12px 18px' : '26px 16px 18px',
        gap: '6px',
        background: 'var(--hck-bg-deep)',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px 22px' }}>
        {!collapsed && (
          <div style={{ fontSize: 'clamp(20px,1.5vw,26px)', fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.1, flex: 1, minWidth: 0 }}>
            High Class
            <br />
            <span style={{ color: 'var(--hck-accent-lt)' }}>Karaoke</span>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir nav' : 'Colapsar nav'}
          style={{ all: 'unset', cursor: 'pointer', display: 'grid', placeItems: 'center', width: '28px', height: '28px', flex: 'none', color: 'var(--hck-faint)', marginLeft: collapsed ? 0 : 'auto' }}
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
        </button>
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onNav(item.id)}
          title={collapsed ? item.label : undefined}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: '12px',
            padding: '14px',
            borderRadius: 'var(--hck-r-md)',
            fontSize: '17px',
            fontWeight: 600,
            ...(isNavActive(item.id)
              ? { background: 'var(--hck-accent-12)', color: 'var(--hck-accent-lt)', boxShadow: 'inset 0 0 0 1px var(--hck-accent)' }
              : { color: 'var(--hck-muted)' }),
          }}
        >
          <Icon name={item.icon} size={21} />
          {!collapsed && (
            <>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
              <span
                className="hck-kbd"
                style={{ marginLeft: 'auto', ...(isNavActive(item.id) ? { background: 'var(--hck-accent-dk)', borderColor: 'var(--hck-accent)' } : {}) }}
              >
                {item.key}
              </span>
            </>
          )}
        </button>
      ))}

      <button
        onClick={onEnterKiosk}
        title={collapsed ? 'En vivo' : undefined}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: '12px', padding: '14px', borderRadius: 'var(--hck-r-md)', fontSize: '17px', fontWeight: 600, color: 'var(--hck-muted)' }}
      >
        <Icon name="bolt" size={21} />
        {!collapsed && (
          <>
            <span style={{ flex: 1 }}>En vivo</span>
            <span className="hck-kbd" style={{ marginLeft: 'auto' }}>V</span>
          </>
        )}
      </button>

      {!collapsed && (
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '14px', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface)', border: '1px solid var(--hck-line)' }}>
          {jobsPending ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span className="hck-spinner" />
                <span style={{ fontSize: '14.5px', fontWeight: 600 }}>
                  Preparando caras: {faceswapProgress!.ready}/{faceswapProgress!.total}
                </span>
              </div>
              <div className="hck-jobbar">
                <i style={{ width: `${(faceswapProgress!.ready / faceswapProgress!.total) * 100}%` }} />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }} className="hck-faint">
              <Icon name="check" size={17} /> Todo al día
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px',
            borderRadius: 'var(--hck-r-md)',
            background: 'var(--hck-surface)',
            border: `1px solid ${session ? 'var(--hck-accent)' : 'var(--hck-line)'}`,
          }}
        >
          {!session ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '14.5px', fontWeight: 600 }}>
                <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--hck-faint)' }} />
                Sesión: no iniciada
              </div>
              <button className="hck-btn hck-btn-primary hck-btn-block" style={{ marginTop: '12px', padding: '10px', fontSize: '15px' }} onClick={onStartSession}>
                <Icon name="mic" size={15} /> Iniciar sesión
              </button>
            </>
          ) : (
            <>
              <button onClick={onGoToSession} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '14.5px', fontWeight: 600 }}>
                  <span
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      background: 'var(--hck-accent)',
                      ...(session.status === 'corriendo' ? { boxShadow: 'var(--hck-glow)', animation: 'hck-pulse 2s ease-in-out infinite' } : {}),
                    }}
                  />
                  {session.status === 'corriendo' ? 'En vivo' : 'Armando sesión'}
                </div>
                <div className="hck-faint" style={{ fontSize: '13.5px', marginTop: '6px' }}>
                  {sessionSingers.length} cantante{sessionSingers.length === 1 ? '' : 's'} · {queue.length} en cola
                </div>
              </button>
              <button className="hck-btn hck-btn-secondary hck-btn-block" style={{ marginTop: '12px', padding: '10px', fontSize: '15px' }} onClick={onEndSession}>
                Terminar sesión
              </button>
            </>
          )}
        </div>
      </div>
      )}
    </aside>
  )
}
