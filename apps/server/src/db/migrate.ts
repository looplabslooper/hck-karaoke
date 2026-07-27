import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') })
console.log('[db] migraciones aplicadas')
