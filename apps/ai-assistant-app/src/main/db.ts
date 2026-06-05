// Lokalna baza SQLite aplikacji (better-sqlite3) — stan UI, którego nie trzymamy
// w backendzie: układ okien edytorów per projekt i geometria okna głównego. Ładujemy
// natywny moduł DEFENSYWNIE; gdy się nie zbuduje, schodzimy do electron-store, żeby
// brak binarki nigdy nie wywalił startu aplikacji.
import { app } from 'electron'
import { join } from 'path'

type Stmt = { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown }
type DB = { prepare: (sql: string) => Stmt; exec: (sql: string) => void; pragma: (s: string) => void }

// undefined = jeszcze nie próbowano otworzyć; null = SQLite niedostępny (fallback).
let db: DB | null | undefined
let fallback: { get: (k: string) => unknown; set: (k: string, v: unknown) => void } | null = null

function open(): DB | null {
  if (db !== undefined) {
    return db
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3')
    const file = join(app.getPath('userData'), 'ai-architect.db')
    const d: DB = new Database(file)

    d.pragma('journal_mode = WAL')
    d.exec(
      'CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'
    )
    db = d
  } catch (e) {
    console.error('[db] better-sqlite3 niedostępny — fallback do electron-store:', (e as Error).message)
    db = null
  }

  return db
}

function store(): { get: (k: string) => unknown; set: (k: string, v: unknown) => void } {
  if (!fallback) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Store = require('electron-store')
    fallback = new Store({ name: 'app-state' })
  }

  return fallback!
}

// kvGet zwraca zdeserializowaną wartość spod klucza (lub null, gdy brak/błąd).
export function kvGet<T = unknown>(key: string): T | null {
  const d = open()

  if (d) {
    try {
      const row = d.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined

      return row ? (JSON.parse(row.value) as T) : null
    } catch {
      return null
    }
  }

  const v = store().get(key)

  return v === undefined || v === null ? null : (v as T)
}

// kvSet zapisuje wartość (JSON) pod kluczem (upsert).
export function kvSet(key: string, value: unknown): void {
  const d = open()

  if (d) {
    try {
      d.prepare(
        'INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).run(key, JSON.stringify(value), Date.now())
    } catch (e) {
      console.error('[db] zapis nieudany:', (e as Error).message)
    }

    return
  }

  store().set(key, value)
}
