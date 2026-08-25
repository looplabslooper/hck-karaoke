import { setFaceSwapEnabled } from './queries.js'

/**
 * Corrida única desde scripts/setup.bat cuando no se detecta GPU NVIDIA en
 * la instalación — deja face swap deshabilitado en `settings` sin que el
 * operador tenga que entrar a la app. `pnpm --filter @kiosco/server db:set-faceswap 0`.
 */
const arg = process.argv[2]
const enabled = arg !== '0' && arg !== 'false'
setFaceSwapEnabled(enabled)
console.log(`[db] faceSwapEnabled = ${enabled}`)
