import { db } from './client.js'
import { settings } from './schema.js'
import { createSong, getSongById } from './queries.js'

// Vía createSong() (no un insert crudo) para que la demo también reciba un
// N° de canción real por el contador de settings — ver nextSongNumber. El
// chequeo previo mantiene el script idempotente (createSong no tiene
// onConflictDoNothing a propósito, para no esconder colisiones de id reales).
if (!getSongById('demo')) {
  createSong({
    id: 'demo',
    title: 'Canción de prueba',
    artist: 'Kiosco de Karaoke',
    playbackMode: 'overlay',
    sourceFormat: 'json',
    syncQuality: 'excellent',
    audioPath: 'demo/audio.mp3',
    lyricsPath: 'demo/lyrics.json',
    videoPath: null,
    instrumentalPath: null,
  })
}

db.insert(settings).values({ key: 'nowPlayingId', value: 'demo' }).onConflictDoNothing().run()

console.log('[db] seed aplicado')
