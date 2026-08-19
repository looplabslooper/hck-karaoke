# CLAUDE.md

## Proyecto
Kiosco de Karaoke — software para convertir una PC en un kiosco de karaoke moderno. Reemplaza *conceptualmente* un sistema legado en VB.NET/MS Access que fue auditado como referencia funcional (ver `old/`, ignorado por git, ~29GB de instaladores — nunca se reutiliza su código ni su formato de datos, y nunca debe commitearse).

## Leer primero
1. **`ROADMAP.md`** — dónde está el proyecto hoy y qué sigue.
2. **`DECISIONES-STACK.md`** — todas las decisiones de arquitectura ya tomadas, con su razonamiento. No las vuelvas a proponer ni a discutir salvo que el usuario lo pida explícitamente.

## Comandos
- `pnpm dev` — levanta `server` (:8080) + `admin` (:5175) juntos, cada uno con su propio dev server (Vite hace proxy de `/api` y `/library` hacia :8080).
- `pnpm build` — compila `apps/admin` a estático (`apps/admin/dist`). `pnpm start` — corre el server en modo producción, sirviendo ese build en el mismo origen (:8080, sin Vite). Requiere `pnpm build` corrido antes al menos una vez.
- `scripts/start-kiosk.ps1` — launcher completo del kiosco: build si falta, arranca el server, espera `/health`, abre Chrome en `--kiosk` apuntando a `http://localhost:8080/`, y al cerrar Chrome mata el server. Instrucciones de Tarea Programada al final del archivo (registro manual, no lo hace el script solo).
- `pnpm --filter @kiosco/<paquete> exec tsc --noEmit` — typecheck de un paquete (`server` | `admin` | `shared`).
- `pnpm --filter @kiosco/shared test` — corre los tests unitarios (`node:test`, sin dependencias extra).
- `pnpm --filter @kiosco/server db:generate` / `db:migrate` / `db:seed` — migraciones Drizzle.
- Pipeline Python: `cd pipeline && uv run python align.py --audio <mp3> --lyrics <txt> --language es --out <json>`. `uv` no está en el PATH del shell por default — usar `export PATH="$HOME/.local/bin:$PATH"` primero, o la ruta completa a `uv.exe`.

## Arquitectura (monorepo pnpm)
- **`apps/server`** — Node/Express/ws + SQLite (Drizzle). Sirve `/api/*`, `/library` (estático) y WebSocket en `/ws`.
- **`apps/admin`** — React+Vite, puerto 5175. **Es la única app y corre en una sola pantalla/PC**: navegación, biblioteca, generador de karaoke y el motor de audio real (Web Audio API) conviven acá. "Pantalla completa" (`apps/admin/src/App.tsx`, `kioskMode`) es un modo visual + Fullscreen API dentro de la misma app, no un proceso ni una pestaña separada — ver ROADMAP.md para el porqué de este cambio (existió una separación `screen`/`admin` en dos apps, se descartó explícitamente).
- **`packages/shared`** — tipos del protocolo WS, dominio (`Song`), parser de `.lrc`, detector de formato/compatibilidad de karaoke. Sin dependencias externas, se consume como TS crudo (sin paso de build).
- **`pipeline/`** — proyecto Python aislado (uv, WhisperX + torch/CUDA) para la sincronización automática de letras. Se invoca como subproceso desde `apps/server/src/sync/align.ts` — nunca se mezcla con el proceso Node.
- **`library/`** — canciones (audio + `lyrics.json`); **`data/kiosco.db`** — SQLite. El contenido pesado/generado está gitignored; solo el JSON de letras se commitea.

## Gotchas ya resueltos (no los vuelvas a pisar)
- **Node debe ser 22.x** (fijado en `.nvmrc`). Versiones más nuevas (24.x) no tenían binario precompilado de `better-sqlite3` en este entorno y hubieran requerido Visual Studio Build Tools para compilar desde cero.
- **`AudioContext` necesita `.resume()` explícito.** Puede quedar en estado `suspended` incluso creado dentro de un gesto del usuario — sin el resume, todo el código de reproducción corre sin errores pero no sale ningún sonido. Ver el comentario en `apps/admin/src/App.tsx`.
- Los imports relativos dentro de `packages/shared` necesitan extensión `.js` explícita (`./domain.js`, no `./domain`) — lo exige `moduleResolution: NodeNext` del lado del servidor; Vite (`Bundler`) lo acepta igual.
- `pnpm-workspace.yaml` tiene `overrides.esbuild` y `allowBuilds` — no los borres: arreglan una vulnerabilidad real y habilitan los builds nativos de `better-sqlite3`/`esbuild`.
- Tras varios reinicios seguidos del servidor durante desarrollo, pueden quedar procesos `node.exe` viejos colgados en los puertos 8080/5175 (`tsx watch` no siempre libera el puerto limpio). Si algo "no responde" o "se cuelga", verificar primero con `netstat -ano | grep LISTENING` y matar duplicados antes de asumir que hay un bug de código nuevo.
- **En dev, la UI vive en `:5175`, no en `:8080`.** El server servía `apps/admin/dist` incondicionalmente, así que entrar a `:8080` mientras se desarrolla te daba **en silencio** un build viejo — parecía andar pero era código de días atrás hablando con una API que ya había cambiado (síntoma real: `TypeError: v.find is not a function`, de un bundle que esperaba que `/api/songs` devolviera un array). Ahora en dev ese puerto responde un cartel que te manda a `:5175`; el build solo se sirve con `pnpm start`.
- **Un `<video>`/`<audio>` que tiene que sobrevivir a un cambio de layout va montado UNA sola vez, fuera del bloque condicional.** El reproductor de `baked-video` estaba dentro de `{kioskMode && ...}`: no existía en modo backstage (tocar "Reproducir" no hacía literalmente nada) y alternar pantalla completa lo remontaba, reiniciando la canción.
- **No derivar qué renderizar desde un `useRef`.** `isLocalReady` salía de `playingIdRef.current`; tocar un ref no dispara re-render, así que el reproductor no se montaba hasta que algún otro `setState` despertara a React de casualidad — y si los `setState` cercanos escribían el mismo valor que ya había, React los descartaba y no pasaba nada nunca. Los refs son para que los callbacks del motor de audio no lean estado viejo; para renderizar hace falta estado de verdad.
- **`.m4a` es audio, aunque MP4 suene a video.** El catálogo legado guarda AAC en contenedor MP4 sin pista de video. Con extensión `.mp4`, `detectFormat` lo toma por karaoke con letra quemada y **descarta el `.json` de la letra**. Ver ROADMAP.md.
- `apps/admin/vite.config.ts` fija `build.target: 'es2022'` — sin esto, `pnpm build` falla con "Transforming destructuring... is not supported yet" en destructuring completamente estándar (bug real de esta versión de esbuild con el target multi-browser por defecto de Vite). No hace falta soporte legacy: el kiosco corre siempre en un Chrome específico vía `--kiosk`.
- **`pipeline/models/inswapper_128.onnx` (face swap real, "Cara en el escenario" tipo `faceswap`) no se versiona** — pesa ~530MB, mismo criterio que `face_landmarker.task`. No hay un mirror oficial único: se bajó de un repo comunitario en Hugging Face (buscar "inswapper_128.onnx download" si hay que reinstalar).
- **El swap con CPU (`onnxruntime` sin GPU) es demasiado lento para ser viable** — probado: un clip de 48 cuadros no terminaba ni después de 13 minutos. `onnxruntime-gpu` es obligatorio en la práctica, no una optimización opcional — ya está en `pipeline/pyproject.toml`. Con GPU (RTX 3070 probado), el mismo clip tarda ~10s incluida la carga de modelos.
- **`onnxruntime-gpu` en Windows no encuentra sus propias DLLs de CUDA aunque estén instaladas por pip** — los paquetes `nvidia-cublas-cu12`/`nvidia-cudnn-cu12` (instalados vía los extras `[cuda,cudnn]`) dejan las DLLs adentro de `site-packages/nvidia/*/bin/`, pero a diferencia de Linux, Windows no las encuentra solas: sin arreglar esto, onnxruntime cae en silencio a CPU (no tira error, solo queda lentísimo) — el síntoma es exactamente el punto anterior. `pipeline/_cuda_dlls.py` lo arregla anteponiendo esas carpetas a `PATH` (¡`os.add_dll_directory()` solo no alcanzó, hace falta también el `PATH`!) antes de importar `onnxruntime`/`insightface` — se importa como primera línea en `analyze_template_face.py`/`render_singer_faceswap.py`. Si se agrega un script nuevo que use estos modelos, hay que importarlo ahí también.
- **`subprocess.Popen` con `stderr=PIPE` sin drenarlo en paralelo puede colgarse si el hijo escribe suficiente stderr** — le pasó a `render_singer_faceswap.py`: escribía cuadros al stdin de `ffmpeg` en loop sin leer su stderr hasta el final; si ffmpeg llena el buffer del pipe de stderr (con el progreso cuadro a cuadro, verbosidad por defecto), se bloquea escribiendo ahí, y este proceso se bloquea escribiéndole a su stdin — deadlock mutuo, sin ningún error, el proceso simplemente no termina nunca. Arreglado con `-loglevel error` en ffmpeg (no hay nada que llene el pipe si no hay errores) — si se agrega otro subproceso con este patrón (escribir mucho a stdin en loop), hay que aplicar el mismo criterio.

## Convenciones
- Comentarios solo cuando explican un *por qué* no obvio (un bug real, una decisión de diseño, el límite de una librería) — nunca "qué hace" el código.
- No commitear cambios sin que el usuario lo pida explícitamente.
- La carpeta `old/` nunca debe trackearse en git — ya está en `.gitignore`; no toques esa regla.
