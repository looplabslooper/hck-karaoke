import fs from 'node:fs'
import path from 'node:path'
import type { Template } from '@kiosco/shared'

/**
 * Escanea templatesDir por subcarpetas <id>/video.mp4 + un archivo de mapeo
 * que define el `kind` — `transform.json` (tracking por color, sticker) o
 * `analysis.json` (análisis de cara real, faceswap), ver domain.ts. El
 * operador las sube desde Studio → Fun Box (o las copia a mano, ver
 * .claude/agents/director-escenas.md). Son pocas carpetas, así que se relee
 * del disco en cada request en vez de cachear.
 */
export function listTemplates(templatesDir: string): Template[] {
  if (!fs.existsSync(templatesDir)) return []

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true }).filter((e) => e.isDirectory())
  const templates: Template[] = []

  for (const entry of entries) {
    const dir = path.join(templatesDir, entry.name)
    const videoPath = path.join(dir, 'video.mp4')
    if (!fs.existsSync(videoPath)) continue
    const videoUrl = `/templates/${entry.name}/video.mp4`

    const analysisPath = path.join(dir, 'analysis.json')
    if (fs.existsSync(analysisPath)) {
      templates.push({ id: entry.name, videoUrl, kind: 'faceswap' })
      continue
    }

    const transformPath = path.join(dir, 'transform.json')
    if (!fs.existsSync(transformPath)) continue
    try {
      const transform = JSON.parse(fs.readFileSync(transformPath, 'utf-8'))
      templates.push({ id: entry.name, videoUrl, kind: 'sticker', transform })
    } catch {
      // transform.json corrupto/incompleto — se ignora esa carpeta en vez de romper el listado entero
    }
  }

  return templates
}
