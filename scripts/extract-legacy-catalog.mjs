// Extrae el catálogo de EcuaKaraoke (old/Instalador_1-7000/ECUAKARAOKE/CANCION/ECK <N>.dat)
// a repertorio/ como pares <Artista> - <Titulo>.m4a + .json (LyricsDoc), para probar el
// importador de carpetas con contenido real. Ver ROADMAP.md para el detalle de cómo se
// reversó el formato (decompilando ECUAKARAOKE.exe con ilspycmd + invocando el método real
// por reflection para obtener un ground-truth, y luego re-implementando el parseo/desencriptado
// acá en JS puro porque la ruta por reflection era ~2s/archivo — inviable para 7000 archivos).
//
// Dos variantes de registro conviven en el mismo catálogo, ambas descubiertas empíricamente:
//  - id <= 6000 o 9000 < id < 9006: registro encriptado (TripleDES-CBC, sin padding real —
//    la Key y el IV viajan en el mismo archivo, no hay secreto externo).
//  - 6001 <= id <= 9000: registro en texto plano, sin ningún paso de desencriptado.
// Ambas variantes comparten el mismo contenedor interno una vez en claro: pista de audio +
// nombre del licenciatario (se descarta, es el comprador original de la licencia) + letra con
// timing por sílaba en un formato de texto propio, terminado en "$$$@\r\n".
//
// OJO: el audio es un MP4 *sin pista de video* (AAC puro), aunque el software viejo lo
// listaba entre sus "formatos de video". Se guarda como .m4a, que es la extensión correcta
// para eso — si se guarda .mp4, el detector de formato lo toma por un karaoke con letra
// quemada y descarta el .json, que es justamente donde vive la sincronía.
//
// Uso: node scripts/extract-legacy-catalog.js [--limit N] [--start-id N] [--end-id N]

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
// `xlsx` (para leer LISTADO DE CANCIONES.xls) NO es dependencia del repo a
// propósito: este script se corre una sola vez, y no vale ensuciar el
// package.json del kiosco con algo que la app nunca usa. Se resuelve así:
//   1. si está instalado en el monorepo, se usa;
//   2. si no, se puede apuntar a una copia suelta con XLSX_PATH=<ruta al .mjs>
//      (ej: instalarlo en una carpeta temporal con `npm i xlsx`).
import { pathToFileURL } from 'node:url'

async function loadXlsx() {
  if (process.env.XLSX_PATH) return import(pathToFileURL(process.env.XLSX_PATH).href)
  try {
    return await import('xlsx')
  } catch {
    console.error(
      'Falta la librería `xlsx`, necesaria para leer LISTADO DE CANCIONES.xls.\n' +
        'Instalala en una carpeta cualquiera (`npm i xlsx`) y volvé a correr con:\n' +
        '  XLSX_PATH=/ruta/a/node_modules/xlsx/xlsx.mjs node scripts/extract-legacy-catalog.mjs',
    )
    process.exit(1)
  }
}
const xlsx = await loadXlsx()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const cancionDir = path.join(repoRoot, 'old/Instalador_1-7000/ECUAKARAOKE/CANCION')
const xlsPath = path.join(repoRoot, 'old/Instalador_1-7000/ECUAKARAOKE/LISTADO DE CANCIONES.xls')
const outDir = path.join(repoRoot, 'repertorio')

const args = process.argv.slice(2)
function argValue(name, fallback) {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? Number(args[idx + 1]) : fallback
}
const limit = argValue('limit', Infinity)
const startId = argValue('start-id', 0)
const endId = argValue('end-id', Infinity)

const SENTINEL = Buffer.from('$$$@\r\n', 'ascii')

function readHeaderLength(buf, offset) {
  // patrón repetido en todo el formato: [flag 2 bytes][longitud u32 LE][reservado 4 bytes]
  return buf.readUInt32LE(offset + 2)
}

function findSentinel(buf, from) {
  const idx = buf.indexOf(SENTINEL, from)
  if (idx === -1) throw new Error('no se encontró el terminador de letra "$$$@\\r\\n"')
  return idx
}

/** A partir del contenedor en claro (video+nombre+letra), separa los tres campos. */
function parsePlainContainer(plain) {
  const videoLen = readHeaderLength(plain, 0)
  const video = plain.subarray(10, 10 + videoLen)

  let pos = 10 + videoLen
  const nameLen = plain.readUInt16LE(pos)
  pos += 2 + nameLen // el nombre del licenciatario no se usa, solo se salta

  pos += 10 // header de la letra (mismo patrón flag+longitud+reservado)
  const sentinelEnd = findSentinel(plain, pos)
  const lyricsRaw = plain.subarray(pos, sentinelEnd - SENTINEL.length)

  return { video, lyricsRaw }
}

function extractRecord(raw, id) {
  const encrypted = id <= 6000 || (id > 9000 && id < 9006)
  if (!encrypted) {
    return parsePlainContainer(raw)
  }
  const key = raw.subarray(10, 34)
  const iv = raw.subarray(44, 52)
  const cipherLen = readHeaderLength(raw, 52)
  const ciphertext = raw.subarray(62, 62 + cipherLen)
  const decipher = crypto.createDecipheriv('des-ede3-cbc', key, iv)
  decipher.setAutoPadding(false)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return parsePlainContainer(plain)
}

/** Formato propio: fragmentos de sílaba separados por '/' o '\' (línea nueva) o pegados
 * (misma palabra). Un espacio al final del fragmento (antes del '%') cierra la palabra
 * actual. Timestamp en milisegundos (confirmado comparando contra la duración real del
 * video: interpretarlo como centisegundos daba tiempos de hasta 35 minutos en canciones
 * de 4). Sin tiempo de fin explícito por palabra — se infiere como el inicio de la
 * siguiente (mismo criterio que se usa en el resto del proyecto). */
function parseLegacyLyrics(text) {
  const tokens = text.split(/\r?\n/).filter((t) => t.trim().length > 0)
  const lines = []
  let currentLine = null
  let currentWord = null

  function closeWord(endTime) {
    if (currentWord) {
      currentWord.end = endTime
      currentLine.words.push(currentWord)
      currentWord = null
    }
  }
  function closeLine(endTime) {
    closeWord(endTime)
    if (currentLine && currentLine.words.length > 0) {
      currentLine.end = endTime
      lines.push(currentLine)
    }
    currentLine = null
  }

  for (const token of tokens) {
    const m = token.match(/^([\\/]?)(.*)%(\d+)@$/)
    if (!m) continue
    const isNewLine = m[1] === '/' || m[1] === '\\'
    const rawFragment = m[2]
    const hasTrailingSpace = /\s$/.test(rawFragment)
    const fragment = rawFragment.trim()
    const t = Number(m[3]) / 1000

    if (isNewLine) {
      closeLine(t)
      currentLine = { start: t, end: t, words: [] }
    } else if (!currentLine) {
      currentLine = { start: t, end: t, words: [] }
    }

    if (!currentWord) {
      currentWord = { t: fragment, start: t, end: t }
    } else {
      closeWord(t)
      currentWord = { t: fragment, start: t, end: t }
    }
    if (hasTrailingSpace) closeWord(t)
  }
  closeLine(currentWord ? currentWord.start : currentLine?.start ?? 0)

  return { lines }
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
}

function loadMetadata() {
  const wb = xlsx.read(fs.readFileSync(xlsPath))
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 })
  const byId = new Map()
  for (const row of rows.slice(1)) {
    const [num, titulo, artista] = row
    if (typeof num === 'number') {
      byId.set(num, { titulo: String(titulo ?? '').trim(), artista: String(artista ?? '').trim() })
    }
  }
  return byId
}

function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const metadata = loadMetadata()

  const files = fs
    .readdirSync(cancionDir)
    .map((f) => f.match(/^ECK (\d+)\.dat$/i))
    .filter(Boolean)
    .map((m) => ({ id: Number(m[1]), filename: m.input }))
    .filter((f) => f.id >= startId && f.id <= endId)
    .sort((a, b) => a.id - b.id)
    .slice(0, limit)

  let ok = 0
  let failed = 0
  const failures = []
  const usedNames = new Set()

  for (const { id, filename } of files) {
    try {
      const raw = fs.readFileSync(path.join(cancionDir, filename))
      const { video, lyricsRaw } = extractRecord(raw, id)
      const lyricsText = lyricsRaw.toString('latin1')
      const lyricsDoc = parseLegacyLyrics(lyricsText)

      const meta = metadata.get(id)
      const titulo = meta?.titulo || `Sin titulo ${id}`
      const artista = meta?.artista || 'Desconocido'
      let baseName = sanitizeFilename(`${artista} - ${titulo}`)
      if (usedNames.has(baseName.toLowerCase())) baseName = `${baseName} (${id})`
      usedNames.add(baseName.toLowerCase())

      fs.writeFileSync(path.join(outDir, `${baseName}.m4a`), video)
      fs.writeFileSync(path.join(outDir, `${baseName}.json`), JSON.stringify(lyricsDoc))
      ok++
    } catch (err) {
      failed++
      failures.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  console.log(`OK: ${ok}  FALLIDOS: ${failed}`)
  if (failures.length > 0) {
    fs.writeFileSync(path.join(outDir, '_failures.json'), JSON.stringify(failures, null, 2))
    console.log(`Ver detalle de fallos en repertorio/_failures.json (primeros 10):`)
    console.log(failures.slice(0, 10))
  }
}

main()
