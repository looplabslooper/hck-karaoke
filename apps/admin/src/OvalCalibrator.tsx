import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AXIS_RATIO_X,
  AXIS_RATIO_Y,
  averageLuminance,
  coverFit,
  interpolate,
  TARGET_COVERAGE,
  type Oval,
  ovalMaskCutout,
  type StickerTemplate,
} from './faceSwapCache'

interface Props {
  /** Foto ya cargada — el caller la necesita igual para el preview compuesto. */
  image: HTMLImageElement
  value: Oval
  onChange: (oval: Oval) => void
  /** Si hay al menos un template `sticker`, se muestra el preview "así se ve
   * en el escenario" al lado, recompuesto en vivo mientras se mueve el óvalo
   * — el óvalo manual solo aplica a ese tipo, los `faceswap` no lo usan. */
  previewTemplate?: StickerTemplate
}

const MIN_SCALE = 0.08
const MAX_SCALE = 0.75

/** Esquinas de la caja del óvalo, como signos respecto del centro. La manija
 * que se arrastra crece/achica contra la esquina opuesta, que queda fija. */
const CORNERS = [
  { id: 'nw', sx: -1, sy: -1 },
  { id: 'ne', sx: 1, sy: -1 },
  { id: 'sw', sx: -1, sy: 1 },
  { id: 'se', sx: 1, sy: 1 },
] as const

type DragState =
  | { kind: 'move'; pointerId: number; rect: DOMRect; startX: number; startY: number; startOval: Oval }
  | { kind: 'resize'; pointerId: number; rect: DOMRect; anchorX: number; anchorY: number; sx: number; sy: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Ubicación a mano del óvalo de recorte de cara sobre la foto del cantante:
 * se arrastra el óvalo para moverlo y las manijas de las esquinas para
 * escalarlo. El óvalo no se puede deformar por construcción — lo único que
 * cambia al escalar es un `scale` escalar, y los semiejes salen siempre de
 * AXIS_RATIO_X/Y, la misma proporción que usa el compositor en vivo.
 */
export function OvalCalibrator({ image, value, onChange, previewTemplate }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const frameRef = useRef(0)
  const pendingRef = useRef<Oval | null>(null)
  const [dragging, setDragging] = useState(false)

  // Relación de aspecto de la foto: `scale` está normalizado contra el ANCHO
  // (igual que en el template y en ovalMaskCutout), así que para expresar el
  // semieje vertical como fracción del alto hay que reescalarlo por acá.
  const aspect = image.naturalWidth / image.naturalHeight
  const halfW = value.scale * AXIS_RATIO_X
  const halfH = value.scale * AXIS_RATIO_Y * aspect

  // Los eventos de puntero llegan mucho más rápido que lo que conviene
  // re-renderizar: se acumula el último valor y se emite uno por frame.
  const emit = useCallback(
    (oval: Oval) => {
      pendingRef.current = oval
      if (frameRef.current) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        if (pendingRef.current) onChange(pendingRef.current)
      })
    },
    [onChange],
  )

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  function startMove(e: React.PointerEvent) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      rect,
      startX: e.clientX,
      startY: e.clientY,
      startOval: value,
    }
    setDragging(true)
  }

  function startResize(e: React.PointerEvent, sx: number, sy: number) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      rect,
      // Esquina opuesta a la que se agarró: queda clavada mientras se escala.
      anchorX: value.cx - sx * halfW,
      anchorY: value.cy - sy * halfH,
      sx,
      sy,
    }
    setDragging(true)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    if (drag.kind === 'move') {
      const dx = (e.clientX - drag.startX) / drag.rect.width
      const dy = (e.clientY - drag.startY) / drag.rect.height
      emit({
        ...drag.startOval,
        cx: clamp(drag.startOval.cx + dx, 0, 1),
        cy: clamp(drag.startOval.cy + dy, 0, 1),
      })
      return
    }

    const px = (e.clientX - drag.rect.left) / drag.rect.width
    const py = (e.clientY - drag.rect.top) / drag.rect.height
    // Un solo `scale` para los dos ejes: se toma el que más se estiró, así el
    // óvalo sigue al puntero sin deformarse nunca.
    const scaleFromX = Math.abs(px - drag.anchorX) / 2 / AXIS_RATIO_X
    const scaleFromY = Math.abs(py - drag.anchorY) / 2 / (AXIS_RATIO_Y * aspect)
    const scale = clamp(Math.max(scaleFromX, scaleFromY), MIN_SCALE, MAX_SCALE)
    emit({
      cx: clamp(drag.anchorX + drag.sx * scale * AXIS_RATIO_X, 0, 1),
      cy: clamp(drag.anchorY + drag.sy * scale * AXIS_RATIO_Y * aspect, 0, 1),
      scale,
    })
  }

  function endDrag(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    // El último frame pendiente puede no haber corrido todavía.
    if (pendingRef.current) onChange(pendingRef.current)
  }

  return (
    <div className="oval-calib-panes">
      <div
        ref={stageRef}
        className={`oval-calib-stage${dragging ? ' is-dragging' : ''}`}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img src={image.src} alt="" draggable={false} />
        <div
          className="oval-calib-oval"
          onPointerDown={startMove}
          style={{
            left: `${(value.cx - halfW) * 100}%`,
            top: `${(value.cy - halfH) * 100}%`,
            width: `${halfW * 200}%`,
            height: `${halfH * 200}%`,
          }}
        >
          {CORNERS.map((c) => (
            <span
              key={c.id}
              className={`oval-calib-handle handle-${c.id}`}
              onPointerDown={(e) => startResize(e, c.sx, c.sy)}
            />
          ))}
        </div>
      </div>

      {previewTemplate && <StagePreview image={image} oval={value} template={previewTemplate} />}
    </div>
  )
}

/** El mismo compuesto que se va a ver en vivo (FaceSwapOverlay), pero de un
 * solo cuadro (t=0) y recalculado en cada ajuste — así el operador calibra
 * mirando el resultado real y no una abstracción. */
function StagePreview({ image, oval, template }: { image: HTMLImageElement; oval: Oval; template: StickerTemplate }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let cancelled = false
    function draw() {
      if (cancelled) return
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      const dstW = canvas!.width
      const dstH = canvas!.height
      const { dx, dy, drawW, drawH } = coverFit(
        template.transform.width || video!.videoWidth,
        template.transform.height || video!.videoHeight,
        dstW,
        dstH,
      )
      ctx.clearRect(0, 0, dstW, dstH)
      ctx.drawImage(video!, dx, dy, drawW, drawH)

      const point = interpolate(template.transform.frames, 0)
      if (!point) return
      const cutout = ovalMaskCutout(image, oval)
      const cutoutLuminance = averageLuminance(cutout.getContext('2d')!, 0, 0, cutout.width, cutout.height)
      const canvasX = dx + point.cx * drawW
      const canvasY = dy + point.cy * drawH
      const targetW = point.scale * drawW * AXIS_RATIO_X * 2 * TARGET_COVERAGE
      const targetH = point.scale * drawW * AXIS_RATIO_Y * 2 * TARGET_COVERAGE
      const videoLuminance = averageLuminance(ctx, canvasX - targetW / 2, canvasY - targetH / 2, targetW, targetH)
      const brightness = cutoutLuminance > 0 ? videoLuminance / cutoutLuminance : 1

      ctx.save()
      ctx.translate(canvasX, canvasY)
      ctx.rotate(point.angle)
      ctx.filter = `brightness(${Math.min(1.6, Math.max(0.5, brightness))})`
      ctx.drawImage(cutout, -targetW / 2, -targetH / 2, targetW, targetH)
      ctx.restore()
    }

    if (video.readyState >= 2) draw()
    else video.addEventListener('loadeddata', draw, { once: true })
    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', draw)
    }
  }, [image, oval, template])

  return (
    <div className="oval-calib-preview">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {/* Sin display:none — ver el comentario de .face-swap-overlay video en
          style.css, mismo motivo: sin caja de layout, Chromium puede no
          decodificar ni el primer frame de forma confiable. */}
      <video
        ref={videoRef}
        src={template.videoUrl}
        muted
        playsInline
        style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <canvas ref={canvasRef} width={240} height={240} />
      <span className="hint">Así se ve en el escenario</span>
    </div>
  )
}
