import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { runMigrations } from './migrations'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultDatabasePath = path.join(__dirname, '..', '..', 'pulse.db')
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : defaultDatabasePath

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF')
runMigrations(db)
db.pragma('foreign_keys = ON')

const integrityErrors = db.pragma('foreign_key_check') as unknown[]
if (integrityErrors.length > 0) {
  throw new Error(`Database integrity check failed with ${integrityErrors.length} foreign-key violation(s)`)
}
