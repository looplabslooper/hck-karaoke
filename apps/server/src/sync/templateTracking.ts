import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pipelineDir = path.resolve(__dirname, '../../../../pipeline')

function resolveUvBinary(): string {
  const candidate = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
  return fs.existsSync(candidate) ? candidate : 'uv'
}

/** Corre pipeline/track_color.py como subproceso vía `uv run` — mismo patrón
 * que runAlignment en align.ts, nunca se mezcla Python con el proceso Node.
 * Trackea el blob de color de la máscara/capucha del template (ver
 * .claude/agents/director-escenas.md) — no hace falta ML, así que a
 * diferencia de WhisperX esto corre en unos segundos, no minutos. */
export function runColorTracking(videoPath: string, outJsonPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const uvBin = resolveUvBinary()
    const child = spawn(uvBin, ['run', 'python', 'track_color.py', '--video', videoPath, '--out', outJsonPath], {
      cwd: pipelineDir,
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      reject(new Error(`No se pudo ejecutar track_color.py (¿está "uv" instalado?): ${err.message}`))
    })

    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`track_color.py falló (código ${code}): ${stderr.slice(-2000)}`))
      else resolve()
    })
  })
}
