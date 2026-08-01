/**
 * Decodificador de CD+G (formato binario de gráficos en subcanal de CD,
 * usado por catálogos comerciales de karaoke desde los 90s — ver
 * DECISIONES-STACK.md y ROADMAP.md, "formatos estándar de karaoke").
 *
 * Referencia: la especificación es de dominio público y está documentada
 * hace décadas (el doc hobbyista clásico "CD+G Revealed"). Formato: paquetes
 * de 24 bytes, 300 por segundo (4 por sector × 75 sectores/seg), cada uno
 * mutando un framebuffer de 300×216 px indexado a una paleta de 16 colores.
 *
 * Este módulo es puro (sin canvas/DOM) para poder testearlo con node:test
 * igual que lrc.ts — el renderer a canvas vive en apps/admin (necesita
 * CanvasRenderingContext2D, que no existe en Node).
 */

export const CDG_PACKET_BYTES = 24
export const CDG_PACKETS_PER_SECOND = 300
export const CDG_WIDTH = 300
export const CDG_HEIGHT = 216
const CDG_TILE_WIDTH = 6
const CDG_TILE_HEIGHT = 12
const CDG_COMMAND = 0x09

// Instrucciones — ver nota de "CD+G Revealed" arriba. `TILE_BLOCK_XOR` es una
// instrucción aparte (38), no una variante de `TILE_BLOCK` (6): superpone por
// XOR en vez de reemplazar, se usa para animaciones simples sin redibujar.
const INSTR_MEMORY_PRESET = 1
const INSTR_BORDER_PRESET = 2
const INSTR_TILE_BLOCK = 6
const INSTR_DEFINE_TRANSPARENT = 28
const INSTR_LOAD_CLUT_LOW = 30
const INSTR_LOAD_CLUT_HIGH = 31
const INSTR_TILE_BLOCK_XOR = 38

export type RgbColor = readonly [number, number, number]

export interface CdgState {
  /** Un índice de paleta (0-15) por pixel, fila por fila. */
  framebuffer: Uint8Array
  palette: RgbColor[]
  borderColor: number
  /** Índice de paleta que se dibuja transparente (deja ver el fondo detrás
   * del canvas) — null si no se definió (opaco). */
  transparentIndex: number | null
}

export function createInitialCdgState(): CdgState {
  return {
    framebuffer: new Uint8Array(CDG_WIDTH * CDG_HEIGHT),
    palette: Array.from({ length: 16 }, () => [0, 0, 0] as RgbColor),
    borderColor: 0,
    transparentIndex: null,
  }
}

/**
 * Aplica un paquete de 24 bytes al estado (in-place). `offset` es dónde
 * empieza el paquete dentro de `bytes` — se llama una vez por paquete, en
 * orden, nunca salteando ninguno (cada instrucción muta el framebuffer
 * acumulado de las anteriores).
 */
export function processCdgPacket(state: CdgState, bytes: Uint8Array, offset: number): void {
  const command = bytes[offset] & 0x3f
  if (command !== CDG_COMMAND) return

  const instruction = bytes[offset + 1] & 0x3f
  const data = bytes.subarray(offset + 4, offset + 20)

  switch (instruction) {
    case INSTR_MEMORY_PRESET:
      state.framebuffer.fill(data[0] & 0x0f)
      break
    case INSTR_BORDER_PRESET:
      state.borderColor = data[0] & 0x0f
      break
    case INSTR_TILE_BLOCK:
      applyTileBlock(state, data, false)
      break
    case INSTR_TILE_BLOCK_XOR:
      applyTileBlock(state, data, true)
      break
    case INSTR_LOAD_CLUT_LOW:
      loadClut(state, data, 0)
      break
    case INSTR_LOAD_CLUT_HIGH:
      loadClut(state, data, 8)
      break
    case INSTR_DEFINE_TRANSPARENT:
      state.transparentIndex = data[0] & 0x0f
      break
    default:
      // Scroll (preset/copy) y demás instrucciones raras: no implementadas
      // a propósito. Los discos de karaoke reales casi nunca las usan para
      // la letra en sí (sí a veces para fondos decorativos) — mejor
      // ignorarlas que aproximarlas mal.
      break
  }
}

function applyTileBlock(state: CdgState, data: Uint8Array, xor: boolean): void {
  const color0 = data[0] & 0x0f
  const color1 = data[1] & 0x0f
  const row = data[2] & 0x1f
  const col = data[3] & 0x3f
  const rowsAvailable = CDG_HEIGHT / CDG_TILE_HEIGHT
  const colsAvailable = CDG_WIDTH / CDG_TILE_WIDTH
  if (row >= rowsAvailable || col >= colsAvailable) return

  for (let r = 0; r < CDG_TILE_HEIGHT; r++) {
    const rowByte = data[4 + r] & 0x3f
    const y = row * CDG_TILE_HEIGHT + r
    for (let c = 0; c < CDG_TILE_WIDTH; c++) {
      const bit = (rowByte >> (5 - c)) & 1
      const color = bit ? color1 : color0
      const x = col * CDG_TILE_WIDTH + c
      const idx = y * CDG_WIDTH + x
      state.framebuffer[idx] = xor ? state.framebuffer[idx] ^ color : color
    }
  }
}

// Cada color son 12 bits (4+4+4) empaquetados en dos bytes de 6 bits útiles
// (quedan de los "6 bits por byte" originales del subcanal de CD): se
// concatenan en un solo número de 12 bits y se separa en 3 nibbles.
function loadClut(state: CdgState, data: Uint8Array, offset: number): void {
  for (let i = 0; i < 8; i++) {
    const b0 = data[i * 2] & 0x3f
    const b1 = data[i * 2 + 1] & 0x3f
    const packed = (b0 << 6) | b1
    const r = (packed >> 8) & 0x0f
    const g = (packed >> 4) & 0x0f
    const b = packed & 0x0f
    // Nibble 0-15 escalado a 0-255 (×17, ya que 15×17=255) — RGB444 clásico.
    state.palette[offset + i] = [r * 17, g * 17, b * 17]
  }
}

/** Cuántos paquetes ya deberían haberse procesado para llegar a este tiempo
 * de reproducción — el llamador decide cuántos de los que faltan aplicar. */
export function cdgPacketIndexForTime(seconds: number): number {
  return Math.max(0, Math.floor(seconds * CDG_PACKETS_PER_SECOND))
}
