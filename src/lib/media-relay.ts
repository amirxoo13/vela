/**
 * Rewrite blocked CDN media through a same-origin relay.
 *
 * `VITE_MEDIA_RELAY` is a path prefix such as `/m` (build time). When it is
 * unset, every helper returns the URL unchanged.
 *
 *   https://<host>[:port]/<path>?<query>
 *     → /m/<host>[:port]/<path>?<query>
 *
 * The reverse proxy must fetch `https://<host>/<path>?<query>` and forward
 * Range. Relative URLs, `data:`, and `blob:` are never rewritten. Same-origin
 * URLs are left alone so local art and hls.js segment URLs that were already
 * resolved against a relay playlist are not wrapped again.
 */

export function mediaRelayBase(): string {
  try {
    const raw = import.meta.env.VITE_MEDIA_RELAY as string | undefined;
    return normalizeRelayBase(typeof raw === "string" ? raw : "");
  } catch {
    return "";
  }
}

export function mediaRelayEnabled(): boolean {
  return mediaRelayBase().length > 0;
}

export function normalizeRelayBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function pageOrigin(): string {
  try {
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  } catch {
    /* not in a browser */
  }
  return "";
}

/**
 * @param origin page origin used to skip same-origin URLs. Defaults to
 * `window.location.origin` in the browser and empty in tests.
 */
export function relayMediaUrl(
  input: string,
  base = mediaRelayBase(),
  origin = pageOrigin(),
): string {
  const prefix = normalizeRelayBase(base);
  if (!prefix || input == null) return input;
  const raw = input.trim();
  if (!raw) return input;
  if (/^(data|blob):/i.test(raw)) return input;
  if (raw.startsWith("/") && !raw.startsWith("//")) return input;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("//")) return input;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return input;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return input;
  if (origin && url.origin === origin) return input;
  if (alreadyOnRelay(url, prefix)) return input;
  return `${prefix}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Turn `/m/<host>/<path>?<query>` back into `https://<host>/<path>?<query>`.
 * Needed when a playlist was already rewritten and relative HLS URIs must be
 * resolved against the CDN URL, not the relay path.
 */
export function originalMediaUrl(input: string, base = mediaRelayBase()): string {
  const prefix = normalizeRelayBase(base);
  if (!prefix || !input) return input;
  const raw = input.trim();
  let path = raw;
  let origin = "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      path = `${url.pathname}${url.search}`;
      origin = url.origin;
    } catch {
      return input;
    }
  }
  if (!path.startsWith(`${prefix}/`)) return input;
  if (origin && /^https?:\/\//i.test(prefix)) {
    try {
      if (origin !== new URL(prefix).origin) return input;
    } catch {
      return input;
    }
  }
  const rest = path.slice(prefix.length + 1);
  const slash = rest.indexOf("/");
  if (slash <= 0) return input;
  const host = rest.slice(0, slash);
  const tail = rest.slice(slash);
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host) && !/^\[[^\]]+\](?::\d+)?$/.test(host)) return input;
  if (!host.includes(".") && !host.includes(":") && host !== "localhost") return input;
  return `https://${host}${tail}`;
}

/** CDN URL to store. A relay path is unwrapped; http(s) and non-media values stay put. */
export function canonicalMediaUrl(input: string, base = mediaRelayBase()): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return originalMediaUrl(raw, base);
}

function alreadyOnRelay(url: URL, prefix: string): boolean {
  if (!/^https?:\/\//i.test(prefix)) return false;
  let relay: URL;
  try {
    relay = new URL(prefix);
  } catch {
    return false;
  }
  if (url.origin !== relay.origin) return false;
  const path = relay.pathname.replace(/\/+$/, "");
  if (!path) return url.origin === relay.origin;
  return url.pathname === path || url.pathname.startsWith(`${path}/`);
}

/** Highest-bandwidth variant playlist URLs, original (not relayed). */
export function hlsVariantUrls(manifest: string, playlistUrl: string): string[] {
  const lines = manifest.split(/\r?\n/);
  const found: Array<{ bandwidth: number; url: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? "").trim();
      if (!next) continue;
      if (next.startsWith("#")) break;
      try {
        found.push({ bandwidth, url: new URL(next, playlistUrl).href });
      } catch {
        /* skip a malformed variant URI */
      }
      break;
    }
  }
  found.sort((a, b) => a.bandwidth - b.bandwidth);
  return found.map((item) => item.url);
}

/**
 * Rewrite playlist, segment, and key URIs. Relative URIs are resolved against
 * the original playlist URL, then passed through `relayMediaUrl`.
 * `absoluteOrigin` (the page origin) turns `/m/...` into an absolute URL so a
 * blob playlist still requests the relay.
 */
export function rewriteHlsManifest(
  manifest: string,
  playlistUrl: string,
  base = mediaRelayBase(),
  absoluteOrigin = "",
): string {
  if (!normalizeRelayBase(base)) return manifest;
  const uriAttr = /URI="([^"]*)"|URI='([^']*)'/gi;
  const finish = (value: string) => {
    let abs = value;
    try {
      abs = new URL(value, playlistUrl).href;
    } catch {
      abs = value;
    }
    const relayed = relayMediaUrl(abs, base, "");
    if (absoluteOrigin && relayed.startsWith("/"))
      return `${absoluteOrigin.replace(/\/+$/, "")}${relayed}`;
    return relayed;
  };
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        if (!/URI=/i.test(line)) return line;
        return line.replace(uriAttr, (match, dbl: string | undefined, sgl: string | undefined) => {
          const uri = dbl ?? sgl ?? "";
          const next = finish(uri);
          return match.includes(`URI="`) || match.toLowerCase().includes(`uri="`)
            ? `URI="${next}"`
            : `URI='${next}'`;
        });
      }
      return finish(trimmed);
    })
    .join("\n");
}
