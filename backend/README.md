# RJ Music Backend

Small JSON REST API (Node 20 + TypeScript + Fastify 5) for a **native mobile** music app.
It wraps the Radiojavan One-Api (`https://api.one-api.ir/radiojavan/v1`), normalizes track
objects into a clean schema, caches responses in memory to save API credit, and proxies MP3
files with HTTP Range support so the mobile player can seek.

No frontend. OpenAPI spec: [`openapi.yaml`](./openapi.yaml).

## Run

```bash
npm install
cp .env.example .env          # PORT, cache TTLs, timeouts (no secrets in here)
export USER_TOKEN=...         # upstream one-api token: ONLY via environment, never in files
npm run build && npm start    # foreground
./scripts/run-bg.sh           # or: build + start in background (PID in server.pid, logs in server.log)
npm run dev                   # watch mode (tsx)
```

Stop the background server: `kill $(cat server.pid)`.

### Config (`.env`)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | Listen port |
| `HOST` | 0.0.0.0 | Listen address |
| `UPSTREAM_BASE_URL` | https://api.one-api.ir/radiojavan/v1 | Upstream base |
| `UPSTREAM_TIMEOUT_MS` | 10000 | Timeout for upstream JSON calls |
| `MEDIA_TIMEOUT_MS` | 15000 | Timeout to get response headers from media CDN |
| `CACHE_TTL_SECONDS` | 180 | Cache TTL for lists (home, search, trending, ...) |
| `ITEM_CACHE_TTL_SECONDS` | 900 | Cache TTL for single items (track, album, ...); download/seek requests reuse it |
| `CACHE_MAX_ENTRIES` | 500 | Max cache entries |
| `LOG_LEVEL` | info | Fastify/pino log level |
| `USER_TOKEN` | — | **Environment only.** Sent to upstream as `one-api-token` header. Never written to disk or logs |
| `MELOBI_DATA_DIR` | `/opt/melobi/data` if writable, else `backend/data` | SQLite file, avatars, and generated session secret. **Set `/opt/melobi/data` in production** so a redeploy of the app folder does not wipe accounts |
| `SESSION_SECRET` | random file in the data dir | HMAC key for session cookies. Set it when more than one process must accept the same cookies. Rotating it signs everyone out |
| `COOKIE_SECURE` | auto | `1` forces the Secure flag, `0` disables it. Unset turns it on only when `X-Forwarded-Proto` is `https` |

## Accounts and library

Accounts are stored in SQLite (`melobi.db` inside `MELOBI_DATA_DIR`), not in the browser and not in Postgres. On startup the process applies any new files in `backend/migrations/` once and records them in `schema_migrations`. There is no separate migrate command. The first migration is `0001_accounts.sql` (users, sessions, login attempts, likes, playlists, playlist tracks, history, follows, saved albums, settings).

Passwords are scrypt hashes. The session cookie is `melobi_session`: httpOnly, SameSite=Lax, path `/`. The database stores an HMAC of the token, not the token. Login is limited to 8 failures per 15 minutes per IP and per email. Signup is limited to 5 per 15 minutes per IP.

The browser must call the API on the **same site** as the page (Caddy serving the app and `/api/v1` on `https://melobi.amirxo.ir`, or Vite's `/api/v1` proxy). Leave `VITE_API_BASE_URL` empty in that setup so the session cookie stays first-party. Avatars are files under `$MELOBI_DATA_DIR/avatars/`.

### Deploy checklist

1. Create `/opt/melobi/data` and give the service user write access, or set `MELOBI_DATA_DIR` to another directory **outside** the app folder.
2. Put `USER_TOKEN` in the environment only. Optionally set `SESSION_SECRET` in that same env file. Do not commit either.
3. Leave `COOKIE_SECURE` unset when Caddy sends `X-Forwarded-Proto: https`.
4. From `backend/`: `npm install`, `npm run build`, `npm start` (listens on `127.0.0.1` or `HOST`, port `8787`).
5. Build the frontend with an empty `VITE_API_BASE_URL` and point Caddy at the preview, with `/api/v1` reaching this process.
6. Restart the API after pulling a release so new SQL files apply. Existing `melobi.db` is kept.

### Account endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | `{ email, password, displayName? }` sets the session cookie |
| POST | `/api/v1/auth/login` | `{ email, password }` |
| POST | `/api/v1/auth/logout` | clears the cookie |
| GET | `/api/v1/auth/me` | `{ data: { user } }` or `{ data: null }` |
| PATCH | `/api/v1/auth/me` | `{ displayName?, avatarPreset?, avatarData? }` |
| POST | `/api/v1/auth/password` | `{ currentPassword, newPassword }` |
| DELETE | `/api/v1/auth/me` | `{ password }` deletes the user and library |
| GET | `/api/v1/me/library` | likes, playlists, history, follows, albums, theme |
| POST | `/api/v1/me/library/import` | merges a guest library once (`library_imported`) |
| PUT / DELETE | `/api/v1/me/likes` | save or remove a liked song |
| POST / PATCH / DELETE | `/api/v1/me/playlists` | create, rename, replace track order, delete |
| POST | `/api/v1/me/history` | remember a play |
| PUT / DELETE | `/api/v1/me/follows` | follow or unfollow an artist |
| PUT / DELETE | `/api/v1/me/albums` | save or remove an album |
| PATCH | `/api/v1/me/settings` | `{ theme }` one of `green`, `crimson`, `night`, `ice` |
| GET | `/api/v1/avatars/:userId` | uploaded avatar bytes |

## Conventions

* Success: `{ "data": ..., "meta": { "cached": true|false, ... } }`
* Error: `{ "error": { "status": 404, "code": "NOT_FOUND", "message": "..." } }`
* CORS is open (`GET, HEAD, OPTIONS`).

### Error mapping

| Situation | HTTP | code |
|---|---|---|
| Bad params / id / missing `q` | 400 | `INVALID_PARAMS`, `INVALID_ID`, `INVALID_QUERY` |
| Upstream 401 (token) | 502 | `UPSTREAM_AUTH` |
| Upstream 403 (no credit) | 503 | `UPSTREAM_CREDIT` |
| Upstream 404 removed / 409 bad path | 404 | `NOT_FOUND` |
| Upstream 500 empty response | 502 | `UPSTREAM_EMPTY` |
| Upstream timeout | 504 | `UPSTREAM_TIMEOUT` |
| Upstream unreachable / other | 502 | `UPSTREAM_UNREACHABLE` / `UPSTREAM_ERROR` |
| Token not configured on server | 500 | `SERVER_MISCONFIGURED` |
| Unknown route | 404 | `ROUTE_NOT_FOUND` |
| Bad Range on download | 416 | `RANGE_NOT_SATISFIABLE` |

## Track schema

```json
{
  "id": 157767,
  "type": "track",
  "title": "Novan - \"Shodi Nooram\"",
  "artist": "Novan",
  "song": "Shodi Nooram",
  "artistFarsi": "نوان",
  "songFarsi": "شدی نورم",
  "album": null,
  "albumId": null,
  "durationSec": 164,
  "plays": 2722477,
  "likes": 7465,
  "explicit": false,
  "artworkUrl": "https://assets.rjassets.com/static/mp3/novan-shodi-nooram/ae6980af164ef46-player.jpg",
  "thumbnailUrl": "https://assets.rjassets.com/static/mp3/novan-shodi-nooram/d8dcb7fb931cf8f-thumb.jpg",
  "streamUrl": "https://host2.media-rj.com/media/mp3/mp3-256/157767-880301e690cf32c.mp3",
  "hlsUrl": "https://host2.media-rj.com/media/mp3/mp3-hls/157767-880301e690cf32c/playlist.m3u8",
  "aacHqUrl": "https://host2.media-rj.com/media/mp3/aac-256/157767-880301e690cf32c.m4a",
  "aacLqUrl": "https://host2.media-rj.com/media/mp3/aac-128/157767-880301e690cf32c.m4a",
  "downloadPath": "/api/v1/tracks/157767/download",
  "shareUrl": "https://rj.app/m/2qKkmQWq",
  "releaseDate": "2026-09-11T04:00:00.000Z"
}
```

`plays`/`likes` are integers (upstream sends `"2,722,477"` strings). `streamUrl` is the direct
256 kbps MP3 on the CDN (playable directly); `downloadPath` is the same file proxied through this
server (no filename is sent). Wherever upstream returns an object with `type: "mp3"` (home sections,
albums, playlists, ...) it is replaced by this schema.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness, `tokenConfigured`, cache stats |
| GET | `/api/v1/home` | Home feed `{ sections: [...] }`, tracks normalized |
| GET | `/api/v1/search?q=` | `{ query, tracks[], albums[], artists[], videos[], podcasts[], playlists[], profiles[], top[] }` |
| GET | `/api/v1/tracks/trending` | `Track[]`, supports `?limit=&offset=` |
| GET | `/api/v1/tracks/featured` | same |
| GET | `/api/v1/tracks/popular` | same |
| GET | `/api/v1/tracks/:id` | Single `Track` |
| GET/HEAD | `/api/v1/tracks/:id/download` | MP3 proxy. `Range` → 206. `?inline=1` for inline disposition |
| GET | `/api/v1/albums/trending` | pass-through |
| GET | `/api/v1/albums/:id` | pass-through, tracks normalized |
| GET | `/api/v1/playlists/:id` | pass-through, tracks normalized |
| GET | `/api/v1/videos/trending` \| `featured` \| `popular` | pass-through |
| GET | `/api/v1/videos/:id` | pass-through |
| GET | `/api/v1/podcasts/dj` \| `shows` \| `popular` | pass-through |
| GET | `/api/v1/podcasts/:id` | pass-through |
| GET | `/api/v1/selfies/:id`, `/api/v1/events`, `/api/v1/events/:id`, `/api/v1/users/:username` | pass-through |

Pass-through endpoints return upstream's `result` as `data` (with track objects normalized);
their exact shape follows upstream and wasn't individually verified, to save credit.

### Examples

```bash
curl http://localhost:8787/health
# {"status":"ok","uptimeSec":12,"tokenConfigured":true,"cache":{"entries":4,"hits":3,"misses":4},"time":"..."}

curl "http://localhost:8787/api/v1/search?q=shadmehr"
# {"data":{"query":"shadmehr","tracks":[{"id":...,"title":"Shadmehr Aghili - \"Mamnoon\"",...}],"albums":[...],...},"meta":{"cached":false}}

curl "http://localhost:8787/api/v1/tracks/trending?limit=2&offset=0"
# {"data":[{Track},{Track}],"meta":{"cached":true,"total":50,"limit":2,"offset":0}}

curl http://localhost:8787/api/v1/tracks/157767
# {"data":{Track},"meta":{"cached":false}}

curl -i -H "Range: bytes=1000-1999" http://localhost:8787/api/v1/tracks/157767/download -o part.bin
# HTTP/1.1 206 Partial Content
# content-type: audio/mpeg
# content-length: 1000
# content-range: bytes 1000-1999/5374539
# accept-ranges: bytes
# content-disposition: attachment   (no filename; the song name is not included)

curl http://localhost:8787/api/v1/tracks/abc
# 400 {"error":{"status":400,"code":"INVALID_ID","message":"Invalid id"}}
```

### Mobile notes

* AVPlayer / ExoPlayer: use `streamUrl` (direct CDN) or `http://<server>/api/v1/tracks/:id/download?inline=1`.
  Both support Range/seeking. `hlsUrl` is also available for adaptive streaming.
* For offline downloads, use `/download` – you get `Content-Length` for progress.
* Each upstream call may cost API credit; responses are cached in memory (lists 180 s, items 900 s by default).
  Cache resets when the server restarts.
