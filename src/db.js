import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "tracker.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,              -- YYYY-MM-DD (user's local day)
    time            TEXT,                       -- HH:MM (user's local time)
    kind            TEXT NOT NULL CHECK (kind IN ('food','exercise','water','weight')),
    meal            TEXT,                       -- breakfast | lunch | dinner | snack
    name            TEXT,
    quantity        TEXT,
    calories        REAL,
    protein_g       REAL,
    carbs_g         REAL,
    fat_g           REAL,
    fiber_g         REAL,
    sugar_g         REAL,
    sodium_mg       REAL,
    duration_min    REAL,
    calories_burned REAL,
    amount_ml       REAL,
    weight_kg       REAL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS entries_date ON entries(date);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS messages_date ON messages(date);

  CREATE TABLE IF NOT EXISTS goals (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    calories    REAL NOT NULL DEFAULT 2200,
    protein_g   REAL NOT NULL DEFAULT 140,
    carbs_g     REAL NOT NULL DEFAULT 240,
    fat_g       REAL NOT NULL DEFAULT 70,
    water_ml    REAL NOT NULL DEFAULT 2500,
    target_weight_kg REAL,
    notes       TEXT
  );
  INSERT OR IGNORE INTO goals (id) VALUES (1);
`);

const ENTRY_COLUMNS = [
  "date", "time", "kind", "meal", "name", "quantity", "calories", "protein_g",
  "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "duration_min",
  "calories_burned", "amount_ml", "weight_kg", "notes",
];
const GOAL_COLUMNS = ["calories", "protein_g", "carbs_g", "fat_g", "water_ml", "target_weight_kg", "notes"];

const pick = (obj, cols) =>
  Object.fromEntries(cols.filter((c) => obj[c] !== undefined).map((c) => [c, obj[c] ?? null]));

export function addEntry(entry) {
  const row = pick(entry, ENTRY_COLUMNS);
  const cols = Object.keys(row);
  const stmt = db.prepare(
    `INSERT INTO entries (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
  );
  const { lastInsertRowid } = stmt.run(...Object.values(row));
  return getEntry(Number(lastInsertRowid));
}

export function getEntry(id) {
  return db.prepare("SELECT * FROM entries WHERE id = ?").get(id) ?? null;
}

export function updateEntry(id, fields) {
  const row = pick(fields, ENTRY_COLUMNS.filter((c) => c !== "kind"));
  const cols = Object.keys(row);
  if (cols.length === 0) return getEntry(id);
  db.prepare(`UPDATE entries SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .run(...Object.values(row), id);
  return getEntry(id);
}

export function deleteEntry(id) {
  return db.prepare("DELETE FROM entries WHERE id = ?").run(id).changes > 0;
}

export function entriesForDate(date) {
  return db.prepare("SELECT * FROM entries WHERE date = ? ORDER BY time, id").all(date);
}

export function getGoals() {
  return db.prepare("SELECT * FROM goals WHERE id = 1").get();
}

export function setGoals(fields) {
  const row = pick(fields, GOAL_COLUMNS);
  const cols = Object.keys(row);
  if (cols.length) {
    db.prepare(`UPDATE goals SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = 1`)
      .run(...Object.values(row));
  }
  return getGoals();
}

function totalsFrom(entries) {
  const t = {
    calories_in: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0,
    sodium_mg: 0, calories_burned: 0, exercise_min: 0, water_ml: 0, weight_kg: null,
  };
  for (const e of entries) {
    if (e.kind === "food") {
      t.calories_in += e.calories ?? 0;
      for (const k of ["protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"]) t[k] += e[k] ?? 0;
    } else if (e.kind === "exercise") {
      t.calories_burned += e.calories_burned ?? 0;
      t.exercise_min += e.duration_min ?? 0;
    } else if (e.kind === "water") {
      t.water_ml += e.amount_ml ?? 0;
    } else if (e.kind === "weight") {
      t.weight_kg = e.weight_kg; // last weigh-in of the day wins
    }
  }
  for (const k of Object.keys(t)) if (typeof t[k] === "number") t[k] = Math.round(t[k] * 10) / 10;
  t.net_calories = Math.round((t.calories_in - t.calories_burned) * 10) / 10;
  return t;
}

export function daySummary(date) {
  const entries = entriesForDate(date);
  return { date, totals: totalsFrom(entries), goals: getGoals(), entries };
}

/** Per-day totals for the `days` days ending at `endDate` (inclusive), oldest first. */
export function history(endDate, days) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, ...totalsFrom(entriesForDate(date)) });
  }
  return out;
}

export function addMessage(date, role, text) {
  db.prepare("INSERT INTO messages (date, role, text) VALUES (?, ?, ?)").run(date, role, text);
}

export function messagesForDate(date, limit = 40) {
  return db
    .prepare("SELECT role, text, created_at FROM messages WHERE date = ? ORDER BY id DESC LIMIT ?")
    .all(date, limit)
    .reverse();
}
