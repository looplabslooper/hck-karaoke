import { useEffect, useRef, useState } from 'react'
import type { Singer } from '@kiosco/shared'

export interface SingerPickerValue {
  singerId: string | null
  name: string
  photo: Blob | null
}

interface Props {
  sessionSingers: Singer[]
  value: SingerPickerValue
  onChange: (value: SingerPickerValue) => void
  /** Solo para el modal de empujar una playlist entera: dejar vacío es válido. */
  allowBlank?: boolean
  autoFocus?: boolean
  onEnter?: () => void
}

/**
 * Selector de cantante compartido entre el modal de "agregar canción" y el
 * de "empujar playlist" — reemplaza los dos <input type="text"> sueltos que
 * había antes. Tipear un nombre que ya existe esta sesión lo reusa (así no
 * hace falta re-fotografiar a alguien que canta una segunda canción); si no
 * matchea, el padre crea un cantante nuevo al enviar (ver resolveSingerId
 * en App.tsx). La foto es opcional y se pega recién cuando se envía el
 * formulario — acá solo se captura/guarda el Blob.
 */
export function SingerPicker({ sessionSingers, value, onChange, allowBlank, autoFocus, onEnter }: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    canvas.toBlob((blob) => {
      if (blob) onChange({ ...value, photo: blob })
    }, 'image/jpeg', 0.85)
    stopCamera()
  }

  function pickExisting(singer: Singer) {
    onChange({ singerId: singer.id, name: singer.name, photo: null })
    setShowSuggestions(false)
  }

  function handleNameChange(name: string) {
    const exact = sessionSingers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    onChange({ singerId: exact ? exact.id : null, name, photo: exact ? null : value.photo })
  }

  const suggestions = value.name.trim()
    ? sessionSingers.filter((s) => s.name.toLowerCase().includes(value.name.trim().toLowerCase()))
    : sessionSingers
  const isExistingSinger = value.singerId !== null

  return (
    <div className="singer-picker">
      <div className="field">
        <label>¿Quién canta?</label>
        <div className="singer-picker-input-wrap">
          <input
            type="text"
            autoFocus={autoFocus}
            value={value.name}
            placeholder={allowBlank ? 'Dejalo vacío para asignar después' : 'Nombre del invitado'}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="singer-suggestions">
              {suggestions.map((s) => (
                <li key={s.id} onMouseDown={() => pickExisting(s)}>
                  {s.photoUrl ? <img src={s.photoUrl} alt="" /> : <span className="singer-suggestion-noPhoto" />}
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        {allowBlank && <p className="hint">Si lo dejás vacío queda como "Sin asignar" y lo asignás después.</p>}
      </div>

      {!isExistingSinger && value.name.trim() && (
        <div className="field singer-photo-field">
          <label>Foto (opcional)</label>
          {photoPreviewUrl ? (
            <div className="singer-photo-preview">
              <img src={photoPreviewUrl} alt="Foto capturada" />
              <button type="button" className="btn-secondary" onClick={() => onChange({ ...value, photo: null })}>
                Sacar de nuevo
              </button>
            </div>
          ) : cameraOpen ? (
            <div className="singer-camera">
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="singer-camera-actions">
                <button type="button" className="btn-primary" onClick={capturePhoto}>
                  Capturar
                </button>
                <button type="button" className="btn-secondary" onClick={stopCamera}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="singer-photo-actions">
              <button type="button" className="btn-secondary" onClick={openCamera}>
                Usar cámara
              </button>
              <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
                Subir foto
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onChange({ ...value, photo: file })
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
