import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectFormat, type UploadInput } from './formatDetector.js'

const base: UploadInput = {
  audioFilename: 'cancion.mp3',
  lyricsFilename: null,
  lyricsText: null,
  videoFilename: null,
}

test('audio + LRC de línea -> overlay/lrc-line/interpolated', () => {
  const result = detectFormat({
    ...base,
    lyricsFilename: 'cancion.lrc',
    lyricsText: '[00:00.50]Esto es una prueba\n[00:03.00]de karaoke',
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.playbackMode, 'overlay')
    assert.equal(result.sourceFormat, 'lrc-line')
    assert.equal(result.syncQuality, 'interpolated')
    assert.ok(result.lyrics)
  }
})

test('audio + LRC word-level -> overlay/lrc-word/excellent', () => {
  const result = detectFormat({
    ...base,
    lyricsFilename: 'cancion.lrc',
    lyricsText: '[00:00.50]<00:00.50>Esto <00:01.00>es\n[00:03.00]<00:03.00>de <00:03.50>karaoke',
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.sourceFormat, 'lrc-word')
    assert.equal(result.syncQuality, 'excellent')
  }
})

test('audio + JSON propio válido -> overlay/json/excellent', () => {
  const result = detectFormat({
    ...base,
    lyricsFilename: 'cancion.json',
    lyricsText: JSON.stringify({ lines: [{ start: 0, end: 1, words: [{ t: 'hola', start: 0, end: 1 }] }] }),
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.sourceFormat, 'json')
    assert.equal(result.syncQuality, 'excellent')
  }
})

test('JSON con forma inválida -> rechazado', () => {
  const result = detectFormat({
    ...base,
    lyricsFilename: 'cancion.json',
    lyricsText: JSON.stringify({ foo: 'bar' }),
  })
  assert.equal(result.ok, false)
})

test('audio + .cdg -> modo completo, sin fondo elegible', () => {
  const result = detectFormat({ ...base, lyricsFilename: 'cancion.cdg', lyricsText: null })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.playbackMode, 'complete')
    assert.equal(result.sourceFormat, 'cdg')
  }
})

test('solo video (letra quemada) -> modo completo, baked-video', () => {
  const result = detectFormat({
    audioFilename: null,
    lyricsFilename: null,
    lyricsText: null,
    videoFilename: 'karaoke-completo.mp4',
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.playbackMode, 'complete')
    assert.equal(result.sourceFormat, 'baked-video')
  }
})

test('solo audio, sin letra -> overlay/audio-only/none', () => {
  const result = detectFormat(base)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.sourceFormat, 'audio-only')
    assert.equal(result.syncQuality, 'none')
  }
})

test('extensión de audio no reconocida -> rechazado', () => {
  const result = detectFormat({ ...base, audioFilename: 'cancion.exe' })
  assert.equal(result.ok, false)
})

test('extensión de letra no reconocida -> rechazado', () => {
  const result = detectFormat({ ...base, lyricsFilename: 'cancion.txt', lyricsText: 'hola' })
  assert.equal(result.ok, false)
})
