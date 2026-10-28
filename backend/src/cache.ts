interface Entry<T> { value: T; expires: number }

/** Tiny in-memory TTL cache with LRU-ish eviction and in-flight request de-duplication. */
export class TtlCache {
  private map = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  hits = 0;
  misses = 0;
  constructor(private maxEntries: number) {}

  get<T>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, e); // refresh LRU position
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number) {
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    const hit = this.get<T>(key);
    if (hit !== undefined) { this.hits++; return { value: hit, cached: true }; }
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) { this.hits++; return { value: await pending, cached: true }; }
    this.misses++;
    const p = fn();
    this.inflight.set(key, p);
    try {
      const value = await p;
      this.set(key, value, ttlMs);
      return { value, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  stats() { return { entries: this.map.size, hits: this.hits, misses: this.misses }; }
}
