import { useEffect, useMemo, useRef, useState } from 'react'
import type { Singer, Song, Template } from '@kiosco/shared'
import { SingerPicker, type SingerPickerValue } from './SingerPicker'
import { songColor } from './songColor'
import { Icon } from './icons'
import { loadFaceCutout } from './faceSwapCache'

type Step = 'singer' | 'songs' | 'next' | 'warn-single' | 'syncing'

interface Props {
  sessionSingers: Singer[]
  /** Cuántas canciones tiene encolada cada cantante, por id. */
  songCounts: Record<string, number>
  queuedTotal: number
  templates: Template[]
  onSingerCreated: () => Promise<void> | void
  onSongsQueued: () => Promise<void> | void
  /** Pasa la sesión a 'corriendo'. Se llama recién con todo precalentado. */
  onBegin: () => Promise<void>
  onClose: () => void
}

const EMPTY_SINGER: SingerPickerValue = { singerId: null, name: '', photo: null, oval: null }

/**
 * Armado guiado de la sesión: cargar cantante → elegir sus canciones →
 * ¿otro cantante o arrancamos? Existe porque antes iniciar una sesión no
 * llevaba a ningún lado — el único camino para encolar a alguien era ir a
 * Biblioteca canción por canción, y la pantalla de Sesión quedaba vacía sin
 * ofrecer la acción que seguía.
 */
export function SessionSetupWizard({
  sessionSingers,
  songCounts,
  queuedTotal,
  templates,
  onSingerCreated,
  onSongsQueued,
  onBegin,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>(sessionSingers.length > 0 ? 'next' : 'singer')
  const [singerValue, setSingerValue] = useState<SingerPickerValue>(EMPTY_SINGER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cantante recién creado, para el paso de canciones.
  const [activeSinger, setActiveSinger] = useState<Singer | null>(null)

  // Paso "canciones"
  const [songQuery, setSongQuery] = useState('')
  const [songResults, setSongResults] = useState<Song[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Paso "sincronizando"
  const [syncDone, setSyncDone] = useState(0)
  const [syncTotal, setSyncTotal] = useState(0)

  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Escape cierra el wizard, salvo mientras está sincronizando (cortar ahí
  // dejaría la sesión a medio arrancar).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && step !== 'syncing' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, busy, onClose])

  useEffect(() => {
    const id = setTimeout(async () => {
      const params = new URLSearchParams({ limit: '40' })
      if (songQuery.trim()) params.set('q', songQuery.trim())
      const res = await fetch(`/api/songs?${params}`)
      const body = await res.json()
      setSongResults(body.items ?? [])
    }, 220)
    return () => clearTimeout(id)
  }, [songQuery])

  const singersWithoutSongs = useMemo(
    () => sessionSingers.filter((s) => !songCounts[s.id]),
    [sessionSingers, songCounts],
  )

  async function submitSinger() {
    const name = singerValue.name.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('name', name)
      if (singerValue.photo) form.set('photo', singerValue.photo, 'photo.jpg')
      if (singerValue.oval) {
        form.set('ovalCx', String(singerValue.oval.cx))
        form.set('ovalCy', String(singerValue.oval.cy))
        form.set('ovalScale', String(singerValue.oval.scale))
      }
      const res = await fetch('/api/singers', { method: 'POST', body: form })
      if (!res.ok) throw new Error('No se pudo registrar al cantante.')
      const singer: Singer = await res.json()
      await onSingerCreated()
      setActiveSinger(singer)
      setSingerValue(EMPTY_SINGER)
      setSelectedIds([])
      setSongQuery('')
      setStep('songs')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo falló al registrar al cantante.')
    } finally {
      setBusy(false)
    }
  }

  async function submitSongs() {
    if (!activeSinger || busy) return
    if (selectedIds.length === 0) {
      setStep('next')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/queue/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ singerId: activeSinger.id, songIds: selectedIds }),
      })
      if (!res.ok) throw new Error('No se pudieron encolar las canciones.')
      await onSongsQueued()
      setStep('next')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo falló al encolar.')
    } finally {
      setBusy(false)
    }
  }

  function goAddAnother() {
    setActiveSinger(null)
    setSingerValue(EMPTY_SINGER)
    setError(null)
    setStep('singer')
  }

  function requestBegin() {
    setError(null)
    if (queuedTotal === 0) {
      setError('Todavía no hay ninguna canción en la cola — cargale al menos una a alguien.')
      return
    }
    if (sessionSingers.length < 2) {
      setStep('warn-single')
      return
    }
    void runBegin()
  }

  /** Precalienta caras + videos de template ANTES de pasar a 'corriendo',
   * con progreso visible: así el hotkey de "cara en el escenario" ya
   * responde al instante apenas arranca el show. */
  async function runBegin() {
    setStep('syncing')
    setError(null)
    const photos = sessionSingers.filter((s) => s.photoUrl)
    const tasks = photos.length + templates.length
    setSyncTotal(tasks)
    setSyncDone(0)

    let done = 0
    const bump = () => {
      done += 1
      setSyncDone(done)
    }

    await Promise.all(
      photos.map((s) =>
        loadFaceCutout(s.photoUrl!, s.oval)
          .catch(() => {})
          .finally(bump),
      ),
    )
    // Los videos van de a uno: varias descargas en paralelo saturan el límite
    // de conexiones por origen y dejan al <video> real esperando (ver el bug
    // del template colgado en el primer frame).
    for (const t of templates) {
      try {
        await fetch(t.videoUrl)
      } catch {
        // Se vuelve a pedir al reproducir; no bloquea el arranque.
      }
      bump()
    }

    try {
      await onBegin()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo comenzar la sesión.')
      setStep('next')
    }
  }

  const stepIndex = step === 'singer' ? 1 : step === 'songs' ? 2 : 3

  return (
    <div className="modal-backdrop" onClick={() => step !== 'syncing' && !busy && onClose()}>
      <div className="modal-panel wizard-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        {step !== 'syncing' && (
          <div className="wizard-modal-head">
            <div>
              <h2>Armar la sesión</h2>
              <p className="hint">
                {sessionSingers.length === 0
                  ? 'Cargá al primer cantante y sus canciones.'
                  : `${sessionSingers.length} cantante${sessionSingers.length === 1 ? '' : 's'} · ${queuedTotal} canción${queuedTotal === 1 ? '' : 'es'} en la cola`}
              </p>
            </div>
            <div className="wizard-dots" aria-hidden>
              {[1, 2, 3].map((n) => (
                <span key={n} className={`wizard-dot${n === stepIndex ? ' active' : ''}`} />
              ))}
            </div>
          </div>
        )}

        {step === 'singer' && (
          <>
            <SingerPicker
              sessionSingers={sessionSingers}
              value={singerValue}
              onChange={setSingerValue}
              autoFocus
              hideSuggestions
              previewTemplate={templates[0]}
              onEnter={submitSinger}
            />
            {error && <p className="error">{error}</p>}
            <div className="step-actions">
              {sessionSingers.length > 0 && (
                <button className="btn-secondary" onClick={() => setStep('next')} disabled={busy}>
                  Volver
                </button>
              )}
              <button className="btn-primary" onClick={submitSinger} disabled={busy || !singerValue.name.trim()}>
                {busy ? 'Guardando…' : 'Siguiente: sus canciones'}
              </button>
            </div>
          </>
        )}

        {step === 'songs' && activeSinger && (
          <>
            <div className="wizard-singer-banner">
              {activeSinger.photoUrl ? (
                <img className="singer-thumb" src={activeSinger.photoUrl} alt="" />
              ) : (
                <span className="singer-chip-avatar">{activeSinger.name[0]?.toUpperCase()}</span>
              )}
              <div>
                <strong>{activeSinger.name}</strong>
                <div className="hint">¿Qué va a cantar?</div>
              </div>
              <span className="tag tag-accent">{selectedIds.length} elegidas</span>
            </div>

            <div className="field">
              <input
                type="text"
                autoFocus
                placeholder="Buscar por título o artista…"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
              />
            </div>

            <div className="wizard-song-list">
              {songResults.length === 0 ? (
                <p className="hint">No hay resultados para esa búsqueda.</p>
              ) : (
                songResults.map((s) => {
                  const picked = selectedIds.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`wizard-song-row${picked ? ' is-picked' : ''}`}
                      onClick={() =>
                        setSelectedIds((ids) => (picked ? ids.filter((x) => x !== s.id) : [...ids, s.id]))
                      }
                    >
                      <span className="song-swatch" style={{ background: songColor(s.id) }} />
                      <span className="wizard-song-title">
                        {s.title}
                        <span className="dim-cell"> · {s.artist}</span>
                      </span>
                      <span className="wizard-song-check">{picked && <Icon name="check" size={14} />}</span>
                    </button>
                  )
                })
              )}
            </div>

            {error && <p className="error">{error}</p>}
            <div className="step-actions">
              <button className="btn-secondary" onClick={() => setStep('next')} disabled={busy}>
                Después le cargo
              </button>
              <button className="btn-primary" onClick={submitSongs} disabled={busy}>
                {busy ? 'Encolando…' : selectedIds.length > 0 ? `Agregar ${selectedIds.length} a la cola` : 'Continuar'}
              </button>
            </div>
          </>
        )}

        {step === 'next' && (
          <>
            <div className="wizard-roster">
              {sessionSingers.map((s) => (
                <div className="wizard-roster-row" key={s.id}>
                  {s.photoUrl ? (
                    <img className="singer-thumb" src={s.photoUrl} alt="" />
                  ) : (
                    <span className="singer-chip-avatar">{s.name[0]?.toUpperCase()}</span>
                  )}
                  <span className="wizard-roster-name">{s.name}</span>
                  <span className={`tag ${songCounts[s.id] ? 'tag-neutral' : 'tag-outline'}`}>
                    {songCounts[s.id] ?? 0} canción{(songCounts[s.id] ?? 0) === 1 ? '' : 'es'}
                  </span>
                </div>
              ))}
            </div>

            {singersWithoutSongs.length > 0 && (
              <p className="hint">
                Sin canciones todavía: {singersWithoutSongs.map((s) => s.name).join(', ')}. Podés cargarles desde
                Biblioteca en cualquier momento.
              </p>
            )}
            {error && <p className="error">{error}</p>}

            <div className="step-actions">
              <button className="btn-secondary" onClick={goAddAnother} disabled={busy}>
                <Icon name="plus" size={14} /> Agregar otro cantante
              </button>
              <button className="btn-primary" onClick={requestBegin} disabled={busy}>
                Comenzar la sesión
              </button>
            </div>
          </>
        )}

        {step === 'warn-single' && (
          <>
            <p className="wizard-warn">
              Hay <strong>un solo cantante</strong> cargado. La sesión funciona igual, pero no va a haber turnos ni
              competencia hasta que sumes a alguien más.
            </p>
            <div className="step-actions">
              <button className="btn-secondary" onClick={goAddAnother}>
                Agregar otro cantante
              </button>
              <button className="btn-primary" onClick={() => void runBegin()}>
                Comenzar igual
              </button>
            </div>
          </>
        )}

        {step === 'syncing' && (
          <div className="wizard-syncing">
            <h2>Preparando el show…</h2>
            <p className="hint">Sincronizando las caras de los cantantes con los videos del Fun Box.</p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: syncTotal > 0 ? `${(syncDone / syncTotal) * 100}%` : '100%' }}
              />
            </div>
            <p className="hint">
              {syncDone} de {syncTotal}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
