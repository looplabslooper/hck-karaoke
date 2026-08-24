import fs from 'node:fs'
import path from 'node:path'
import type { Template } from '@kiosco/shared'
import { getAllTemplateMeta, ensureTemplateMeta } from './db/queries.js'

/**
 * Escanea templatesDir por subcarpetas <id>/video.mp4 + un archivo de mapeo
 * que define el `kind` — `transform.json` (tracking por color, sticker) o
 * `analysis.json` (análisis de cara real, faceswap), ver domain.ts. El
 * operador las sube desde Studio → Fun Box (o las copia a mano, ver
 * .claude/agents/director-escenas.md). Son pocas carpetas, así que se relee
 * del disco en cada request en vez de cachear.
 *
 * Nombre y hotkey viven aparte, en `template_meta` (ver db/queries.ts) — una
 * carpeta subida antes de esa tabla existir no tiene fila, de ahí el
 * fallback "Escena N" con `hotkey: null`.
 */
export function listTemplates(templatesDir: string): Template[] {
  if (!fs.existsSync(templatesDir)) return []

  const meta = getAllTemplateMeta()
  const entries = fs.readdirSync(templatesDir, { withFileTypes: true }).filter((e) => e.isDirectory())
  const templates: Template[] = []

  for (const entry of entries) {
    const dir = path.join(templatesDir, entry.name)
    const videoPath = path.join(dir, 'video.mp4')
    if (!fs.existsSync(videoPath)) continue
    const videoUrl = `/templates/${entry.name}/video.mp4`
    const m = meta[entry.name]
    const name = m?.name ?? `Escena ${templates.length + 1}`
    const hotkey = m?.hotkey ?? null
    if (!m) ensureTemplateMeta(entry.name, name)

    const analysisPath = path.join(dir, 'analysis.json')
    if (fs.existsSync(analysisPath)) {
      templates.push({ id: entry.name, videoUrl, name, hotkey, kind: 'faceswap' })
      continue
    }

    const transformPath = path.join(dir, 'transform.json')
    if (!fs.existsSync(transformPath)) continue
    try {
      const transform = JSON.parse(fs.readFileSync(transformPath, 'utf-8'))
      templates.push({ id: entry.name, videoUrl, name, hotkey, kind: 'sticker', transform })
    } catch {
      // transform.json corrupto/incompleto — se ignora esa carpeta en vez de romper el listado entero
    }
  }

  return templates
}
