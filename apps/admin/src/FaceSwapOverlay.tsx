import { useEffect, useRef } from 'react'
import {
  AXIS_RATIO_X,
  AXIS_RATIO_Y,
  averageLuminance,
  coverFit,
  getFaceCutout,
  interpolate,
  loadFaceCutout,
  TARGET_COVERAGE,
  type Oval,
  type StickerTemplate,
} from './faceSwapCache'

interface Props {
  template: StickerTemplate
  photoUrl: string
  oval: Oval | null
  onDone: () => void
}

/**
 * Overlay transitorio del kiosco para templates `sticker`: pega la foto del
 * cantante sobre el video-template durante unos segundos. A diferencia del
 * <video> de la canción (que vive siempre montado, ver gotcha en CLAUDE.md),
 * este SÍ se monta/desmonta libremente — es efímero por diseño. Los
 * templates `faceswap` usan FaceSwapVideoOverlay en su lugar (el clip ya
 * viene compuesto del server, no hay nada que interpolar acá).
 */
export function FaceSwapOverlay({ template, photoUrl, oval, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cutoutRef = useRef<HTMLCanvasElement | null>(null)
  const cutoutLuminanceRef = useRef(128)

  // Precalentado por App.tsx (ver efecto sobre sessionSingers) — normalmente
  // ya está en cache para cuando este overlay se monta. `loadFaceCutout`
  // sirve de fallback sin duplicar la lógica de recorte si igual hay un miss.
  useEffect(() => {
    let cancelled = false
    const cached = getFaceCutout(photoUrl)
    if (cached) {
      cutoutRef.current = cached.cutout
      cutoutLuminanceRef.current = cached.luminance
      return
    }
    loadFaceCutout(photoUrl, oval).then((result) => {
      if (cancelled) return
      cutoutRef.current = result.cutout
      cutoutLuminanceRef.current = result.luminance
    })
    return () => {
      cancelled = true
    }
  }, [photoUrl, oval])

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
        const targetW = point.scale * drawW * AXIS_RATIO_X * 2 * TARGET_COVERAGE
        const targetH = point.scale * drawW * AXIS_RATIO_Y * 2 * TARGET_COVERAGE

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
