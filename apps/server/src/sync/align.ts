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

export interface AlignInput {
  audioPath: string
  lyricsText: string
  language?: string
}

/**
 * Corre el pipeline de alineación forzada (WhisperX, ver /pipeline) como
 * subproceso — no se mezcla Python en el proceso del servidor.
 */
export function runAlignment({ audioPath, lyricsText, language = 'es' }: AlignInput): Promise<LyricsDoc> {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosco-sync-'))
    const lyricsFile = path.join(tmpDir, 'lyrics.txt')
    const outFile = path.join(tmpDir, 'out.json')
    fs.writeFileSync(lyricsFile, lyricsText, 'utf-8')

    const uvBin = resolveUvBinary()
    const child = spawn(
      uvBin,
      ['run', 'python', 'align.py', '--audio', audioPath, '--lyrics', lyricsFile, '--language', language, '--out', outFile],
      { cwd: pipelineDir },
    )

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      reject(new Error(`No se pudo ejecutar el pipeline de sincronización (¿está "uv" instalado?): ${err.message}`))
    })

    child.on('close', (code) => {
      if (code !== 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        reject(new Error(`El pipeline de sincronización falló (código ${code}): ${stderr.slice(-2000)}`))
        return
      }
      try {
        const lyrics = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as LyricsDoc
        fs.rmSync(tmpDir, { recursive: true, force: true })
        resolve(lyrics)
      } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}
