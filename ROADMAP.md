# Roadmap — Kiosco de Karaoke

_Última actualización: 2026-08-20._

## Corregida la segmentación de palabras del catálogo legado (sesión 2026-08-14)

Investigando la queja de "la sincronía no se siente confiable" se encontró que **87% del
catálogo legado (6979 de 7005 canciones) mostraba la letra con las palabras mal cortadas** —
sílabas sueltas en vez de palabras completas ("EN UNCA FE SEVIERON" en vez de "EN UN CAFE SE
VIERON"). No era un bug de esta app: el dato ya venía mal generado desde
`scripts/extract-legacy-catalog.mjs`.

**Causa real**: el catálogo legado usa dos convenciones de espacio distintas para marcar bordes
de palabra —espacio *antes* del fragmento (abre palabra nueva ahí mismo) vs. espacio *después*
del fragmento (abre palabra nueva en el *siguiente* fragmento, no en éste)— y el parser viejo
trataba ambas igual, además de no separar los casos donde un mismo fragmento trae más de una
palabra corta pegada con un espacio adentro del propio texto. Ver el comentario de
`parseLegacyLyrics()` en `scripts/extract-legacy-catalog.mjs` para el detalle completo.

**Corrección aplicada en dos fases**: `extract-legacy-catalog.mjs --only-lyrics` regeneró los
7005 `repertorio/*.json` con el parser corregido (0 fallos), y el nuevo
`scripts/resync-legacy-lyrics.mjs` empujó lo corregido a la biblioteca en vivo correlacionando
por nombre de archivo (sin fingerprint de texto — `audioPath` en la DB ya apunta al `.m4a` en
`repertorio/`, que tiene el mismo nombre base que su `.json` hermano). 6979 canciones corregidas,
26 sin cambios, 7 sin correlato en el catálogo legado (no se tocaron). Cada canción corregida
tiene su versión original respaldada en `scripts/_backups/lyrics-fix-<timestamp>/`, restaurable
con `node scripts/resync-legacy-lyrics.mjs --restore <timestamp>` — también revierte el
`syncVerified` que la corrida puso en `false` para cualquier canción cuyo contenido cambió.

Verificado: heurística automática (largo promedio de palabra) sobre las 7008 canciones con letra
→ 0 sospechosas; muestreo manual de 18 canciones al azar, todas correctas.

## Rework del flujo de sesión de karaoke (en curso)

Ver **`PLAN-SESION-KARAOKE.md`** para el detalle completo: contexto, decisiones cerradas, y el
estado etapa por etapa (Etapa 1, armado guiado, ya hecha y verificada; Etapa 2, el show —turnos,
puntaje en vivo, cierre con resultados—, en curso).

## Catálogo legado migrado (sesión 2026-07-31)

El catálogo del sistema viejo (`old/`, EcuaKaraoke) **ya está extraído e importado**: 7005 canciones
con letra sincronizada a nivel sílaba. Esto reemplaza la línea de "extra a futuro, fuera de alcance"
que decía este documento antes.

**Cómo se rompió el formato** (por si hay que volver a tocarlo): `ECUAKARAOKE.exe` es un ensamblado
.NET, se decompiló con `ilspycmd` (paquete de NuGet, corre sobre el runtime .NET 8 que ya estaba
instalado — no hizo falta instalar dnSpy ni el SDK). El código estaba ofuscado (identificadores
tipo `_0018._0001`), así que primero se invocó el método real de desencriptado **por reflection**
para obtener un ground-truth, y recién después se re-implementó el parseo en JS puro
(`scripts/extract-legacy-catalog.mjs`) — la ruta por reflection tardaba ~2s por archivo, inviable
para 7000. La versión en JS se validó byte a byte contra el ground-truth.

Formato de `CANCION/ECK <N>.dat`: dos variantes conviven — `id <= 6000` y `9000 < id < 9006` están
cifradas con TripleDES-CBC (la Key y el IV viajan **en el mismo archivo**, no hay secreto externo),
y `6001..9000` están en texto plano sin ningún cifrado. Adentro, ambas traen: pista de audio +
nombre del licenciatario (se descarta) + letra con timing por sílaba, terminada en `$$$@\r\n`.

**Lección que costó cara — no repetirla:** ese audio es un **MP4 sin pista de video** (AAC puro),
aunque el software viejo lo listaba entre sus "formatos de video". Se extrajo primero como `.mp4`,
y el detector de formato lo clasificó como `baked-video` (karaoke con letra quemada) → la app
mostró pantalla negra y **descartó el `.json` con la letra**, que es justamente donde estaba toda
la sincronía. Se corrigió guardando `.m4a` y agregando esa extensión a `AUDIO_EXT`. Las 7005
quedaron como `json` / `excellent` / `overlay`, el mejor nivel de la app.

Corolario importante para el futuro: **estas pistas son instrumentales, sin voz.** WhisperX no
puede alinearlas (la alineación forzada necesita una voz que alinear), así que la sincronía que
venía en los `.dat` es irreemplazable — si se pierde, no se puede regenerar automáticamente.

## Cambio de arquitectura de esta sesión (leer antes de tocar `apps/`)

El diseño original separaba dos apps: `apps/screen` (:5173, la única que reproducía audio, pensada para el monitor/TV del kiosco) y `apps/admin` (:5174, control remoto que nunca sonaba, sincronizadas por WS). El usuario pidió explícitamente reemplazar eso por **una sola pantalla**: navegación, elección de canciones, letra y un modo de pantalla completa, todo en la misma app y el mismo proceso.

Como consecuencia:
- **`apps/screen` fue eliminada por completo.** Todo su motor de audio (Web Audio, pausa/reanudar/seek) y `LyricsView` se movieron a `apps/admin/src/App.tsx` y `apps/admin/src/LyricsView.tsx`.
- `apps/admin` ahora tiene un `kioskMode`: un botón "pantalla completa" oculta la navegación/biblioteca y muestra solo el fondo de video + la letra (con Fullscreen API real de por medio), con un botón para salir. La barra "marquesina" (play/pausa + scrubber) sigue visible arriba de todo.
- `packages/shared/src/protocol.ts` perdió `ControlMsg`/`PlaybackStatusMsg`: ya no hace falta sincronizar dos clientes por WS, pausa/reanudar/seek son llamadas de función locales dentro del mismo componente. `ServerMsg` quedó solo con `snapshot`.
- `apps/server/src/index.ts` perdió el relay genérico de mensajes WS (ya no hay a quién reenviarle nada); solo emite `snapshot` al conectar y tras cambios de estado.
- `pnpm dev` ahora levanta únicamente `server` (:8080) + `admin` (:5175).

**Esto pisa una decisión previamente documentada en `DECISIONES-STACK.md`** (resumen ejecutivo, punto 2, y §5/§6): la separación control-remoto/pantalla fue explícitamente descartada por el usuario a favor de una sola superficie. `DECISIONES-STACK.md` no se reescribió — tiene una nota al pie en cada sección afectada señalando la reversión y por qué, para no perder el razonamiento original (útil si el proyecto alguna vez vuelve a necesitar multi-pantalla, p. ej. varias TVs).

## Dónde estamos

### Hecho y confirmado funcionando
- Monorepo pnpm: `apps/server` (Node/Express/ws + SQLite/Drizzle), `apps/admin` (React+Vite, la app única de kiosco — control + reproducción), `packages/shared` (tipos + lógica pura), `pipeline/` (Python aislado con uv, WhisperX).
- Base de datos SQLite con catálogo de canciones (`songs`) y config global (`settings`).
- Detector de formato + evaluador de compatibilidad (LRC línea/palabra, JSON propio, CD+G, video con letra quemada, solo audio) — 13 tests unitarios, todos pasando.
- Endpoint de subida de karaokes ya armados (`POST /api/songs`).
- Generador de karaoke automático (`POST /api/songs/sync`): audio/video + letra pegada como texto → WhisperX alinea contra GPU (RTX 3070) → guarda `lyrics.json`. Probado con una canción real completa ("Tuyo" — Rodrigo Amarante), 0 palabras sin sincronizar tras el ajuste del límite de sanidad de duración por palabra.
- Fondo de video global, siempre renderizado detrás de la letra (nunca la tapa, por diseño).
- App única rediseñada: sidebar de navegación, biblioteca en tarjetas (el color del borde es la calidad de sincronía), barra "marquesina" persistente con play/pausa + scrubber, y modo pantalla completa (fondo + letra, Fullscreen API).
- **Audio real con letra sincronizada, pausa/reanudar/seek y pantalla completa** funcionando y confirmado por el usuario dentro de la misma app (`localhost:5175`). El bug real que costó encontrar en su momento: faltaba `AudioContext.resume()` — el código corría sin errores pero no salía sonido.
- Selector de idioma en "Generar karaoke" (es/en/pt/fr/it/de) — antes de esto el pipeline siempre alineaba en español sin importar el idioma real de la canción, la causa raíz de la mayoría de los problemas de sincronía reportados. Ver el hallazgo grande más abajo.
- `pipeline/align.py` corta la línea cuando detecta un hueco real (instrumental/silencio >1.2s) entre palabras, en vez de dejarlo "adentro" de una sola línea. `LyricsView` muestra puntitos + barra de espera durante esos huecos.
- Seguridad: `pnpm audit` limpio (se corrigió una vulnerabilidad alta real en `drizzle-orm` y una moderada transitiva de `esbuild`).
- **Rediseño visual completo** a partir de un mockup que el usuario armó con Claude Design ("HCK · High Class Karaoke", confirmado — ver memoria `project_hck_visual_rebrand`): paleta oscura + acento violeta único (Plus Jakarta Sans), biblioteca ahora es una tabla con **buscador y filtro por calidad de sincronía funcionando de verdad** (antes era un pendiente de esta lista) y orden A→Z/Z→A, "Generar karaoke" pasó a ser un wizard de 4 pasos con dropzone de arrastrar-y-soltar, control de **volumen real** (GainNode) en el reproductor, y botón "Mostrar letras" con overlay flotante (línea actual + preview de la siguiente) para ver la letra sin entrar a pantalla completa.
- **"Cara en el escenario" integrado a la Sesión de Karaoke** (reemplaza la vieja `/walk-on`, que era una herramienta HTML suelta y desconectada de la app — sin fetch a la API, foto capturada de nuevo a mano cada vez). Ahora es un panel dentro de la página `cola` que lista los templates de Fun Box numerados; con sesión activa y pantalla completa, las teclas `1`-`9` (o click en el panel) disparan `FaceSwapOverlay` sobre quien está cantando, usando la foto ya guardada al registrar al cantante. Fotos (recorte ovalado + luminancia) y videos de templates se precalientan solos — al crear/recargar una sesión y al registrar un cantante nuevo (`apps/admin/src/faceSwapCache.ts`, efectos en `App.tsx`) — para que no haya demora la primera vez que se aprieta la tecla en vivo.

El usuario probó a mano el merge screen+admin: reproducción, audio y pantalla completa andan bien ("se abre bien y se escucha bien"). Lo que estaba mal era la sincronización de la letra — ver el hallazgo grande abajo. El rediseño visual también se dio por bueno ("visualmente es lo que pedí").

### Hallazgo grande de esta sesión: por qué la letra se desincronizaba

El usuario reportó desync de letra (ej. "Stitches" — Shawn Mendes, se notaba desde el segundo ~55) y pidió feedback visual para los huecos sin letra. Investigando `library/3ac2c8b5.../lyrics.json` (la canción real) encontramos dos causas separadas:

1. **Bug raíz, alto impacto — el idioma de alineación siempre era español.** `apps/server/src/index.ts` (`/api/songs/sync`) default-eaba `language = 'es'` y el formulario "Generar karaoke" en `apps/admin` nunca tenía un campo para elegirlo. "Stitches" es una canción en inglés — se alineó con el modelo wav2vec2 **español** (`VOXPOPULI_ASR_BASE_10K_ES`), que no reconoce los fonemas del inglés. Confirmado re-corriendo `pipeline/align.py` a mano con `--language en` contra el audio real: con el idioma correcto, la primera línea pasó de un timestamp completamente roto (`"thought"` terminaba en 2.88s y la siguiente palabra recién arrancaba en 32.8s, un hueco de 30s adentro de la misma línea) a tiempos coherentes (7.3s–10.7s), sin más anomalías en el resto de la canción.
   - **Fix**: `apps/admin/src/App.tsx` ahora tiene un `<select name="language">` (es/en/pt/fr/it/de) en el formulario de generación — son los idiomas con modelo "torch" nativo en WhisperX (`DEFAULT_ALIGN_MODELS_TORCH`), más portugués vía HF. El servidor ya leía `req.body.language`, solo faltaba que el form lo mandara.
   - **Ya corregido en el catálogo**: reemplacé a mano `library/3ac2c8b5-fe29-463a-be6e-32a726440730/lyrics.json` (Stitches) por una alineación nueva con `language=en` — reconstruí el texto plano desde las palabras del JSON viejo (el texto pegado original no se persiste, solo el resultado). Si hay otras canciones no-españolas ya sincronizadas antes de este fix, probablemente tengan el mismo problema y convenga re-generarlas.

2. **Defensivo, menor impacto — un hueco real (instrumental/silencio) podía quedar "adentro" de una sola línea.** `pipeline/align.py` ya tenía una guarda de sanidad (`MAX_WORD_SECONDS`) que recorta la *duración* de una palabra anómala, pero no cortaba la línea — así que aunque la palabra individual quedara acotada, la frase completa se mostraba en pantalla desde el arranque y se quedaba pegada hasta que la próxima palabra realmente empezaba, sin ningún indicio visual de que había un hueco.
   - **Fix**: `align.py` ahora corta la línea en dos apenas detecta un hueco (>1.2s) entre el fin de una palabra y el inicio de la siguiente — el mismo umbral (`MIN_GAP_SECONDS`) que usa el cliente para decidir cuándo mostrar la UI de espera.
   - **UI nueva** (pedido explícito del usuario): `apps/admin/src/LyricsView.tsx` — cuando no hay línea activa y el hueco hasta la próxima supera ese umbral, se muestran tres puntitos animados + una barra de progreso (`--wait-p`) que se llena hasta que arranca la próxima línea. Huecos cortos (pausas naturales entre versos) no disparan la UI para evitar parpadeo.

**Nota aparte, no es bug**: la letra pegada para "Stitches" solo cubre hasta ~2:29 del tema real (~3:23) — probablemente se pegó incompleta (falta el bridge/breakdown final). Si se quiere sincronía completa hay que re-generarla pegando la letra entera.

### Intento descartado: anclar la alineación a segmentos reales por VAD

El usuario propuso (buena idea en principio): en vez de alinear la canción entera como un bloque, detectar dónde hay voz real (VAD) y anclar cada línea a su propio tramo, para que un error puntual no arrastre el resto de la canción. Se implementó y se probó a fondo contra el audio real de "Stitches" — **se descartó porque empeoró el resultado**, no lo mejoró. Registro para no repetir el mismo camino:

- Pipeline probado: `whisperx.load_model(...).transcribe(audio, chunk_size=8)` (Silero VAD, corrido en CPU — ver problemas de entorno abajo) para obtener tramos con voz real, después repartiendo nuestras palabras pegadas entre esos tramos **proporcionalmente a la cantidad de palabras que Whisper transcribió en cada uno**, y alineando cada tramo por separado.
- Resultado real: peor que el bloque único. La repartición proporcional es frágil — tramos de VAD cortos o parejos meten palabras de más o de menos en cada ventana, y el error se compone a lo largo de la canción. Llegó a producir un hueco de 32s en el minuto ~1:50 de "Stitches" (`"And now that"` → nada → `"I'm without your kisses"`) donde el enfoque simple (un solo bloque, con el idioma correcto) no tenía ninguna anomalía.
- **Si se retoma esto en el futuro**, no alcanza con repartir por cantidad de palabras — hace falta un matching de texto real (comparar el texto transcripto por Whisper contra la letra pegada con algo tipo `difflib`/Needleman-Wunsch, como ya anticipa `DECISIONES-STACK.md` §12 para la alternativa de Deepgram) para saber de verdad qué tramo de VAD corresponde a qué línea pegada, en vez de asumir que el orden y las proporciones alcanzan.
- Efectos secundarios del experimento que quedaron revertidos (no tocar de nuevo sin retomar esto): `pipeline/align.py` volvió a la versión de un solo bloque (con el fix de idioma + el corte de línea por hueco, ambos vigentes). `pipeline/pyproject.toml`/`uv.lock` volvieron a su estado original — el pin `setuptools<81` que hizo falta para que `ctranslate2` no explotara en el import (`pkg_resources` eliminado en setuptools ≥81) ya no aplica porque no usamos `whisperx.load_model`/transcripción en el pipeline actual. Si algún día se vuelve a necesitar transcripción real (no solo alineación forzada), va a hacer falta ese pin de nuevo, más forzar el VAD a Silero (`vad_method="silero"`, no el default pyannote — rompe con PyTorch ≥2.6 por un `torch.load(weights_only=True)` que no sabe deserializar sus objetos omegaconf) y correr esa transcripción en CPU (el wheel de `ctranslate2` para Windows no trae el cuDNN 8 completo que necesita para GPU).

## QoL de esta sesión: cola en vivo, puntajes, re-sincronizar y Demucs

El usuario pidió explícitamente dejar la Fase 2 (celular/QR) para el final y en cambio "hacer rígido" el kiosco de una sola pantalla que ya existe. Se agregó:

- **Re-sincronizar una canción existente** — `POST /api/songs/:id/resync` (nunca toca el audio, solo vuelve a correr WhisperX con letra/idioma nuevos y pisa `lyrics.json`). En la Biblioteca, botón "⟳" por fila abre un modal para pegar la letra corregida. Responde directamente a "¿qué pasa si la letra queda desincronizada?" — antes había que hacerlo a mano por CLI (lo que se hizo con "Stitches" esta sesión), ahora es un flujo real de la app.
- **Cola en vivo** — tabla nueva `queue_items` (`songId`, `singer`, `status: queued|playing|done`, `score`, `position`). Página nueva en el sidebar ("Cola en vivo"): tarjeta "Cantando ahora" + botón "Siguiente ▶" (marca `done` lo que sonaba y sube lo próximo a `playing`, dispara la reproducción real vía el mismo mecanismo de `setNowPlaying`+snapshot que ya existía), lista de "Próximos" con mover arriba/abajo y quitar. Desde la Biblioteca, botón "+ Cola" agrega una canción a la cola pidiendo el nombre de quién canta.
- **Puntajes / tabla de posiciones** — cada item de cola, una vez cantado (`done`), se puede puntuar 1-10 (botones de un toque) desde la sección "Falta puntuar". `GET /api/leaderboard` suma puntaje por cantante y ordena de mayor a menor — la tabla de posiciones vive en la misma página de cola, con el primer puesto destacado.
- **Demucs** — `pipeline/separate.py` (nuevo) separa voz/instrumental con el modelo `htdemucs` (API de Python, no CLI) antes de alinear. Es **opt-in** (checkbox "Separar voz del instrumental (Demucs)" en el wizard y en el modal de re-sincronizar) — no obligatorio en cada canción porque suma tiempo real de proceso y el bug dominante de sincronía (idioma) ya está resuelto; queda como recurso para temas con mucha base instrumental.
- **Eliminar canción** — botón "🗑" por fila en la Biblioteca, con modal de confirmación (acción irreversible, no se borra sin confirmar). `DELETE /api/songs/:id` limpia la fila de `songs`, cualquier entrada de `queue_items` que la mencionara (pasada o pendiente), y la carpeta `library/<id>/` entera del disco.
- **"Apagar voz original" (modo karaoke real)** — el instrumental que separa Demucs ya no se descarta: si se sincronizó con "Separar voz" activado, queda guardado como `instrumental.mp3` junto al audio (columna `instrumental_path`, `Song.instrumentalUrl` en el tipo compartido). El reproductor decodifica ambos buffers al cargar la canción; un botón nuevo en la barra ("Apagar voz original") intercambia entre uno y otro **preservando la posición exacta** — mismo mecanismo que pausar/buscar (parar la fuente actual, arrancar una nueva del otro buffer desde el mismo offset). Solo aparece si la canción tiene instrumental guardado.
- **Filtro oscuro opcional en pantalla completa** — la vista de pantalla completa siempre tuvo un degradado oscuro sobre el fondo (`.performance-scrim`) para que la letra no se pierda contra el video; ahora es opcional (activado por defecto) con un botón nuevo al lado de "Salir de pantalla completa" para sacarlo si el fondo elegido ya es lo bastante oscuro por sí solo.
- **Corrección manual de sincronía, línea por línea** — pedido a raíz de un caso real: en dos canciones de Bad Bunny el coro (con ad-libs/voces dobladas, típico del género) quedaba desincronizado cerca del final. En vez del editor completo de tap-to-sync por palabra que preveía `DECISIONES-STACK.md` §12(D) (mucho más trabajo), se hizo una versión acotada al problema real: panel "Corregir sincronía" (botón nuevo en la barra, junto a "Apagar voz original") con la lista de líneas, la que está sonando resaltada en vivo, y dos acciones por línea — "Fijar acá" (desplaza esa línea y sus palabras a la posición real de reproducción, conservando el ritmo interno) y "Fijar desde acá →" (aplica el mismo desplazamiento a todas las líneas siguientes también, para el caso típico de que el desfasaje se arrastre hasta el final). `PUT /api/songs/:id/lyrics` persiste el `lyrics.json` corregido; hasta guardar, se puede escuchar el resultado y descartar si no quedó bien.

Todo lo anterior está probado a mano contra el servidor real corriendo (no solo typecheck) — agregar/mover/sacar de la cola, avanzar la cola, puntuar, ranking, re-sincronizar con y sin Demucs, borrar una canción de prueba completa (DB + disco), confirmar que el instrumental queda guardado y servido por HTTP tras una re-sincronización con Demucs, y guardar/restaurar una corrección manual de letra contra el endpoint real (incluyendo los casos de error: canción inexistente, cuerpo inválido).

### Formatos estándar de karaoke: CD+G implementado

El catálogo/detector ya reconocía `.cdg` desde el principio (`sourceFormat: 'cdg'`, `playbackMode: 'complete'`, el archivo binario se guarda tal cual bajo `lyricsPath`), pero la pantalla completa solo mostraba "reproducción nativa pendiente". Ahora se reproduce de verdad:

- **`packages/shared/src/cdg.ts`** (nuevo, sin dependencias, sin DOM) — decodificador puro del formato binario CD+G: paquetes de 24 bytes a 300/seg, framebuffer de 300×216 indexado a una paleta de 16 colores. Implementa memory preset, border preset, tile block (normal y XOR), carga de paleta (RGB444, dos lotes de 8 colores) y color transparente. **No implementa scroll** (preset/copy) a propósito — es raro que los discos de karaoke reales lo usen para la letra en sí, y una aproximación incorrecta se vería peor que ignorarlo. 10 tests unitarios con paquetes sintéticos, más un test de integración temporal (borrado después) que reproduce un archivo `.cdg` completo de punta a punta y verifica el framebuffer resultante.
- **`apps/admin/src/CdgPlayer.tsx`** (nuevo) — decodifica el archivo en tiempo real al ritmo del mismo reloj de audio que usa `LyricsView` (`getPositionSeconds()`), dibujando el framebuffer en un `<canvas>` vía `ImageData`. Como cada paquete muta estado acumulado, un seek hacia atrás no se puede "deshacer" — se detecta y se reprocesa desde el paquete 0 (barato: hasta ~72k paquetes para una canción de 4 minutos, trivial para JS en un frame).
- **`App.tsx`** — el motor de Web Audio (decodificar audio, pausa/reanudar/seek, todo lo que ya existía) ahora también corre para `sourceFormat === 'cdg'`, no solo para `playbackMode === 'overlay'` (nuevo helper `usesWebAudioEngine`). El audio sigue siendo un archivo aparte — a diferencia de `baked-video`, que trae todo adentro de un video y sigue sin implementar.

Probado de punta a punta contra el servidor real: generé un `.cdg` sintético a mano (memory preset + carga de paleta + un tile block), lo subí por `/api/songs`, confirmé que se detecta y guarda bien, que se sirve idéntico byte a byte por HTTP, y corrí el parser completo contra ese archivo verificando el framebuffer y la paleta resultantes. **Lo que no se pudo probar en este entorno**: cómo se ve realmente en un canvas de navegador (no hay herramienta de automatización de browser acá) — conviene probarlo con un archivo `.cdg` real de un karaoke comercial antes de confiar en esto para un evento en vivo.

## Lo que sigue (sin orden estricto)

1. Probar el reproductor CD+G con un archivo real de karaoke comercial (no solo el sintético usado para probar el parser) — confirmar visualmente en el navegador que se ve bien.
2. `baked-video` (video con letra ya quemada) — el otro formato "estándar" pendiente, mucho más simple que CD+G: un `<video>` que reproduce el archivo tal cual, sin Web Audio ni parser propio (el archivo ya trae todo adentro). Quedó afuera de esta tanda a propósito (se priorizó CD+G).
3. Re-pegar la letra completa de "Stitches" (falta el tramo final, ~2:29 de ~3:23) si se quiere sincronía de principio a fin — ya se puede hacer desde la app (botón "⟳" en la Biblioteca), solo falta que el usuario pegue el texto completo.
4. Empaquetado: falta correr `scripts/start-kiosk.ps1` de punta a punta y, si se quiere, registrar el arranque automático (ver sección de abajo — son cambios de sistema, no se hacen sin pedirlo explícitamente).
5. ~~Migración del catálogo legado~~ — **hecha** (2026-07-31, ver sección arriba): 7005 canciones extraídas a `repertorio/` e importadas con letra sincronizada.
6. **Fase 2 del plan original — dejada para el final a pedido del usuario:** celular + QR + sala en vivo, para que los invitados pidan canción/reaccionen/voten desde su propio teléfono en vez de que el operador cargue todo desde la única pantalla. La cola y los puntajes de esta sesión ya están modelados de forma que Fase 2 podría sumarse encima (un invitado agregándose a la misma cola) en vez de ser un sistema aparte — pero eso es diseño a futuro, no algo ya decidido.
7. **Modularizar features pesadas/opcionales, instalables aparte** (para cuando se trabaje en refinar/optimizar la app). Medido en la sesión 2026-08-20: `pipeline/.venv` + `pipeline/models/` pesan **~8.5GB** (torch+CUDA 4.5GB, librerías `nvidia-*-cu12` 2.3GB, onnxruntime-gpu 343MB, opencv 138MB, mediapipe 44MB, whisperx 17MB, demucs+deps ~20MB, `inswapper_128.onnx` 530MB) — el 92% del peso total de la app sin canciones (~8.7GB). Ese peso es un requisito de instalación fijo hoy, aunque la PC no tenga GPU NVIDIA — caso en el que el face swap del Fun Box ni siquiera es usable (CPU: 13+ min por clip, ver gotcha de `CLAUDE.md`). La idea: tratar "reconocimiento facial / face swap con IA" (y potencialmente Demucs, que también es pesado y opcional) como una feature que se descarga e instala aparte y se activa/desactiva según haga falta — no siempre incluida — así una PC sin GPU no baja ni instala nada que no va a poder usar. El resto del stack Python (WhisperX para sincronía de letra) sí puede correr en CPU (más lento, pero usable) y podría quedar como base obligatoria. Relevante también si algún día se empaqueta esto como app instalable multiplataforma (Tauri, sin depender de Windows): el pipeline Python+CUDA es la única pieza que no porta igual a todos lados (no hay CUDA en macOS), modularizarlo la desacopla de esa decisión en vez de forzar "todo o nada".

### Empaquetado (§6/§11 de `DECISIONES-STACK.md`) — en progreso esta sesión

**Hecho y probado:**
- `apps/admin` ahora tiene build de producción real (`pnpm build` → `apps/admin/dist`). Hizo falta fijar `build.target: 'es2022'` en `vite.config.ts` — sin eso, esta versión de esbuild rompe con un falso positivo en destructuring estándar (ver gotcha en `CLAUDE.md`).
- `apps/server` sirve ese build directamente (`express.static`, montado después de `/api` y `/library` para no taparlas) — `pnpm start` corre todo en un solo origen (:8080), sin Vite. Probado a mano: build, arranque en modo producción, `GET /` sirve el HTML con la marca HCK, los assets (`.js`/`.css`) cargan con 200, y `/api/songs` sigue andando. Confirmado y vuelto a dev mode después.
- `scripts/start-kiosk.ps1`: build si falta, arranca el server (`pnpm start`), espera a `/health` (con timeout), abre Chrome con los flags de `DECISIONES-STACK.md` §6 (`--kiosk --app=http://localhost:8080/ --autoplay-policy=no-user-gesture-required ...`), y al cerrar Chrome mata el server (incluso si se corta a mano). Firewall: crea la regla `KaraokeKiosk` (puerto 8080/TCP, perfil privado) si corre como administrador; si no, avisa y sigue sin fallar. Sintaxis verificada (parseo), **no se ejecutó de punta a punta** — abrir Chrome en `--kiosk` le toma la pantalla al usuario, así que hace falta que lo corra él cuando quiera probarlo.

**Pendiente (son cambios de sistema, no los hago sin que el usuario los pida explícitamente):**
- Correr `scripts/start-kiosk.ps1` una vez de punta a punta para confirmar que Chrome realmente abre en kiosco y el audio arranca con `--autoplay-policy=no-user-gesture-required` (§6 dice que es obligatorio, no debería hacer falta ni un click).
- Registrar la Tarea Programada de arranque automático — el comando exacto (`Register-ScheduledTask ...`) queda documentado al final de `scripts/start-kiosk.ps1`, pero registrarlo de verdad es una acción sobre la cuenta de Windows del usuario, no algo para hacer sin pedir permiso primero.
- Confirmar que la regla de firewall + perfil de red "Privada" están bien si alguna vez se prueba desde un celular en la misma LAN (no es necesario todavía — Fase 2 no empezó).

## Decisiones ya tomadas (no volver a discutir sin que lo pida el usuario)
Detalle completo en `DECISIONES-STACK.md`. Resumen rápido:
- Node **22.23.1** fijado en `.nvmrc` — versiones más nuevas no tenían binario precompilado de `better-sqlite3` en este entorno.
- **Una sola app (`apps/admin`, puerto 5175) hace todo**: navegación, biblioteca y reproducción real de audio en la misma pantalla — reemplaza la separación control-remoto/pantalla que existía antes (ver nota arriba).
- CD+G y videos con letra quemada van a un modo "completo" aparte (sin overlay propio, sin fondo elegible). **CD+G ya se reproduce de verdad** (parser + canvas propios, ver más arriba) y **`baked-video` también** (`<video>` nativo montado fuera del bloque de kiosco, para que alternar pantalla completa no lo remonte y corte la canción; mini-preview en backstage, pantalla entera en kiosco). Nota: el catálogo legado *no* usa este modo — resultó ser audio+letra, ver la sección de arriba.
- Sincronización automática: LRCLIB (no implementado todavía) → WhisperX (implementado) → editor manual de corrección (implementado, pero a nivel línea — "Corregir sincronía" en la barra del reproductor — no palabra por palabra como preveía el plan original; alcanza para el caso real que lo motivó). APIs pagas (Deepgram, etc.) quedaron descartadas — no hacen falta.

## Cómo levantar el proyecto
```bash
cd e:\Work
pnpm dev        # server (:8080) + admin (:5175) juntos
```
Requiere Node 22.13+ (usar `.nvmrc`). Para el generador de karaoke hace falta `uv` instalado (`pipeline/`), con torch+CUDA si hay GPU NVIDIA disponible.
