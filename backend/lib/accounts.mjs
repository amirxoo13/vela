/**
 * Email/password accounts and the per-user library.
 * The upstream Radiojavan token is never read here.
 */
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeAccounts, dataDir, getDb, hashToken, openAccounts } from "./db.mjs";

export { closeAccounts, openAccounts };

const scryptAsync = promisify(scrypt);
const COOKIE = "melobi_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const SIGNUP_LIMIT = 5;
const THEMES = new Set(["green", "crimson", "night", "ice"]);
const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function json(status, data, cookies) {
  return { status, json: data, cookies };
}

function fail(status, code, message) {
  return json(status, { error: { status, code, message } });
}

function ok(data, cookies) {
  return json(200, { data }, cookies);
}

export function accountPath(pathname) {
  const path = normalizePath(pathname);
  return (
    path.startsWith("/api/v1/auth") ||
    path.startsWith("/api/v1/me") ||
    path.startsWith("/api/v1/avatars/")
  );
}

function normalizePath(pathname) {
  const path = String(pathname || "/").split("?")[0];
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value == null ? "" : String(value);
}

function readCookie(headers, name) {
  const raw = header(headers, "cookie");
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return "";
}

function wantsSecure(headers) {
  const flag = process.env.COOKIE_SECURE?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  const proto = header(headers, "x-forwarded-proto").split(",")[0].trim().toLowerCase();
  return proto === "https";
}

function cookieHeader(token, headers, maxAgeSec) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (wantsSecure(headers)) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(headers) {
  return cookieHeader("", headers, 0);
}

function cleanEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function cleanName(value, fallback) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return text || fallback;
}

function nameFromEmail(email) {
  const local = email.split("@")[0] || "Listener";
  const cleaned = cleanName(local.replace(/[._-]+/g, " "), "Listener");
  return cleaned || "Listener";
}

function cleanId(value) {
  const id = String(value ?? "").trim();
  return ID_RE.test(id) ? id : null;
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanUrl(value) {
  const text = String(value ?? "").trim().slice(0, 2000);
  if (!text) return "";
  if (text.startsWith("/api/") || text.startsWith("/m/")) return text;
  if (/^https?:\/\//i.test(text)) return text;
  return "";
}

function cleanTheme(value) {
  return THEMES.has(value) ? value : null;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$8$1$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, "base64url");
    expected = Buffer.from(hashB64, "base64url");
  } catch {
    return false;
  }
  if (!salt.length || expected.length !== 32) return false;
  const key = Buffer.from(await scryptAsync(password, salt, expected.length, { N, r, p }));
  return timingSafeEqual(key, expected);
}

function publicUser(row) {
  const avatar =
    row.avatar_kind === "upload"
      ? { type: "upload", url: `/api/v1/avatars/${row.id}?v=${row.updated_at}` }
      : { type: "preset", id: String(row.avatar_value || "1") };
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatar,
    createdAt: row.created_at,
  };
}

function trackFromRow(row, atKey) {
  return {
    id: row.track_id,
    title: row.title,
    artist: row.artist,
    cover: row.cover,
    duration: row.duration,
    streamUrl: row.stream_url,
    downloadPath: row.download_path,
    ...(atKey ? { at: row[atKey] } : {}),
  };
}

function cleanTrack(input) {
  if (!input || typeof input !== "object") return null;
  const id = cleanId(input.id);
  if (!id) return null;
  const title = cleanText(input.title, 200) || "Track";
  return {
    id,
    title,
    artist: cleanText(input.artist, 200),
    cover: cleanUrl(input.cover),
    duration: Number.isFinite(Number(input.duration)) ? Math.max(0, Number(input.duration)) : 0,
    streamUrl: cleanUrl(input.streamUrl ?? input.stream_url),
    downloadPath: cleanUrl(input.downloadPath ?? input.download_path),
  };
}

function readLibrary(db, userId) {
  const user = db.prepare("SELECT library_imported FROM users WHERE id = ?").get(userId);
  const likes = db
    .prepare("SELECT * FROM likes WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)
    .map((row) => trackFromRow(row));
  const lists = db
    .prepare("SELECT * FROM playlists WHERE user_id = ? ORDER BY position ASC, created_at DESC")
    .all(userId);
  const playlists = lists.map((list) => ({
    id: list.id,
    name: list.name,
    tracks: db
      .prepare("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC")
      .all(list.id)
      .map((row) => trackFromRow(row)),
  }));
  const history = db
    .prepare("SELECT * FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT 80")
    .all(userId)
    .map((row) => trackFromRow(row, "played_at"));
  const follows = db
    .prepare("SELECT * FROM follows WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)
    .map((row) => ({ id: row.artist_id, name: row.name, image: row.image }));
  const albums = db
    .prepare("SELECT * FROM saved_albums WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)
    .map((row) => ({
      id: row.album_id,
      title: row.title,
      artist: row.artist,
      cover: row.cover,
      year: row.year,
    }));
  const settings = db.prepare("SELECT theme FROM settings WHERE user_id = ?").get(userId);
  return {
    imported: !!user?.library_imported,
    liked: likes,
    playlists,
    history,
    follows,
    albums,
    theme: settings?.theme && THEMES.has(settings.theme) ? settings.theme : "green",
  };
}

function sessionUser(db, headers) {
  const token = readCookie(headers, COOKIE);
  if (!token) return null;
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT users.*, sessions.expires_at AS session_expires, sessions.token_hash AS token_hash
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(hashToken(token));
  if (!row || row.session_expires < now) {
    if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.token_hash);
    return null;
  }
  let renewed = null;
  if (row.session_expires - now < RENEW_MS) {
    const expires = now + SESSION_MS;
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(expires, row.token_hash);
    renewed = cookieHeader(token, headers, Math.floor(SESSION_MS / 1000));
  }
  return { user: row, token, renewed };
}

function issueSession(db, userId, headers) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now + SESSION_MS,
    now,
  );
  return cookieHeader(token, headers, Math.floor(SESSION_MS / 1000));
}

function pruneAttempts(db) {
  db.prepare("DELETE FROM login_attempts WHERE at < ?").run(Date.now() - 60 * 60 * 1000);
}

function attemptCount(db, bucket, windowMs) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE bucket = ? AND at > ?").get(bucket, Date.now() - windowMs);
  return row?.n ?? 0;
}

function recordAttempt(db, bucket) {
  db.prepare("INSERT INTO login_attempts (bucket, at) VALUES (?, ?)").run(bucket, Date.now());
}

function limited(db, buckets, limit) {
  return buckets.some((bucket) => attemptCount(db, bucket, WINDOW_MS) >= limit);
}

function upsertTrackList(db, playlistId, tracks) {
  db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
  const insert = db.prepare(
    `INSERT INTO playlist_tracks
      (playlist_id, track_id, position, title, artist, cover, duration, stream_url, download_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seen = new Set();
  let position = 0;
  for (const raw of tracks.slice(0, 500)) {
    const track = cleanTrack(raw);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    insert.run(
      playlistId,
      track.id,
      position,
      track.title,
      track.artist,
      track.cover,
      track.duration,
      track.streamUrl,
      track.downloadPath,
    );
    position += 1;
  }
}

function saveLike(db, userId, track) {
  db.prepare(
    `INSERT INTO likes (user_id, track_id, title, artist, cover, duration, stream_url, download_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, track_id) DO UPDATE SET
       title = excluded.title,
       artist = excluded.artist,
       cover = excluded.cover,
       duration = excluded.duration,
       stream_url = excluded.stream_url,
       download_path = excluded.download_path`,
  ).run(userId, track.id, track.title, track.artist, track.cover, track.duration, track.streamUrl, track.downloadPath, Date.now());
}

function saveHistory(db, userId, track, at) {
  const played = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  db.prepare(
    `INSERT INTO history (user_id, track_id, title, artist, cover, duration, stream_url, download_path, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, track_id) DO UPDATE SET
       title = excluded.title,
       artist = excluded.artist,
       cover = excluded.cover,
       duration = excluded.duration,
       stream_url = excluded.stream_url,
       download_path = excluded.download_path,
       played_at = excluded.played_at`,
  ).run(userId, track.id, track.title, track.artist, track.cover, track.duration, track.streamUrl, track.downloadPath, played);
  db.prepare(
    `DELETE FROM history WHERE user_id = ? AND track_id NOT IN (
       SELECT track_id FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT 80
     )`,
  ).run(userId, userId);
}

function requireUser(db, headers) {
  const session = sessionUser(db, headers);
  if (!session) return { error: fail(401, "UNAUTHENTICATED", "Sign in to continue") };
  return session;
}

function playlistFor(db, userId, id) {
  return db.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").get(id, userId);
}

function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", type: "image/png" };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", type: "image/jpeg" };
  }
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", type: "image/webp" };
  }
  return null;
}

function decodeImage(value) {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(String(value ?? ""));
  if (!match) return null;
  const buf = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (buf.length < 32 || buf.length > 1_400_000) return null;
  const kind = sniffImage(buf);
  if (!kind) return null;
  return { buf, ...kind };
}

function removeAvatarFiles(userId) {
  const folder = join(dataDir(), "avatars");
  let names = [];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(`${userId}.`)) {
      try {
        unlinkSync(join(folder, name));
      } catch {
        /* already gone */
      }
    }
  }
}

function bodyObject(body) {
  if (body == null || body === "") return {};
  if (Buffer.isBuffer(body)) {
    if (!body.length) return {};
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return null;
    }
  }
  if (typeof body === "string") {
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof body === "object") return body;
  return null;
}

async function importLibrary(db, userId, payload) {
  const liked = Array.isArray(payload.liked) ? payload.liked.slice(0, 500) : [];
  const playlists = Array.isArray(payload.playlists) ? payload.playlists.slice(0, 100) : [];
  const history = Array.isArray(payload.history) ? payload.history.slice(0, 80) : [];
  const follows = Array.isArray(payload.follows) ? payload.follows.slice(0, 200) : [];
  const albums = Array.isArray(payload.albums) ? payload.albums.slice(0, 200) : [];
  const theme = cleanTheme(payload.theme);
  const now = Date.now();
  db.exec("BEGIN");
  try {
    for (const raw of liked) {
      const track = cleanTrack(raw);
      if (track) saveLike(db, userId, track);
    }
    let position = db.prepare("SELECT COALESCE(MAX(position), -1) AS n FROM playlists WHERE user_id = ?").get(userId).n;
    for (const raw of playlists) {
      if (!raw || typeof raw !== "object") continue;
      let id = cleanId(raw.id);
      const name = cleanText(raw.name, 80) || "Playlist";
      if (id) {
        const owner = db.prepare("SELECT user_id FROM playlists WHERE id = ?").get(id);
        if (owner && owner.user_id !== userId) id = null;
      }
      if (!id) id = `pl-${randomUUID()}`;
      const existing = playlistFor(db, userId, id);
      if (!existing) {
        position += 1;
        db.prepare(
          "INSERT INTO playlists (id, user_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, userId, name, position, now, now);
      } else if (name) {
        db.prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?").run(name, now, id);
      }
      const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
      if (tracks.length) upsertTrackList(db, id, tracks);
    }
    for (const raw of history) {
      const track = cleanTrack(raw);
      if (track) saveHistory(db, userId, track, raw.at);
    }
    const followStmt = db.prepare(
      `INSERT INTO follows (user_id, artist_id, name, image, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, artist_id) DO UPDATE SET name = excluded.name, image = excluded.image`,
    );
    for (const raw of follows) {
      if (!raw || typeof raw !== "object") continue;
      const id = cleanId(raw.id);
      if (!id) continue;
      followStmt.run(userId, id, cleanText(raw.name, 200) || "Artist", cleanUrl(raw.image), now);
    }
    const albumStmt = db.prepare(
      `INSERT INTO saved_albums (user_id, album_id, title, artist, cover, year, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, album_id) DO UPDATE SET
         title = excluded.title, artist = excluded.artist, cover = excluded.cover, year = excluded.year`,
    );
    for (const raw of albums) {
      if (!raw || typeof raw !== "object") continue;
      const id = cleanId(raw.id);
      if (!id) continue;
      albumStmt.run(
        userId,
        id,
        cleanText(raw.title, 200) || "Album",
        cleanText(raw.artist, 200),
        cleanUrl(raw.cover),
        cleanText(raw.year, 16),
        now,
      );
    }
    if (theme) {
      db.prepare(
        `INSERT INTO settings (user_id, theme, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`,
      ).run(userId, theme, now);
    }
    db.prepare("UPDATE users SET library_imported = 1, updated_at = ? WHERE id = ?").run(now, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * @param {{ method: string, path: string, headers?: Record<string, string | string[] | undefined>, body?: unknown, ip?: string }} input
 */
export async function dispatchAccount(input) {
  const method = String(input.method || "GET").toUpperCase();
  const path = normalizePath(input.path);
  const headers = input.headers || {};
  const ip = String(input.ip || "local").slice(0, 64);
  if (!accountPath(path)) return null;
  if (method === "OPTIONS") {
    return {
      status: 204,
      json: null,
      headers: {
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, accept",
        "access-control-max-age": "600",
      },
    };
  }

  let db;
  try {
    db = getDb();
  } catch {
    return fail(500, "INTERNAL", "Account storage is unavailable");
  }

  try {
    if (method === "GET" && path.startsWith("/api/v1/avatars/")) {
      const userId = cleanId(decodeURIComponent(path.slice("/api/v1/avatars/".length)));
      if (!userId) return fail(400, "INVALID_ID", "Invalid id");
      const row = db.prepare("SELECT avatar_kind, avatar_value FROM users WHERE id = ?").get(userId);
      if (!row || row.avatar_kind !== "upload") return fail(404, "NOT_FOUND", "Avatar not found");
      const file = join(dataDir(), "avatars", row.avatar_value);
      let buf;
      try {
        buf = readFileSync(file);
      } catch {
        return fail(404, "NOT_FOUND", "Avatar not found");
      }
      const kind = sniffImage(buf);
      return {
        status: 200,
        raw: buf,
        headers: {
          "content-type": kind?.type || "application/octet-stream",
          "cache-control": "public, max-age=86400",
          "x-content-type-options": "nosniff",
        },
      };
    }

    const payload = method === "GET" || method === "HEAD" ? {} : bodyObject(input.body);
    if (payload == null) return fail(400, "INVALID_BODY", "Expected JSON");

    if (method === "POST" && path === "/api/v1/auth/signup") {
      pruneAttempts(db);
      if (limited(db, [`signup:${ip}`], SIGNUP_LIMIT)) {
        return fail(429, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
      }
      const email = cleanEmail(payload.email);
      const password = String(payload.password ?? "");
      if (!email) return fail(400, "INVALID_EMAIL", "Enter a valid email address");
      if (password.length < 8 || password.length > 128) {
        return fail(400, "INVALID_PASSWORD", "Use a password between 8 and 128 characters");
      }
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) {
        recordAttempt(db, `signup:${ip}`);
        return fail(409, "EMAIL_TAKEN", "An account with that email already exists");
      }
      const id = randomUUID();
      const now = Date.now();
      const displayName = cleanName(payload.displayName, nameFromEmail(email));
      const passwordHash = await hashPassword(password);
      db.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, avatar_kind, avatar_value, library_imported, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'preset', '1', 0, ?, ?)`,
      ).run(id, email, passwordHash, displayName, now, now);
      db.prepare("INSERT INTO settings (user_id, theme, updated_at) VALUES (?, 'green', ?)").run(id, now);
      const cookie = issueSession(db, id, headers);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return ok({ user: publicUser(user) }, [cookie]);
    }

    if (method === "POST" && path === "/api/v1/auth/login") {
      pruneAttempts(db);
      const email = cleanEmail(payload.email) || "";
      const password = String(payload.password ?? "");
      const buckets = [`login:${ip}`];
      if (email) buckets.push(`login-email:${email}`);
      if (limited(db, buckets, LOGIN_LIMIT)) {
        return fail(429, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
      }
      const user = email ? db.prepare("SELECT * FROM users WHERE email = ?").get(email) : null;
      const match = user ? await verifyPassword(password, user.password_hash) : false;
      if (!user || !match) {
        recordAttempt(db, `login:${ip}`);
        if (email) recordAttempt(db, `login-email:${email}`);
        return fail(401, "INVALID_LOGIN", "Email or password is incorrect");
      }
      const cookie = issueSession(db, user.id, headers);
      return ok({ user: publicUser(user) }, [cookie]);
    }

    if (method === "POST" && path === "/api/v1/auth/logout") {
      const token = readCookie(headers, COOKIE);
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
      return ok({ ok: true }, [clearCookie(headers)]);
    }

    if (method === "GET" && path === "/api/v1/auth/me") {
      const session = sessionUser(db, headers);
      if (!session) return ok(null);
      const cookies = session.renewed ? [session.renewed] : undefined;
      return ok({ user: publicUser(session.user) }, cookies);
    }

    if (method === "PATCH" && path === "/api/v1/auth/me") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const user = session.user;
      let displayName = user.display_name;
      if (payload.displayName != null) {
        displayName = cleanName(payload.displayName, "");
        if (!displayName) return fail(400, "INVALID_NAME", "Enter a display name");
      }
      let avatarKind = user.avatar_kind;
      let avatarValue = user.avatar_value;
      if (payload.avatarPreset != null) {
        const preset = String(payload.avatarPreset);
        if (!/^[1-8]$/.test(preset)) return fail(400, "INVALID_AVATAR", "Choose an avatar");
        removeAvatarFiles(user.id);
        avatarKind = "preset";
        avatarValue = preset;
      }
      if (payload.avatarData != null) {
        const image = decodeImage(payload.avatarData);
        if (!image) return fail(400, "INVALID_AVATAR", "Use a PNG, JPEG, or WebP image under 1.4 MB");
        removeAvatarFiles(user.id);
        const filename = `${user.id}.${image.ext}`;
        writeFileSync(join(dataDir(), "avatars", filename), image.buf, { mode: 0o600 });
        avatarKind = "upload";
        avatarValue = filename;
      }
      const now = Date.now();
      db.prepare("UPDATE users SET display_name = ?, avatar_kind = ?, avatar_value = ?, updated_at = ? WHERE id = ?").run(
        displayName,
        avatarKind,
        avatarValue,
        now,
        user.id,
      );
      const next = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      return ok({ user: publicUser(next) }, session.renewed ? [session.renewed] : undefined);
    }

    if (method === "POST" && path === "/api/v1/auth/password") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const current = String(payload.currentPassword ?? "");
      const next = String(payload.newPassword ?? "");
      if (next.length < 8 || next.length > 128) {
        return fail(400, "INVALID_PASSWORD", "Use a password between 8 and 128 characters");
      }
      const match = await verifyPassword(current, session.user.password_hash);
      if (!match) return fail(401, "INVALID_LOGIN", "Current password is incorrect");
      const passwordHash = await hashPassword(next);
      const now = Date.now();
      db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now, session.user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(session.user.id);
      const cookie = issueSession(db, session.user.id, headers);
      return ok({ ok: true }, [cookie]);
    }

    if (method === "DELETE" && path === "/api/v1/auth/me") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const match = await verifyPassword(String(payload.password ?? ""), session.user.password_hash);
      if (!match) return fail(401, "INVALID_LOGIN", "Password is incorrect");
      removeAvatarFiles(session.user.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(session.user.id);
      return ok({ ok: true }, [clearCookie(headers)]);
    }

    if (method === "GET" && path === "/api/v1/me/library") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      return ok(readLibrary(db, session.user.id), session.renewed ? [session.renewed] : undefined);
    }

    if (method === "POST" && path === "/api/v1/me/library/import") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      if (!session.user.library_imported) await importLibrary(db, session.user.id, payload);
      return ok(readLibrary(db, session.user.id));
    }

    if (method === "PUT" && path === "/api/v1/me/likes") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const track = cleanTrack(payload.track ?? payload);
      if (!track) return fail(400, "INVALID_TRACK", "Missing track");
      saveLike(db, session.user.id, track);
      return ok({ ok: true });
    }

    const likePath = path.match(/^\/api\/v1\/me\/likes\/([^/]+)$/);
    if (likePath && method === "DELETE") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(decodeURIComponent(likePath[1]));
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      db.prepare("DELETE FROM likes WHERE user_id = ? AND track_id = ?").run(session.user.id, id);
      return ok({ ok: true });
    }

    if (method === "POST" && path === "/api/v1/me/playlists") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const name = cleanText(payload.name, 80);
      if (!name) return fail(400, "INVALID_NAME", "Enter a playlist name");
      let id = cleanId(payload.id);
      if (id) {
        const owner = db.prepare("SELECT user_id FROM playlists WHERE id = ?").get(id);
        if (owner && owner.user_id !== session.user.id) return fail(409, "CONFLICT", "Playlist id is taken");
        if (owner && owner.user_id === session.user.id) return ok({ id, name: playlistFor(db, session.user.id, id).name });
      } else {
        id = `pl-${randomUUID()}`;
      }
      const now = Date.now();
      const position = db.prepare("SELECT COALESCE(MIN(position), 1) - 1 AS n FROM playlists WHERE user_id = ?").get(session.user.id).n;
      db.prepare("INSERT INTO playlists (id, user_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        id,
        session.user.id,
        name,
        position,
        now,
        now,
      );
      if (Array.isArray(payload.tracks)) upsertTrackList(db, id, payload.tracks);
      return json(201, { data: { id, name } });
    }

    const playlistPath = path.match(/^\/api\/v1\/me\/playlists\/([^/]+)$/);
    if (playlistPath && method === "PATCH") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(decodeURIComponent(playlistPath[1]));
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      const list = playlistFor(db, session.user.id, id);
      if (!list) return fail(404, "NOT_FOUND", "Playlist not found");
      const name = payload.name == null ? list.name : cleanText(payload.name, 80);
      if (!name) return fail(400, "INVALID_NAME", "Enter a playlist name");
      db.prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
      if (Array.isArray(payload.tracks)) upsertTrackList(db, id, payload.tracks);
      return ok({ id, name });
    }

    if (playlistPath && method === "DELETE") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(decodeURIComponent(playlistPath[1]));
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(id, session.user.id);
      return ok({ ok: true });
    }

    if (method === "POST" && path === "/api/v1/me/history") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const track = cleanTrack(payload.track ?? payload);
      if (!track) return fail(400, "INVALID_TRACK", "Missing track");
      saveHistory(db, session.user.id, track, payload.at ?? payload.track?.at);
      return ok({ ok: true });
    }

    if (method === "PUT" && path === "/api/v1/me/follows") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(payload.id);
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      db.prepare(
        `INSERT INTO follows (user_id, artist_id, name, image, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, artist_id) DO UPDATE SET name = excluded.name, image = excluded.image`,
      ).run(session.user.id, id, cleanText(payload.name, 200) || "Artist", cleanUrl(payload.image), Date.now());
      return ok({ ok: true });
    }

    const followPath = path.match(/^\/api\/v1\/me\/follows\/([^/]+)$/);
    if (followPath && method === "DELETE") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(decodeURIComponent(followPath[1]));
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      db.prepare("DELETE FROM follows WHERE user_id = ? AND artist_id = ?").run(session.user.id, id);
      return ok({ ok: true });
    }

    if (method === "PUT" && path === "/api/v1/me/albums") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(payload.id);
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      db.prepare(
        `INSERT INTO saved_albums (user_id, album_id, title, artist, cover, year, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, album_id) DO UPDATE SET
           title = excluded.title, artist = excluded.artist, cover = excluded.cover, year = excluded.year`,
      ).run(
        session.user.id,
        id,
        cleanText(payload.title, 200) || "Album",
        cleanText(payload.artist, 200),
        cleanUrl(payload.cover),
        cleanText(payload.year, 16),
        Date.now(),
      );
      return ok({ ok: true });
    }

    const albumPath = path.match(/^\/api\/v1\/me\/albums\/([^/]+)$/);
    if (albumPath && method === "DELETE") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const id = cleanId(decodeURIComponent(albumPath[1]));
      if (!id) return fail(400, "INVALID_ID", "Invalid id");
      db.prepare("DELETE FROM saved_albums WHERE user_id = ? AND album_id = ?").run(session.user.id, id);
      return ok({ ok: true });
    }

    if (method === "PATCH" && path === "/api/v1/me/settings") {
      const session = requireUser(db, headers);
      if (session.error) return session.error;
      const theme = cleanTheme(payload.theme);
      if (!theme) return fail(400, "INVALID_THEME", "Unknown theme");
      db.prepare(
        `INSERT INTO settings (user_id, theme, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`,
      ).run(session.user.id, theme, Date.now());
      return ok({ theme });
    }

    return fail(404, "ROUTE_NOT_FOUND", "Route not found");
  } catch {
    return fail(500, "INTERNAL", "Internal server error");
  }
}
