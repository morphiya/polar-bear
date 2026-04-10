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
    CREATE TABLE IF NOT EXISTS recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      freq TEXT NOT NULL,
      until_date TEXT,
      count INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS timeblocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#c9b8ff',
      end_date TEXT,
      recurrence_id INTEGER REFERENCES recurrences(id),
      recurrence_index INTEGER
    )
  `);

  // Миграции
  for (const col of ["end_date TEXT", "recurrence_id INTEGER", "recurrence_index INTEGER"]) {
    try { await db.execute(`ALTER TABLE timeblocks ADD COLUMN ${col}`); } catch (_) {}
  }
  await db.execute("UPDATE timeblocks SET end_date = date WHERE end_date IS NULL");

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
  const first = weekDates[0];
  const last = weekDates[weekDates.length - 1];
  return db.select(
    `SELECT * FROM timeblocks WHERE date <= $1 AND (end_date >= $2 OR end_date IS NULL) ORDER BY date, start_min`,
    [last, first]
  );
}

export async function createTimeblock({ date, type, start_min, end_min, color, end_date, recurrence_id, recurrence_index }) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO timeblocks (date, type, start_min, end_min, color, end_date, recurrence_id, recurrence_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [date, type, start_min, end_min, color, end_date ?? date, recurrence_id ?? null, recurrence_index ?? null]
  );
}

export async function updateTimeblock(id, { date, start_min, end_min, type, color, end_date }) {
  const db = await getDb();
  await db.execute(
    "UPDATE timeblocks SET date=$1, start_min=$2, end_min=$3, type=$4, color=$5, end_date=$6 WHERE id=$7",
    [date, start_min, end_min, type, color, end_date ?? date, id]
  );
}

export async function deleteTimeblock(id) {
  const db = await getDb();
  await db.execute("DELETE FROM timeblocks WHERE id=$1", [id]);
}

// --- Recurrence ---

function addFreq(dateStr, freq, n) {
  const d = new Date(dateStr);
  if (freq === "daily")   d.setDate(d.getDate() + n);
  if (freq === "weekly")  d.setDate(d.getDate() + n * 7);
  if (freq === "monthly") d.setMonth(d.getMonth() + n);
  return d.toISOString().split("T")[0];
}

export async function createRecurringTimeblock({ date, end_date, type, start_min, end_min, color, freq, until_date, count }) {
  const db = await getDb();

  // Сохраняем правило
  const result = await db.execute(
    "INSERT INTO recurrences (freq, until_date, count) VALUES ($1,$2,$3)",
    [freq, until_date ?? null, count ?? null]
  );
  const recurrence_id = result.lastInsertId;

  // Генерируем экземпляры
  const blockDuration = end_date !== date
    ? (() => { const d0 = new Date(date); const d1 = new Date(end_date); return Math.round((d1-d0)/86400000); })()
    : 0;

  const MAX = 366;
  let i = 0;
  let cur = date;

  while (i < MAX) {
    const curEnd = blockDuration > 0
      ? addFreq(cur, "daily", blockDuration)
      : cur;

    await db.execute(
      "INSERT INTO timeblocks (date,type,start_min,end_min,color,end_date,recurrence_id,recurrence_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [cur, type, start_min, end_min, color, curEnd, recurrence_id, i]
    );

    i++;
    const next = addFreq(date, freq, i);

    if (until_date && next > until_date) break;
    if (count && i >= count) break;

    cur = next;
  }
}

export async function getRecurrenceBlocks(recurrence_id) {
  const db = await getDb();
  return db.select(
    "SELECT * FROM timeblocks WHERE recurrence_id=$1 ORDER BY recurrence_index",
    [recurrence_id]
  );
}

// Удаление с областью: "this" | "following" | "all"
export async function deleteTimeblockScoped(block, scope) {
  const db = await getDb();
  const hasRecurrence = block.recurrence_id != null && block.recurrence_id !== 0;
  if (scope === "this" || !hasRecurrence) {
    await db.execute("DELETE FROM timeblocks WHERE id=$1", [block.id]);
  } else if (scope === "following") {
    await db.execute(
      "DELETE FROM timeblocks WHERE recurrence_id=$1 AND recurrence_index>=$2",
      [block.recurrence_id, block.recurrence_index]
    );
  } else if (scope === "all") {
    await db.execute("DELETE FROM timeblocks WHERE recurrence_id=$1", [block.recurrence_id]);
    await db.execute("DELETE FROM recurrences WHERE id=$1", [block.recurrence_id]);
  }
}

// Редактирование с областью
export async function updateTimeblockScoped(block, updates, scope) {
  const db = await getDb();
  const { date, start_min, end_min, type, color, end_date } = updates;

  const hasRecurrence = block.recurrence_id != null && block.recurrence_id !== 0;
  if (scope === "this" || !hasRecurrence) {
    // Отрываем от серии и обновляем
    await db.execute(
      "UPDATE timeblocks SET date=$1,start_min=$2,end_min=$3,type=$4,color=$5,end_date=$6,recurrence_id=NULL,recurrence_index=NULL WHERE id=$7",
      [date, start_min, end_min, type, color, end_date ?? date, block.id]
    );
  } else if (scope === "following") {
    // Смещение дат относительно оригинального блока
    const origDate = block.date;
    const blocks = await db.select(
      "SELECT * FROM timeblocks WHERE recurrence_id=$1 AND recurrence_index>=$2 ORDER BY recurrence_index",
      [block.recurrence_id, block.recurrence_index]
    );
    for (const b of blocks) {
      const dayOffset = Math.round((new Date(b.date) - new Date(origDate)) / 86400000);
      const newDate = addFreq(date, "daily", dayOffset);
      const newEndDate = end_date ? addFreq(end_date, "daily", dayOffset) : newDate;
      await db.execute(
        "UPDATE timeblocks SET date=$1,start_min=$2,end_min=$3,type=$4,color=$5,end_date=$6 WHERE id=$7",
        [newDate, start_min, end_min, type, color, newEndDate, b.id]
      );
    }
  } else if (scope === "all") {
    const blocks = await db.select(
      "SELECT * FROM timeblocks WHERE recurrence_id=$1 ORDER BY recurrence_index",
      [block.recurrence_id]
    );
    const firstDate = blocks[0]?.date ?? block.date;
    for (const b of blocks) {
      const dayOffset = Math.round((new Date(b.date) - new Date(firstDate)) / 86400000);
      const newDate = addFreq(date, "daily", dayOffset);
      const newEndDate = end_date ? addFreq(end_date, "daily", dayOffset) : newDate;
      await db.execute(
        "UPDATE timeblocks SET date=$1,start_min=$2,end_min=$3,type=$4,color=$5,end_date=$6 WHERE id=$7",
        [newDate, start_min, end_min, type, color, newEndDate, b.id]
      );
    }
  }
}
