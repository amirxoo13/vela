/**
 * Browser client for the music backend (`/api/v1`).
 * The upstream token stays on the server. This module only talks to our API.
 * Set `VITE_API_BASE_URL` to an absolute origin in production. Leave it empty
 * in dev so requests stay same-origin and Vite proxies `/api/v1`.
 */

const ARABIC =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export type ApiTrack = {
  id: number | string;
  type?: string;
  title?: string;
  artist?: string;
  song?: string;
  album?: string | null;
  albumId?: number | null;
  durationSec?: number | null;
  plays?: number | null;
  likes?: number | null;
  artworkUrl?: string | null;
  thumbnailUrl?: string | null;
  streamUrl?: string | null;
  downloadPath?: string;
  releaseDate?: string | null;
};

export type SearchPayload = {
  query?: string;
  tracks?: unknown;
  albums?: unknown;
  artists?: unknown;
  videos?: unknown;
  podcasts?: unknown;
  playlists?: unknown;
  profiles?: unknown;
};

export class MusicApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MusicApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (raw ?? "").trim().replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
}

/** Latin/English UI text only. Drops values that contain Arabic-script characters. */
export function english(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || ARABIC.test(text)) return "";
  return text;
}

export function isApiTrack(value: unknown): value is ApiTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as ApiTrack;
  return (
    track.type === "track" &&
    track.id != null &&
    !!(track.streamUrl || track.song || track.title)
  );
}

export function collectTracks(value: unknown): ApiTrack[] {
  const out: ApiTrack[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    if (isApiTrack(node)) {
      const id = String(node.id);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(node);
      }
      return;
    }
    for (const child of Object.values(node as Record<string, unknown>)) walk(child, depth + 1);
  };
  walk(value, 0);
  return out;
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
  } catch {
    throw new MusicApiError(0, "OFFLINE", "No connection");
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    const code = body?.error?.code ?? "HTTP";
    const message = english(body?.error?.message) || response.statusText || "Request failed";
    throw new MusicApiError(response.status, code, message);
  }
  return body as T;
}

export async function getData(path: string): Promise<unknown> {
  const body = await getJson<{ data?: unknown }>(path);
  return body?.data;
}

export async function getHome(): Promise<unknown> {
  return getData("/api/v1/home");
}

export async function getTrackList(kind: "trending" | "featured" | "popular"): Promise<ApiTrack[]> {
  const data = await getData(`/api/v1/tracks/${kind}`);
  if (Array.isArray(data)) return data.filter(isApiTrack);
  return collectTracks(data);
}

export async function getTrack(id: string): Promise<ApiTrack> {
  const data = await getData(`/api/v1/tracks/${encodeURIComponent(id)}`);
  if (!isApiTrack(data)) throw new MusicApiError(404, "NOT_FOUND", "Track not found");
  return data;
}

export async function searchMusic(query: string): Promise<SearchPayload> {
  const data = await getData(`/api/v1/search?q=${encodeURIComponent(query)}`);
  if (!data || typeof data !== "object") return { query };
  return data as SearchPayload;
}

export function downloadHref(track: { id: string; downloadPath?: string }): string {
  if (!track.id && !track.downloadPath) return "";
  const path = track.downloadPath || `/api/v1/tracks/${encodeURIComponent(track.id)}/download`;
  return apiUrl(path);
}

/** Direct CDN stream when the API provided one, otherwise the seekable inline proxy. */
export function playbackSrc(track: { id: string; streamUrl?: string; downloadPath?: string }): string {
  if (track.streamUrl) return track.streamUrl;
  const href = downloadHref(track);
  if (!href) return "";
  return href.includes("?") ? `${href}&inline=1` : `${href}?inline=1`;
}
