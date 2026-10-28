/**
 * Dev-only stand-in for backend/ when USER_TOKEN is not available.
 * Serves captured Radiojavan responses from fixtures/ and proxies the public
 * MP3 URLs inside them (Range included). This is not the production data path:
 * the app always calls /api/v1, and production points that at the real backend.
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const read = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const homeFile = read("home.json");
const trendingFile = read("tracks-trending.json");
const searchFile = read("search-shadmehr.json");
const singleFile = read("track-157767.json");

const homeSections = Array.isArray(homeFile.data?.sections) ? homeFile.data.sections : [];
const homeVideos = homeSections.flatMap((section) =>
  Array.isArray(section.items) ? section.items.filter((item) => item?.type === "video") : [],
);
const homePlaylists = homeSections.flatMap((section) =>
  Array.isArray(section.items) ? section.items.filter((item) => item?.type === "playlist") : [],
);

const searchTracks = Array.isArray(searchFile.data?.tracks) ? searchFile.data.tracks : [];
const searchAlbumTracks = Array.isArray(searchFile.data?.albums) ? searchFile.data.albums : [];
const searchVideos = Array.isArray(searchFile.data?.videos) ? searchFile.data.videos : [];
const searchPodcasts = Array.isArray(searchFile.data?.podcasts) ? searchFile.data.podcasts : [];
const searchPlaylists = (Array.isArray(searchFile.data?.playlists) ? searchFile.data.playlists : []).map(
  (item) => item?.playlist ?? item,
);
const searchArtists = Array.isArray(searchFile.data?.artists) ? searchFile.data.artists : [];
const searchProfiles = Array.isArray(searchFile.data?.profiles) ? searchFile.data.profiles : [];

const tracksById = new Map();
for (const track of [...trendingFile.data, ...searchTracks, ...searchAlbumTracks, singleFile.data]) {
  if (track?.id != null) tracksById.set(String(track.id), track);
}
const allTracks = [...tracksById.values()];

const playlistsById = new Map();
for (const playlist of [...homePlaylists, ...searchPlaylists]) {
  if (playlist?.id != null) playlistsById.set(String(playlist.id), playlist);
}
const videosById = new Map();
for (const video of [...homeVideos, ...searchVideos]) {
  if (video?.id != null) videosById.set(String(video.id), video);
}
const podcastsById = new Map();
for (const podcast of searchPodcasts) {
  if (podcast?.id != null) podcastsById.set(String(podcast.id), podcast);
}

const albumGroups = new Map();
for (const track of searchAlbumTracks) {
  if (!track?.album && track?.albumId == null) continue;
  const id = String(track.albumId ?? track.album);
  if (!albumGroups.has(id)) {
    albumGroups.set(id, {
      id: track.albumId ?? id,
      type: "album",
      title: track.album || "Album",
      artist: track.artist || "",
      photo: track.artworkUrl || "",
      tracks: [],
    });
  }
  albumGroups.get(id).tracks.push(track);
}

const MEDIA_HOST = /(^|\.)media-rj\.com$/i;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
  });
  res.end(payload);
}

function paginate(items, url) {
  const params = new URL(url, "http://fixture.local").searchParams;
  const limit = Math.min(Math.max(parseInt(params.get("limit") || "", 10) || items.length || 1, 1), 200);
  const offset = Math.max(parseInt(params.get("offset") || "", 10) || 0, 0);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

function listBody(items, url) {
  const page = paginate(items, url);
  return {
    data: page.items,
    meta: { cached: false, total: page.total, limit: page.limit, offset: page.offset },
  };
}

function haystack(value) {
  if (!value || typeof value !== "object") return "";
  return ["title", "artist", "song", "album", "name", "display_name", "username", "podcast_artist"]
    .map((key) => (typeof value[key] === "string" ? value[key] : ""))
    .join(" ")
    .toLowerCase();
}

function searchBody(query) {
  const needle = query.toLowerCase();
  if (needle.includes("shadmehr")) {
    const body = structuredClone(searchFile);
    body.data.query = query;
    body.meta = { ...(body.meta ?? {}), cached: false };
    return body;
  }
  const hit = (item) => haystack(item).includes(needle);
  return {
    data: {
      query,
      tracks: allTracks.filter(hit),
      albums: searchAlbumTracks.filter(hit),
      artists: searchArtists.filter(hit),
      videos: [...videosById.values()].filter(hit),
      podcasts: searchPodcasts.filter(hit),
      playlists: [...playlistsById.values()].filter(hit).map((playlist) => ({ playlist })),
      profiles: searchProfiles.filter(hit),
      top: [],
    },
    meta: { cached: false },
  };
}

function playlistBody(id) {
  const playlist = playlistsById.get(id) ?? { id, title: "Playlist", type: "playlist" };
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const items = [];
  const count = Math.min(12, allTracks.length);
  for (let i = 0; i < count; i += 1) items.push(allTracks[(hash + i) % allTracks.length]);
  return { data: { ...playlist, items }, meta: { cached: false } };
}

async function proxyMedia(req, res, track, inline) {
  let url;
  try {
    url = new URL(track.streamUrl);
  } catch {
    sendJson(res, 404, { error: { status: 404, code: "NO_STREAM", message: "This track has no downloadable MP3" } });
    return;
  }
  if (url.protocol !== "https:" || !MEDIA_HOST.test(url.hostname)) {
    sendJson(res, 502, { error: { status: 502, code: "BAD_MEDIA_URL", message: "Upstream media URL host is not allowed" } });
    return;
  }
  const headers = {};
  if (typeof req.headers.range === "string") headers.range = req.headers.range;
  const upstream = await fetch(url, { method: req.method === "HEAD" ? "HEAD" : "GET", headers });
  res.statusCode = upstream.status;
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-disposition", inline ? "inline" : "attachment");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "public, max-age=3600");
  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://fixture.local");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "range, if-range, content-type",
        "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
      });
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 404, { error: { status: 404, code: "ROUTE_NOT_FOUND", message: "Route not found" } });
      return;
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") {
      sendJson(res, 200, {
        status: "ok",
        uptimeSec: Math.round(process.uptime()),
        tokenConfigured: false,
        mode: "fixtures",
        cache: { entries: tracksById.size, hits: 0, misses: 0 },
        time: new Date().toISOString(),
      });
      return;
    }

    if (path === "/api/v1/home") {
      sendJson(res, 200, homeFile);
      return;
    }
    if (path === "/api/v1/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 1 || q.length > 100) {
        sendJson(res, 400, { error: { status: 400, code: "INVALID_QUERY", message: 'Query parameter "q" is required (1-100 chars)' } });
        return;
      }
      sendJson(res, 200, searchBody(q));
      return;
    }
    if (path === "/api/v1/tracks/trending") {
      sendJson(res, 200, listBody(trendingFile.data, req.url || ""));
      return;
    }
    if (path === "/api/v1/tracks/featured") {
      sendJson(res, 200, listBody(searchTracks, req.url || ""));
      return;
    }
    if (path === "/api/v1/tracks/popular") {
      sendJson(res, 200, listBody(searchAlbumTracks, req.url || ""));
      return;
    }

    const download = path.match(/^\/api\/v1\/tracks\/(\d+)\/download$/);
    if (download) {
      const track = tracksById.get(download[1]);
      if (!track?.streamUrl) {
        sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "Track not found" } });
        return;
      }
      const inline = url.searchParams.get("inline") === "1" || url.searchParams.get("inline") === "true";
      await proxyMedia(req, res, track, inline);
      return;
    }
    const trackPath = path.match(/^\/api\/v1\/tracks\/(\d+)$/);
    if (trackPath) {
      const track = tracksById.get(trackPath[1]);
      if (!track) {
        sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "Track not found" } });
        return;
      }
      sendJson(res, 200, { data: track, meta: { cached: false } });
      return;
    }

    if (path === "/api/v1/albums/trending") {
      sendJson(res, 200, { data: [...albumGroups.values()], meta: { cached: false } });
      return;
    }
    const albumPath = path.match(/^\/api\/v1\/albums\/([^/]+)$/);
    if (albumPath) {
      const album = albumGroups.get(albumPath[1]);
      if (!album) {
        sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "Album not found" } });
        return;
      }
      sendJson(res, 200, { data: album, meta: { cached: false } });
      return;
    }
    const playlistPath = path.match(/^\/api\/v1\/playlists\/([^/]+)$/);
    if (playlistPath) {
      sendJson(res, 200, playlistBody(decodeURIComponent(playlistPath[1])));
      return;
    }

    if (path === "/api/v1/videos/trending") {
      sendJson(res, 200, { data: homeVideos.slice(0, 3), meta: { cached: false } });
      return;
    }
    if (path === "/api/v1/videos/featured") {
      sendJson(res, 200, { data: homeVideos.slice(3, 6), meta: { cached: false } });
      return;
    }
    if (path === "/api/v1/videos/popular") {
      sendJson(res, 200, { data: homeVideos.slice(6), meta: { cached: false } });
      return;
    }
    const videoPath = path.match(/^\/api\/v1\/videos\/([^/]+)$/);
    if (videoPath) {
      const video = videosById.get(decodeURIComponent(videoPath[1]));
      if (!video) {
        sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "Video not found" } });
        return;
      }
      sendJson(res, 200, { data: video, meta: { cached: false } });
      return;
    }

    if (path === "/api/v1/podcasts/popular" || path === "/api/v1/podcasts/shows" || path === "/api/v1/podcasts/dj") {
      sendJson(res, 200, { data: searchPodcasts, meta: { cached: false } });
      return;
    }
    const podcastPath = path.match(/^\/api\/v1\/podcasts\/([^/]+)$/);
    if (podcastPath) {
      const podcast = podcastsById.get(decodeURIComponent(podcastPath[1]));
      if (!podcast) {
        sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "Podcast not found" } });
        return;
      }
      sendJson(res, 200, { data: podcast, meta: { cached: false } });
      return;
    }

    if (path === "/api/v1/events") {
      sendJson(res, 200, { data: [], meta: { cached: false } });
      return;
    }
    const eventPath = path.match(/^\/api\/v1\/events\/([^/]+)$/);
    if (eventPath) {
      sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "Event not found" } });
      return;
    }
    const userPath = path.match(/^\/api\/v1\/users\/([^/]+)$/);
    if (userPath) {
      const username = decodeURIComponent(userPath[1]);
      const profile = searchProfiles.find((item) => item?.username === username) ?? null;
      if (!profile) {
        sendJson(res, 404, { error: { status: 404, code: "NOT_FOUND", message: "User not found" } });
        return;
      }
      sendJson(res, 200, { data: profile, meta: { cached: false } });
      return;
    }

    sendJson(res, 404, { error: { status: 404, code: "ROUTE_NOT_FOUND", message: "Route not found" } });
  } catch {
    if (!res.headersSent) {
      sendJson(res, 500, { error: { status: 500, code: "INTERNAL", message: "Internal server error" } });
    }
  }
});

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  process.stdout.write(`fixture api on ${host}:${port}\n`);
});
