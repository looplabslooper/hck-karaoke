import { useEffect, useRef } from 'react'

interface Props {
  videoUrl: string
  onDone: () => void
}

/**
 * Overlay transitorio para templates `faceswap`: el clip ya viene compuesto
 * por el server (swap real ya renderizado, ver
 * GET /api/sessions/current/faceswap-status), así que acá no hace falta
 * canvas ni interpolación como en FaceSwapOverlay — solo reproducirlo a
 * pantalla completa y avisar cuando termina.
 */
export function FaceSwapVideoOverlay({ videoUrl, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let done = false
    function finish() {
      if (done) return
      done = true
      onDone()
    }
    // Respaldo por si 'ended' no dispara — mismo motivo que FaceSwapOverlay:
    // el clip siempre es corto, un timer generoso no cuesta nada.
    const fallbackTimer = window.setTimeout(finish, 15000)
    video.addEventListener('ended', finish)
    return () => {
      window.clearTimeout(fallbackTimer)
      video.removeEventListener('ended', finish)
    }
  }, [onDone])

  return (
    <div className="face-swap-video-overlay">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={videoUrl} muted autoPlay playsInline />
    </div>
  )
}
