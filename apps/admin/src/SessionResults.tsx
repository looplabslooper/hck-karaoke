import { useMemo, useState } from 'react'
import type { LeaderboardEntry, Singer } from '@kiosco/shared'
import { Icon } from './icons'

interface Props {
  sessionSingers: Singer[]
  leaderboard: LeaderboardEntry[]
  /** Todas las canciones por cantante (encoladas + cantadas), no solo las
   * puntuadas — es lo que hace falta para detectar desventaja real. */
  songCounts: Record<string, number>
  /** Vuelve a la sesión sin borrar nada — para seguir cargando más
   * canciones o puntuando lo que quedó pendiente. */
  onBack: () => void
  /** Cierra la sesión de verdad (borra cantantes/fotos/cola). */
  onEndSession: () => void
}

type RankedSinger = {
  singerId: string
  name: string
  photoUrl: string | null
  totalScore: number
  songsScored: number
  average: number
}

/**
 * Pantalla de resultados al terminar la sesión — se muestra ANTES de borrar
 * nada (ver handleEndSession en App.tsx), así se arma con los datos todavía
 * vivos y no hace falta ninguna tabla de historial.
 */
export function SessionResults({ sessionSingers, leaderboard, songCounts, onBack, onEndSession }: Props) {
  const [mode, setMode] = useState<'total' | 'promedio'>('total')

  // Cruza sessionSingers con leaderboard a propósito: getLeaderboard() solo
  // devuelve a quien tiene AL MENOS una canción puntuada, así que alguien
  // que cantó y nunca fue calificado tendría que desaparecer de la tabla en
  // vez de figurar con 0.
  const ranked: RankedSinger[] = useMemo(() => {
    const byId = new Map(leaderboard.map((e) => [e.singerId, e]))
    return sessionSingers
      .map((s) => {
        const entry = byId.get(s.id)
        const totalScore = entry?.totalScore ?? 0
        const songsScored = entry?.songsScored ?? 0
        return {
          singerId: s.id,
          name: s.name,
          photoUrl: s.photoUrl,
          totalScore,
          songsScored,
          average: songsScored > 0 ? totalScore / songsScored : 0,
        }
      })
      .sort((a, b) => (mode === 'total' ? b.totalScore - a.totalScore : b.average - a.average))
  }, [sessionSingers, leaderboard, mode])

  const counts = sessionSingers.map((s) => songCounts[s.id] ?? 0)
  const maxCount = Math.max(0, ...counts)
  const uneven = sessionSingers.length > 1 && counts.some((c) => c !== maxCount)
  const behind = sessionSingers.filter((s) => (songCounts[s.id] ?? 0) < maxCount)

  const pendingUnscored = leaderboard.length === 0 && sessionSingers.length > 0

  const [podium, rest] = [ranked.slice(0, 3), ranked.slice(3)]

  const PLACE_HEIGHT = ['150px', '190px', '124px'] as const
  const PLACE_ACCENT: Record<number, boolean> = { 1: true }

  return (
    <div className="hck-scope hck-dialog-back">
      <div className="hck-dialog" style={{ width: 'min(720px,100%)', maxHeight: '86vh', overflowY: 'auto' }}>
        <h2>Resultados de la sesión</h2>
        <p className="hck-faint" style={{ fontSize: '15px', marginTop: '-8px' }}>
          Así quedó la noche — todavía no se borró nada.
        </p>

        {uneven && (
          <div
            style={{
              display: 'flex',
              gap: '14px',
              padding: '16px',
              borderRadius: 'var(--hck-r-md)',
              background: 'var(--hck-surface-2)',
              border: '1px solid var(--hck-line-2)',
            }}
          >
            <span style={{ color: 'var(--hck-accent-lt)', flex: 'none' }}>
              <Icon name="star" size={18} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <strong style={{ fontSize: '15.5px' }}>
                {behind.map((s) => s.name).join(', ')} {behind.length === 1 ? 'cantó' : 'cantaron'} menos canciones
                que el resto.
              </strong>
              <p className="hck-faint" style={{ fontSize: '14px' }}>
                El total no es del todo justo con esta diferencia — podés cargarle más o comparar por promedio.
              </p>
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button className="hck-btn hck-btn-secondary" onClick={onBack}>
                  Cargar más canciones
                </button>
                <button className="hck-btn hck-btn-secondary" onClick={() => setMode('promedio')}>
                  Usar promedio
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingUnscored ? (
          <p className="hck-faint" style={{ fontSize: '14.5px' }}>
            Todavía no se cargó ningún puntaje.
          </p>
        ) : (
          <>
            <div
              style={{
                display: 'inline-flex',
                padding: '4px',
                borderRadius: '99px',
                background: 'var(--hck-surface-2)',
                border: '1px solid var(--hck-line)',
                gap: '2px',
                alignSelf: 'flex-start',
              }}
            >
              {(['total', 'promedio'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: '8px 18px',
                    borderRadius: '99px',
                    fontSize: '14.5px',
                    fontWeight: 700,
                    ...(mode === m
                      ? { background: 'var(--hck-accent)', color: '#fff', boxShadow: 'var(--hck-glow)' }
                      : { color: 'var(--hck-muted)' }),
                  }}
                >
                  {m === 'total' ? 'Total' : 'Promedio'}
                </button>
              ))}
            </div>

            {podium.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '16px', padding: '10px 0 4px' }}>
                {[podium[1], podium[0], podium[2]].map((entry, col) =>
                  entry ? (
                    <div
                      key={entry.singerId}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        width: '150px',
                      }}
                    >
                      {entry.photoUrl ? (
                        <img
                          src={entry.photoUrl}
                          alt=""
                          style={{
                            width: PLACE_ACCENT[col] ? '68px' : '54px',
                            height: PLACE_ACCENT[col] ? '68px' : '54px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: `2.5px solid ${PLACE_ACCENT[col] ? 'var(--hck-accent)' : 'var(--hck-line-2)'}`,
                            boxShadow: PLACE_ACCENT[col] ? 'var(--hck-glow)' : 'none',
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            width: PLACE_ACCENT[col] ? '68px' : '54px',
                            height: PLACE_ACCENT[col] ? '68px' : '54px',
                            borderRadius: '50%',
                            background: 'var(--hck-surface-3)',
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 700,
                            fontSize: '20px',
                          }}
                        >
                          {entry.name[0]?.toUpperCase()}
                        </span>
                      )}
                      <div style={{ fontWeight: 700, fontSize: '15px', textAlign: 'center' }}>{entry.name}</div>
                      <div
                        style={{
                          width: '100%',
                          height: PLACE_HEIGHT[col],
                          borderRadius: 'var(--hck-r-md) var(--hck-r-md) 0 0',
                          background: PLACE_ACCENT[col]
                            ? 'linear-gradient(180deg,var(--hck-accent-22),var(--hck-surface-2))'
                            : 'var(--hck-surface-2)',
                          border: `1px solid ${PLACE_ACCENT[col] ? 'var(--hck-accent)' : 'var(--hck-line)'}`,
                          borderBottom: 'none',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                        }}
                      >
                        <div style={{ fontSize: '26px', fontWeight: 800, color: PLACE_ACCENT[col] ? 'var(--hck-accent-lt)' : 'var(--hck-faint)' }}>
                          {[2, 1, 3][col]}
                        </div>
                        <div className="hck-mono" style={{ fontSize: '14.5px', fontWeight: 700 }}>
                          {mode === 'total' ? `${entry.totalScore} pts` : `${entry.average.toFixed(1)} prom.`}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={`empty-${col}`} style={{ width: '150px' }} />
                  ),
                )}
              </div>
            )}

            {rest.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {rest.map((entry, i) => (
                  <div key={entry.singerId} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 4px' }}>
                    <span className="hck-faint hck-mono" style={{ width: '22px', fontSize: '14px', fontWeight: 700 }}>
                      {i + 4}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                      {entry.photoUrl && (
                        <img src={entry.photoUrl} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                      )}
                      <span style={{ fontWeight: 600, fontSize: '15px' }}>{entry.name}</span>
                    </div>
                    <span className="hck-faint" style={{ fontSize: '13.5px' }}>
                      {entry.songsScored} canción{entry.songsScored === 1 ? '' : 'es'}
                    </span>
                    <span className="hck-mono" style={{ fontSize: '15px', fontWeight: 700, width: '80px', textAlign: 'right' }}>
                      {mode === 'total' ? `${entry.totalScore} pts` : `${entry.average.toFixed(1)} prom.`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="hck-btn hck-btn-secondary" onClick={onBack}>
            Volver a la sesión
          </button>
          <button className="hck-btn hck-btn-danger" onClick={onEndSession}>
            Cerrar la sesión
          </button>
        </div>
      </div>
    </div>
  )
}
