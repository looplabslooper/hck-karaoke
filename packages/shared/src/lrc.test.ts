import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLrc, lineLrcToLyricsDoc, wordLrcToLyricsDoc } from './lrc.js'

const LINE_LEVEL = `[ar:Test Artist]
[ti:Test Song]
[00:00.50]Esto es una prueba
[00:03.00]de karaoke sincronizado`

const WORD_LEVEL = `[00:00.50]<00:00.50>Esto <00:01.00>es <00:01.40>una <00:02.00>prueba
[00:03.00]<00:03.00>de <00:03.50>karaoke`

test('parseLrc: ignora metadata y detecta LRC de línea', () => {
  const parsed = parseLrc(LINE_LEVEL)
  assert.equal(parsed.wordLevel, false)
  assert.equal(parsed.lines.length, 2)
  assert.equal(parsed.lines[0].start, 0.5)
  assert.equal(parsed.lines[1].start, 3.0)
})

test('parseLrc: detecta LRC word-level por los tags <mm:ss.xx>', () => {
  const parsed = parseLrc(WORD_LEVEL)
  assert.equal(parsed.wordLevel, true)
  assert.equal(parsed.lines.length, 2)
})

test('lineLrcToLyricsDoc: reparte el tiempo proporcional a la longitud de cada palabra', () => {
  const doc = lineLrcToLyricsDoc(parseLrc(LINE_LEVEL))
  assert.equal(doc.lines.length, 2)

  const line0 = doc.lines[0]
  assert.equal(line0.start, 0.5)
  assert.equal(line0.end, 3.0) // = inicio de la línea siguiente
  assert.equal(line0.words.map((w) => w.t).join(' '), 'Esto es una prueba')
  assert.equal(line0.words[0].start, 0.5) // la primera palabra arranca con la línea
  assert.ok(Math.abs(line0.words.at(-1)!.end - 3.0) < 1e-9) // la última cierra con la línea

  // "prueba" (6 letras) debe durar más que "es" (2 letras)
  const esWord = line0.words.find((w) => w.t === 'es')!
  const pruebaWord = line0.words.find((w) => w.t === 'prueba')!
  assert.ok(pruebaWord.end - pruebaWord.start > esWord.end - esWord.start)

  // última línea sin línea siguiente: usa el fallback (+6s)
  const line1 = doc.lines[1]
  assert.equal(line1.end, 9.0)
})

test('wordLrcToLyricsDoc: usa los timestamps exactos del archivo, sin interpolar', () => {
  const doc = wordLrcToLyricsDoc(parseLrc(WORD_LEVEL))
  const line0 = doc.lines[0]
  assert.deepEqual(
    line0.words.map((w) => [w.t, w.start, w.end]),
    [
      ['Esto', 0.5, 1.0],
      ['es', 1.0, 1.4],
      ['una', 1.4, 2.0],
      ['prueba', 2.0, 3.0], // cierra con el inicio de la línea siguiente
    ],
  )
})
