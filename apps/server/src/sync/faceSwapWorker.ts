import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { spawn, exec, execSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pipelineDir = path.resolve(__dirname, '../../../../pipeline')

function resolveUvBinary(): string {
  const candidate = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
  return fs.existsSync(candidate) ? candidate : 'uv'
}

/**
 * 10 minutos sin trabajos nuevos → se apaga el worker (libera VRAM). Da
 * margen de sobra para que sigan entrando cantantes durante el armado de una
 * sesión sin perder el estado caliente (modelos ya cargados), sin dejar la
 * GPU reservada indefinidamente entre sesiones. faceswap_worker.py tiene su
 * propio respaldo independiente (se auto-apaga si nadie le escribe nada por
 * el doble de este tiempo) por si Node muere sin avisarle — ver ese archivo.
 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000

type QueuedJob = {
  id: string
  payload: Record<string, unknown>
  resolve: () => void
  reject: (err: Error) => void
}

let worker: ChildProcessWithoutNullStreams | null = null
// El pid que reporta el worker en su handshake ({"type":"ready","pid":...}),
// NO child.pid — en Windows `uv run python ...` no hace exec(), es una
// cadena de 3 procesos (uv.exe -> python.exe del venv -> python.exe real),
// así que child.pid es el de arriba, casi siempre bloqueado esperando a su
// hijo. setPriority/taskkill tienen que apuntar al pid real reportado acá.
let workerPid: number | null = null
let readyPromise: Promise<void> | null = null
let shuttingDown = false
let idleTimer: ReturnType<typeof setTimeout> | null = null
let crashRetryUsed = false

const queue: QueuedJob[] = []
let inFlight: QueuedJob | null = null

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (worker && !inFlight && queue.length === 0) stopWorker()
  }, IDLE_TIMEOUT_MS)
}

function stopWorker(): void {
  if (!worker) return
  shuttingDown = true
  const child = worker
  const pidToKill = workerPid
  child.stdin.end() // EOF prolijo: el loop de Python sale solo del `for line in sys.stdin`
  setTimeout(() => {
    if (worker !== child) return // ya salió solo
    if (pidToKill) exec(`taskkill /PID ${pidToKill} /T /F`, () => {})
    else child.kill()
  }, 5000)
}

function handleResponseLine(msg: { id?: string; ok?: boolean; error?: string }): void {
  if (!msg.id || !inFlight || msg.id !== inFlight.id) return
  const job = inFlight
  inFlight = null
  crashRetryUsed = false
  resetIdleTimer()
  if (msg.ok) job.resolve()
  else job.reject(new Error(msg.error ?? 'face swap worker: el trabajo falló'))
  pump()
}

function handleUnexpectedExit(stderrTail: string): void {
  if (inFlight) {
    inFlight.reject(new Error(`face swap worker se cayó a mitad de un trabajo. stderr: ${stderrTail.slice(-1000)}`))
    inFlight = null
  }
  if (queue.length === 0) return
  // Un reinicio automático (no se quiere perder de una varios cantantes/templates
  // encolados por un bache transitorio), pero solo uno — si el worker recién
  // reiniciado se cae de nuevo antes de completar nada, es un problema real
  // (ej. falta el modelo), no un bache, y ahí sí se corta en vez de loopear.
  if (crashRetryUsed) {
    const err = new Error(`face swap worker volvió a caerse enseguida, se cancelan ${queue.length} trabajo(s) en cola. stderr: ${stderrTail.slice(-1000)}`)
    for (const job of queue.splice(0)) job.reject(err)
    return
  }
  crashRetryUsed = true
  pump()
}

function ensureWorker(): Promise<void> {
  if (readyPromise) return readyPromise

  shuttingDown = false
  const uvBin = resolveUvBinary()
  // --extra faceswap: insightface/onnxruntime-gpu quedaron en un extra
  // aparte de pyproject.toml (no en las dependencias base) para que una
  // instalación sin GPU no los baje — este worker es el único consumidor,
  // así que siempre pide el extra al arrancar.
  const child = spawn(uvBin, ['run', '--extra', 'faceswap', 'python', 'faceswap_worker.py'], { cwd: pipelineDir })
  worker = child

  let stderrTail = ''
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000)
  })

  readyPromise = new Promise((resolve, reject) => {
    let settled = false
    const rl = readline.createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        console.error('[faceSwapWorker] línea no reconocida del worker, se ignora:', line)
        return
      }
      if (msg.type === 'ready') {
        if (typeof msg.pid === 'number') {
          workerPid = msg.pid
          try {
            os.setPriority(msg.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
          } catch {
            // No crítico si el SO no lo permite — sigue a prioridad normal.
          }
        }
        if (!settled) {
          settled = true
          resolve()
        }
        return
      }
      handleResponseLine(msg)
    })
    child.on('error', (err) => {
      if (!settled) {
        settled = true
        reject(new Error(`No se pudo ejecutar faceswap_worker.py (¿está "uv" instalado?): ${err.message}`))
      }
    })
  })

  child.on('exit', () => {
    const wasShuttingDown = shuttingDown
    worker = null
    workerPid = null
    readyPromise = null
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (wasShuttingDown) return
    handleUnexpectedExit(stderrTail)
  })

  return readyPromise
}

function pump(): void {
  if (inFlight || queue.length === 0) return
  const job = queue.shift()!
  inFlight = job
  ensureWorker()
    .then(() => {
      worker!.stdin.write(JSON.stringify(job.payload) + '\n')
    })
    .catch((err) => {
      inFlight = null
      job.reject(err)
      // El worker nunca llegó a arrancar (ej. "uv" no está en el PATH) — no
      // es un bache transitorio, es de entorno. Falla todo lo que quedaba
      // encolado de una en vez de reintentar cada uno por separado.
      const rest = queue.splice(0)
      for (const q of rest) q.reject(err)
    })
}

function submitJob(op: 'analyze' | 'swap', payload: Record<string, unknown>): Promise<void> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    queue.push({ id, payload: { id, op, ...payload }, resolve, reject })
    pump()
  })
}

/** Paso pesado, una sola vez por template — ver faceSwapRender.ts. */
export function analyze(videoPath: string, analysisJsonPath: string): Promise<void> {
  return submitJob('analyze', { video: videoPath, out: analysisJsonPath })
}

/** Paso liviano, uno por cantante — ver faceSwapRender.ts. */
export function swap(
  videoPath: string,
  analysisJsonPath: string,
  sourcePhotoPath: string,
  outVideoPath: string,
): Promise<void> {
  return submitJob('swap', {
    video: videoPath,
    analysis: analysisJsonPath,
    sourcePhoto: sourcePhotoPath,
    out: outVideoPath,
  })
}

// Best-effort: si el server de Node se cae/cierra, intentar llevarse el
// worker con él. No es 100% confiable en Windows (ver gotcha de CLAUDE.md
// sobre procesos node.exe huérfanos tras reinicios), pero no cuesta nada —
// el respaldo real es el auto-apagado por inactividad del propio worker.
process.on('exit', () => {
  if (workerPid) {
    try {
      execSync(`taskkill /PID ${workerPid} /T /F`, { stdio: 'ignore' })
    } catch {
      // el proceso ya puede no existir, o taskkill no está disponible — no es crítico acá.
    }
  }
})
