// Fase B de la corrección del catálogo legado (ver plan de sesión): empuja los
// repertorio/*.json ya regenerados por `extract-legacy-catalog.mjs --only-lyrics`
// (fix de segmentación de palabras) a la biblioteca en vivo (library/_imported/).
//
// Correlación por nombre de archivo, no por contenido: audioPath en la DB guarda
// `external:<ruta absoluta al .m4a en repertorio/>` con el mismo nombre base que
// su .json hermano (misma convención de sanitizeFilename que usa el extractor,
// sin cambios) — no hace falta ningún fingerprint de texto.
//
// Re-corrible sin efectos secundarios: si el .json regenerado es igual al que ya
// está en la biblioteca, no toca nada. Antes de pisar algo, guarda el original en
// scripts/_backups/lyrics-fix-<timestamp>/<songId>.json — `--restore <timestamp>`
// deshace la corrida completa.
//
// Uso:
//   node scripts/resync-legacy-lyrics.mjs
//   node scripts/resync-legacy-lyrics.mjs --restore 2026-08-14T12-00-00

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// `better-sqlite3` es dependencia de apps/server, no de la raíz del monorepo —
// pnpm no lo hoistea acá. Se resuelve a mano en vez de agregar el paquete a la
// raíz solo para este script (mismo criterio que ya usa extract-legacy-catalog.mjs
// con `xlsx`, ver ese archivo).
const { default: Database } = await import(
  pathToFileURL(path.join(repoRoot, 'apps/server/node_modules/better-sqlite3/lib/index.js')).href
)
const dbPath = path.join(repoRoot, 'data', 'kiosco.db')
const libraryDir = path.join(repoRoot, 'library')
const backupsRoot = path.join(__dirname, '_backups')
const EXTERNAL_PREFIX = 'external:'

const args = process.argv.slice(2)
const restoreIdx = args.indexOf('--restore')

function timestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
}

function main() {
  if (restoreIdx !== -1) return restore(args[restoreIdx + 1])
  return run()
}

function run() {
  if (!fs.existsSync(dbPath)) {
    console.error(`No se encontró la base en ${dbPath} — ¿corriste esto desde la raíz del repo?`)
    process.exit(1)
  }
  const db = new Database(dbPath)
  const rows = db.prepare('SELECT id, audio_path, lyrics_path, sync_verified FROM songs').all()

  const ts = timestamp()
  const backupDir = path.join(backupsRoot, `lyrics-fix-${ts}`)
  let backupDirCreated = false

  let corrected = 0
  let unchanged = 0
  let nonLegacy = 0
  let missingLiveFile = 0
  let failed = 0
  const failures = []
  const correctedSamples = []
  const manifest = {} // songId -> sync_verified original, para poder restaurarlo también

  for (const row of rows) {
    try {
      if (!row.audio_path?.startsWith(EXTERNAL_PREFIX)) { nonLegacy++; continue }
      const audioAbsPath = row.audio_path.slice(EXTERNAL_PREFIX.length)
      if (!audioAbsPath.toLowerCase().endsWith('.m4a')) { nonLegacy++; continue }
      const repertorioJsonPath = audioAbsPath.slice(0, -path.extname(audioAbsPath).length) + '.json'
      if (!fs.existsSync(repertorioJsonPath)) { nonLegacy++; continue }

      if (!row.lyrics_path) { missingLiveFile++; continue }
      const livePath = path.join(libraryDir, row.lyrics_path)
      if (!fs.existsSync(livePath)) { missingLiveFile++; continue }

      const regenerated = fs.readFileSync(repertorioJsonPath, 'utf-8')
      const current = fs.readFileSync(livePath, 'utf-8')

      // Comparación normalizada (mismo JSON.stringify de un lado y otro), no
      // byte a byte, para no marcar "cambió" por espacios/orden de claves.
      const regeneratedNorm = JSON.stringify(JSON.parse(regenerated))
      const currentNorm = JSON.stringify(JSON.parse(current))
      if (regeneratedNorm === currentNorm) { unchanged++; continue }

      if (!backupDirCreated) {
        fs.mkdirSync(backupDir, { recursive: true })
        backupDirCreated = true
      }
      fs.writeFileSync(path.join(backupDir, `${row.id}.json`), current)
      fs.writeFileSync(livePath, regeneratedNorm)
      manifest[row.id] = row.sync_verified
      db.prepare('UPDATE songs SET sync_verified = 0 WHERE id = ?').run(row.id)

      corrected++
      if (correctedSamples.length < 12) {
        const before = JSON.parse(current)
        const after = JSON.parse(regeneratedNorm)
        correctedSamples.push({
          id: row.id,
          before: before.lines[0]?.words.map((w) => w.t).join(' ') ?? '',
          after: after.lines[0]?.words.map((w) => w.t).join(' ') ?? '',
        })
      }
    } catch (err) {
      failed++
      failures.push({ id: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (backupDirCreated) fs.writeFileSync(path.join(backupDir, '_manifest.json'), JSON.stringify(manifest))
  db.close()

  console.log(`Corregidas:        ${corrected}`)
  console.log(`Sin cambios:       ${unchanged}`)
  console.log(`No-legado:         ${nonLegacy}`)
  console.log(`Sin archivo vivo:  ${missingLiveFile}`)
  console.log(`Fallidas:          ${failed}`)
  if (backupDirCreated) console.log(`\nBackup en: ${backupDir}`)
  if (failures.length > 0) {
    console.log('\nFallos:')
    failures.slice(0, 20).forEach((f) => console.log(`  ${f.id}: ${f.error}`))
  }
  if (correctedSamples.length > 0) {
    console.log('\nMuestra de corregidas (primera línea, antes / después):')
    correctedSamples.forEach((s) => {
      console.log(`  ${s.id}`)
      console.log(`    antes:   ${s.before}`)
      console.log(`    despues: ${s.after}`)
    })
  }
}

function restore(ts) {
  if (!ts) {
    console.error('Uso: node scripts/resync-legacy-lyrics.mjs --restore <timestamp>')
    console.error('Backups disponibles:')
    if (fs.existsSync(backupsRoot)) fs.readdirSync(backupsRoot).forEach((d) => console.error(`  ${d}`))
    process.exit(1)
  }
  const backupDir = path.join(backupsRoot, `lyrics-fix-${ts}`)
  if (!fs.existsSync(backupDir)) {
    console.error(`No existe ${backupDir}`)
    process.exit(1)
  }
  const manifestPath = path.join(backupDir, '_manifest.json')
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) : {}

  const db = new Database(dbPath)
  const rows = db.prepare('SELECT id, lyrics_path FROM songs').all()
  const byId = new Map(rows.map((r) => [r.id, r.lyrics_path]))

  let restored = 0
  for (const file of fs.readdirSync(backupDir)) {
    if (file === '_manifest.json') continue
    const id = file.replace(/\.json$/, '')
    const lyricsPath = byId.get(id)
    if (!lyricsPath) continue
    const livePath = path.join(libraryDir, lyricsPath)
    fs.copyFileSync(path.join(backupDir, file), livePath)
    if (id in manifest) db.prepare('UPDATE songs SET sync_verified = ? WHERE id = ?').run(manifest[id], id)
    restored++
  }
  db.close()
  console.log(`Restauradas ${restored} canciones desde ${backupDir}.`)
}

main()
