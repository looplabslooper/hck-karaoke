import fs from 'node:fs'
import type { TemplateRenderStatus } from '@kiosco/shared'
import { runSingerFaceSwap } from './faceSwapRender.js'

/**
 * Trackea en memoria los renders de swap por-cantante en curso. El estado
 * "de verdad" es si el .mp4 de salida ya existe en disco (ver
 * getFaceSwapStatus) — este Map solo evita relanzar la misma combinación
 * mientras ya está en vuelo, y el Set recuerda si el último intento falló
 * (para no reintentar en loop cada vez que el cliente pollea el status).
 * Vive en memoria a propósito: es estado de la sesión activa, tan efímero
 * como ella — el árbol de _sessions/<id>/ donde caen estos .mp4 se borra
 * entero al terminar la sesión (ver /api/sessions/end en index.ts).
 */
const inFlight = new Map<string, Promise<void>>()
const failedKeys = new Set<string>()

function jobKey(singerId: string, templateId: string): string {
  return `${singerId}:${templateId}`
}

export function getFaceSwapStatus(outPath: string, singerId: string, templateId: string): TemplateRenderStatus {
  if (fs.existsSync(outPath)) return 'ready'
  const k = jobKey(singerId, templateId)
  if (failedKeys.has(k)) return 'failed'
  return 'pending'
}

/**
 * Dispara el render en segundo plano si no hay uno ya en curso y el archivo
 * de salida todavía no existe — idempotente, seguro de llamar más de una vez
 * para la misma combinación (ej. al registrar un cantante y, casi al mismo
 * tiempo, al subir un template nuevo).
 */
export function triggerFaceSwapRender(
  singerId: string,
  templateId: string,
  videoPath: string,
  analysisPath: string,
  photoPath: string,
  outPath: string,
  outDir: string,
): void {
  const k = jobKey(singerId, templateId)
  if (inFlight.has(k) || fs.existsSync(outPath)) return

  fs.mkdirSync(outDir, { recursive: true })
  failedKeys.delete(k)
  const job = runSingerFaceSwap(videoPath, analysisPath, photoPath, outPath)
    .catch((err) => {
      failedKeys.add(k)
      console.error(`[faceswap] ${k} falló:`, err instanceof Error ? err.message : err)
    })
    .finally(() => {
      inFlight.delete(k)
    })
  inFlight.set(k, job)
}
