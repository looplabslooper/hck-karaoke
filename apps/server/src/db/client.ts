import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const dataDir = path.resolve(__dirname, '../../../../data')
fs.mkdirSync(dataDir, { recursive: true })

const sqlite = new Database(path.join(dataDir, 'kiosco.db'))
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')

export const db = drizzle(sqlite, { schema })
