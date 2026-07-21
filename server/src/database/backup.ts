import 'dotenv/config'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const databaseDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourcePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(databaseDirectory, 'pulse.db')
const backupDirectory = path.join(databaseDirectory, 'backups')

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Database not found at ${sourcePath}`)
}

fs.mkdirSync(backupDirectory, { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const destinationPath = path.join(backupDirectory, `pulse-${timestamp}.db`)
const source = new Database(sourcePath, { readonly: true })

try {
  await source.backup(destinationPath)
} finally {
  source.close()
}

const backup = new Database(destinationPath, { readonly: true })
try {
  const integrity = backup.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${String(integrity)}`)
} finally {
  backup.close()
}

console.log(`Verified backup created: ${destinationPath}`)
