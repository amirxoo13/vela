import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TtlCache } from './cache.js';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { deepNormalize, extractTrackList, isTrackLike, normalizeTrack, type Track } from './normalize.js';
import { proxyTrackAudio } from './media.js';
import { upstreamGet } from './upstream.js';

export const cache = new TtlCache(config.cacheMaxEntries);

const NUM_ID = /^\d{1,12}$/;
const SLUG_ID = /^[A-Za-z0-9._-]{1,128}$/;

function checkId(id: string, re = SLUG_ID): string {
  if (!re.test(id)) throw new ApiError(400, 'INVALID_ID', 'Invalid id');
  return id;
}

function paginate<T>(items: T[], q: any) {
  const limit = Math.min(Math.max(parseInt(q?.limit, 10) || items.length || 1, 1), 200);
  const offset = Math.max(parseInt(q?.offset, 10) || 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

async function cached(path: string, ttl: number, query?: Record<string, string>) {
  const key = path + (query ? '?' + new URLSearchParams(query).toString() : '');
  return cache.wrap(key, ttl, () => upstreamGet(path, query));
}

export async function getTrack(id: string): Promise<{ track: Track; cached: boolean }> {
  checkId(id, NUM_ID);
  const { value, cached: c } = await cached(`/track/${id}`, config.itemTtlMs);
  if (!value || typeof value !== 'object') throw new ApiError(404, 'NOT_FOUND', 'Track not found');
  return { track: normalizeTrack(value), cached: c };
}

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    tokenConfigured: !!process.env.USER_TOKEN,
    cache: cache.stats(),
    time: new Date().toISOString(),
  }));

  app.register(async (api) => {
    api.get('/home', async () => {
      const r = await cached('/home', config.listTtlMs);
      return { data: deepNormalize(r.value), meta: { cached: r.cached } };
    });

    api.get('/search', async (req: FastifyRequest<{ Querystring: { q?: string } }>) => {
      const q = (req.query.q ?? '').trim();
      if (q.length < 1 || q.length > 100) throw new ApiError(400, 'INVALID_QUERY', 'Query parameter "q" is required (1-100 chars)');
      const r = await cached('/search', config.listTtlMs, { q: q.toLowerCase() });
      const v: any = r.value ?? {};
      const arr = (x: any) => (Array.isArray(x) ? x : []);
      return {
        data: {
          query: q,
          tracks: arr(v.mp3s).filter(isTrackLike).map(normalizeTrack),
          albums: deepNormalize(arr(v.albums)),
          artists: arr(v.artists),
          videos: arr(v.videos),
          podcasts: arr(v.podcasts),
          playlists: arr(v.playlists),
          profiles: arr(v.profiles),
          top: arr(v.top),
        },
        meta: { cached: r.cached },
      };
    });

    for (const kind of ['trending', 'featured', 'popular'] as const) {
      api.get(`/tracks/${kind}`, async (req) => {
        const r = await cached(`/tracks/${kind}`, config.listTtlMs);
        const page = paginate(extractTrackList(r.value), req.query);
        return { data: page.items, meta: { cached: r.cached, total: page.total, limit: page.limit, offset: page.offset } };
      });
    }

    api.get('/tracks/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { track, cached: c } = await getTrack(req.params.id);
      return { data: track, meta: { cached: c } };
    });

    api.get('/tracks/:id/download', async (req: FastifyRequest<{ Params: { id: string }; Querystring: { inline?: string } }>, reply: FastifyReply) => {
      const { track } = await getTrack(req.params.id);
      const inline = req.query.inline === '1' || req.query.inline === 'true';
      return proxyTrackAudio(req, reply, track, inline);
    });

    // Generic pass-through endpoints (track objects inside are normalized).
    const lists: Array<[string, string]> = [
      ['/albums/trending', '/albums/trending'],
      ['/videos/trending', '/videos/trending'],
      ['/videos/featured', '/videos/featured'],
      ['/videos/popular', '/videos/popular'],
      ['/podcasts/dj', '/podcasts/dj'],
      ['/podcasts/shows', '/podcasts/shows'],
      ['/podcasts/popular', '/podcasts/popular'],
      ['/events', '/events'],
    ];
    for (const [local, up] of lists) {
      api.get(local, async () => {
        const r = await cached(up, config.listTtlMs);
        return { data: deepNormalize(r.value), meta: { cached: r.cached } };
      });
    }

    const items: Array<[string, string]> = [
      ['/albums/:id', '/album/'],
      ['/playlists/:id', '/playlist/'],
      ['/videos/:id', '/video/'],
      ['/podcasts/:id', '/podcast/'],
      ['/selfies/:id', '/selfie/'],
      ['/events/:id', '/event/'],
      ['/users/:id', '/user/'],
    ];
    for (const [local, up] of items) {
      api.get(local, async (req: FastifyRequest<{ Params: { id: string } }>) => {
        const id = checkId(req.params.id);
        const r = await cached(up + encodeURIComponent(id), config.itemTtlMs);
        return { data: deepNormalize(r.value), meta: { cached: r.cached } };
      });
    }
  }, { prefix: '/api/v1' });
}
