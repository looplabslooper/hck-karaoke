import { asc, eq, isNull } from 'drizzle-orm'
import { db } from './client.js'
import { songs, settings } from './schema.js'

/**
 * Corrida única (REQ-16): numera las canciones que quedaron sin `number` al
 * agregar la columna — el catálogo legado importado antes de este campo.
 * Orden por `createdAt` para que el N° refleje "hace cuánto está en el
 * catálogo", no un orden arbitrario. Deja `settings['songNumberSeq']` en el
 * máximo asignado para que `nextSongNumber()` (queries.ts) siga de ahí.
 * Idempotente: si se vuelve a correr, no toca las filas que ya tienen número.
 */
const pending = db.select().from(songs).where(isNull(songs.number)).orderBy(asc(songs.createdAt)).all()

const current = db.select().from(settings).where(eq(settings.key, 'songNumberSeq')).get()
let next = current ? Number(current.value) : 0

db.transaction((tx) => {
  for (const row of pending) {
    next += 1
    tx.update(songs).set({ number: next }).where(eq(songs.id, row.id)).run()
  }
  tx.insert(settings)
    .values({ key: 'songNumberSeq', value: String(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(next) } })
    .run()
})

console.log(`[db] ${pending.length} canciones numeradas — songNumberSeq quedó en ${next}`)
