import fs from 'node:fs'
import path from 'node:path'
import type { Template } from '@kiosco/shared'

/**
 * Escanea templatesDir por subcarpetas <id>/{video.mp4,transform.json} — el
 * operador las copia a mano (ver .claude/agents/director-escenas.md), no hay
 * UI de carga. Son pocas carpetas, así que se relee del disco en cada
 * request en vez de cachear.
 */
export function listTemplates(templatesDir: string): Template[] {
  if (!fs.existsSync(templatesDir)) return []

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true }).filter((e) => e.isDirectory())
  const templates: Template[] = []

  for (const entry of entries) {
    const dir = path.join(templatesDir, entry.name)
    const videoPath = path.join(dir, 'video.mp4')
    const transformPath = path.join(dir, 'transform.json')
    if (!fs.existsSync(videoPath) || !fs.existsSync(transformPath)) continue

    try {
      const transform = JSON.parse(fs.readFileSync(transformPath, 'utf-8'))
      templates.push({ id: entry.name, videoUrl: `/templates/${entry.name}/video.mp4`, transform })
    } catch {
      // transform.json corrupto/incompleto — se ignora esa carpeta en vez de romper el listado entero
    }
  }

  return templates
}
