# Design Style A — ilustración plana con cel-shading (referencia de póster)

Estilo de diseño que le gustó al usuario a partir de un póster de karaoke de referencia (2026-08-14). Documentado acá para poder reusarlo en prompts de generación de imagen/video sin tener que re-describirlo cada vez, en este chat o en uno nuevo.

Ya usado en: [PROMPTS-BANNERS.md](PROMPTS-BANNERS.md) (los 4 banners) y en la escena de green-screen "chico tocando el tambor" (sesión 2026-08-14). El Banner 4 fue el primero generado y salió tal cual se pedía — es el resultado validado que ajustó la descripción de la técnica de iluminación de abajo (ver nota en esa sección).

## Origen

Póster de club nocturno: fondo naranja con rayos de sunburst, cantante ilustrado en pose expresiva, titular tipográfico enorme partido en dos líneas, franja vertical de texto contra el borde derecho.

## Elementos del estilo (agnósticos de color — aplican siempre)

**Ilustración**
- Iluminación dramática tipo rim-light/chiaroscuro, **no** relleno parejo de color en toda la figura — corregido después de ver el resultado real del Banner 4, que quedó así en vez del cel-shading de 2-3 tonos uniformes que se había asumido al describir el estilo por primera vez. La masa del cuerpo se mantiene casi enteramente en negro casi puro (con apenas un tono del color de acento por debajo, para dar volumen sin ser negro plano); el color de acento aparece solo como luz de borde en los cantos que enfrentan los rayos (hombro, brazo, mano, ala de sombrero, pliegues de ropa), con un brillo casi blanco en los puntos de luz más intensos (nudillos, bordes duros).
- Bordes duros entre luz y sombra — nunca degradé suave difuso, nunca 3D/foto-realista.
- Rasgos faciales simplificados, no detallados — la pose y la luz de borde llevan la energía, no la expresión.
- El personaje suele cortarse por el borde del cuadro (hombro, brazo) — da escala e inmediatez, no queda "flotando" centrado.
- Pose siempre a mitad de movimiento, asimétrica (torso girado, un hombro más bajo, peso cargado a un lado) — nunca una pose posada/estática.

**Fondo / iluminación**
- Varios rayos de luz diagonales convergiendo desde una esquina (no un único haz), en degradé de color sólido a transparente — recurso gráfico dramático, no niebla volumétrica ni lens flare realista. Los rayos son la fuente de la luz de borde sobre la figura, no un elemento gráfico independiente superpuesto.
- Paleta monocromática o casi: un solo tono de acento dominando toda la escena (en el original, naranja; nada de otro color saturado compitiendo).

**Tipografía y layout**
- Titular gigante, condensado, todo mayúsculas, jerarquía muy marcada contra el texto secundario (chico, discreto).
- Composición asimétrica: bloque de texto de un lado, ilustración empujando desde el otro, mucho espacio negativo.
- Elemento de texto vertical contra un borde como recurso de relleno de margen (opcional, no siempre aplica).

## Variante adaptada a la marca HCK (paleta)

Cuando este estilo se usa para piezas de HCK · High Class Karaoke, la paleta original (naranja/amarillo/marrón) se reemplaza por la paleta de marca — nunca se mezcla con ella:

- Fondo casi negro `#0F1115`.
- Único acento de color: violeta eléctrico `#8B5CF6` — para rayos, sombreado del personaje (base/sombra/brillo, los tres en tonos de violeta), y cualquier resalte.
- Texto en blanco hueso `#F5F5F7`.
- Cero colores extra — ni dorado, ni multicolor, ni el naranja/amarillo del original. Esta regla de "un solo acento" ya es la regla general de marca del kiosco (ver `CLAUDE.md`), este estilo simplemente le suma la técnica de ilustración cel-shaded + rayos que no tenía antes.
- Tipografía de referencia: Plus Jakarta Sans.

## Variante para green-screen / overlays

Cuando la pieza se genera como video para superponerse via chroma-key (no como imagen fija), el fondo naranja/negro se reemplaza por un verde chroma-key plano, saturado y parejo (sin degradé, sombra ni textura) — el resto de las reglas de ilustración, color de personaje y rayos violeta se mantienen igual. Ver el prompt de "chico tocando el tambor" en el historial de esta sesión como ejemplo de punta a punta.

## Cuándo usarlo

Pedile a Claude que aplique "Design Style A" (o "el estilo del póster") en vez de re-explicar todo esto — este archivo es la referencia. Si el pedido es para una pieza de HCK, aplicar por default la variante de paleta de marca salvo que el usuario pida otra cosa explícitamente.
