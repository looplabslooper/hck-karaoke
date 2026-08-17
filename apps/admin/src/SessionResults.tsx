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

  return (
    <div className="modal-backdrop">
      <div className="modal-panel results-modal">
        <h2>Resultados de la sesión</h2>
        <p className="hint">Así quedó la noche — todavía no se borró nada.</p>

        {uneven && (
          <div className="results-warn">
            <Icon name="star" size={16} />
            <div>
              <strong>
                {behind.map((s) => s.name).join(', ')} {behind.length === 1 ? 'cantó' : 'cantaron'} menos canciones
                que el resto.
              </strong>
              <p>El total no es del todo justo con esta diferencia — podés cargarle más o comparar por promedio.</p>
              <div className="results-warn-actions">
                <button className="btn-secondary" onClick={onBack}>
                  Cargar más canciones
                </button>
                <button className="btn-secondary" onClick={() => setMode('promedio')}>
                  Usar promedio
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingUnscored ? (
          <p className="hint">Todavía no se cargó ningún puntaje.</p>
        ) : (
          <>
            <div className="results-toggle">
              <button
                className={`seg-opt${mode === 'total' ? ' is-active' : ''}`}
                onClick={() => setMode('total')}
              >
                Total
              </button>
              <button
                className={`seg-opt${mode === 'promedio' ? ' is-active' : ''}`}
                onClick={() => setMode('promedio')}
              >
                Promedio
              </button>
            </div>

            {podium.length > 0 && (
              <div className="podium">
                {[podium[1], podium[0], podium[2]].map((entry, col) =>
                  entry ? (
                    <div className={`podium-place place-${col}`} key={entry.singerId}>
                      <div className="podium-rank">{[2, 1, 3][col]}</div>
                      {entry.photoUrl ? (
                        <img className="singer-thumb podium-thumb" src={entry.photoUrl} alt="" />
                      ) : (
                        <span className="singer-chip-avatar podium-thumb">{entry.name[0]?.toUpperCase()}</span>
                      )}
                      <div className="podium-name">{entry.name}</div>
                      <div className="podium-score">
                        {mode === 'total' ? `${entry.totalScore} pts` : `${entry.average.toFixed(1)} prom.`}
                      </div>
                    </div>
                  ) : (
                    <div className="podium-place" key={`empty-${col}`} />
                  ),
                )}
              </div>
            )}

            {rest.length > 0 && (
              <div className="leaderboard-list results-rest">
                {rest.map((entry, i) => (
                  <div className="leaderboard-row" key={entry.singerId}>
                    <div className="leaderboard-rank">{i + 4}</div>
                    <div className="leaderboard-singer">
                      {entry.photoUrl && <img className="singer-thumb" src={entry.photoUrl} alt="" />}
                      {entry.name}
                    </div>
                    <div className="leaderboard-songs">
                      {entry.songsScored} canción{entry.songsScored === 1 ? '' : 'es'}
                    </div>
                    <div className="leaderboard-score">
                      {mode === 'total' ? `${entry.totalScore} pts` : `${entry.average.toFixed(1)} prom.`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="step-actions">
          <button className="btn-secondary" onClick={onBack}>
            Volver a la sesión
          </button>
          <button className="btn-danger" onClick={onEndSession}>
            Cerrar la sesión
          </button>
        </div>
      </div>
    </div>
  )
}
