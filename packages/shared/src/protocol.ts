import type { Song } from './domain.js'

/**
 * Todo corre en una sola pantalla (ver ROADMAP.md) — no hay un segundo
 * cliente "admin" al que sincronizarle pausa/seek por WS. `snapshot` es el
 * único mensaje real hoy; queda como base para cuando los celulares (Fase 2)
 * se sumen como clientes de solo lectura (cola, reacciones).
 */
export type ServerMsg = { t: 'snapshot'; nowPlaying: Song | null; backgroundVideoUrl: string | null }
