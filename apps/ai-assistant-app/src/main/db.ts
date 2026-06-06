// Lokalna baza SQLite aplikacji (better-sqlite3) — stan UI, którego nie trzymamy
// w backendzie: układ okien edytorów per projekt i geometria okna głównego. Ładujemy
// natywny moduł DEFENSYWNIE; gdy się nie zbuduje, schodzimy do electron-store, żeby
// brak binarki nigdy nie wywalił startu aplikacji.
import { app } from 'electron'
import { join } from 'path'

type RunResult = { lastInsertRowid: number | bigint; changes: number }
type Stmt = {
  get: (...a: unknown[]) => unknown
  all: (...a: unknown[]) => unknown[]
  run: (...a: unknown[]) => RunResult
}
type DB = {
  prepare: (sql: string) => Stmt
  exec: (sql: string) => void
  pragma: (s: string) => void
  transaction: <T extends (...a: unknown[]) => unknown>(fn: T) => T
}

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
    d.exec(
      'CREATE TABLE IF NOT EXISTS tasks (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'title TEXT NOT NULL, ' +
        'description TEXT NOT NULL DEFAULT "", ' +
        'status TEXT NOT NULL DEFAULT "todo", ' +
        'jira_key TEXT NOT NULL DEFAULT "", ' +
        'branch TEXT NOT NULL DEFAULT "", ' +
        'active INTEGER NOT NULL DEFAULT 0, ' +
        'project TEXT NOT NULL DEFAULT "", ' +
        'created_at INTEGER NOT NULL, ' +
        'updated_at INTEGER NOT NULL)'
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

// ---- Tasks store (view 4) ----------------------------------------------------
// Tasks live in the SQLite `tasks` table when better-sqlite3 is available; when it
// is not, we degrade to an array kept in app_state via kvGet/kvSet so the feature
// keeps working (just without SQL queries).

export type Task = {
  id: number
  title: string
  description: string
  status: 'todo' | 'doing' | 'done'
  jiraKey?: string
  branch?: string
  active: boolean
  project: string
  createdAt: number
  updatedAt: number
}

type TaskRow = {
  id: number
  title: string
  description: string
  status: string
  jira_key: string
  branch: string
  active: number
  project: string
  created_at: number
  updated_at: number
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: (r.status as Task['status']) || 'todo',
    jiraKey: r.jira_key || undefined,
    branch: r.branch || undefined,
    active: !!r.active,
    project: r.project,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

// fallbackTasks reads the array kept in app_state (used when SQLite is unavailable).
function fallbackTasks(): Task[] {
  return kvGet<Task[]>('tasks:all') ?? []
}

function setFallbackTasks(list: Task[]): void {
  kvSet('tasks:all', list)
}

// tasksList returns tasks for a project ('' = all), newest first.
export function tasksList(project: string): Task[] {
  const d = open()

  if (d) {
    const rows = project
      ? (d.prepare('SELECT * FROM tasks WHERE project = ? ORDER BY id DESC').all(project) as TaskRow[])
      : (d.prepare('SELECT * FROM tasks ORDER BY id DESC').all() as TaskRow[])

    return rows.map(rowToTask)
  }

  const all = fallbackTasks()

  return all.filter((t) => !project || t.project === project).sort((a, b) => b.id - a.id)
}

// tasksSave upserts a task. When id is missing/0 a new row is created.
export function tasksSave(t: {
  id?: number
  title: string
  description?: string
  status?: string
  jiraKey?: string
  branch?: string
  project: string
}): Task {
  const now = Date.now()
  const d = open()

  if (d) {
    if (t.id) {
      d.prepare(
        'UPDATE tasks SET title = ?, description = ?, status = ?, jira_key = ?, branch = ?, project = ?, updated_at = ? WHERE id = ?'
      ).run(t.title, t.description ?? '', t.status ?? 'todo', t.jiraKey ?? '', t.branch ?? '', t.project, now, t.id)

      const row = d.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id) as TaskRow

      return rowToTask(row)
    }

    const res = d
      .prepare(
        'INSERT INTO tasks (title, description, status, jira_key, branch, active, project, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)'
      )
      .run(t.title, t.description ?? '', t.status ?? 'todo', t.jiraKey ?? '', t.branch ?? '', t.project, now, now)
    const row = d.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(res.lastInsertRowid)) as TaskRow

    return rowToTask(row)
  }

  const all = fallbackTasks()

  if (t.id) {
    const idx = all.findIndex((x) => x.id === t.id)

    if (idx >= 0) {
      const merged: Task = {
        ...all[idx],
        title: t.title,
        description: t.description ?? '',
        status: (t.status as Task['status']) ?? all[idx].status,
        jiraKey: t.jiraKey,
        branch: t.branch,
        project: t.project,
        updatedAt: now
      }
      all[idx] = merged
      setFallbackTasks(all)

      return merged
    }
  }

  const nextId = all.reduce((m, x) => Math.max(m, x.id), 0) + 1
  const created: Task = {
    id: nextId,
    title: t.title,
    description: t.description ?? '',
    status: (t.status as Task['status']) ?? 'todo',
    jiraKey: t.jiraKey,
    branch: t.branch,
    active: false,
    project: t.project,
    createdAt: now,
    updatedAt: now
  }
  all.push(created)
  setFallbackTasks(all)

  return created
}

// tasksDelete removes a task by id; returns whether a row was removed.
export function tasksDelete(id: number): boolean {
  const d = open()

  if (d) {
    const res = d.prepare('DELETE FROM tasks WHERE id = ?').run(id)

    return res.changes > 0
  }

  const all = fallbackTasks()
  const next = all.filter((t) => t.id !== id)
  setFallbackTasks(next)

  return next.length !== all.length
}

// tasksSetActive marks one task active and clears active on every other task.
export function tasksSetActive(id: number): Task {
  const now = Date.now()
  const d = open()

  if (d) {
    const tx = d.transaction(() => {
      d.prepare('UPDATE tasks SET active = 0, updated_at = ? WHERE active = 1').run(now)
      d.prepare('UPDATE tasks SET active = 1, updated_at = ? WHERE id = ?').run(now, id)
    })
    tx()

    const row = d.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow

    return rowToTask(row)
  }

  const all = fallbackTasks()
  let found: Task | null = null

  for (const t of all) {
    const active = t.id === id

    if (t.active !== active) {
      t.active = active
      t.updatedAt = now
    }

    if (active) {
      found = t
    }
  }

  setFallbackTasks(all)

  return found ?? tasksList('')[0]
}

// ---- Jira config -------------------------------------------------------------
export type JiraConfig = { baseUrl: string; email: string; token: string; project: string }

export function jiraGetConfig(): JiraConfig | null {
  return kvGet<JiraConfig>('jira:config')
}

export function jiraSetConfig(cfg: JiraConfig): void {
  kvSet('jira:config', cfg)
}

// ---- Stats counters (topbar) -------------------------------------------------
// Daily counters; the stored `day` (YYYY-MM-DD) resets the counters when the date
// rolls over so the topbar always shows "today".
export type Stats = { keystrokes: number; lines: number; tasks: number; day: string }

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function freshStats(): Stats {
  return { keystrokes: 0, lines: 0, tasks: 0, day: todayKey() }
}

export function statsGet(): Stats {
  const cur = kvGet<Stats>('stats:daily')
  const today = todayKey()

  if (!cur || cur.day !== today) {
    const next = freshStats()
    kvSet('stats:daily', next)

    return next
  }

  return cur
}

export function statsBump(field: 'keystrokes' | 'lines' | 'tasks', by = 1): Stats {
  const cur = statsGet()
  const next: Stats = { ...cur, [field]: cur[field] + by }
  kvSet('stats:daily', next)

  return next
}
