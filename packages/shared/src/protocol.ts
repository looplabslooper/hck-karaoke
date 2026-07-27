import type { Song } from './domain.js'

export interface PlaybackStatus {
  position: number
  duration: number
  paused: boolean
}

export type ControlMsg = { t: 'control'; action: 'pause' | 'resume' | 'seek'; position?: number }
export type PlaybackStatusMsg = { t: 'playback-status'; status: PlaybackStatus }

/**
 * Mensajes servidor -> cliente. `control` y `playback-status` en realidad
 * los origina otro cliente (admin/screen) — el servidor solo los retransmite
 * al resto de las conexiones, no les da tratamiento especial.
 */
export type ServerMsg = { t: 'snapshot'; nowPlaying: Song | null; backgroundVideoUrl: string | null } | ControlMsg | PlaybackStatusMsg

/** Mensajes cliente -> servidor. Se amplía en los pasos 2/3 (cola, reacciones, puntajes). */
export type ClientMsg = ControlMsg | PlaybackStatusMsg
