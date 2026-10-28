import 'dotenv/config';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '0.0.0.0',
  upstreamBaseUrl: (process.env.UPSTREAM_BASE_URL || 'https://api.one-api.ir/radiojavan/v1').replace(/\/+$/, ''),
  upstreamTimeoutMs: num(process.env.UPSTREAM_TIMEOUT_MS, 10_000),
  mediaTimeoutMs: num(process.env.MEDIA_TIMEOUT_MS, 15_000),
  listTtlMs: num(process.env.CACHE_TTL_SECONDS, 180) * 1000,
  itemTtlMs: num(process.env.ITEM_CACHE_TTL_SECONDS, 900) * 1000,
  cacheMaxEntries: num(process.env.CACHE_MAX_ENTRIES, 500),
  logLevel: process.env.LOG_LEVEL || 'info',
};

/** Read the upstream token at call time; never log or persist it. */
export function getToken(): string | undefined {
  const t = process.env.USER_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}
