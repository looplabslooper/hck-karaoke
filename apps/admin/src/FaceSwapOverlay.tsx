import { useEffect, useRef } from 'react'
import type { Template } from '@kiosco/shared'

interface Props {
  template: Template
  photoUrl: string
  onDone: () => void
}

// Misma proporción de ejes que pipeline/track_color.py, pipeline/compose_preview.py
// y template-editor.html — `scale` es "distancia interocular (o equivalente)
// normalizada por el ancho del template", y estos factores convierten eso en
// el semi-ancho/semi-alto del óvalo pegado.
const AXIS_RATIO_X = 1.1
const AXIS_RATIO_Y = 1.5

type Frame = Template['transform']['frames'][number]
type ResolvedFrame = { t: number; cx: number; cy: number; angle: number; scale: number }

/** Interpola cx/cy/angle/scale entre los dos frames de transform.json más
 * cercanos a t, sosteniendo el primero/último fuera de rango — misma lógica
 * que template-editor.html y pipeline/compose_preview.py, para que este
 * compositor en vivo se comporte igual que lo ya validado offline. */
function interpolate(frames: Frame[], t: number): ResolvedFrame | null {
  const usable = frames.filter(
    (f): f is Frame & ResolvedFrame => f.cx !== null && f.cy !== null && f.angle !== null && f.scale !== null,
  )
  if (usable.length === 0) return null
  if (t <= usable[0].t) return usable[0]
  const last = usable[usable.length - 1]
  if (t >= last.t) return last
  for (let i = 0; i < usable.length - 1; i++) {
    const a = usable[i]
    const b = usable[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1
      const f = (t - a.t) / span
      const da = ((b.angle - a.angle + Math.PI) % (2 * Math.PI)) - Math.PI
      return {
        t,
        cx: a.cx + (b.cx - a.cx) * f,
        cy: a.cy + (b.cy - a.cy) * f,
        angle: a.angle + da * f,
        scale: a.scale + (b.scale - a.scale) * f,
      }
    }
  }
  return last
}

/** Mismo "cover" que `object-fit: cover` en CSS, pero para dibujar a mano en
 * un canvas (drawImage no tiene object-fit) — necesario porque acá se
 * compone video + parche en un solo canvas, no un <video> suelto. */
function coverFit(srcW: number, srcH: number, dstW: number, dstH: number) {
  const srcRatio = srcW / srcH
  const dstRatio = dstW / dstH
  let drawW: number
  let drawH: number
  if (srcRatio > dstRatio) {
    drawH = dstH
    drawW = dstH * srcRatio
  } else {
    drawW = dstW
    drawH = dstW / srcRatio
  }
  return { dx: (dstW - drawW) / 2, dy: (dstH - drawH) / 2, drawW, drawH }
}

/** Recorte ovalado con feather, centrado en la foto entera — mismo truco de
 * máscara radial que ovalMaskCutout() en karaoke-walk.html. Sin detección de
 * cara: asume que la foto ya viene más o menos centrada en el rostro (la
 * vista previa en vivo de SingerPicker empuja a eso al capturar). */
function ovalMaskCutout(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const cctx = c.getContext('2d')!
  cctx.drawImage(img, 0, 0)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = c.width
  maskCanvas.height = c.height
  const mctx = maskCanvas.getContext('2d')!
  const rx = c.width * 0.46
  const ry = c.height * 0.48
  mctx.save()
  mctx.translate(c.width / 2, c.height / 2)
  mctx.scale(rx, ry)
  const g = mctx.createRadialGradient(0, 0, 0.5, 0, 0, 1)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  mctx.fillStyle = g
  mctx.beginPath()
  mctx.arc(0, 0, 1, 0, Math.PI * 2)
  mctx.fill()
  mctx.restore()

  cctx.globalCompositeOperation = 'destination-in'
  cctx.drawImage(maskCanvas, 0, 0)
  cctx.globalCompositeOperation = 'source-over'
  return c
}

/** Luminancia promedio de una región del canvas (muestreada, no pixel a
 * pixel) — heurística de primera pasada para acercar el brillo del parche
 * pegado al del video de abajo. No es color-grading real, ver plan. */
function averageLuminance(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
  const sx = Math.max(0, Math.round(x))
  const sy = Math.max(0, Math.round(y))
  const sw = Math.max(1, Math.min(Math.round(w), ctx.canvas.width - sx))
  const sh = Math.max(1, Math.min(Math.round(h), ctx.canvas.height - sy))
  const { data } = ctx.getImageData(sx, sy, sw, sh)
  const stride = 16 // 1 cada 4 píxeles (4 canales) — alcanza para un promedio
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += stride) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    count++
  }
  return count > 0 ? sum / count : 128
}

/**
 * Overlay transitorio del kiosco: pega la foto del cantante sobre el video-
 * template durante unos segundos. A diferencia del <video> de la canción
 * (que vive siempre montado, ver gotcha en CLAUDE.md), este SÍ se monta/
 * desmonta libremente — es efímero por diseño.
 */
export function FaceSwapOverlay({ template, photoUrl, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cutoutRef = useRef<HTMLCanvasElement | null>(null)
  const cutoutLuminanceRef = useRef(128)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const cutout = ovalMaskCutout(img)
      cutoutRef.current = cutout
      cutoutLuminanceRef.current = averageLuminance(cutout.getContext('2d')!, 0, 0, cutout.width, cutout.height)
    }
    img.src = photoUrl
    return () => {
      cancelled = true
    }
  }, [photoUrl])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let rafId = 0
    let done = false

    function resize() {
      canvas!.width = window.innerWidth
      canvas!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function finish() {
      if (done) return
      done = true
      cancelAnimationFrame(rafId)
      onDone()
    }

    // Respaldo por si 'ended' no dispara — el template siempre es corto, no
    // cuesta nada tener las dos salidas.
    const lastT = template.transform.frames.at(-1)?.t ?? 10
    const fallbackTimer = window.setTimeout(finish, (lastT + 1.5) * 1000)
    video.addEventListener('ended', finish)

    function draw() {
      rafId = requestAnimationFrame(draw)
      const ctx = canvas!.getContext('2d')
      if (!ctx || video!.readyState < 2) return

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

      const cutout = cutoutRef.current
      const point = interpolate(template.transform.frames, video!.currentTime)
      if (cutout && point) {
        const canvasX = dx + point.cx * drawW
        const canvasY = dy + point.cy * drawH
        const targetW = point.scale * drawW * AXIS_RATIO_X * 2
        const targetH = point.scale * drawW * AXIS_RATIO_Y * 2

        const videoLuminance = averageLuminance(ctx, canvasX - targetW / 2, canvasY - targetH / 2, targetW, targetH)
        const brightness = cutoutLuminanceRef.current > 0 ? videoLuminance / cutoutLuminanceRef.current : 1

        ctx.save()
        ctx.translate(canvasX, canvasY)
        ctx.rotate(point.angle)
        ctx.filter = `brightness(${Math.min(1.6, Math.max(0.5, brightness))})`
        ctx.drawImage(cutout, -targetW / 2, -targetH / 2, targetW, targetH)
        ctx.restore()
      }
    }
    rafId = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      window.clearTimeout(fallbackTimer)
      video.removeEventListener('ended', finish)
      cancelAnimationFrame(rafId)
    }
  }, [template, onDone])

  return (
    <div className="face-swap-overlay">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={template.videoUrl} muted autoPlay playsInline />
      <canvas ref={canvasRef} />
    </div>
  )
}
