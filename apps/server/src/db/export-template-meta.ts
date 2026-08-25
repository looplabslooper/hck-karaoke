import fs from 'node:fs'
import { db } from './client.js'
import { templateMeta } from './schema.js'

/**
 * Corrida única desde scripts/export-templates.ps1 — no hay endpoint HTTP
 * para esto porque solo hace falta al mover la instalación a otra PC.
 * `template_meta` (nombre + hotkey) vive en la base, no en el filesystem
 * junto a los videos, así que el zip de templates no alcanza solo.
 */
const outPath = process.argv[2]
if (!outPath) {
  console.error('uso: tsx export-template-meta.ts <archivo-salida.json>')
  process.exit(1)
}

const rows = db.select().from(templateMeta).all()
fs.writeFileSync(outPath, JSON.stringify(rows, null, 2))
console.log(`[db] ${rows.length} template_meta exportados a ${outPath}`)
