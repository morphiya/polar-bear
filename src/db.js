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

// --- Timeblocks ---

export async function getTimeblocks(weekDates) {
  const db = await getDb();
  const placeholders = weekDates.map((_, i) => `$${i + 1}`).join(", ");
  return db.select(
    `SELECT * FROM timeblocks WHERE date IN (${placeholders}) ORDER BY date, start_min`,
    weekDates
  );
}

export async function createTimeblock({ date, type, start_min, end_min, color }) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO timeblocks (date, type, start_min, end_min, color) VALUES ($1, $2, $3, $4, $5)",
    [date, type, start_min, end_min, color]
  );
}

export async function updateTimeblock(id, { date, start_min, end_min, type, color }) {
  const db = await getDb();
  await db.execute(
    "UPDATE timeblocks SET date = $1, start_min = $2, end_min = $3, type = $4, color = $5 WHERE id = $6",
    [date, start_min, end_min, type, color, id]
  );
}

export async function deleteTimeblock(id) {
  const db = await getDb();
  await db.execute("DELETE FROM timeblocks WHERE id = $1", [id]);
}
