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
/** Reescribe solo los .json de letra, sin volver a volcar el audio (16 GB) —
 * para cuando se corrige el parser de letra y no hace falta re-extraer todo. */
const onlyLyrics = args.includes('--only-lyrics')

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

/** Tope de duración de una palabra, igual que en `pipeline/align.py`: sin esto, la última
 * palabra de una línea se estira hasta que arranca la siguiente, y en un interludio
 * instrumental eso da barridos de 100 segundos sobre una sola sílaba. */
const MAX_WORD_SECONDS = 2.5

/**
 * Formato propio del catálogo legado. Cada token es
 * `[marca de línea opcional][fragmento]%[ms]@`, un fragmento por *sílaba*
 * (a veces varias palabras cortas comparten un mismo fragmento/timestamp):
 *
 *     \DA%34200@   LE%34250@    A%34290@    TU%34340@   CUER%34380@  PO%34430@
 *      └ nueva línea            └ espacio = borde de palabra
 *
 * Reglas confirmadas contra los archivos reales (dos variantes conviven en el
 * catálogo — un mismo fragmento nunca mezcla las dos, pero canciones distintas sí):
 * - `/` o `\` al principio: arranca una línea nueva.
 * - **Convención "espacio al principio"**: un espacio ANTES del fragmento marca que
 *   ESE fragmento abre palabra nueva (ej. registros encriptados, id ≤ 6000).
 * - **Convención "espacio al final"**: un espacio DESPUÉS del fragmento marca que el
 *   SIGUIENTE fragmento abre palabra nueva — NO el actual (ej. registros en texto
 *   plano, 6001 ≤ id ≤ 9000). Tratar este espacio como "abre palabra nueva en el
 *   fragmento actual" (como hacía una versión anterior de este parser) desplaza el
 *   corte de palabra en un fragmento: "EN UN CAFE SE VIERON" salía "EN UNCA FE
 *   SEVIERON". Confirmado corriendo ambas variantes contra las 7005 canciones reales:
 *   la interpretación vieja cambiaba el resultado en 6116/7005 (87%).
 * - Sin espacio en ningún lado: sílaba pegada a la anterior ("DA"+"LE" = "DALE").
 * - Un mismo fragmento puede traer más de una palabra corta pegada con espacio
 *   *adentro* del propio texto (ej. "MI HER" = "MI" + inicio de "HERMANO", con un
 *   solo timestamp para ambas) — hay que partirlo, si no queda "MI HER" como una
 *   sola palabra con un espacio raro en el medio.
 * - el timestamp es en milisegundos, y marca cuándo *empieza* a cantarse ese fragmento.
 *
 * Las sílabas se agrupan en palabras enteras porque `LyricsView` renderiza un espacio
 * después de cada entrada: dejarlas sueltas mostraba "DA LE A TU CUER PO". El fin de
 * cada palabra se infiere como el comienzo de la siguiente (mismo criterio que el resto
 * del proyecto), acotado por MAX_WORD_SECONDS.
 */
function parseLegacyLyrics(text) {
  const tokens = text.split(/\r?\n/).filter((t) => t.trim().length > 0)

  // 1) tokens -> fragmentos planos, sabiendo dónde empieza línea y dónde palabra
  const frags = []
  for (const token of tokens) {
    const m = token.match(/^([\\/]?)(.*)%(\d+)@$/)
    if (!m) continue
    const raw = m[2]
    const textPart = raw.trim()
    if (!textPart) continue
    frags.push({
      newLine: m[1] === '/' || m[1] === '\\',
      leadingSpace: /^\s/.test(raw),
      trailingSpace: /\s$/.test(raw),
      t: textPart,
      start: Number(m[3]) / 1000,
    })
  }
  if (frags.length === 0) return { lines: [] }

  // 2) agrupar sílabas en palabras y palabras en líneas
  const lines = []
  let line = null
  let word = null

  const pushWord = () => {
    if (word && line) line.words.push(word)
    word = null
  }
  const pushLine = () => {
    pushWord()
    if (line && line.words.length > 0) lines.push(line)
    line = null
  }

  frags.forEach((f, i) => {
    if (f.newLine) pushLine()
    if (!line) line = { start: f.start, end: f.start, words: [] }

    const prev = i > 0 ? frags[i - 1] : null
    // El primer fragmento de una línea siempre abre palabra, aunque no traiga
    // espacio. Las dos convenciones de espacio (ver comentario arriba) valen
    // por igual: espacio al principio de ESTE fragmento, o al final del ANTERIOR.
    const boundaryBefore = i === 0 || f.leadingSpace || (prev && prev.trailingSpace)

    const next = frags[i + 1]
    const fragEnd = next ? next.start : f.start + MAX_WORD_SECONDS

    // Un mismo fragmento puede traer más de una palabra pegada (espacio
    // *adentro* del texto) — se parte, y solo la primera sub-palabra respeta
    // boundaryBefore; cualquier sub-palabra adicional es, por definición,
    // una palabra nueva (el espacio que las separa está ahí mismo).
    const subTokens = f.t.split(/\s+/).filter(Boolean)
    subTokens.forEach((sub, subIdx) => {
      const isLastSub = subIdx === subTokens.length - 1
      const opensNewWord = subIdx > 0 || boundaryBefore || !word
      if (opensNewWord) {
        pushWord()
        word = { t: sub, start: f.start, end: f.start }
      } else {
        word.t += sub
      }
      // Solo la última sub-palabra de este fragmento puede seguir
      // extendiéndose con el fragmento siguiente.
      word.end = isLastSub ? fragEnd : f.start
    })
  })
  pushLine()

  // 3) acotar palabras que se estiran sobre un interludio, y cerrar cada línea
  for (const l of lines) {
    for (const w of l.words) {
      if (w.end - w.start > MAX_WORD_SECONDS) w.end = w.start + MAX_WORD_SECONDS
      if (w.end <= w.start) w.end = w.start + 0.15 // piso: una palabra siempre barre algo
    }
    l.start = l.words[0].start
    l.end = l.words[l.words.length - 1].end
  }

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

      if (!onlyLyrics) fs.writeFileSync(path.join(outDir, `${baseName}.m4a`), video)
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
