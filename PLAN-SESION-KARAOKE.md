# Plan — Sesión de karaoke de punta a punta

Rework completo del flujo de sesión: desde que el admin abre el kiosco hasta que se muestra la
tabla de posiciones al final de la noche. Este documento cubre **todas las etapas definidas hasta
hoy**.

| Etapa | Alcance | Estado |
|---|---|---|
| 1 | Armado guiado: estados de sesión, wizard de cantantes, calibrador de óvalo, refinamiento transversal | ✅ Hecha y verificada |
| 2 | El show: turnos alternados, puntaje en vivo, cierre con resultados | ✅ Hecha y verificada |
| — | Deuda conocida y fuera de alcance | 📋 Documentada, no se ejecuta |

---

## Contexto

El pedido nace de una fricción concreta y reportada: *"al iniciar una sesión no me deja colocar
quién canta primero"*. Investigándolo resultó no ser un bug puntual sino la **ausencia del flujo
entero**. Iniciar una sesión solo insertaba una fila en `sessions`; la pantalla de Sesión quedaba
con "Nadie está cantando todavía" y "No hay nadie en espera", y el único camino para encolar a
alguien era irse a Biblioteca y tocar "+ Cola" canción por canción, sin que nada lo sugiriera.

El objetivo, en palabras del usuario: que armar y correr una sesión sea **sin fricción, con los
mejores controles, intuitivo, fácil y estético**, y que el resultado sea *"una versión estable y
presentable de la app, refinada"* — no un resultado rápido y fugaz. Eso último es una restricción
de diseño, no un adorno: prioriza terminar bien cada pieza sobre cubrir más superficie.

### El flujo objetivo, como lo describió el usuario

1. El admin abre el kiosco y carga sus canciones.
2. Inicia una sesión. Tiene que haber un botón evidente, en todas las pantallas, para iniciar una
   sesión **o volver a la que está en curso** si navegó a otro lado.
3. La sesión pide y permite cargar cantantes: nombre y, opcionalmente, foto.
4. Al cargar la foto, un óvalo que se puede **arrastrar y redimensionar sobre la misma imagen**,
   sin deformarse, con manijas en una caja — no solo sliders sueltos.
5. Cargado el cantante, la plataforma pregunta qué canciones tiene para él: una selección rápida.
6. Después pregunta si suma otro cantante (repite) o si arranca.
7. Si arranca con uno solo, avisa y deja elegir entre sumar otro o arrancar igual.
8. Al arrancar, una pantalla de carga donde las caras de los cantantes se sincronizan con los
   videos de template, para que el hotkey funcione sin demora.
9. Durante el show, las canciones **se alternan entre cantantes**, uno después del otro. El admin
   puede cambiar el orden. Al terminar cada canción arranca el siguiente. Es toggleable.
10. Durante cada canción se le asigna un puntaje al cantante, que se acumula **por canción**.
11. La tabla de posiciones se muestra **al finalizar la sesión, no antes**.
12. Si un cantante tiene más canciones que otro, se avisa que hay desventaja, y se puede cargar más
    canciones o usar el promedio igual.

---

## Decisiones cerradas (no reabrir)

Tomadas con el usuario a lo largo de la conversación. Están acá para no volver a discutirlas.

- **Puntaje: un valor por canción, editable.** Se mantiene la columna `score` que ya existe. El
  usuario dijo "por el momento solo el admin"; cuando haya varios votantes se migra a una tabla de
  votos, no antes.
- **Dos etapas con prueba en el medio**, en vez de una sola pasada grande. El armado primero
  (que es donde estaba la fricción), el show después.
- **Orden de turnos: orden de carga de los cantantes**, ajustable con las flechas ▲▼ que la cola ya
  tiene. Sin UI nueva para elegir quién abre.
- **El plan vive en el repo** como documento propio y commiteable.
- **La arquitectura de pantalla completa no se toca.** Sigue con `kioskMode` + Fullscreen API sobre
  el documento entero; cambiar eso arriesga reintroducir el bug de remontaje de `<video>` ya
  documentado en `CLAUDE.md`.
- **Sin historial de sesiones.** La sesión sigue siendo efímera. Los resultados se muestran con los
  datos vivos, antes de borrar, así no hace falta tabla nueva.

---

## Etapa 1 — Armado guiado ✅

Hecha, con typecheck limpio en los tres paquetes, 23 tests pasando, migración aplicada y humo de
API end-to-end.

### 1.1 Máquina de estados de la sesión

`sessions` tenía **solo** `id` + `startedAt`: "activa" significaba "existe una fila", sin ninguna
noción de armado vs corriendo.

- `sessions.status`: `'armando' | 'corriendo'`, `notNull().default('armando')`. Migración `0011`,
  un `ALTER TABLE ADD` puro sin prompt interactivo.
- `SessionStatus` y `Session.status` en `packages/shared/src/domain.ts`.
- `createSession` arranca en `'armando'`; `beginSession` pasa a `'corriendo'`.
- `POST /api/sessions/begin` valida **del lado del server** (no solo en la UI) que haya al menos un
  cantante y una canción encolada, para que la sesión nunca quede en vivo sin nadie a quien llamar.
- El estado se persiste a propósito: recargar la pantalla en pleno armado no pierde el contexto.

### 1.2 Control de sesión evidente y siempre presente

El cuadro del sidebar pasó de cartel pasivo a punto de entrada único. Como el sidebar es
persistente, está en todas las pantallas sin duplicar controles.

- **Sin sesión** → botón primario "Iniciar sesión", que crea la sesión, navega a Sesión y abre el
  wizard.
- **Armando** → punto ámbar, "Armando sesión", conteo de cantantes y de la cola, clickeable para
  volver, más "Seguir armando".
- **En curso** → punto verde, "En vivo", clickeable para volver desde cualquier pantalla.
- La página de Sesión sin sesión activa muestra un llamado a la acción en vez de paneles vacíos, y
  con la sesión en armado muestra una banda ámbar con "Seguir armando".

### 1.3 Armado guiado — `apps/admin/src/SessionSetupWizard.tsx`

Modal por pasos: **cantante → sus canciones → ¿otro o arrancamos?**

- Paso cantante: reusa `SingerPicker` (nombre, foto por cámara o archivo, óvalo).
- Paso canciones: buscador con debounce contra `GET /api/songs?q=`, selección múltiple, y encolado
  en una sola llamada con **`POST /api/queue/batch`** nuevo (`addSongsToQueue`, misma transacción y
  criterio de posiciones que `addPlaylistToQueue`). Se puede saltear con "Después le cargo".
- Paso resumen: roster con cuántas canciones tiene cada uno (`GET /api/queue/counts` nuevo), aviso
  de quiénes están sin canciones, y las dos salidas.
- Guardas: sin canciones no deja comenzar y explica por qué; con un solo cantante muestra el paso
  de advertencia con "Agregar otro" / "Comenzar igual".
- **Pantalla de sincronización** con progreso real: espera las promesas de `loadFaceCutout` de cada
  foto y descarga los videos de template **de a uno** (en paralelo saturan el límite de conexiones
  por origen — es exactamente el bug que dejaba el template colgado en el primer frame). Recién
  después llama a `/api/sessions/begin`.
- El botón "Registrar cantante" abre este mismo wizard: se eliminó el modal suelto que registraba
  un cantante sin canciones y sin decir qué seguía.

### 1.4 Calibrador de óvalo — `apps/admin/src/OvalCalibrator.tsx`

Antes era un canvas con click-para-mover y un slider de tamaño. Ahora:

- La foto va como `<img>` y el óvalo es una capa DOM encima: hit-testing y estilado gratis por CSS,
  y el canvas queda solo para el preview compuesto.
- **Arrastrar el óvalo** para moverlo; **arrastrar las manijas** de las cuatro esquinas para
  escalar, con la esquina opuesta de ancla.
- **No se puede deformar por construcción**: lo único que cambia al escalar es un `scale` escalar, y
  los semiejes salen siempre de `AXIS_RATIO_X/Y`, la misma proporción que usa el compositor en vivo.
- Pointer Events con `setPointerCapture` y emisión de un valor por frame (`requestAnimationFrame`).
  Es el primer drag de la app; queda encapsulado, sin librerías.
- Lo que queda fuera del óvalo se oscurece con el truco de `box-shadow` gigante sobre un
  `border-radius: 50%`, así el recorte se lee de un vistazo. Al lado, el preview "así se ve en el
  escenario" se recompone en vivo mientras se arrastra.
- El slider desapareció.

### 1.5 Refinamiento transversal

- **Escape cierra los modales** — ninguno lo manejaba; la única salida era el click en el fondo.
- **Los atajos globales se pausan con un modal abierto**, para que la barra espaciadora no dispare
  play/pausa mientras se completa un formulario.
- Transiciones de entrada de modales con `backdrop-filter`, respetando `prefers-reduced-motion`.

### 1.6 Dos bugs reales encontrados de paso

- **`songColor` exportado desde `App.tsx` rompía el Fast Refresh de Vite.** Cada edición de
  `App.tsx` forzaba una recarga completa de la página en vez de un hot update
  ("Could not Fast Refresh — export is incompatible"). Movido a `apps/admin/src/songColor.ts`.
- **`.modal-actions` no tenía ninguna regla CSS.** Dos modales tenían su fila de botones sin
  estilar. Unificado a `.step-actions`.

---

## Etapa 2 — El show ✅

Hecha y verificada. Sin migración: no cambió el esquema.

### Estado actual verificado en código

- `listQueue` (`queries.ts:383`) trae `queued`+`playing` por `position` y en JS pone el `playing`
  primero. `advanceQueue` (`:524`) pasa el `playing` a `done` y sube el `queued` de menor posición.
- `moveQueueItem` (`:496`) intercambia posiciones con el vecino `queued`. Se conserva tal cual.
- `addToQueue` / `addSongsToQueue` appendean con `max(position WHERE status='queued') + 1`.
- `scoreQueueItem` (`:546`) exige `status='done'`.
- `getLeaderboard` (`:670`) filtra `status='done' AND score IS NOT NULL`: **un cantante sin ninguna
  canción puntuada no aparece**, y `songsScored` cuenta solo las puntuadas.
- `countQueuedSongsBySinger` (Etapa 1) cuenta **todas** las canciones por cantante sin importar el
  estado — es el dato correcto para la advertencia de desventaja.
- Ya existen y funcionan: `handleScoreItem`, `handleMoveQueueItem`, `handleAdvanceQueue`,
  `autoAdvance` + `handleSongEnded` + cuenta regresiva, y `refreshQueue` que trae cola,
  no-puntuadas, leaderboard y conteos de una sola vez.

### 2.1 Turnos alternados

**`interleaveQueue()`** nuevo en `apps/server/src/db/queries.ts`:

- Lee los `queued` por `position`, los agrupa por `singerId` **respetando el orden de aparición**
  (que después del wizard es el orden de carga de los cantantes) y los reparte round-robin:
  `A1, B1, C1, A2, B2, A3`.
- Reescribe `position` 0..n-1 en una transacción. No toca `playing` ni `done`. Deja las posiciones
  densas, así el append siguiente (`max+1`) sigue siendo correcto.

Se invoca en dos lugares, nunca solo:

- `POST /api/sessions/begin`, antes de pasar a `corriendo`, para que el show arranque alternado.
- **`POST /api/queue/interleave`** (nuevo), detrás de un botón "Alternar turnos" en la página de
  Sesión, para cuando se sumaron canciones en vivo y la cola quedó despareja.

El reordenamiento manual del admin manda: **nunca se re-intercala automáticamente.**

### 2.2 Puntaje en vivo

- `scoreQueueItem` deja de exigir `status='done'` y acepta también `'playing'`. Queda excluido solo
  `'queued'`: no tiene sentido puntuar algo que todavía no se cantó. La ruta
  `POST /api/queue/:id/score` ya valida 1–10 y no cambia.
- Los botones 1–10 aparecen en la tarjeta **"Cantando ahora"**, con el valor elegido resaltado y
  editable hasta que la canción termina. Reusa `.score-buttons` / `.score-btn`, más un `is-active`.
- El panel "Falta puntuar" se queda como red de contención para las que pasaron sin puntuar.

### 2.3 La tabla de posiciones se revela al final

- Se saca el `leaderboard-panel` de la página `cola`. El estado `leaderboard` sigue existiendo y
  ahora alimenta la pantalla de resultados.
- **`handleEndSession` se parte en dos.** "Terminar sesión" ya no borra ni usa el `confirm()` del
  navegador: abre la pantalla de resultados. El borrado real (`POST /api/sessions/end`) ocurre
  recién cuando el admin la cierra. Así los resultados se calculan con los datos todavía vivos y no
  hace falta ninguna tabla de historial.

**`apps/admin/src/SessionResults.tsx`** (nuevo), modal a pantalla casi completa:

- Podio de los tres primeros y lista del resto.
- Se arma cruzando `sessionSingers` con `leaderboard`, **no solo el leaderboard**: quien cantó y
  nunca fue puntuado tiene que aparecer con 0, no desaparecer.
- Toggle **Total / Promedio** (`totalScore / songsScored`, los dos campos ya vienen del backend).
- Si quedan canciones sin puntuar, se avisa con un camino para volver y puntuarlas.
- Acciones: "Volver a la sesión" (no borra nada) y "Cerrar la sesión" (borra, con la confirmación
  explícita en el propio botón).

### 2.4 Advertencia de desventaja

Al abrir los resultados se comparan las canciones por cantante con `countQueuedSongsBySinger`
(todas, no solo las puntuadas). Si no están parejas, arriba del podio aparece un aviso con los
nombres en desventaja y dos salidas:

- **"Cargar más canciones"** → cierra los resultados y vuelve a la sesión.
- **"Usar promedio"** → cambia el toggle a promedio, que es la comparación justa cuando cantaron
  distinta cantidad de veces.

### 2.5 Archivos

- `apps/server/src/db/queries.ts` — `interleaveQueue()`, `scoreQueueItem` acepta `playing`.
- `apps/server/src/index.ts` — `POST /api/queue/interleave`; llamada a `interleaveQueue` en `/begin`.
- `apps/admin/src/SessionResults.tsx` — **nuevo**.
- `apps/admin/src/App.tsx` — puntaje en "Cantando ahora", baja del `leaderboard-panel`, botón
  "Alternar turnos", `handleEndSession` partido en abrir-resultados / cerrar-sesión.
- `apps/admin/src/style.css` — podio, resultados, botones de puntaje activos, aviso de desventaja.
- `PLAN-SESION-KARAOKE.md` (este documento), `ROADMAP.md` actualizado y enlazándolo.

---

## Deuda conocida y fuera de alcance 📋

Documentada a propósito. **No se ejecuta en estas etapas**, pero conviene que esté escrita para no
redescubrirla.

- **`endSession` borra `queue_items` sin filtrar** (`db.delete(queueItems).run()`, la tabla entera).
  Hoy es correcto porque nunca hay más de una sesión, pero es una mina: si alguna vez hay dos, se
  lleva puesta la otra. `queue_items` no tiene `sessionId`; agregarlo es la solución real.
- **La cola no se pushea por WebSocket.** El único mensaje es `snapshot` con `nowPlaying` +
  `backgroundVideoUrl`; agregar/quitar/mover/puntuar no emiten nada, así que la UI es toda refetch.
  Alcanza porque hay un solo operador en una sola pantalla. Si alguna vez hay un segundo dispositivo
  (por ejemplo que el público puntúe desde el celular), esto hay que rehacerlo.
- **Puntaje de un solo votante.** Varios votantes necesitan una tabla de votos; ver decisión cerrada.
- **Empujar una playlist entera crea desbalance** por diseño: appendea todas las canciones a un
  mismo cantante. El botón "Alternar turnos" es la salida manual.
- **`listQueue` levanta todas las canciones y todos los cantantes a memoria** en cada llamada, y
  cruza en JS. Con 7000 canciones ya se nota; conviene un JOIN real si la cola se vuelve caliente.
- **Sin historial de sesiones**: al cerrar, los resultados se pierden. Era la decisión, pero si
  alguna vez se quiere "el ranking del mes", hace falta persistir.

---

## Verificación

### Etapa 1 (ya corrida, quedó verde)

Typecheck de `server`/`admin`/`shared`, 23 tests, `db:generate` + `db:migrate` sin prompts, y humo
de API que confirmó las dos guardas (400 sin cantantes, 400 sin canciones), el encolado en batch, el
conteo por cantante y la transición a `corriendo`.

### Etapa 2 (corrida, quedó verde)

- Typecheck limpio en `server`/`admin`, 23 tests de `shared` pasando.
- **Humo de API** — sesión con Ana (3 canciones) y Beto (2), `begin`: la cola quedó
  `A,B,A,B,A` (no `A,A,A,B,B`). Puntuar el ítem `playing` dio 200 y fue editable (8→9);
  intentar puntuar un `queued` siguió dando 400. El leaderboard esperó correctamente a que el
  ítem pasara a `done` para incluir a Ana. `POST /api/queue/interleave` suelto (sin pasar por
  `/begin`) probado aparte con A(3)/B(1) desparejos: quedó `A,B,A,A` — round-robin correcto,
  B se agota en la primera ronda y A completa el resto.
- Sin errores en el log de dev server durante toda la prueba (typecheck + HMR limpios).
- Pendiente: pasada manual en el navegador (podio, toggle Total/Promedio, aviso de desventaja
  visual, Escape en los resultados) — el humo de API cubrió la lógica de negocio, no la UI.
