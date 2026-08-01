# Rediseño de la app — estructura, pantallas y expectativas

Documento de trabajo para pensar una nueva versión de `apps/admin` (la única app del kiosco — ver `CLAUDE.md`/`ROADMAP.md`). No es una implementación ni un compromiso de scope: es el punto de partida para decidir qué construir. Compara lo que el usuario pidió contra lo que ya existe hoy en `apps/admin/src/App.tsx`, y marca qué es reordenar/renombrar vs. qué es dominio nuevo (tablas, endpoints).

## Navegación propuesta (sidebar)

1. **Inicio** — nueva
2. **Biblioteca** — ya existe, se le suma buscador estilo Spotify
3. **Playlists** — nueva
4. **En espera** — ya existe como "Cola en vivo", posible rename
5. **Agregar canción nueva** — ya existe ("Generar")
6. **Subir canción armada** — ya existe
7. **Fondo de video** — ya existe
8. **Entrada en vivo** — ya existe, herramienta aparte (`/walk-on`)

Reproductor (marquesina inferior) y pantalla completa siguen siendo transversales, no pantallas del sidebar.

---

## 1. Inicio (nueva)

**Qué es:** landing al abrir el kiosco, antes de ir a buscar algo puntual en la Biblioteca. Da contexto/ambiente y accesos rápidos.

**Qué debería tener:**
- **Carrusel de banners** arriba de todo. Rotación automática + flechas/dots.
  - Contenido posible: canción destacada, promoción de la noche, mensaje de bienvenida, anuncio de evento. Cada banner podría llevar a una acción (abrir una canción, ir a una playlist, ir a "Agregar canción").
  - **Dominio nuevo necesario**: no existe hoy nada parecido a un banner. Haría falta una tabla `banners` (imagen, título, subtítulo opcional, link/acción, orden, activo/inactivo) y una pantalla de administración simple para cargarlos — o, más barato para una v1, banners fijos por código (sin admin) si no hace falta que el operador los edite en vivo.
- **"Canciones más escuchadas"** debajo, como fila de tarjetas (estilo Spotify "quick picks").
  - **Dato que falta hoy**: `Song` (`packages/shared/src/domain.ts`) no tiene contador de reproducciones. Dos formas de resolverlo:
    - (a) contador simple `playCount` en `songs`, incrementado cada vez que se llama `POST /api/play/:id`.
    - (b) derivarlo de `queue_items` (cuántas veces cada `songId` llegó a `status: 'done'`) — más fiel a "se cantó de verdad", pero no cuenta reproducciones de prueba/preview fuera de la cola.
  - Definir cuál de las dos noções de "más escuchada" es la que se quiere antes de tocar la DB.
- Posible: acceso directo a "seguir la sesión" (mini resumen de "En espera" / quién sigue) sin tener que ir a esa pantalla — opcional, evaluar si no duplica demasiado la pantalla 4.

**Preguntas abiertas:** ¿quién carga los banners (el operador, o son fijos de marca HCK)? ¿"más escuchadas" es global (histórico) o de la sesión actual de la noche?

---

## 2. Biblioteca (ya existe, se extiende)

**Qué es hoy:** tabla de canciones con buscador por texto (título/artista), filtro por calidad de sincronía, orden A→Z/Z→A, y acciones por fila (▶ Reproducir, + Cola, ⟳ Re-sincronizar, 🗑 Eliminar).

**Qué pide el usuario ("inspirado en Spotify"):** ya hay buscador (`searchQuery`, instantáneo, sin submit) — lo que falta para que se sienta "Spotify" es más la forma que la función:
- Buscador más prominente (barra grande arriba, no un input chico en una toolbar), con ícono de lupa y placeholder tipo "¿Qué querés cantar?".
- Resultados que reaccionen tecla por tecla (ya pasa — `filteredSongs` es un `.filter` en cada render).
- Posible: distinguir visualmente resultados por título vs. por artista, o agrupar "Canciones" / "Artistas" si en algún momento hay muchas canciones del mismo artista.
- Cover art real en vez del swatch de color por hash (`songColor`) — hoy no hay campo de imagen en `Song`; si se quiere carátula de verdad hace falta subir/generar una imagen por canción (dominio nuevo, no trivial).
- Vista tipo grilla de tarjetas con carátula como alternativa a la tabla actual (toggle lista/grilla) — cosmético, no requiere dominio nuevo salvo el punto de la carátula.

**Qué no cambia:** filtro por calidad de sincronía y las acciones por fila siguen siendo específicas de este proyecto (no tienen equivalente en Spotify) y deberían quedar.

---

## 3. Playlists (nueva)

**Qué es:** listas curadas de canciones que el operador arma de antemano (ej. "Arranque tranqui", "Éxitos 2000s", "Para el final de la noche") para no tener que buscar canción por canción en el momento.

**Qué debería tener:**
- Listado de playlists existentes (nombre, cantidad de canciones, quizás una carátula compuesta de las primeras canciones).
- Crear/editar/borrar playlist, agregar/quitar canciones desde la Biblioteca ("+ Playlist" al lado de "+ Cola" en cada fila) o desde dentro de la playlist misma.
- **Acción clave pedida por el usuario**: "agregar a la sesión de karaoke" — un botón por playlist que empuja *todas* sus canciones a la cola en vivo (`queue_items`) de una sola vez, en vez de una por una.
  - Decisión de diseño pendiente: ¿con qué "cantante" quedan esas entradas? Opciones: (a) pedir un nombre una sola vez y asignarlo a todas, (b) dejarlas con cantante vacío/"Sin asignar" y que el operador las edite después, (c) no pedir cantante — reinterpretar la playlist como "cola de fondo" sin dueño individual. Afecta el modelo de `QueueItem` (`singer` hoy es obligatorio).

**Dominio nuevo necesario:**
- Tabla `playlists` (`id`, `name`, `createdAt`) + tabla puente `playlist_songs` (`playlistId`, `songId`, `position`).
- Endpoints: `GET/POST /api/playlists`, `POST /api/playlists/:id/songs`, `DELETE /api/playlists/:id/songs/:songId`, `POST /api/playlists/:id/add-to-queue`.
- Tipo compartido nuevo en `packages/shared/src/domain.ts` (`Playlist`, similar a como está `QueueItem`).

---

## 4. En espera (ya existe como "Cola en vivo")

**Qué es hoy:** ya cumple exactamente lo que se pidió — "las canciones en espera de la sesión actual de karaoke". Tiene:
- Tarjeta "Cantando ahora" (cantante + canción actual) con botón "Siguiente ▶".
- Lista "Próximos en la cola" con posición, mover arriba/abajo, quitar.
- "Falta puntuar" (canciones ya cantadas sin puntaje).
- Tabla de posiciones (leaderboard por cantante).

**Qué decidir para el rediseño:**
- Solo **renombrar** la pantalla/label del sidebar de "Cola en vivo" a "En espera" si se quiere ese nombre exacto (cambio cosmético, cero impacto de dominio) — o mantener "Cola en vivo" y usar "en espera" solo como descripción de la sección "Próximos". Confirmar cuál de las dos.
- Si se agrega **Playlists** (punto 3), esta pantalla es donde termina aterrizando el resultado de "agregar playlist a la sesión" — vale la pena pensarlas juntas.
- Puntajes/leaderboard: ¿siguen viviendo acá, o el rediseño los separa a una pantalla propia ("Resultados"/"Ranking")? Hoy están mezclados en la misma página por conveniencia, no por una decisión fuerte de IA.

---

## 5. Agregar canción nueva (ya existe — "Generar")

Wizard de 4 pasos: subir audio → pegar letra → sincronizar (WhisperX vía `pipeline/`) → confirmación. Incluye selector de idioma y opción Demucs (separar voz). No hay cambios pedidos acá — se mantiene igual salvo que el rediseño visual general (paleta, tipografía) se le aplique parejo con el resto de la app.

## 6. Subir canción armada (ya existe)

Para karaokes ya armados (LRC, JSON propio, CD+G, video con letra quemada). Formulario simple: título, artista, audio, letra, video. Sin cambios pedidos.

## 7. Fondo de video (ya existe)

Configura el clip de fondo global detrás de la letra en pantalla completa. Un solo fondo activo a la vez, hoy. Sin cambios pedidos — posible mejora futura (no pedida): banco de fondos con selección por canción/playlist en vez de uno global único.

## 8. Entrada en vivo (ya existe, fuera de React)

Herramienta HTML/JS autocontenida (`apps/server/public/`) para animar la entrada del próximo cantante (chroma key o foto con máscara). Vive fuera del árbol de React a propósito, no se toca en un rediseño de `apps/admin`.

## Transversales (no son pantallas del sidebar)

- **Reproductor / marquesina inferior**: play/pause, scrubber, volumen, "Mostrar letras" (overlay flotante), "Apagar voz original" (si hay instrumental), "Corregir sincronía", "Pantalla completa". Persiste en todas las pantallas.
- **Pantalla completa**: fondo de video + letra grande (Fullscreen API real), con toggle de oscurecer fondo y botón de salir.

---

## Resumen de dominio nuevo si se avanza con esto

| Necesidad | Tabla/tipo nuevo | Endpoint nuevo |
|---|---|---|
| Carrusel de banners | `banners` | CRUD básico (o hardcodeado si no hace falta admin) |
| "Más escuchadas" | contador en `songs` o derivado de `queue_items.status='done'` | incrementar en `POST /api/play/:id` (si se elige opción a) |
| Playlists | `playlists` + `playlist_songs` | CRUD + `add-to-queue` |

Todo lo demás pedido (buscador en Biblioteca, "En espera") ya existe funcionalmente hoy — el trabajo ahí es de forma/ubicación, no de dominio nuevo.
