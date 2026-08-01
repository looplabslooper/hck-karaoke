import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { LyricsDoc } from '@kiosco/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pipelineDir = path.resolve(__dirname, '../../../../pipeline')

function resolveUvBinary(): string {
  const candidate = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
  return fs.existsSync(candidate) ? candidate : 'uv'
}

/** Corre un script del pipeline (`pipeline/<script>`) como subproceso vía
 * `uv run` — nunca se mezcla Python con el proceso Node. */
function runPipelineScript(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const uvBin = resolveUvBinary()
    const child = spawn(uvBin, ['run', 'python', script, ...args], { cwd: pipelineDir })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      reject(new Error(`No se pudo ejecutar ${script} (¿está "uv" instalado?): ${err.message}`))
    })

    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${script} falló (código ${code}): ${stderr.slice(-2000)}`))
      else resolve()
    })
  })
}

export interface AlignInput {
  audioPath: string
  lyricsText: string
  language?: string
  /** Separar voz/instrumental con Demucs antes de alinear — mejora la
   * precisión en temas con mucha base instrumental, a costa de un rato más
   * de proceso. Ver DECISIONES-STACK.md §12(B) y ROADMAP.md. */
  separateVocals?: boolean
  /** Si separateVocals=true, copiar el instrumental.wav separado a esta ruta
   * (para guardarlo como pista de "voz original apagada") antes de que se
   * borre el directorio temporal. Ignorado si separateVocals=false. */
  instrumentalOutputPath?: string
}

/**
 * Corre el pipeline de alineación forzada (WhisperX, ver /pipeline) — y
 * opcionalmente la separación de voz (Demucs) antes, alineando contra el
 * stem vocal en vez de la mezcla completa.
 */
export async function runAlignment({
  audioPath,
  lyricsText,
  language = 'es',
  separateVocals = false,
  instrumentalOutputPath,
}: AlignInput): Promise<LyricsDoc> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-sync-'))
  try {
    const lyricsFile = path.join(tmpDir, 'lyrics.txt')
    const outFile = path.join(tmpDir, 'out.json')
    fs.writeFileSync(lyricsFile, lyricsText, 'utf-8')

    let alignAudioPath = audioPath
    if (separateVocals) {
      const separatedDir = path.join(tmpDir, 'separated')
      await runPipelineScript('separate.py', ['--audio', audioPath, '--out-dir', separatedDir])
      alignAudioPath = path.join(separatedDir, 'vocals.wav')
      if (instrumentalOutputPath) {
        fs.copyFileSync(path.join(separatedDir, 'instrumental.wav'), instrumentalOutputPath)
      }
    }

    await runPipelineScript('align.py', [
      '--audio',
      alignAudioPath,
      '--lyrics',
      lyricsFile,
      '--language',
      language,
      '--out',
      outFile,
    ])
    return JSON.parse(fs.readFileSync(outFile, 'utf-8')) as LyricsDoc
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
