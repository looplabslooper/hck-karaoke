import type { QueueItem, Singer } from '@kiosco/shared'
import { Icon } from './icons'

interface Props {
  queue: QueueItem[]
  sessionSingers: Singer[]
  open: boolean
  onToggle: () => void
  waitAddNumber: string
  onWaitAddNumberChange: (v: string) => void
  waitAddSingerId: string | null
  onWaitAddSingerIdChange: (v: string | null) => void
  waitAddError: string | null
  waitAdding: boolean
  onWaitAdd: () => void
}

const SLOTS = 9

/**
 * Chrome global — vive arriba de toda pantalla (no solo Sesión), igual que
 * en el mockup (`waitStrip()`, ver plan). Colapsada por defecto: pill con el
 * total + hotkey E. Expandida: 9 casilleros con N° de canción + cantante
 * (el 1 es el que sigue) y el alta rápida por número ya construida.
 */
export function WaitStrip({
  queue,
  sessionSingers,
  open,
  onToggle,
  waitAddNumber,
  onWaitAddNumberChange,
  waitAddSingerId,
  onWaitAddSingerIdChange,
  waitAddError,
  waitAdding,
  onWaitAdd,
}: Props) {
  if (!open) {
    return (
      <div className="hck-scope" style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', padding: '8px clamp(20px,2.4vw,40px)', borderBottom: '1px solid var(--hck-line)', background: 'var(--hck-bg-deep)' }}>
        <button className="hck-btn hck-btn-ghost" onClick={onToggle} style={{ fontSize: '15px' }}>
          <Icon name="list" size={18} /> Lista de espera · {queue.length} <span className="hck-kbd" style={{ marginLeft: '4px' }}>E</span>
        </button>
      </div>
    )
  }

  const slots = Array.from({ length: SLOTS }, (_, i) => queue[i] ?? null)

  return (
    <div className="hck-scope" style={{ flex: 'none', background: 'var(--hck-bg-deep)', borderBottom: '1px solid var(--hck-line-2)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '2px solid var(--hck-accent)' }}>
        {slots.map((q, i) => {
          const on = !!q
          const next = i === 0 && on
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--hck-line)' }}>
              <div
                style={{
                  padding: '6px 4px',
                  textAlign: 'center',
                  fontSize: '15px',
                  fontWeight: 700,
                  background: next ? 'var(--hck-accent)' : on ? 'var(--hck-accent-22)' : 'transparent',
                  color: next ? '#fff' : on ? 'var(--hck-accent-lt)' : 'var(--hck-deco)',
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  padding: '9px 8px',
                  textAlign: 'center',
                  background: on ? 'var(--hck-surface)' : 'var(--hck-bg)',
                  boxShadow: next ? 'inset 0 0 0 1.5px var(--hck-accent)' : undefined,
                }}
              >
                <div className="hck-mono" style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1, color: on ? 'var(--hck-text)' : 'var(--hck-deco)' }}>
                  {on ? String(q!.song.number).padStart(2, '0') : '—'}
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 600, marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: on ? 'var(--hck-accent-lt)' : 'transparent' }}>
                  {on ? q!.singer : '·'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: '10px', padding: '10px clamp(14px,1.6vw,28px)' }}>
        <div className="hck-field" style={{ width: '110px' }}>
          <label style={{ fontSize: '12px' }}>N° de canción</label>
          <input
            className="hck-input"
            type="number"
            style={{ minHeight: '40px', padding: '8px 12px' }}
            value={waitAddNumber}
            onChange={(e) => onWaitAddNumberChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onWaitAdd()}
            placeholder="00"
          />
        </div>
        <div className="hck-field" style={{ flex: '0 1 220px', minWidth: '160px' }}>
          <label style={{ fontSize: '12px' }}>Cantante</label>
          <select
            className="hck-input"
            style={{ minHeight: '40px', padding: '8px 12px' }}
            value={waitAddSingerId ?? ''}
            onChange={(e) => onWaitAddSingerIdChange(e.target.value || null)}
          >
            <option value="">Elegí quién canta</option>
            {sessionSingers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <button className="hck-btn hck-btn-primary" style={{ minHeight: '40px' }} disabled={waitAdding} onClick={onWaitAdd}>
          {waitAdding ? 'Agregando…' : 'Agregar'}
        </button>
        {waitAddError && <p style={{ color: '#F87171', fontSize: '13.5px', margin: 0 }}>{waitAddError}</p>}
        <span className="hck-faint" style={{ fontSize: '13.5px', marginLeft: 'auto' }}>
          {queue.length > SLOTS ? `+${queue.length - SLOTS} más atrás` : 'El 1 canta después'}
        </span>
        <button className="hck-btn hck-btn-ghost" style={{ fontSize: '14px' }} onClick={onToggle}>
          <Icon name="collapse" size={15} /> Ocultar <span className="hck-kbd" style={{ marginLeft: '4px' }}>E</span>
        </button>
      </div>
    </div>
  )
}
