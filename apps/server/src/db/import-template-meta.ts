import fs from 'node:fs'
import { eq } from 'drizzle-orm'
import { db } from './client.js'
import { templateMeta } from './schema.js'

/**
 * Contraparte de export-template-meta.ts, corrida desde
 * scripts/import-templates.ps1. `onConflictDoUpdate` para que se pueda
 * volver a importar el mismo zip sin duplicar filas (ej. si el import
 * falló a mitad de camino la primera vez).
 */
const inPath = process.argv[2]
if (!inPath) {
  console.error('uso: tsx import-template-meta.ts <archivo.json>')
  process.exit(1)
}

const rows: { id: string; name: string; hotkey: number | null; createdAt: number }[] = JSON.parse(
  fs.readFileSync(inPath, 'utf-8'),
)

db.transaction((tx) => {
  for (const row of rows) {
    // Un hotkey importado puede chocar con uno que la carpeta huérfana
    // (ensureTemplateMeta) ya le haya asignado a otro template en esta PC —
    // se libera antes de upsertear para no terminar con dos templates en
    // el mismo número.
    if (row.hotkey != null) {
      tx.update(templateMeta).set({ hotkey: null }).where(eq(templateMeta.hotkey, row.hotkey)).run()
    }
    tx.insert(templateMeta)
      .values(row)
      .onConflictDoUpdate({ target: templateMeta.id, set: { name: row.name, hotkey: row.hotkey } })
      .run()
  }
})

console.log(`[db] ${rows.length} template_meta importados desde ${inPath}`)
