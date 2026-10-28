export interface Track {
  id: number;
  type: 'track';
  title: string;
  artist: string;
  song: string;
  artistFarsi: string | null;
  songFarsi: string | null;
  album: string | null;
  albumId: number | null;
  durationSec: number | null;
  plays: number | null;
  likes: number | null;
  explicit: boolean;
  artworkUrl: string | null;
  thumbnailUrl: string | null;
  streamUrl: string | null;
  hlsUrl: string | null;
  aacHqUrl: string | null;
  aacLqUrl: string | null;
  downloadPath: string;
  shareUrl: string | null;
  releaseDate: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** "2,722,477" -> 2722477 */
export function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, ''));
    return Number.isFinite(n) && v.trim() !== '' ? Math.round(n) : null;
  }
  return null;
}

function toDuration(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

function toDate(t: any): string | null {
  const raw = str(t.created_at) ?? str(t.date);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

export function isTrackLike(o: any): boolean {
  return !!o && typeof o === 'object' && o.type === 'mp3' && o.id != null && (o.link || o.song || o.title);
}

export function normalizeTrack(t: any): Track {
  const id = toInt(t.id) ?? 0;
  return {
    id,
    type: 'track',
    title: str(t.title) ?? [t.artist, t.song].filter(Boolean).join(' - '),
    artist: str(t.artist) ?? '',
    song: str(t.song) ?? '',
    artistFarsi: str(t.artist_farsi),
    songFarsi: str(t.song_farsi),
    album: str(t.album_album) ?? str(t.album),
    albumId: toInt(t.album_id),
    durationSec: toDuration(t.duration),
    plays: toInt(t.plays),
    likes: toInt(t.likes),
    explicit: !!t.explicit,
    artworkUrl: str(t.photo_player) ?? str(t.photo),
    thumbnailUrl: str(t.thumbnail) ?? str(t.photo_240),
    streamUrl: str(t.link),
    hlsUrl: str(t.hls_link),
    aacHqUrl: str(t.hq_link),
    aacLqUrl: str(t.lq_link),
    downloadPath: `/api/v1/tracks/${id}/download`,
    shareUrl: str(t.share_link),
    releaseDate: toDate(t),
  };
}

/** Recursively replace every track-like object inside an arbitrary upstream payload. */
export function deepNormalize(v: any, depth = 0): any {
  if (depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => deepNormalize(x, depth + 1));
  if (v && typeof v === 'object') {
    if (isTrackLike(v)) return normalizeTrack(v);
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepNormalize(val, depth + 1);
    return out;
  }
  return v;
}

/** Find a list of tracks inside a list-style upstream result (array, or object with an array). */
export function extractTrackList(result: any): Track[] {
  if (Array.isArray(result)) return result.filter(isTrackLike).map(normalizeTrack);
  if (result && typeof result === 'object') {
    for (const key of ['mp3s', 'tracks', 'items', 'songs', 'result']) {
      if (Array.isArray(result[key])) return extractTrackList(result[key]);
    }
  }
  return [];
}
