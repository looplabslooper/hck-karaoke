import { spawn } from 'node:child_process'

/**
 * Redimensiona una imagen a un cuadrado de `size`x`size`, preservando
 * transparencia — mismo criterio que transcode.ts/faceSwapRender.ts (spawn de
 * ffmpeg en vez de sumar una librería de imágenes nueva: ffmpeg ya es un
 * requisito obligatorio del proyecto y sabe procesar imágenes estáticas igual
 * que video). `pad=...:color=0x00000000` rellena con negro 100% transparente
 * en vez de un fondo sólido — las portadas de categoría son íconos con canal
 * alfa (no fotos), perder la transparencia los dejaría con un cuadro negro
 * feo alrededor.
 */
export function resizeSquareImage(inputPath: string, outputPath: string, size = 512): Promise<void> {
  return new Promise((resolve, reject) => {
    const filter = `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`
    const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-vf', filter, outputPath])

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
