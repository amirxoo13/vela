import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { ApiError } from './errors.js';
import type { Track } from './normalize.js';

const ALLOWED_MEDIA_HOSTS = [/(^|\.)media-rj\.com$/i, /(^|\.)rjassets\.com$/i];

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/** No filename is sent: the song name is intentionally left out of downloads. */
function contentDisposition(inline: boolean): string {
  return inline ? 'inline' : 'attachment';
}

/** Proxies the track MP3, forwarding Range so mobile players can seek (206 Partial Content). */
export async function proxyTrackAudio(req: FastifyRequest, reply: FastifyReply, track: Track, inline: boolean) {
  if (!track.streamUrl) throw new ApiError(404, 'NO_STREAM', 'This track has no downloadable MP3');
  let url: URL;
  try { url = new URL(track.streamUrl); } catch { throw new ApiError(502, 'BAD_MEDIA_URL', 'Upstream returned an invalid media URL'); }
  if (url.protocol !== 'https:' || !ALLOWED_MEDIA_HOSTS.some((re) => re.test(url.hostname))) {
    throw new ApiError(502, 'BAD_MEDIA_URL', 'Upstream media URL host is not allowed');
  }

  const headers: Record<string, string> = {};
  const range = req.headers.range;
  if (typeof range === 'string' && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range.trim())) headers.range = range.trim();
  const ifRange = req.headers['if-range'];
  if (typeof ifRange === 'string' && headers.range) headers['if-range'] = ifRange;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.mediaTimeoutMs);
  req.raw.on('close', () => { if (!reply.raw.writableFinished) ac.abort(); });

  let res: Response;
  try {
    res = await fetch(url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: ac.signal });
  } catch (err: any) {
    clearTimeout(timer);
    if (ac.signal.aborted) throw new ApiError(504, 'MEDIA_TIMEOUT', 'Media server did not respond in time');
    throw new ApiError(502, 'MEDIA_UNREACHABLE', 'Could not reach media server');
  }
  clearTimeout(timer); // headers received; let the body stream as long as needed

  if (res.status === 416) {
    reply.code(416);
    const cr = res.headers.get('content-range');
    if (cr) reply.header('content-range', cr);
    reply.header('accept-ranges', 'bytes');
    await res.body?.cancel();
    return reply.send({ error: { status: 416, code: 'RANGE_NOT_SATISFIABLE', message: 'Requested range not satisfiable' } });
  }
  if (res.status !== 200 && res.status !== 206) {
    await res.body?.cancel();
    if (res.status === 404 || res.status === 403) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'MP3 file not found on media server');
    throw new ApiError(502, 'MEDIA_ERROR', `Media server error (status ${res.status})`);
  }

  reply.code(res.status);
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) reply.header(h, v);
  }
  if (!res.headers.get('content-type') || res.headers.get('content-type') === 'binary/octet-stream') {
    reply.header('content-type', 'audio/mpeg');
  }
  reply.header('accept-ranges', 'bytes');
  reply.header('content-disposition', contentDisposition(inline));
  reply.header('cache-control', 'public, max-age=3600');

  if (req.method === 'HEAD' || !res.body) {
    await res.body?.cancel();
    // Write headers directly so Fastify doesn't overwrite Content-Length with 0 for an empty body.
    reply.hijack();
    reply.raw.writeHead(res.status, reply.getHeaders() as any);
    reply.raw.end();
    return;
  }
  return reply.send(Readable.fromWeb(res.body as any));
}
