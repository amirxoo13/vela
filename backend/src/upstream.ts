import { config, getToken } from './config.js';
import { ApiError, mapUpstreamStatus } from './errors.js';

/** Calls the One-Api Radiojavan endpoint and returns its `result` field. */
export async function upstreamGet<T = any>(path: string, query?: Record<string, string>): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(500, 'SERVER_MISCONFIGURED', 'Server is missing the upstream API token (USER_TOKEN)');

  const url = new URL(config.upstreamBaseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'one-api-token': token, accept: 'application/json' },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ApiError(504, 'UPSTREAM_TIMEOUT', `Upstream did not respond within ${config.upstreamTimeoutMs} ms`);
    }
    throw new ApiError(502, 'UPSTREAM_UNREACHABLE', 'Could not reach upstream API');
  }

  let body: any;
  try { body = await res.json(); } catch { body = undefined; }

  const status = typeof body?.status === 'number' ? body.status : res.status;
  if (!res.ok || status !== 200) {
    const msg = typeof body?.message === 'string' ? body.message
      : typeof body?.result === 'string' ? body.result : undefined;
    throw mapUpstreamStatus(status !== 200 ? status : res.status, msg);
  }
  if (body?.result === undefined || body?.result === null || body?.result === '') {
    throw mapUpstreamStatus(500);
  }
  return body.result as T;
}
