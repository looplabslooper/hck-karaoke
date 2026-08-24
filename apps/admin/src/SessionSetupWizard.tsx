import { useEffect, useMemo, useRef, useState } from 'react'
import type { Singer, Song, Template, TemplateRenderStatus } from '@kiosco/shared'
import { SingerPicker, type SingerPickerValue } from './SingerPicker'
import { songColor } from './songColor'
import { Icon } from './icons'
import { loadFaceCutout } from './faceSwapCache'

type Step = 'singer' | 'songs' | 'next' | 'warn-single' | 'warn-faceswap' | 'syncing'

interface Props {
  sessionSingers: Singer[]
  /** Cuántas canciones tiene encolada cada cantante, por id. */
  songCounts: Record<string, number>
  queuedTotal: number
  templates: Template[]
  /** Estado de los renders `faceswap` en curso — { singerId: { templateId:
   * status } }, ver GET /api/sessions/current/faceswap-status en App.tsx. */
  faceswapStatus: Record<string, Record<string, TemplateRenderStatus>>
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
  faceswapStatus,
  onSingerCreated,
  onSongsQueued,
  onBegin,
  onClose,
}: Props) {
  // El preview "en contexto" del calibrador de óvalo solo aplica a templates
  // `sticker` (los `faceswap` no usan óvalo manual, ver OvalCalibrator.tsx).
  const stickerPreviewTemplate = templates.find((t): t is Extract<Template, { kind: 'sticker' }> => t.kind === 'sticker')
  const faceswapTemplates = templates.filter((t): t is Extract<Template, { kind: 'faceswap' }> => t.kind === 'faceswap')

  // Cantantes con foto cuyo render `faceswap` todavía no está listo para
  // ALGÚN template — se usa tanto para el aviso al arrancar como para el
  // indicador chico en el roster (paso "next").
  const singersWithPendingFaceswap = useMemo(() => {
    if (faceswapTemplates.length === 0) return []
    return sessionSingers.filter(
      (s) => s.photoUrl && faceswapTemplates.some((t) => faceswapStatus[s.id]?.[t.id] !== 'ready'),
    )
  }, [sessionSingers, faceswapTemplates, faceswapStatus])

  // Agregado ready/total para la barra de progreso del roster — cada
  // combinación cantante-con-foto × template `faceswap` cuenta una vez. Al
  // sumar un cantante nuevo, solo crece `total`; lo que ya estaba `ready`
  // para los demás sigue contando (el server no lo vuelve a renderizar, ver
  // triggerFaceSwapRendersForSinger).
  const faceswapProgress = useMemo(() => {
    const singers = sessionSingers.filter((s) => s.photoUrl)
    if (faceswapTemplates.length === 0 || singers.length === 0) return null
    let ready = 0
    for (const s of singers) {
      for (const t of faceswapTemplates) {
        if (faceswapStatus[s.id]?.[t.id] === 'ready') ready++
      }
    }
    return { ready, total: singers.length * faceswapTemplates.length }
  }, [sessionSingers, faceswapTemplates, faceswapStatus])

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
    if (singersWithPendingFaceswap.length > 0) {
      setStep('warn-faceswap')
      return
    }
    if (sessionSingers.length < 2) {
      setStep('warn-single')
      return
    }
    void runBegin()
  }

  /** Confirmación de "Comenzar igual" desde el aviso de faceswap pendiente —
   * sigue encadenando al resto de los chequeos en vez de arrancar directo,
   * para no saltearse el aviso de "un solo cantante" si aplica también. */
  function confirmFaceswapWarning() {
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
    <div className="hck-scope hck-dialog-back" onClick={() => step !== 'syncing' && !busy && onClose()}>
      <div
        className="hck-dialog"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(680px,100%)', maxHeight: '86vh', overflowY: 'auto' }}
      >
        {step !== 'syncing' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
            <div>
              <h2>Armar la sesión</h2>
              <p className="hck-faint" style={{ marginTop: '8px', fontSize: '15px' }}>
                {sessionSingers.length === 0
                  ? 'Cargá al primer cantante y sus canciones.'
                  : `${sessionSingers.length} cantante${sessionSingers.length === 1 ? '' : 's'} · ${queuedTotal} canción${queuedTotal === 1 ? '' : 'es'} en la cola`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '7px', flex: 'none', paddingTop: '6px' }} aria-hidden>
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  style={{
                    width: n === stepIndex ? '22px' : '8px',
                    height: '8px',
                    borderRadius: '99px',
                    background: n === stepIndex ? 'var(--hck-accent)' : 'var(--hck-line-2)',
                    transition: 'width .18s ease',
                  }}
                />
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
              previewTemplate={stickerPreviewTemplate}
              onEnter={submitSinger}
            />
            {error && (
              <p style={{ color: '#FCA5A5', fontSize: '14.5px' }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {sessionSingers.length > 0 && (
                <button className="hck-btn hck-btn-secondary" onClick={() => setStep('next')} disabled={busy}>
                  Volver
                </button>
              )}
              <button className="hck-btn hck-btn-primary" onClick={submitSinger} disabled={busy || !singerValue.name.trim()}>
                {busy ? 'Guardando…' : 'Siguiente: sus canciones'}
              </button>
            </div>
          </>
        )}

        {step === 'songs' && activeSinger && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '14px 16px',
                borderRadius: 'var(--hck-r-md)',
                background: 'var(--hck-surface-2)',
                border: '1px solid var(--hck-line)',
              }}
            >
              {activeSinger.photoUrl ? (
                <img
                  src={activeSinger.photoUrl}
                  alt=""
                  style={{ width: '46px', height: '46px', borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
                />
              ) : (
                <span
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    background: 'var(--hck-surface-3)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    flex: 'none',
                  }}
                >
                  {activeSinger.name[0]?.toUpperCase()}
                </span>
              )}
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: '17px' }}>{activeSinger.name}</strong>
                <div className="hck-faint" style={{ fontSize: '13.5px', marginTop: '2px' }}>
                  ¿Qué va a cantar?
                </div>
              </div>
              <span className="hck-tag hck-tag-accent">{selectedIds.length} elegidas</span>
            </div>

            <input
              type="text"
              className="hck-input"
              autoFocus
              placeholder="Buscar por título o artista…"
              value={songQuery}
              onChange={(e) => setSongQuery(e.target.value)}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto' }}>
              {songResults.length === 0 ? (
                <p className="hck-faint" style={{ fontSize: '14.5px' }}>
                  No hay resultados para esa búsqueda.
                </p>
              ) : (
                songResults.map((s) => {
                  const picked = selectedIds.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((ids) => (picked ? ids.filter((x) => x !== s.id) : [...ids, s.id]))
                      }
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '11px 14px',
                        borderRadius: 'var(--hck-r-md)',
                        ...(picked
                          ? { background: 'var(--hck-accent-12)', boxShadow: 'inset 0 0 0 1px var(--hck-accent)' }
                          : { background: 'transparent' }),
                      }}
                    >
                      <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: songColor(s.id), flex: 'none' }} />
                      <span style={{ flex: 1, fontSize: '15.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                        <span className="hck-faint" style={{ fontWeight: 500 }}> · {s.artist}</span>
                      </span>
                      <span style={{ width: '18px', flex: 'none', color: 'var(--hck-accent-lt)' }}>
                        {picked && <Icon name="check" size={14} />}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            {error && (
              <p style={{ color: '#FCA5A5', fontSize: '14.5px' }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={() => setStep('next')} disabled={busy}>
                Después le cargo
              </button>
              <button className="hck-btn hck-btn-primary" onClick={submitSongs} disabled={busy}>
                {busy ? 'Encolando…' : selectedIds.length > 0 ? `Agregar ${selectedIds.length} a la cola` : 'Continuar'}
              </button>
            </div>
          </>
        )}

        {step === 'next' && (
          <>
            {faceswapProgress && faceswapProgress.ready < faceswapProgress.total && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p className="hck-faint" style={{ fontSize: '14px' }}>
                  Preparando caras para Fun Box: {faceswapProgress.ready}/{faceswapProgress.total}
                </p>
                <div className="hck-jobbar">
                  <i style={{ width: `${(faceswapProgress.ready / faceswapProgress.total) * 100}%` }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {sessionSingers.map((s) => {
                const pendingFaceswap = singersWithPendingFaceswap.some((p) => p.id === s.id)
                return (
                  <div
                    key={s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 4px' }}
                  >
                    {s.photoUrl ? (
                      <img src={s.photoUrl} alt="" style={{ width: '38px', height: '38px', borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
                    ) : (
                      <span
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '50%',
                          background: 'var(--hck-surface-3)',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 700,
                          fontSize: '14px',
                          flex: 'none',
                        }}
                      >
                        {s.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '15.5px' }}>{s.name}</span>
                    {pendingFaceswap && (
                      <span className="hck-tag hck-tag-outline" title="Preparando su cara para uno o más templates">
                        Preparando cara…
                      </span>
                    )}
                    <span className={`hck-tag${songCounts[s.id] ? '' : ' hck-tag-outline'}`}>
                      {songCounts[s.id] ?? 0} canción{(songCounts[s.id] ?? 0) === 1 ? '' : 'es'}
                    </span>
                  </div>
                )
              })}
            </div>

            {singersWithoutSongs.length > 0 && (
              <p className="hck-faint" style={{ fontSize: '14px' }}>
                Sin canciones todavía: {singersWithoutSongs.map((s) => s.name).join(', ')}. Podés cargarles desde
                Biblioteca en cualquier momento.
              </p>
            )}
            {error && (
              <p style={{ color: '#FCA5A5', fontSize: '14.5px' }}>{error}</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={goAddAnother} disabled={busy}>
                <Icon name="plus" size={14} /> Agregar otro cantante
              </button>
              <button className="hck-btn hck-btn-primary" onClick={requestBegin} disabled={busy}>
                Comenzar la sesión
              </button>
            </div>
          </>
        )}

        {step === 'warn-faceswap' && (
          <>
            <p style={{ fontSize: '15.5px', lineHeight: 1.6 }}>
              Todavía se está preparando la cara de <strong>{singersWithPendingFaceswap.map((s) => s.name).join(', ')}</strong>{' '}
              para uno o más templates de Fun Box. Si arrancás ahora, esos hotkeys pueden no estar listos apenas les
              toque el turno.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={() => setStep('next')}>
                Esperar un poco más
              </button>
              <button className="hck-btn hck-btn-primary" onClick={confirmFaceswapWarning}>
                Comenzar igual
              </button>
            </div>
          </>
        )}

        {step === 'warn-single' && (
          <>
            <p style={{ fontSize: '15.5px', lineHeight: 1.6 }}>
              Hay <strong>un solo cantante</strong> cargado. La sesión funciona igual, pero no va a haber turnos ni
              competencia hasta que sumes a alguien más.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="hck-btn hck-btn-secondary" onClick={goAddAnother}>
                Agregar otro cantante
              </button>
              <button className="hck-btn hck-btn-primary" onClick={() => void runBegin()}>
                Comenzar igual
              </button>
            </div>
          </>
        )}

        {step === 'syncing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px 0' }}>
            <h2>Preparando el show…</h2>
            <p className="hck-faint" style={{ fontSize: '15px' }}>
              Sincronizando las caras de los cantantes con los videos del Fun Box.
            </p>
            <div className="hck-jobbar">
              <i style={{ width: syncTotal > 0 ? `${(syncDone / syncTotal) * 100}%` : '100%' }} />
            </div>
            <p className="hck-faint" style={{ fontSize: '14px' }}>
              {syncDone} de {syncTotal}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
