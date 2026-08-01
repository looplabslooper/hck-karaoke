import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialCdgState,
  processCdgPacket,
  cdgPacketIndexForTime,
  CDG_WIDTH,
  CDG_HEIGHT,
  CDG_PACKETS_PER_SECOND,
} from './cdg.js'

function makePacket(instruction: number, data: number[]): Uint8Array {
  const packet = new Uint8Array(24)
  packet[0] = 0x09 // command
  packet[1] = instruction
  for (let i = 0; i < data.length && i < 16; i++) packet[4 + i] = data[i]
  return packet
}

test('processCdgPacket: ignora paquetes que no son comando CD+G', () => {
  const state = createInitialCdgState()
  const packet = new Uint8Array(24)
  packet[0] = 0x01 // no es 0x09
  packet[4] = 5
  processCdgPacket(state, packet, 0)
  assert.equal(state.framebuffer[0], 0)
})

test('memory preset: llena toda la pantalla con el color indicado', () => {
  const state = createInitialCdgState()
  const packet = makePacket(1, [7])
  processCdgPacket(state, packet, 0)
  assert.equal(state.framebuffer.length, CDG_WIDTH * CDG_HEIGHT)
  assert.ok(state.framebuffer.every((px) => px === 7))
})

test('border preset: guarda el color de borde sin tocar el framebuffer', () => {
  const state = createInitialCdgState()
  const packet = makePacket(2, [3])
  processCdgPacket(state, packet, 0)
  assert.equal(state.borderColor, 3)
  assert.equal(state.framebuffer[0], 0)
})

test('load CLUT low: decodifica 8 colores RGB444 en las entradas 0-7', () => {
  const state = createInitialCdgState()
  // blanco puro (0xF,0xF,0xF): packed = 0xFFF -> b0=0b111111(0x3F), b1=0b111111(0x3F)
  const data = [0x3f, 0x3f, ...Array(14).fill(0)]
  const packet = makePacket(30, data)
  processCdgPacket(state, packet, 0)
  assert.deepEqual(state.palette[0], [255, 255, 255])
  // el resto de las 7 entradas de este lote quedan en negro (todos ceros)
  assert.deepEqual(state.palette[1], [0, 0, 0])
})

test('load CLUT high: usa el offset 8-15 en vez de 0-7', () => {
  const state = createInitialCdgState()
  const data = [0x3f, 0x3f, ...Array(14).fill(0)]
  const packet = makePacket(31, data)
  processCdgPacket(state, packet, 0)
  assert.deepEqual(state.palette[8], [255, 255, 255])
  assert.deepEqual(state.palette[0], [0, 0, 0])
})

test('tile block: dibuja un tile de 6x12 con los dos colores según los bits', () => {
  const state = createInitialCdgState()
  // color0=1, color1=2, row=0, col=0, primera fila de píxeles = 0b100000 (bit más a la izquierda prendido)
  const data = [1, 2, 0, 0, 0b100000, ...Array(11).fill(0)]
  const packet = makePacket(6, data)
  processCdgPacket(state, packet, 0)
  // primer píxel de la fila 0 (bit prendido) -> color1
  assert.equal(state.framebuffer[0], 2)
  // segundo píxel de la fila 0 (bit apagado) -> color0
  assert.equal(state.framebuffer[1], 1)
  // fila 1 del tile (todos los bits en 0) -> color0 en toda la fila
  assert.equal(state.framebuffer[CDG_WIDTH], 1)
})

test('tile block XOR: combina con lo que ya había en vez de reemplazar', () => {
  const state = createInitialCdgState()
  state.framebuffer[0] = 5
  const data = [1, 2, 0, 0, 0b100000, ...Array(11).fill(0)]
  const packet = makePacket(38, data)
  processCdgPacket(state, packet, 0)
  // pixel 0: bit prendido -> XOR con color1(2): 5 ^ 2 = 7
  assert.equal(state.framebuffer[0], 5 ^ 2)
})

test('tile block: ignora tiles fuera del área visible en vez de escribir fuera de rango', () => {
  const state = createInitialCdgState()
  const data = [1, 2, 99, 99, ...Array(12).fill(0)] // row/col absurdos
  const packet = makePacket(6, data)
  assert.doesNotThrow(() => processCdgPacket(state, packet, 0))
})

test('define transparent: guarda el índice sin tocar el framebuffer', () => {
  const state = createInitialCdgState()
  const packet = makePacket(28, [4])
  processCdgPacket(state, packet, 0)
  assert.equal(state.transparentIndex, 4)
})

test('cdgPacketIndexForTime: 300 paquetes por segundo, nunca negativo', () => {
  assert.equal(cdgPacketIndexForTime(1), CDG_PACKETS_PER_SECOND)
  assert.equal(cdgPacketIndexForTime(0.5), 150)
  assert.equal(cdgPacketIndexForTime(-3), 0)
})
