import * as faceSwapWorker from './faceSwapWorker.js'

/** Paso pesado, una sola vez por template: detecta la cara del protagonista
 * cuadro a cuadro y cachea el resultado (pipeline/analyze_template_face.py).
 * Corre al subir un template `kind: 'faceswap'` en Studio — no está en el
 * camino crítico de un show en vivo, puede tardar. Delega en
 * faceSwapWorker.ts (proceso persistente, modelos ya cargados) en vez de
 * spawnear un proceso Python nuevo cada vez — ver ese archivo para el porqué. */
export function runTemplateFaceAnalysis(videoPath: string, analysisJsonPath: string): Promise<void> {
  return faceSwapWorker.analyze(videoPath, analysisJsonPath)
}

/** Paso liviano, uno por cantante: reusa el análisis ya cacheado y corre solo
 * el swap en sí (pipeline/render_singer_faceswap.py). Se dispara en segundo
 * plano apenas se confirma la foto de un cantante — ver faceSwapJobs.ts. */
export function runSingerFaceSwap(
  videoPath: string,
  analysisJsonPath: string,
  sourcePhotoPath: string,
  outVideoPath: string,
): Promise<void> {
  return faceSwapWorker.swap(videoPath, analysisJsonPath, sourcePhotoPath, outVideoPath)
}
