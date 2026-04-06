import Database from "@tauri-apps/plugin-sql";

let _db = null;

export async function getDb() {
  if (_db) return _db;

  const db = await Database.load("sqlite:polar-bear.db");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      date TEXT PRIMARY KEY,
      mood INTEGER NOT NULL,
      note TEXT DEFAULT ''
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS timeblocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#c9b8ff'
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      note TEXT DEFAULT ''
    )
  `);

  _db = db;
  return _db;
}
