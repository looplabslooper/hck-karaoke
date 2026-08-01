import { useEffect, useRef } from 'react'
import {
  createInitialCdgState,
  processCdgPacket,
  cdgPacketIndexForTime,
  CDG_PACKET_BYTES,
  CDG_WIDTH,
  CDG_HEIGHT,
  type CdgState,
} from '@kiosco/shared'

interface Props {
  cdgUrl: string
  getPositionSeconds: () => number
}

/**
 * Reproductor de CD+G: decodifica el archivo binario en tiempo real, al
 * mismo ritmo que el audio (300 paquetes/seg — ver packages/shared/src/cdg.ts),
 * y dibuja el framebuffer resultante en un canvas. Cada paquete muta estado
 * acumulado (no se puede "saltar" a la mitad sin haber procesado todo lo
 * anterior), así que un seek hacia atrás reprocesa desde el paquete 0 — a
 * ~300 paquetes/seg incluso una canción de 4 minutos son ~72k paquetes,
 * trivial para JS en un solo frame.
 */
export function CdgPlayer({ cdgUrl, getPositionSeconds }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bytesRef = useRef<Uint8Array | null>(null)
  const cdgStateRef = useRef<CdgState>(createInitialCdgState())
  const lastPacketIndexRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    bytesRef.current = null
    cdgStateRef.current = createInitialCdgState()
    lastPacketIndexRef.current = 0

    fetch(cdgUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (cancelled) return
        bytesRef.current = new Uint8Array(buf)
      })
      .catch(() => {
        // el canvas se queda en blanco; el estado de carga/error de la
        // canción ya se maneja arriba (App.tsx) antes de montar este componente
      })

    return () => {
      cancelled = true
    }
  }, [cdgUrl])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(CDG_WIDTH, CDG_HEIGHT)

    const render = (state: CdgState) => {
      const { framebuffer, palette, transparentIndex } = state
      for (let i = 0; i < framebuffer.length; i++) {
        const colorIndex = framebuffer[i]
        const [r, g, b] = palette[colorIndex] ?? [0, 0, 0]
        const o = i * 4
        imageData.data[o] = r
        imageData.data[o + 1] = g
        imageData.data[o + 2] = b
        imageData.data[o + 3] = colorIndex === transparentIndex ? 0 : 255
      }
      ctx.putImageData(imageData, 0, 0)
    }

    const tick = () => {
      const bytes = bytesRef.current
      if (bytes) {
        const totalPackets = Math.floor(bytes.length / CDG_PACKET_BYTES)
        const targetIndex = Math.min(cdgPacketIndexForTime(getPositionSeconds()), totalPackets)

        if (targetIndex < lastPacketIndexRef.current) {
          // seek hacia atrás (scrubber, pausa/reanudar, etc.): no hay forma de
          // "deshacer" paquetes ya aplicados, así que se reprocesa desde cero.
          cdgStateRef.current = createInitialCdgState()
          lastPacketIndexRef.current = 0
        }

        for (let i = lastPacketIndexRef.current; i < targetIndex; i++) {
          processCdgPacket(cdgStateRef.current, bytes, i * CDG_PACKET_BYTES)
        }
        lastPacketIndexRef.current = targetIndex
        render(cdgStateRef.current)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [getPositionSeconds])

  return (
    <canvas
      ref={canvasRef}
      width={CDG_WIDTH}
      height={CDG_HEIGHT}
      className="cdg-canvas"
      aria-label="Letra CD+G"
    />
  )
}
