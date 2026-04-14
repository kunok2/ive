import Database from 'better-sqlite3'
import path from 'path'
import { startScanner } from '../scanner'
import { initSchema } from './schema'

declare global {
  var db: Database.Database | undefined;
}

export function getDb() {
  if (!global.db) {
    const dbPath = path.join(process.cwd(), 'data', 'spring-ive.db')
    const db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
    initSchema(db)
    global.db = db

    if (process.env.NODE_ENV !== 'test') {
      startScanner();
    }
  }
  return global.db
}
