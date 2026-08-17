// Color determinístico por canción (no tenemos un campo "color" en el
// dominio) — mismo id, mismo tono, sin necesidad de guardarlo en la DB.
//
// Vive en su propio módulo y no en App.tsx a propósito: exportar algo que no
// sea un componente desde un archivo de componentes rompe el Fast Refresh de
// Vite ("export is incompatible"), y cada edición de App.tsx forzaba una
// recarga completa de la página en vez de un hot update.
export function songColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 62%, 58%)`
}
