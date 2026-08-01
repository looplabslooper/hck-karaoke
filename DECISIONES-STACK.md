# Kiosco de Karaoke — Decisiones de stack

Evaluación de cada punto contra las prioridades declaradas: **offline/LAN-first**, **costo-eficiencia**,
**velocidad de desarrollo**, **máximo código compartido entre pantalla grande y celulares**.

Formato: recomendación concreta → por qué → qué se pierde → cuándo cambiarla.

---

> **Actualización 2026-07-27 — reversión explícita del usuario:** este documento originalmente
> asumía **dos apps de pantalla** (`apps/screen` para el TV/monitor del kiosco, `apps/admin` como
> control remoto que nunca reproduce audio), sincronizadas por WebSocket. El usuario pidió
> explícitamente reemplazar eso por **una sola pantalla**: navegación, biblioteca, letra y modo
> pantalla completa, todo en una misma app (`apps/admin`, ahora la única app de frontend además del
> futuro `apps/mobile`). `apps/screen` fue eliminada del repo. El razonamiento de abajo sobre *por qué*
> se había elegido la separación se deja intacto (es útil si el proyecto algún día vuelve a necesitar
> multi-pantalla — varias TVs, por ejemplo) pero **ya no aplica como decisión vigente**; ver
> `ROADMAP.md` para el detalle de qué cambió en el código. No la vuelvas a proponer como si estuviera
> vigente.

## Resumen ejecutivo (las 5 decisiones que importan)

1. **Un solo monorepo TypeScript**: Node 22 LTS + React + Vite. Las tres superficies (pantalla, admin, celular) son la misma app con tres entradas y un paquete `shared` con el protocolo y el motor de karaoke.
2. **El micrófono NO pasa por el software.** Va por hardware (mixer o interfaz de audio con monitoreo directo). Es la decisión que más riesgo elimina del proyecto — ver §7.
3. **La letra se renderiza con DOM + CSS `background-clip: text`**, no Canvas. Menos código, tipografía y acentos gratis, 60 fps. Canvas solo si después querés efectos por letra con física.
4. **El pipeline de sincronía es local y gratis**: Demucs (separar voz) → WhisperX (alineación forzada con la letra real) → editor manual de tap-to-sync en el admin. La API paga es un plugin opcional que probablemente nunca uses. El dinero no compra confiabilidad acá; el editor manual sí.
5. **Nada de PWA instalable en el celular.** Sobre `http://192.168.x.x` el navegador no da contexto seguro: no hay service worker, no hay install prompt, no hay `getUserMedia`. Es una web responsive común y funciona perfecto — ver §9.

---

## 1. Runtime / lenguaje de backend

**Recomendación: Node 22 LTS + TypeScript.** (Cambia la decisión tentativa de Bun.)

Por qué:
- Todo el proyecto es "una sola PC con Windows, en una fiesta, sin internet para buscar el fix". Bun en Windows sigue siendo su plataforma más débil, y un bug raro a las 2 AM cuesta la noche entera.
- El pipeline de letras necesita lanzar procesos externos: `ffmpeg`, Python (Demucs, WhisperX). `child_process` en Windows, con rutas con espacios, encoding de consola y señales, está mucho mejor pisado en Node.
- `better-sqlite3` tiene prebuilds confiables para Windows/Node. En otros runtimes vas a compilar o depender de bindings menos probados.
- Herramientas de arranque/servicio en Windows asumen Node.

Qué se pierde vs Bun: arranque más lento (irrelevante, es un proceso persistente), y `bun build --compile` que te da un `.exe` de un archivo. Ese último punto es real y atractivo — pero se resuelve mejor con Tauri en la fase 2 (§11).

Descartados:
- **Go / Rust**: cero código compartido con el frontend, que es una prioridad explícita. El backend acá es CRUD + WebSocket; no necesita su performance.
- **.NET 8 (C#)**: solo gana si vas a motor de audio nativo con ManagedBass. No vas (§6). Si no, es partir el proyecto en dos lenguajes sin beneficio.
- **Python**: el pipeline ML es Python, sí — pero eso corre como subproceso/CLI, no como servidor. Servidor en Python te da peor packaging en Windows y peor realtime.

**Cambiala si**: querés distribuir a terceros y priorizás el binario único por sobre todo → Bun. Si vas a Tauri igual, no aplica.

---

## 2. Base de datos

**Recomendación: SQLite embebida (archivo local), modo WAL, vía `better-sqlite3`.** Confirma tu decisión tentativa.

- Una sola PC, un solo proceso, ~30 clientes: SQLite está sobrado por dos órdenes de magnitud.
- `better-sqlite3` es **síncrono**, lo cual acá es una ventaja: sin `await` en cada query, sin pool, sin race conditions raras en la cola.
- Activá `PRAGMA journal_mode=WAL` y `PRAGMA synchronous=NORMAL`.

**Regla importante**: la base guarda *metadata* (catálogo, cola, sesiones, puntajes, log de reacciones). El audio y el JSON de letra viven en disco (`library/<songId>/audio.opus`, `lyrics.json`) y la DB guarda la ruta. Nunca blobs de audio en SQLite — te rompe el backup, el WAL y la memoria.

Descartado: **PostgreSQL** — un servicio más que arrancar, actualizar y que puede no levantar la noche del evento. Cero beneficio en single-node.

---

## 3. ORM / capa de datos

**Recomendación: Drizzle + drizzle-kit.** Confirma tu decisión tentativa.

- Tipado derivado del schema sin codegen en runtime, migraciones en SQL plano que podés leer, y se integra directo con `better-sqlite3`.
- Sin binario de engine externo: importa para empaquetar el kiosco después (Prisma arrastra un engine nativo por plataforma, que es fricción real en un instalador).

Alternativa legítima: **Kysely** si preferís query-builder puro y escribir el schema a mano. Es igual de válido; no vale la pena cambiar.

Descartados: **Prisma** (peso de packaging, capa de abstracción que no necesitás en SQLite), **SQL crudo** (lo vas a querer para 2-3 queries de la cola; usá `db.run(sql\`...\`)` de Drizzle para esos casos puntuales y listo).

---

## 4. Comunicación en tiempo real

**Recomendación: WebSocket nativo (`ws`) self-hosted, con un envelope de mensajes tipado compartido entre cliente y servidor.**

Diseño concreto:
```ts
// packages/shared/protocol.ts
type ServerMsg =
  | { t: 'snapshot'; queue: QueueItem[]; now: NowPlaying | null; ... }
  | { t: 'queue.changed'; queue: QueueItem[] }
  | { t: 'reaction'; kind: ReactionKind; from: string }
  | { t: 'score.updated'; ... }
type ClientMsg =
  | { t: 'join'; room: string; name: string; clientId: string }
  | { t: 'request'; songId: string }
  | { t: 'react'; kind: ReactionKind }
  | { t: 'rate'; value: number }
```

Reglas que hacen que esto no falle en una fiesta:
- **Snapshot al conectar y al reconectar.** El servidor manda el estado completo en `join`. Nunca dependas de haber recibido todos los deltas — los celulares se van a dormir, cambiar de red y volver.
- **Heartbeat + backoff exponencial** en el cliente (~30 líneas). Ping cada 20s, si no hay pong en 10s cerrás y reconectás con jitter.
- **`clientId` persistido en `localStorage`**, no en memoria: si el celular recarga, sigue siendo la misma persona en la cola (crítico para el round-robin de §Cola).
- **La pantalla grande NO usa el WS para el timing de la reproducción.** Recibe la canción + el JSON de letra y reproduce con su propio reloj de audio. El WS solo empuja eventos de cola/reacciones/control. Así un hipo de red nunca traba el karaoke. Esto es lo que hace que "no importa el delay del celular" y "la pantalla se siente en vivo" sean compatibles.
- **Rate-limit de reacciones** por cliente (ej. 5/seg) y **coalescing en el servidor** a ~10 Hz antes de emitir al screen. Sin esto, 20 personas apretando el corazón te saturan el render.

Descartados:
- **Socket.IO**: te regala reconexión y rooms, que es tentador. Pero suma protocolo propio, cliente más pesado y fallbacks HTTP que no necesitás en LAN. Las ~30 líneas de reconexión valen menos que la simplicidad. *Si no querés escribirlas, Socket.IO es una elección defendible — no es un error.*
- **SSE**: unidireccional (necesitás cliente→servidor igual), y sobre HTTP/1.1 sin TLS tenés el límite de 6 conexiones por origen en el navegador.

---

## 5. Framework de frontend

**Recomendación: React 19 + Vite + TypeScript, un monorepo con pnpm workspaces y tres entradas.**

```
apps/screen    → pantalla grande (kiosco)
apps/admin     → panel de administrador
apps/mobile    → web de los invitados
apps/server    → Node + ws + Drizzle
packages/shared → protocolo WS, tipos de dominio, cliente WS, motor de letra
```

Por qué React: ecosistema más grande, mejor asistencia de IA para código (importa para velocidad de desarrollo), y el argumento de performance de Svelte/Solid es **nulo acá** porque el camino caliente es el render de la letra a 60 fps, que no pasa por el framework en ninguno de los casos.

**Svelte 5 es igual de válido** si te resulta más cómodo: menos boilerplate, mismo nivel de código compartido. Nada en este diseño depende de la elección. Elegí uno y no lo revisites.

Descartados: **vanilla JS** (el panel admin tiene suficiente estado como para que duela), **Solid** (ecosistema chico sin beneficio compensatorio acá).

---

## 6. Motor de la pantalla grande

**Recomendación: fase 1, Chromium en modo kiosco. Fase 2 (cuando quieras un instalador), Tauri v2.**

Fase 1 — launcher concreto:
```bat
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --app=http://localhost:8080/screen ^
  --user-data-dir="%LOCALAPPDATA%\KaraokeKiosk\chrome-profile" ^
  --autoplay-policy=no-user-gesture-required ^
  --disable-session-crashed-bubble ^
  --disable-infobars ^
  --noerrdialogs ^
  --use-angle=d3d11
```
- `--autoplay-policy=no-user-gesture-required` es **obligatorio**: sin eso el `AudioContext` arranca suspendido y no reproduce hasta un click.
- Perfil dedicado (`--user-data-dir`) para que no te aparezcan pestañas restauradas, extensiones ni el diálogo de "Chrome no se cerró correctamente".

Fase 2 — **Tauri v2**: instalador único, control de ventana, acceso a filesystem, ícono en bandeja, y el servidor Node corre como *sidecar*. Usa WebView2 (Edge Chromium), o sea ~10 MB y las mismas APIs web. Riesgo a verificar cuando llegues: diferencias de códecs y Web Audio entre Chrome y WebView2 (mp3/aac están OK; probá tu track de pitch-shift antes de comprometerte).

Descartados:
- **Electron**: 150+ MB y no necesitás Node en el renderer. Tauri hace lo mismo mejor para este caso.
- **.NET 8 + WPF + ManagedBass**: motor de audio superior, sí, pero tirás a la basura el 100% del código compartido con los celulares y duplicás el render de letra. Contradice la prioridad explícita.
- **Godot**: excelente para el render, pésimo para servir una web a celulares y gestionar un catálogo. Herramienta equivocada.

---

## 7. Audio: reproducción, tono y tempo — y el micrófono

### 7a. El micrófono (leer esto primero)

**Recomendación: el micrófono NO entra al software. Ruteo por hardware.**

Cantante → micrófono → mixer (o interfaz USB con monitoreo directo) → parlantes.
La PC manda la pista al mismo mixer por su salida de audio. El mixer suma. Fin.

Por qué esto es innegociable: el monitoreo de voz por navegador (`getUserMedia` → Web Audio → salida) tiene latencia de ida y vuelta de decenas a más de cien milisegundos en Windows con drivers genéricos. Por encima de ~15 ms cantar se vuelve físicamente incómodo; a 60+ es imposible. Ni Web Audio, ni WASAPI compartido, ni BASS lo arreglan sin ASIO y una interfaz decente — momento en el cual ya tenés el hardware que resuelve el problema sin software.

Beneficio secundario: el volumen y el eco/reverb del micrófono los maneja quien opera el mixer, sin tocar el sistema. Y si el software se cuelga, el micrófono sigue sonando.

**Si más adelante querés grabar la performance**, ahí sí capturás el mic por software (la latencia de grabación no importa) — pero el monitoreo en vivo sigue siendo por hardware.

### 7b. Reproducción y timing

**Recomendación: Web Audio API con el track decodificado completo a `AudioBuffer`.**

- Decodificá el archivo entero con `decodeAudioData` antes de empezar (4 min ≈ 40 MB de PCM en RAM — trivial).
- **El reloj maestro es `AudioContext.currentTime`**, nunca `<audio>.currentTime` (que es grueso y con jitter) ni `Date.now()` ni `setInterval`. Toda la sincronía de letra cuelga de ahí.
- Precargá la canción siguiente de la cola mientras suena la actual: cero silencio entre temas.

### 7c. Cambio de tono / tempo

**Recomendación: `signalsmith-stretch` (WASM, licencia permisiva) en un `AudioWorklet`. Alternativa segura: `SoundTouchJS`.**

- SoundTouchJS es el clásico: MIT, mucho uso, calidad aceptable; se nota artefacto metálico en shifts grandes (>±3 semitonos).
- signalsmith-stretch da notablemente mejor calidad con licencia permisiva. Verificá la licencia exacta de la versión que instales antes de comprometerte.
- **Rubberband (`rubberband-web`)** es el mejor en calidad, pero es GPL/dual-comercial. Para uso privado no comercial el GPL es aceptable; si algún día distribuís, contamina. Dado que ya declaraste uso no comercial, es viable — pero preferí lo permisivo si la calidad alcanza.

**Detalle de implementación**: con pitch-shift en un AudioWorklet, la posición de reproducción ya no es `currentTime - startTime`. Contá los *frames procesados* por el worklet y publicá esa posición al hilo principal; el render de letra debe leer esa posición, no la del contexto. Si no, la letra se desincroniza en cuanto tocás el tempo.

---

## 8. Renderizado del efecto de letra

**Recomendación: DOM + CSS con `background-clip: text`, manejado por `requestAnimationFrame`.** (Cambia el supuesto de que Canvas es lo obvio.)

La técnica:
```css
.word {
  background: linear-gradient(90deg, var(--sung) 0%, var(--sung) var(--p),
                              var(--unsung) var(--p), var(--unsung) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```
En cada frame, para la palabra activa: `--p = clamp(0, (t - w.start) / (w.end - w.start), 1) * 100%`. Eso es el barrido clásico de CD+G, y son ~20 líneas.

Por qué DOM/CSS gana acá:
- Tipografía real: acentos, ñ, ligaduras, kerning, **wrapping automático** de líneas largas. En Canvas todo eso lo escribís vos y se ve peor.
- Contorno y sombra (`paint-order: stroke fill`, `text-shadow`) sin esfuerzo, que es exactamente el look de karaoke sobre video.
- Sin manejo manual de DPI ni texto borroso en pantallas 4K.
- Compuesto por GPU; el costo por frame es actualizar una custom property en 1-2 elementos.

Qué se pierde: efectos por letra con física (rebote, partículas por sílaba), gradientes animados complejos. Si algún día los querés, **ahí** migrás la línea activa a Canvas 2D o WebGL — el JSON de timestamps no cambia, solo el renderer.

**Regla dura**: el render lee la posición de audio (§7c) en cada `rAF`. Nunca `setTimeout` por palabra, nunca animaciones CSS con `duration` — se desfasan al primer stutter y no se pueden buscar/pausar.

Estructura del JSON de letra (formato interno, confirma tu decisión):
```json
{ "lines": [
    { "start": 12.40, "end": 16.85,
      "words": [ { "t": "Nunca", "start": 12.40, "end": 12.86 }, ... ] } ] }
```
Simple, versionable, editable a mano, y traducible desde y hacia LRC/ASS si hace falta.

---

## 9. App de celular

**Recomendación: misma app React del monorepo, entrada `apps/mobile`, web responsive común. NO persigas PWA instalable.**

El motivo es técnico y decisivo: los celulares se conectan a `http://192.168.x.x:8080`, que **no es un contexto seguro**. Eso significa que el navegador bloquea:
- Service Workers → sin caché offline propia, sin instalación
- El prompt de "Agregar a pantalla de inicio" (en Chrome; iOS lo permite manualmente pero sin SW no aporta nada)
- `getUserMedia`, notificaciones, etc.

No lo necesitás: la web se sirve desde la misma LAN a la que el celular ya está conectado, y `ws://` funciona sin problema sobre http. Un manifest con íconos y `theme-color` es gratis y suma; el service worker, no.

**Evitá la trampa de HTTPS**: conseguir contexto seguro en LAN requiere certificado válido para una IP privada → CA propia instalada en cada celular → inviable en una fiesta. No vayas por ahí.

### Trampas de red que sí te van a morder

Estas son la causa #1 de "funcionaba en mi máquina":
1. **Firewall de Windows**: la primera vez, Windows bloquea el puerto entrante. El launcher debe crear la regla:
   `netsh advfirewall firewall add rule name="KaraokeKiosk" dir=in action=allow protocol=TCP localport=8080 profile=private`
   Y el perfil de la red WiFi tiene que ser **Privada**, no Pública.
2. **Aislamiento de clientes (AP isolation)** en el router: si está activo, los celulares no ven a la PC. Hay que desactivarlo. Verificalo *antes* del evento.
3. **Adaptadores virtuales**: Hyper-V, WSL, VirtualBox y VPNs crean interfaces con IPs que no son la de la LAN. Ver §10.
4. Android puede mostrar "red sin internet" y saltar a datos móviles. Los invitados deben quedarse en la WiFi. Un cartel al lado del QR ahorra explicaciones.

---

## 10. Generación de QR

**Recomendación: librería en el cliente (`qrcode` o `qr-code-styling`), pero la IP la resuelve el servidor.**

El QR en sí es trivial. El problema real es **saber qué URL codificar**. En Windows, `os.networkInterfaces()` te va a devolver varias IPv4 no-internas: la LAN real, la de Hyper-V (`172.x`), la de WSL, la de la VPN.

Diseño:
- Endpoint `GET /api/network` que devuelve todas las candidatas IPv4 no-loopback con nombre de adaptador, ordenadas por heurística (preferí `192.168.*`, descartá adaptadores con "Hyper-V", "vEthernet", "VirtualBox", "TAP", "WSL" en el nombre).
- El **admin muestra un selector** con la elegida por defecto y las alternativas. Un click resuelve el caso raro sin tocar código.
- La URL codificada incluye el código de sala: `http://192.168.1.50:8080/j/A7K2`.
- **Mostrá siempre el código corto en texto grande junto al QR.** Cámaras que no leen, gente sin cámara, links que no abren: el fallback de tipear la URL + código salva la noche.
- Mostrá el QR en la pantalla grande (esquina, o pleno durante los intervalos) *y* dejá que el admin lo imprima.

---

## 11. Empaquetado y arranque del kiosco

**Recomendación fase 1: launcher script + Tarea Programada al iniciar sesión. Fase 2: instalador Tauri con el servidor como sidecar y ícono en bandeja.**

**Descartá el Servicio de Windows.** Razón concreta: desde Windows Vista los servicios corren en la **Sesión 0**, aislada de la sesión del usuario. No tienen acceso al dispositivo de audio ni pueden mostrar UI. Un servicio no puede reproducir el karaoke. Punto.

Secuencia del launcher (PowerShell):
1. Asegurar la regla de firewall (§9).
2. Arrancar el servidor Node como proceso hijo, log a archivo.
3. Poll a `http://localhost:8080/health` hasta OK (con timeout).
4. Lanzar Chrome en kiosco (§6).
5. Al cerrar Chrome, matar el servidor.

Registralo en el Programador de tareas con disparador *"Al iniciar sesión"* del usuario del kiosco, con "Ejecutar solo si el usuario inició sesión". Configurá inicio de sesión automático en esa cuenta si querés arranque de cero a karaoke.

---

## 12. Pipeline de sincronización de letras

**Este es el punto donde tu plan tentativo necesita más cambios.** Recomendación:

```
[audio original] 
      │
      ├─(A) ¿Hay LRC/LRCLIB para esta canción?  ── sí ─→ nivel línea → interpolar palabras
      │                                                    (rápido, gratis, calidad aceptable)
      ├─(B) Demucs: separar stem vocal
      │        └─→ además te genera el instrumental para reproducir
      ├─(C) WhisperX align: alineación forzada del stem vocal contra la letra que pegaste
      │        └─→ timestamps por palabra, local, gratis
      └─(D) Editor manual tap-to-sync en el admin  ←── fallback garantizado
```

### (A) LRCLIB — gratis, pero ojo
Devuelve LRC **a nivel de línea**, no de palabra. Para tu requisito de "siempre palabra por palabra", hay que interpolar dentro de cada línea repartiendo el tiempo proporcional a la longitud en caracteres de cada palabra. Se ve razonablemente bien y es lo que hacen muchas apps. Requiere internet → **descargá y cacheá al agregar la canción, nunca durante el evento**.

### (B) Demucs — el paso que falta en tu plan
Es crítico y no estaba contemplado:
- Si tu fuente es la **canción original con voz**, alinear sobre la mezcla completa da resultados mediocres. Separá el stem vocal primero y la alineación mejora muchísimo.
- Bonus enorme: Demucs te devuelve también el **instrumental**, que es literalmente la pista de karaoke. Resolvés "generar karaoke desde un mp3 cualquiera" con la misma herramienta.
- Si tu fuente ya es un **instrumental sin voz**, la alineación automática es imposible por definición. Solo queda (A) o (D). El sistema tiene que detectar y avisar esto, no fallar en silencio.
- Costo: ~1-3 min por canción en CPU, segundos en GPU. Una sola vez.

### (C) WhisperX en lugar de aeneas
- **aeneas**: herencia de Python 2, instalación dolorosa en Windows (necesita espeak + compilación), y alinea a nivel de *fragmento*, no de palabra. No sirve para tu requisito.
- **WhisperX**: la etapa `align()` hace exactamente lo que necesitás — alineación forzada de un texto conocido contra el audio, con wav2vec2, salida **por palabra**. Como ya tenés la letra correcta (la pegás en el admin), no dependés de la calidad de transcripción. Gratis, local, offline después de bajar los modelos. Con GPU, muy por encima de tiempo real; en CPU, del orden del tiempo real.
- Alternativa: **Montreal Forced Aligner** — más preciso en fonética, más pesado de instalar. WhisperX primero.

### (D) Editor manual tap-to-sync — construilo
Un día de trabajo: la letra en pantalla, reproducís el audio, apretás espacio en cada palabra, ajustás arrastrando. **Esto es lo que realmente garantiza tu requisito de "siempre palabra por palabra"**, no una API. Además te sirve para corregir los 3-4 desfasajes que deje el alineador automático en cada canción, que siempre los hay.

### APIs pagas: la conclusión es que no las necesitás
- Números de referencia (orden de magnitud, **verificá precios actuales**): Deepgram ronda los ~US$0.004/min y AssemblyAI está en el mismo orden. Una canción de 4 minutos cuesta **centavos**. El costo no es el problema.
- El problema es otro: **el ASR te da las palabras que *escuchó*, no las que pegaste**. Necesitás un paso extra de alineación de secuencias (Needleman-Wunsch o `difflib`) para transferir los timestamps del transcript a la letra real. Ese pegamento hay que escribirlo igual, y con nombres propios o letras en spanglish falla.
- Y encima requiere internet.

**Veredicto**: dejá una interfaz `LyricAligner` con implementaciones intercambiables y escribí `WhisperXAligner` + `LrclibProvider` + el editor manual. `DeepgramAligner` queda como plugin de 100 líneas por si algún día te sirve. No gastes plata donde el path gratis corre una sola vez por canción, offline, en la misma máquina.

**Empaquetado del pipeline Python**: usá `uv` para el entorno (rapidísimo, reproducible) y llamalo por CLI desde Node. No mezcles Python en el proceso del servidor.

---

## 13. Entorno de ejecución del backend

**Recomendación: proceso local en la sesión del usuario, hijo del launcher (§11). Fase 2: sidecar de Tauri con ícono en bandeja.**

**Descartá Docker.** Razones concretas para este caso:
- En Windows implica una VM (WSL2). El NAT de esa VM **rompe el descubrimiento en LAN**: los celulares no llegan al contenedor sin port-forwarding manual, y la detección de IP de §10 devuelve basura.
- Pasar la GPU a WhisperX a través de Docker Desktop en Windows es una pelea innecesaria.
- Sumás Docker Desktop como dependencia de arranque en una máquina que tiene que prender y andar.

Única excepción defendible: aislar el pipeline Python. Incluso ahí, un venv con `uv` es más simple y más rápido.

---

## Puntos transversales que no estaban en la lista pero necesitás decidir

### Cola justa (round-robin) — algoritmo concreto

No hace falta nada exótico. A cada pedido asignale un `round`:

```
round(pedido) = cantidad de pedidos previos del mismo solicitante en esta sesión
orden = ORDER BY round ASC, requestedAt ASC
```

- Ana pide 3 temas seguidos → rounds 0, 1, 2.
- Llega Beto y pide 1 → round 0, y **se ubica automáticamente después del primero de Ana y antes del segundo**.
- Es estable, no necesita rebalanceo, y se calcula con una sola query.
- Agregá un flag `pinned` + posición manual para que el admin pueda forzar un orden (cumpleañero, alguien que se va). El sort respeta los pinned y acomoda el resto alrededor.
- La identidad del solicitante viene del `clientId` de `localStorage` (§4), no del nombre — si no, dos "Juan" se pisan y recargar la página te deja hacer trampa.

### Marcado de disponibilidad
Campo `available: boolean` en la canción (y `unavailableReason`). El repertorio en el celular filtra por `available = true`. Necesitás también `hasLyrics` / `syncQuality` para no poner en cola algo que todavía no terminó de procesar.

### Puntajes
Dos fuentes distintas, no las mezcles en un solo número sin explicar: puntaje del admin (discreto, manual) y promedio de la audiencia. Guardá ambos. Mostrá el ranking al final de la noche — es lo que hace que la gente se enganche.

### Reacciones en overlay
- Rate-limit por cliente + coalescing a ~10 Hz en el servidor (§4).
- Tope duro de sprites concurrentes en pantalla (ej. 40) con descarte de los más viejos. Sin eso, un pico de reacciones te tira los fps justo en el estribillo.
- Animación CSS con `transform` y `opacity` únicamente (compuestas por GPU), elementos reciclados desde un pool.

### Video de fondo
`<video loop muted playsinline>` detrás de la letra, con `object-fit: cover`. Silenciado siempre — el audio sale por Web Audio. Tené 3-4 loops cortos en H.264 y rotalos. Verificá que el decode de video + el AudioWorklet de pitch conviven sin glitches en la PC real, temprano.

### Formato de audio de la biblioteca
Guardá **Opus** (o mp3 si querés máxima compatibilidad de herramientas). Opus a 96-128 kbps es transparente para karaoke y ocupa la mitad. WebView2 y Chrome lo decodifican sin problema.

### Nota legal
Grabaciones y letras están bajo derecho de autor. Esto es un sistema para uso privado no comercial, que es el marco que declaraste — solo dejalo asentado por escrito en el README y no lo publiques como servicio.

---

## Orden de construcción sugerido

1. **Esqueleto end-to-end con una canción hardcodeada**: servidor + WS + pantalla que reproduce audio y pinta la letra desde un JSON hecho a mano. Esto valida lo más riesgoso (timing, render) en el día 1.
2. **Celular + QR + cola**: unirse, ver el repertorio, pedir, round-robin.
3. **Panel admin**: control de reproducción, reordenar cola, disponibilidad, puntaje.
4. **Reacciones + overlay**.
5. **Pipeline de letras**: LRCLIB → WhisperX → editor manual. Es la parte más grande; hacela cuando el resto ya funciona.
6. **Empaquetado**: launcher, firewall, tarea programada. Después, Tauri si querés instalador.

**Prueba de campo obligatoria antes del primer evento real**: la PC destino, el router destino, 4-5 celulares distintos (Android e iOS), el mixer conectado. Los problemas de §9 solo aparecen ahí.
