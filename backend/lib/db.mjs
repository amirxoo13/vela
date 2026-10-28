import { createHmac, randomBytes } from "node:crypto";
import { accessSync, constants, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

let db = null;
let dirCache = null;
let warned = false;

/** Directory that holds melobi.db, avatars, and the generated session secret. */
export function dataDir() {
  if (dirCache) return dirCache;
  const fromEnv = process.env.MELOBI_DATA_DIR?.trim();
  if (fromEnv) {
    mkdirSync(fromEnv, { recursive: true });
    dirCache = fromEnv;
    return dirCache;
  }
  const persistent = "/opt/melobi/data";
  try {
    mkdirSync(persistent, { recursive: true });
    accessSync(persistent, constants.W_OK);
    dirCache = persistent;
    return dirCache;
  } catch {
    if (!warned) {
      warned = true;
      console.warn(
        "MELOBI_DATA_DIR is unset and /opt/melobi/data is not writable. Using backend/data. " +
          "On the server, create /opt/melobi/data (or set MELOBI_DATA_DIR) so accounts survive redeploys.",
      );
    }
    const fallback = join(here, "..", "data");
    mkdirSync(fallback, { recursive: true });
    dirCache = fallback;
    return dirCache;
  }
}

export function sessionSecret() {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const file = join(dataDir(), "session.secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* create below */
  }
  const created = randomBytes(32).toString("base64url");
  writeFileSync(file, created + "\n", { mode: 0o600 });
  return created;
}

export function hashToken(token) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function applyMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    database
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => row.id),
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(name, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function getDb() {
  if (db) return db;
  const file = join(dataDir(), "melobi.db");
  const database = new DatabaseSync(file);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  applyMigrations(database);
  mkdirSync(join(dataDir(), "avatars"), { recursive: true });
  db = database;
  return db;
}

export function openAccounts() {
  getDb();
}

export function closeAccounts() {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  db = null;
  dirCache = null;
  warned = false;
}
