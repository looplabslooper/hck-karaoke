import type { FormEvent } from 'react'
import type { Song } from '@kiosco/shared'
import { Icon } from './icons'
import { songColor } from './songColor'

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const LEGEND: Record<string, [string, string][]> = {
  inicio: [['↑↓←→', 'Seek ±5s'], ['Espacio', 'Pausa'], ['/', 'Buscar'], ['N', 'Siguiente'], ['E', 'Lista de espera'], ['X', 'Efectos']],
  biblioteca: [['/', 'Buscar'], ['Espacio', 'Pausa'], ['N', 'Siguiente'], ['E', 'Lista de espera']],
  cola: [['N', 'Siguiente turno'], ['P', 'Puntuar'], ['V', 'Ir al show'], ['Espacio', 'Pausa'], ['E', 'Lista de espera']],
  studio: [['Espacio', 'Pausa'], ['E', 'Lista de espera'], ['X', 'Efectos']],
  configuracion: [['Espacio', 'Pausa']],
}
const KIOSK_LEGEND: [string, string][] = [['1-9', 'Fun Box'], ['0', 'Cortar'], ['N', 'Siguiente'], ['F', 'Salir'], ['Espacio', 'Pausa']]

interface Props {
  page: string
  kioskMode: boolean
  nowPlayingSong: Song | null
  isLocalReady: boolean
  paused: boolean
  duration: number
  scrubValue: number | null
  displayPosition: number
  onScrubDrag: (e: FormEvent<HTMLInputElement>) => void
  onScrubCommit: (e: FormEvent<HTMLInputElement>) => void
  onTogglePlay: () => void
  volume: number
  onVolumeChange: (e: FormEvent<HTMLInputElement>) => void
  vocalsOff: boolean
  onToggleVocals: () => void
  hasInstrumental: boolean
  showSyncEditor: boolean
  onToggleSyncEditor: () => void
  hasLyrics: boolean
  showLyricsOverlay: boolean
  onToggleLyricsOverlay: () => void
  autoAdvance: boolean
  onToggleAutoAdvance: () => void
  onEnterKiosk: () => void
  /** Colapso propio, independiente del de la nav lateral (REQ-09). */
  collapsed: boolean
  onToggleCollapse: () => void
  /** Popover global de Fun Box ("Efectos") — accesible desde cualquier
   * pantalla, hotkey X (ver App.tsx). */
  fxOpen: boolean
  onToggleFx: () => void
}

/** Marquesina persistente — reemplazo visual del <div className="player-bar">
 * viejo, misma lógica real por debajo (los handlers vienen de App.tsx tal
 * cual estaban). Suma la leyenda de teclas contextual del mockup HCK, que
 * no existía antes. Ver plan del refactor visual. */
export function Marquee({
  page,
  kioskMode,
  nowPlayingSong,
  isLocalReady,
  paused,
  duration,
  scrubValue,
  displayPosition,
  onScrubDrag,
  onScrubCommit,
  onTogglePlay,
  volume,
  onVolumeChange,
  vocalsOff,
  onToggleVocals,
  hasInstrumental,
  showSyncEditor,
  onToggleSyncEditor,
  hasLyrics,
  showLyricsOverlay,
  onToggleLyricsOverlay,
  autoAdvance,
  onToggleAutoAdvance,
  onEnterKiosk,
  collapsed,
  onToggleCollapse,
  fxOpen,
  onToggleFx,
}: Props) {
  const position = scrubValue ?? displayPosition
  const legend = kioskMode ? KIOSK_LEGEND : LEGEND[page] || LEGEND.inicio

  if (collapsed) {
    return (
      <div
        className="hck-scope"
        style={{
          position: 'fixed',
          left: 'var(--hck-rail-w, 0px)',
          right: 0,
          bottom: 0,
          zIndex: 10,
          borderTop: '1px solid var(--hck-line)',
          background: 'var(--hck-bg-deep)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '10px clamp(20px,2.4vw,40px)',
        }}
      >
        <button className="hck-btn hck-btn-icon" onClick={onTogglePlay} disabled={!nowPlayingSong} aria-label={!isLocalReady || paused ? 'Reproducir' : 'Pausar'}>
          <Icon name={!isLocalReady || paused ? 'play' : 'pause'} size={18} />
        </button>
        <span className="hck-muted" style={{ fontSize: '15px', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nowPlayingSong ? `${nowPlayingSong.title} · ${nowPlayingSong.artist}` : 'Nadie está cantando todavía'}
        </span>
        <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={onToggleCollapse} title="Expandir menú inferior" aria-label="Expandir menú inferior">
          <Icon name="expand" size={16} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="hck-scope"
      style={{
        position: 'fixed',
        left: 'var(--hck-rail-w, 0px)',
        right: 0,
        bottom: 0,
        zIndex: 10,
        borderTop: '1px solid var(--hck-line)',
        background: 'var(--hck-bg-deep)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px,1.6vw,30px)', padding: '16px clamp(20px,2.4vw,40px)' }}>
        <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={onToggleCollapse} title="Colapsar menú inferior" aria-label="Colapsar menú inferior">
          <Icon name="collapse" size={16} />
        </button>
        {nowPlayingSong ? (
          <div style={{ width: '64px', height: '64px', borderRadius: 'var(--hck-r-md)', flex: 'none', background: songColor(nowPlayingSong.id) }} />
        ) : (
          <div style={{ width: '64px', height: '64px', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-surface-2)' }} />
        )}
        <div style={{ minWidth: '180px', maxWidth: '26vw' }}>
          {nowPlayingSong ? (
            <>
              <div style={{ fontSize: 'clamp(17px,1.35vw,23px)', fontWeight: 700, letterSpacing: '-.025em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlayingSong.title}
              </div>
              <div className="hck-muted" style={{ fontSize: '14.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlayingSong.artist}
              </div>
            </>
          ) : (
            <div className="hck-muted" style={{ fontSize: '17px' }}>Nadie está cantando todavía</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="hck-btn hck-btn-icon" onClick={onTogglePlay} disabled={!nowPlayingSong} aria-label={!isLocalReady || paused ? 'Reproducir' : 'Pausar'}>
            <Icon name={!isLocalReady || paused ? 'play' : 'pause'} size={20} />
          </button>
        </div>
        <div style={{ flex: 1, minWidth: '160px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span className="hck-mono hck-faint" style={{ fontSize: '15px' }}>{formatTime(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            disabled={!duration}
            value={position}
            onChange={onScrubDrag}
            onMouseUp={onScrubCommit}
            onTouchEnd={onScrubCommit}
            style={{ flex: 1, accentColor: 'var(--hck-accent)' }}
          />
          <span className="hck-mono hck-faint" style={{ fontSize: '15px' }}>{formatTime(duration)}</span>
        </div>
        {hasLyrics && (
          <button
            className={`hck-btn hck-btn-secondary${showLyricsOverlay ? ' hck-btn-on' : ''}`}
            onClick={onToggleLyricsOverlay}
            disabled={kioskMode}
          >
            {showLyricsOverlay ? 'Ocultar letras' : 'Mostrar letras'}
          </button>
        )}
        {hasInstrumental && (
          <button className={`hck-btn hck-btn-icon${vocalsOff ? ' hck-btn-on' : ''}`} onClick={onToggleVocals} title="Apagar la voz original">
            <Icon name="micOff" size={19} />
          </button>
        )}
        {hasLyrics && !kioskMode && (
          <button className={`hck-btn hck-btn-icon${showSyncEditor ? ' hck-btn-on' : ''}`} onClick={onToggleSyncEditor} title="Corregir sincronía">
            <Icon name="sync" size={19} />
          </button>
        )}
        <button className={`hck-btn hck-btn-secondary${autoAdvance ? ' hck-btn-on' : ''}`} onClick={onToggleAutoAdvance} title="Al terminar cada canción, pasar a la siguiente de la cola">
          Auto-avance: {autoAdvance ? 'sí' : 'no'}
        </button>
        <button className={`hck-btn${fxOpen ? ' hck-btn-on' : ' hck-btn-secondary'}`} onClick={onToggleFx}>
          <Icon name="wand" size={19} /> Efectos <span className="hck-kbd" style={{ marginLeft: '4px' }}>X</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '150px' }}>
          <Icon name="volume" size={19} />
          <input type="range" min={0} max={100} value={volume} onChange={onVolumeChange} aria-label="Volumen" style={{ width: '100%', accentColor: 'var(--hck-accent)' }} />
        </div>
        {!kioskMode && (
          <button className="hck-btn hck-btn-on" onClick={onEnterKiosk}>
            <Icon name="expand" size={19} /> Pantalla del público <span className="hck-kbd" style={{ marginLeft: '4px' }}>F</span>
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '22px', padding: '0 clamp(20px,2.4vw,40px) 14px', flexWrap: 'wrap' }}>
        {legend.map(([k, l]) => (
          <span key={k + l} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 500 }} className="hck-faint">
            <span className="hck-kbd">{k}</span> {l}
          </span>
        ))}
      </div>
    </div>
  )
}
