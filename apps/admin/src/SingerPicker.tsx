import { useEffect, useRef, useState } from 'react'
import type { Singer } from '@kiosco/shared'
import type { Oval, StickerTemplate } from './faceSwapCache'
import { OvalCalibrator } from './OvalCalibrator'

export interface SingerPickerValue {
  singerId: string | null
  name: string
  photo: Blob | null
  oval: Oval | null
}

interface Props {
  sessionSingers: Singer[]
  value: SingerPickerValue
  onChange: (value: SingerPickerValue) => void
  /** Solo para el modal de empujar una playlist entera: dejar vacío es válido. */
  allowBlank?: boolean
  autoFocus?: boolean
  onEnter?: () => void
  /** Template `sticker` usado para el preview "en contexto" durante la
   * calibración del óvalo — si no hay ninguno (Fun Box vacío, o solo hay
   * templates `faceswap`), la calibración muestra solo la foto con el óvalo
   * encima. */
  previewTemplate?: StickerTemplate
  /** El armado guiado ya pregunta el nombre en su propio paso; ahí conviene
   * esconder el autocompletado de cantantes ya cargados. */
  hideSuggestions?: boolean
}

const DEFAULT_OVAL: Oval = { cx: 0.5, cy: 0.5, scale: 0.42 }

/**
 * Selector de cantante compartido entre el armado guiado y los modales de
 * "agregar canción" / "empujar playlist". Tipear un nombre que ya existe esta
 * sesión lo reusa (así no hace falta re-fotografiar a alguien que canta una
 * segunda canción); si no matchea, el padre crea un cantante nuevo al enviar
 * (ver resolveSingerId en App.tsx). La foto es opcional y se pega recién
 * cuando se envía el formulario — acá solo se captura/guarda el Blob, junto
 * con el óvalo de recorte de cara que el operador ubica a mano.
 */
export function SingerPicker({
  sessionSingers,
  value,
  onChange,
  allowBlank,
  autoFocus,
  onEnter,
  previewTemplate,
  hideSuggestions,
}: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // --- Calibración del óvalo de cara -------------------------------------
  const [calibrating, setCalibrating] = useState(false)
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null)
  const [calibImg, setCalibImg] = useState<HTMLImageElement | null>(null)
  const [draftOval, setDraftOval] = useState<Oval>(DEFAULT_OVAL)

  useEffect(() => {
    if (!value.photo) {
      setPhotoPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(value.photo)
    setPhotoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value.photo])

  useEffect(() => {
    // cerrar la cámara al desmontar (cambiar de canción, cerrar el modal),
    // para no dejar el LED de la cámara prendido de fondo.
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El calibrador necesita la foto ya decodificada (usa su relación de aspecto
  // y la dibuja en el preview compuesto), no solo el Blob.
  useEffect(() => {
    if (!pendingPhoto) {
      setCalibImg(null)
      return
    }
    const url = URL.createObjectURL(pendingPhoto)
    const img = new Image()
    img.onload = () => setCalibImg(img)
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [pendingPhoto])

  function openCalibrationForNewPhoto(photo: Blob) {
    setPendingPhoto(photo)
    setDraftOval(DEFAULT_OVAL)
    setCalibrating(true)
  }

  function openCalibrationToAdjust() {
    if (!value.photo) return
    setPendingPhoto(value.photo)
    setDraftOval(value.oval ?? DEFAULT_OVAL)
    setCalibrating(true)
  }

  function confirmCalibration() {
    onChange({ ...value, photo: pendingPhoto, oval: draftOval })
    setCalibrating(false)
    setPendingPhoto(null)
  }

  function cancelCalibration() {
    setCalibrating(false)
    setPendingPhoto(null)
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOpen(false)
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      setCameraOpen(true)
    } catch {
      alert('No se pudo acceder a la cámara. Podés subir una foto en su lugar.')
    }
  }

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [cameraOpen])

  function capturePhoto() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) openCalibrationForNewPhoto(blob)
      },
      'image/jpeg',
      0.85,
    )
    stopCamera()
  }

  function pickExisting(singer: Singer) {
    onChange({ singerId: singer.id, name: singer.name, photo: null, oval: null })
    setShowSuggestions(false)
  }

  function handleNameChange(name: string) {
    const exact = sessionSingers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    onChange({
      singerId: exact ? exact.id : null,
      name,
      photo: exact ? null : value.photo,
      oval: exact ? null : value.oval,
    })
  }

  const suggestions = value.name.trim()
    ? sessionSingers.filter((s) => s.name.toLowerCase().includes(value.name.trim().toLowerCase()))
    : sessionSingers
  const isExistingSinger = value.singerId !== null

  return (
    <div className="hck-scope" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div className="hck-field">
        <label>¿Quién canta?</label>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="hck-input"
            autoFocus={autoFocus}
            value={value.name}
            placeholder={allowBlank ? 'Dejalo vacío para asignar después' : 'Nombre del invitado'}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
          />
          {!hideSuggestions && showSuggestions && suggestions.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                margin: '6px 0 0',
                padding: '8px',
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 20,
                background: 'var(--hck-surface-2)',
                border: '1px solid var(--hck-line-2)',
                borderRadius: 'var(--hck-r-md)',
                boxShadow: '0 20px 50px rgba(0,0,0,.5)',
                maxHeight: '220px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  onMouseDown={() => pickExisting(s)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '9px 10px',
                    borderRadius: 'var(--hck-r-sm)',
                    cursor: 'pointer',
                    fontSize: '15.5px',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(245,245,247,.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {s.photoUrl ? (
                    <img src={s.photoUrl} alt="" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--hck-surface-3)', flex: 'none' }} />
                  )}
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        {allowBlank && (
          <p className="hck-faint" style={{ fontSize: '14px', marginTop: '8px' }}>
            Si lo dejás vacío queda como "Sin asignar" y lo asignás después.
          </p>
        )}
      </div>

      {!isExistingSinger && value.name.trim() && (
        <div className="hck-field">
          <label>Foto (opcional)</label>
          {calibrating ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p className="hck-faint" style={{ fontSize: '14.5px' }}>
                Arrastrá el óvalo para ponerlo sobre la cara, y las manijas de las esquinas para agrandarlo o
                achicarlo.
              </p>
              {calibImg ? (
                <OvalCalibrator
                  image={calibImg}
                  value={draftOval}
                  onChange={setDraftOval}
                  previewTemplate={previewTemplate}
                />
              ) : (
                <p className="hck-faint" style={{ fontSize: '14.5px' }}>
                  Cargando la foto…
                </p>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="hck-btn hck-btn-secondary" onClick={cancelCalibration}>
                  Cancelar
                </button>
                <button type="button" className="hck-btn hck-btn-primary" disabled={!calibImg} onClick={confirmCalibration}>
                  Confirmar óvalo
                </button>
              </div>
            </div>
          ) : photoPreviewUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <img
                src={photoPreviewUrl}
                alt="Foto capturada"
                style={{ width: '84px', height: '84px', borderRadius: 'var(--hck-r-md)', objectFit: 'cover', border: '1px solid var(--hck-line-2)' }}
              />
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" className="hck-btn hck-btn-secondary" onClick={openCalibrationToAdjust}>
                  Ajustar óvalo
                </button>
                <button
                  type="button"
                  className="hck-btn hck-btn-secondary"
                  onClick={() => onChange({ ...value, photo: null, oval: null })}
                >
                  Sacar de nuevo
                </button>
              </div>
            </div>
          ) : cameraOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', borderRadius: 'var(--hck-r-lg)', border: '1px solid var(--hck-line-2)' }}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="hck-btn hck-btn-primary" onClick={capturePhoto}>
                  Capturar
                </button>
                <button type="button" className="hck-btn hck-btn-secondary" onClick={stopCamera}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" className="hck-btn hck-btn-secondary" onClick={openCamera}>
                Usar cámara
              </button>
              <button type="button" className="hck-btn hck-btn-secondary" onClick={() => fileInputRef.current?.click()}>
                Subir foto
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) openCalibrationForNewPhoto(file)
                  e.target.value = ''
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
