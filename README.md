# Kiosco de Karaoke

Software para convertir una PC (Windows) en un kiosco de karaoke moderno: catálogo de canciones con
letra sincronizada, cola de cantantes, puntajes, animación de cara en el escenario ("Fun Box") y modo
pantalla completa para el público.

## Requisitos: instalar Node 22.x

El repo fija **Node 22.23.1** en `.nvmrc`, pero `scripts\setup.bat` solo valida el major (22.x) — no
hace falta ese patch exacto. Node más nuevo (24.x) no tiene binario precompilado de `better-sqlite3`
en este stack y forzaría a compilarlo a mano con Visual Studio Build Tools, por eso el major importa.

**Opción simple** (recomendada para una PC dedicada al kiosco):
1. Ir a https://nodejs.org/en/download, elegir la versión **22.x LTS**, Windows Installer (.msi), x64.
2. Correr el instalador (next → next → finish, ya incluye npm).
3. Abrir una terminal nueva y verificar: `node -v` → tiene que decir `v22.x.x`.

**Opción alternativa** (si esa PC ya tiene o va a necesitar otras versiones de Node para otra cosa):
1. Instalar [nvm-windows](https://github.com/coreybutler/nvm-windows/releases) (el `nvm-setup.exe` del
   último release).
2. `nvm install 22.23.1`
3. `nvm use 22.23.1`

Con cualquiera de las dos, seguí con el arranque rápido de abajo — `setup.bat` revisa la versión solo y
corta con un mensaje claro si detecta algo distinto de 22.x.

## Arranque rápido

```
scripts\setup.bat
```

Doble click también sirve — es un `.bat`, abre su propia consola. Instala dependencias, crea la base
de datos si no existe (sin canciones), instala el pipeline de Python (letra + Fun Box, detectando si
hay GPU NVIDIA — ver más abajo), y al final ofrece arrancar en modo desarrollo.

Si copiaste un `templates-export.zip` junto al repo (ver "Mover Fun Box a otra instalación" más abajo),
el script lo detecta solo y ofrece importarlo al final.

## Setup manual

Si preferís correrlo a mano (o no estás en Windows):

```
pnpm install
pnpm --filter @kiosco/server db:migrate      # crea data/kiosco.db, vacía
pnpm --filter @kiosco/server db:seed         # opcional: una canción de prueba
pnpm dev                                     # server :8080 + admin :5175 (Vite)
```

La UI se usa en **`:5175`** durante desarrollo, no en `:8080` — ese puerto en dev solo sirve el build
viejo/estático.

## Producción (el modo que corre en el kiosco real)

```
pnpm build      # compila apps/admin a estático
pnpm start      # sirve todo desde :8080, sin Vite
```

Para el arranque automático al prender la PC (Chrome en `--kiosk` apuntando al server, con reintentos
y limpieza si se cierra), ver `scripts/start-kiosk.ps1` — incluye las instrucciones para registrarlo en
el Programador de tareas de Windows (es un cambio de sistema, se hace a mano una vez).

## Estructura

- `apps/server` — Node/Express + SQLite (Drizzle). API REST + WebSocket.
- `apps/admin` — React/Vite. Única pantalla: navegación, biblioteca, generador de karaoke y motor de
  audio conviven acá.
- `packages/shared` — tipos y protocolo compartidos entre server y admin.
- `pipeline/` — sincronización automática de letra (WhisperX) y face swap (IA) — **opcional y pesado**
  (~8.5GB con soporte GPU), ver más abajo.
- `library/` — canciones y contenido subido (gitignoreado salvo lo mínimo); `data/kiosco.db` — base de
  datos local (se recrea con las migraciones, nunca se versiona).

## Pipeline de sincronía (opcional)

Sin esto, subir canciones ya sincronizadas (LRC, JSON propio, CD+G, video con letra quemada) funciona
igual. Hace falta para "sincronía automática" (WhisperX), separar voz/instrumental (Demucs) y el sticker
por color de Fun Box — todo esto anda en CPU, más lento pero utilizable:

```
cd pipeline
uv sync
```

El **face swap con IA real** de Fun Box es aparte (`onnxruntime-gpu`, `insightface`) porque de verdad
necesita GPU NVIDIA — probado: sin GPU, un clip de unos segundos tarda 13+ minutos (ver gotcha en
`CLAUDE.md`). Si la PC tiene una placa NVIDIA:

```
cd pipeline
uv sync --extra faceswap
```

`scripts\setup.bat` hace esta detección solo y pregunta qué instalar si no encuentra GPU. Face swap
también se puede deshabilitar/habilitar después desde Fun Box en Studio, sin reinstalar nada
(`settings.faceSwapEnabled` en la base).

Además hace falta bajar aparte `pipeline/models/inswapper_128.onnx` (~530MB, no se versiona, ver
gotcha en `CLAUDE.md`) — si ya lo tenías en otra instalación, viaja solo con
`scripts\export-templates.ps1` / `import-templates.ps1` (ver abajo).

## Mover Fun Box a otra instalación

Los templates de Fun Box (`templates/`, videos + mapeo) y el modelo de face swap
(`pipeline/models/inswapper_128.onnx`) no viven en git — son contenido pesado que cada instalación
gestiona por su cuenta. Para llevarlos de una PC a otra:

```
# en la PC de origen
scripts\export-templates.ps1
```

Genera `templates-export.zip` junto al repo (templates + sus nombres/hotkeys + el modelo de face swap
si está presente). Copiá ese archivo a la PC nueva **por afuera de git** (USB, red, la nube) — es
pesado (puede rondar 500MB+ con el modelo incluido) y no corresponde subirlo al repositorio.

```
# en la PC nueva, después de scripts\setup.bat
scripts\import-templates.ps1
```

Si el zip quedó junto al repo antes de correr `setup.bat`, el instalador ya ofrece importarlo solo al
terminar.

## Más contexto

- **`CLAUDE.md`** — comandos, gotchas ya resueltos, convenciones. Léelo antes de tocar código.
- **`ROADMAP.md`** — dónde está el proyecto hoy y qué sigue.
- **`DECISIONES-STACK.md`** — por qué se eligió cada pieza del stack.
