# Móvil de audiencia — concepto y estructura

Fase 2 del roadmap (`ROADMAP.md`, "Lo que sigue" #6): la app que corre en el celular de un invitado
al escanear el QR del kiosco. Este documento es **insumo para Claude Design**, no una spec de
implementación — describe pantallas, estados y conceptos, no componentes ni endpoints.

## Alcance de esta primera tanda

Dos features, ambas dentro de la misma sesión de karaoke ya modelada en el backend
(`sessions`/`singers`/`queue_items`, ver `apps/server/src/db/schema.ts`):

1. **Puntaje de audiencia** por canción, mientras suena.
2. **Fun Box remoto**: la audiencia pide *una* animación de cara-en-el-escenario por sesión completa.

Todo lo demás (pedir canción, chat, reacciones tipo corazón/aplauso) queda **fuera de esta tanda** —
no lo diseñes todavía, aunque el modelo de datos ya lo deje abierto a futuro.

## Flujo de entrada

Coincide con el diseño de QR ya cerrado en `DECISIONES-STACK.md` §10: el QR codifica
`http://<ip-lan>:8080/j/<CODIGO>` — un código corto tipo `A7K2`, no un UUID. Eso significa que
**la pantalla de "unirse" normalmente llega con el código ya resuelto por la URL**, no que el
usuario lo tipee a mano. Aun así hay que diseñar el fallback manual (cámara que no lee, alguien
sin cámara — §10 ya pide mostrar el código en texto grande al lado del QR para esto).

**Pantalla 1 — Unirse**
- Si la URL trae el código: mostrar directamente "¿Es esta tu karaoke?" con algo que confirme que
  es la sesión correcta antes de pedir nada más (a definir con el admin qué dato de sesión sirve de
  confirmación visual — podría ser tan simple como mostrar el código grande y un botón "Sí, unirme").
- Si no hay código en la URL (alguien tipeó la home a mano): input para el código, mismo estilo que
  el texto grande al lado del QR en el kiosco.
- **Contraseña**: solo aparece si la sesión la tiene activada (la setea el admin al crear la sesión,
  opcional, solo para habilitar el puntaje de audiencia). Si la sesión no tiene contraseña, este
  campo ni se muestra — no hay que diseñar un campo vacío/deshabilitado, directamente no existe en
  ese caso.
- **Estados de error a cubrir**: código inexistente, contraseña incorrecta, sesión que ya terminó
  (el admin cierra sesión y la fila se borra — ver comentario de `sessions` en `schema.ts`, es
  efímera). Cada uno necesita su propio mensaje, no un error genérico.

Una vez adentro, el celular queda "suscripto" a esa sesión — no hace falta volver a loguearse
mientras la pestaña siga abierta (guardar el código+sesión localmente, mismo criterio que
`clientId` en `localStorage` que ya usa el resto del proyecto para identidad de dispositivo).

## Pantalla 2 — Home de audiencia (una vez adentro)

Dos secciones en la misma pantalla, no dos rutas separadas — la audiencia entra, ve quién canta, y
tiene ambas acciones (puntaje + filtro) a mano sin navegar. Pensalo como un solo scroll corto, no
un dashboard con tabs.

### A. "Cantando ahora" + puntaje

Qué mostrar (viene de `queue_items.status = 'playing'` + su `singer`/`song`):
- Nombre de la canción y artista.
- Nombre del cantante (y foto, si `singers.photoPath` existe — ya se usa en el Fun Box del admin).
- Selector de puntaje. Seguir la misma escala 1-10 de un toque que ya usa el admin
  (`queries.ts`/`leaderboard`) — la audiencia alimenta un promedio aparte, **no** pisa el puntaje
  discreto del operador (ver `DECISIONES-STACK.md`, sección "Puntajes": son dos fuentes que nunca
  se mezclan en un solo número).
- **Se puede cambiar el puntaje libremente** mientras la ventana esté abierta — no es "elegís una
  vez y listo", el diseño tiene que dejar claro que tocar otro número lo reemplaza, sin
  confirmación extra que friccione.

**Ventana de tiempo — hasta el 80% de la canción.** Esto necesita señal visual, no solo una regla
invisible que corta en silencio:
- Mientras está abierta: el selector se ve activo/interactivo.
- Al llegar al 80%: el selector pasa a un estado "cerrado" (deshabilitado, o directamente
  reemplazado por "Puntaje enviado: N — ¡gracias!"). Diseñar ambos estados.
- Si la canción termina y el usuario nunca puntuó: estado neutro, sin culpa ("Esta te la
  perdiste — la próxima podés puntuar").
- Considerar un indicador sutil de cuánto falta para que se cierre (no un contador exacto en
  segundos — el reloj real vive en el motor de audio del kiosco — pero sí algo como una barra que
  se va llenando, coherente con el estilo de barra de espera que ya existe en `LyricsView`).

### B. "Agregale un filtro en pantalla" (Fun Box remoto)

Contexto: esto solo tiene sentido si el kiosco está mostrando la pantalla con el fondo (pantalla
completa) — si no está en ese modo, la sección debería mostrarse pero inerte/explicando por qué
("Todavía no arrancó el show").

Regla de cuota: **una animación por sesión completa**, no por canción. El diseño tiene que dejar
esto clarísimo desde el primer vistazo — es la diferencia entre "tengo 1 tiro guardado para toda
la noche" y "puedo mandar una por canción", y si no se entiende la gente va a reclamar cuando se
quede sin cuota en la segunda canción.

Estados de esta sección:
1. **Disponible, sin usar todavía**: selector de animaciones (reusa los templates del Fun Box del
   admin — `template_meta`: nombre, sin necesidad de mostrar video previo, es una elección a
   ciegas tipo sorpresa, o a definir si conviene mostrar una miniatura). Botón de envío claro.
2. **Enviada, en espera** (~10s antes de aplicarse): estado de "cargando/procesando" — algo que
   comunique que ya se mandó y está por pasar, sin dar una cuenta regresiva exacta al segundo (es
   *"aprox"* 10s, no prometas precisión que no existe).
3. **Aplicada con éxito**: confirmación breve, la cuota queda gastada para el resto de la sesión.
4. **Error — el cantante cambió**: si el cantante que estaba en escena cuando se mandó el pedido ya
   no es el que está cantando cuando el filtro está por dispararse (10s después), se cancela y
   **no se consume la cuota**. Mensaje debe explicar el motivo, no solo "error" — algo como "el
   filtro no llegó a tiempo, [cantante] ya terminó — tu filtro sigue disponible, probá con quien
   está cantando ahora". Este estado tiene que devolver al usuario al estado 1 (disponible), no
   dejarlo trabado.
5. **Ya usada**: una vez gastada la cuota, la sección pasa a un estado final para el resto de la
   sesión — mostrar qué se mandó (si se aplicó) como recuerdo, no dejar la sección vacía o parecer
   rota.

## Guía visual para Claude Design

- Reusar el sistema HCK ya cerrado para el resto de la app (`apps/admin/src/hck-theme.css` /
  `design-style-a.md`): fondo casi negro, acento violeta único (#8B5CF6), Plus Jakarta Sans. Esta
  pantalla es la cara pública de la marca en el celular de cada invitado — tiene que sentirse la
  misma app que el kiosco, no un formulario genérico aparte.
- **Contexto de uso real: fiesta, poca luz, una mano, con música fuerte de fondo.** Botones grandes,
  alto contraste, cero texto chico obligatorio para entender qué tocar. Nada de hover — todo tiene
  que leerse por tap directo.
- Mobile-first estricto (viewport de celular, no hay versión de escritorio de esto) — un solo
  layout fluido, sin sidebar ni navegación compleja.
- Carga rápida: la sesión es sobre wifi de LAN compartida entre muchos celulares (ver §9 de
  `DECISIONES-STACK.md`) — evitar assets pesados, nada de video de fondo en esta pantalla.

## Preguntas abiertas (para resolver antes de pasar a diseño final)

- ¿Qué dato de sesión confirma "es la correcta" en la Pantalla 1 más allá del código? (¿nombre de
  evento? ¿nada más que el código+botón?)
- ¿Los templates del Fun Box se eligen a ciegas (solo nombre) o conviene mostrar una miniatura del
  efecto antes de mandar el pedido?
- ¿Qué pasa si dos personas de la misma sesión mandan el pedido de filtro casi al mismo tiempo —
  es una cuota por *dispositivo* (celular) o por sesión entera compartida entre todos los
  invitados? (el texto original dice "por sesión", asumido acá como por dispositivo/dueño del
  celular, no un pozo común de 1 para todos los invitados — confirmar).
