import { spawn } from 'node:child_process'

/**
 * Normaliza cualquier audio/video de entrada (mp3, mp4, wav, etc.) a un mp3
 * estándar — así el resto del sistema (WhisperX, el reproductor web) siempre
 * trabaja con el mismo formato sin importar qué subió el admin.
 */
export function transcodeToMp3(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-qscale:a', '4', outputPath])

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`)))
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg falló (código ${code}): ${stderr.slice(-1500)}`))
      else resolve()
    })
  })
}
