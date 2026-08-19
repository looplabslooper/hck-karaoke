import type { Template } from '@kiosco/shared'

/** interpolate()/el compositor solo aplican al tipo `sticker` (el que trae
 * `transform`) — el tipo `faceswap` no tiene curva que interpolar, el clip ya
 * viene compuesto del server. */
export type StickerTemplate = Extract<Template, { kind: 'sticker' }>

// Misma proporción de ejes que pipeline/track_color.py, pipeline/compose_preview.py
// y template-editor.html — `scale` es "distancia interocular (o equivalente)
// normalizada por el ancho del frame", y estos factores convierten eso en el
// semi-ancho/semi-alto del óvalo. Se usa tanto para el óvalo de destino
// (dónde se pega la cara sobre el template) como para el de origen (qué
// parte de la foto es "la cara" — ver `Oval` más abajo).
export const AXIS_RATIO_X = 1.1
export const AXIS_RATIO_Y = 1.5

// El óvalo de destino trackeado por track_color.py sigue el centro/tamaño
// del blob de color, que suele quedar un poco más chico que la máscara/
// capucha real (el algoritmo detecta el núcleo saturado, no el borde de la
// tela) — sin margen, queda un anillo de la máscara original asomando
// alrededor de la cara pegada. Se agranda el parche un 14% de más al
// pegarlo, sin tocar los datos de tracking guardados.
export const TARGET_COVERAGE = 1.14

export interface Oval {
  cx: number
  cy: number
  scale: number
}

/** Óvalo centrado que ocupa casi toda la foto — fallback para cantantes
 * registrados antes de que existiera la calibración a mano (ver
 * SingerPicker), o si por algún motivo no se guardó ninguna. */
const DEFAULT_OVAL: Oval = { cx: 0.5, cy: 0.5, scale: 0.42 }

/** Recorta la foto al bounding box del óvalo calibrado (o al centrado por
 * default si no hay calibración) y le aplica una máscara ovalada con
 * feather — el resultado siempre llena su propio canvas de borde a borde,
 * para que el resto del compositor (que lo escala a `targetW x targetH` sin
 * conocer el tamaño real de la foto) lo pegue al tamaño correcto sin
 * importar qué tan chica/corrida haya quedado la cara en la foto original. */
export function ovalMaskCutout(img: HTMLImageElement, oval: Oval | null): HTMLCanvasElement {
  const o = oval ?? DEFAULT_OVAL
  const photoW = img.naturalWidth
  const photoH = img.naturalHeight
  const cropW = Math.max(2, Math.round(o.scale * photoW * AXIS_RATIO_X * 2))
  const cropH = Math.max(2, Math.round(o.scale * photoW * AXIS_RATIO_Y * 2))
  const cropX = o.cx * photoW - cropW / 2
  const cropY = o.cy * photoH - cropH / 2

  const c = document.createElement('canvas')
  c.width = cropW
  c.height = cropH
  const cctx = c.getContext('2d')!

  // El óvalo calibrado puede salirse del borde de la foto (cara cerca de un
  // extremo) — se recorta el rectángulo fuente a los límites reales de la
  // imagen y se desplaza el destino, en vez de pedirle a drawImage un
  // rectángulo fuente fuera de rango.
  const sx = Math.max(0, cropX)
  const sy = Math.max(0, cropY)
  const sw = Math.max(0, Math.min(photoW, cropX + cropW) - sx)
  const sh = Math.max(0, Math.min(photoH, cropY + cropH) - sy)
  if (sw > 0 && sh > 0) {
    cctx.drawImage(img, sx, sy, sw, sh, sx - cropX, sy - cropY, sw, sh)
  }

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
 * pegado al del video de abajo. No es color-grading real. Exportada porque
 * FaceSwapOverlay también la usa en vivo, cuadro a cuadro, para muestrear el
 * video debajo del parche (no solo la foto, que es lo que cachea este
 * módulo). */
export function averageLuminance(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
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

type Frame = StickerTemplate['transform']['frames'][number]
type ResolvedFrame = { t: number; cx: number; cy: number; angle: number; scale: number }

/** Interpola cx/cy/angle/scale entre los dos frames de transform.json más
 * cercanos a t, sosteniendo el primero/último fuera de rango — misma lógica
 * que template-editor.html y pipeline/compose_preview.py, para que el
 * compositor en vivo (FaceSwapOverlay) y el preview estático de calibración
 * (SingerPicker) se comporten igual que lo ya validado offline. */
export function interpolate(frames: Frame[], t: number): ResolvedFrame | null {
  // `visible: false` marca un tramo sin detección confiable — track_color.py
  // puede seguir escribiendo una posición ahí (arrastrada internamente), no
  // hay que usarla. Filtrar solo por cx/cy/angle/scale no-null no alcanza:
  // esos campos vienen poblados igual en frames invisibles, y pegar la cara
  // en esas coordenadas es justamente el bug de "el mapeo queda cualquier
  // cosa" — el óvalo saltando a donde el tracker perdió la máscara.
  const usable = frames.filter(
    (f): f is Frame & ResolvedFrame =>
      f.visible && f.cx !== null && f.cy !== null && f.angle !== null && f.scale !== null,
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
export function coverFit(srcW: number, srcH: number, dstW: number, dstH: number) {
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

export interface FaceCutout {
  cutout: HTMLCanvasElement
  luminance: number
}

/** Cache module-level: la foto de un cantante (y su calibración) no cambian
 * mientras dura la sesión, así que el recorte ovalado + luminancia se
 * computan una sola vez. Se precalienta al registrar cantantes (ver
 * App.tsx, efecto sobre sessionSingers) para que no haya demora la primera
 * vez que se dispara el overlay de "cara en el escenario" en vivo — si
 * igual hay un cache miss (timing raro), `loadFaceCutout` sirve de fallback
 * sin duplicar la lógica. */
const cache = new Map<string, FaceCutout>()
const inFlight = new Map<string, Promise<FaceCutout>>()

export function loadFaceCutout(photoUrl: string, oval: Oval | null): Promise<FaceCutout> {
  const cached = cache.get(photoUrl)
  if (cached) return Promise.resolve(cached)
  const existing = inFlight.get(photoUrl)
  if (existing) return existing

  const promise = new Promise<FaceCutout>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cutout = ovalMaskCutout(img, oval)
      const luminance = averageLuminance(cutout.getContext('2d')!, 0, 0, cutout.width, cutout.height)
      const result = { cutout, luminance }
      cache.set(photoUrl, result)
      inFlight.delete(photoUrl)
      resolve(result)
    }
    img.onerror = () => {
      inFlight.delete(photoUrl)
      reject(new Error(`No se pudo cargar la foto: ${photoUrl}`))
    }
    img.src = photoUrl
  })
  inFlight.set(photoUrl, promise)
  return promise
}

export function warmFaceCutout(photoUrl: string, oval: Oval | null): void {
  loadFaceCutout(photoUrl, oval).catch(() => {})
}

export function getFaceCutout(photoUrl: string): FaceCutout | undefined {
  return cache.get(photoUrl)
}
