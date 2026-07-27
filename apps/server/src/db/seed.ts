import { db } from './client.js'
import { songs, settings } from './schema.js'

const demoSong = {
  id: 'demo',
  title: 'Canción de prueba',
  artist: 'Kiosco de Karaoke',
  playbackMode: 'overlay',
  sourceFormat: 'json',
  syncQuality: 'excellent',
  audioPath: 'demo/audio.mp3',
  lyricsPath: 'demo/lyrics.json',
  videoPath: null,
  createdAt: Date.now(),
}

db.insert(songs).values(demoSong).onConflictDoNothing().run()
db.insert(settings).values({ key: 'nowPlayingId', value: 'demo' }).onConflictDoNothing().run()

console.log('[db] seed aplicado')
