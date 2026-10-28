import {
  hlsVariantUrls,
  mediaRelayEnabled,
  originalMediaUrl,
  relayMediaUrl,
  rewriteHlsManifest,
} from "@/lib/media-relay";

/**
 * Safari plays HLS itself, so segment requests cannot go through an hls.js
 * loader. Fetch the playlist (and its highest variant) via the relay, rewrite
 * every URI to an absolute same-origin relay URL, and hand the browser a blob
 * playlist. On failure, fall back to the relay URL of the original manifest
 * so relative segments still resolve under `/m/<host>/<dir>/`.
 */
export async function nativeHlsSource(
  hlsUrl: string,
): Promise<{ src: string; revoke: () => void }> {
  const original = originalMediaUrl(hlsUrl);
  const direct = relayMediaUrl(original);
  if (!mediaRelayEnabled()) return { src: hlsUrl, revoke: () => undefined };
  try {
    let body = await fetchPlaylist(direct);
    let base = /^https?:\/\//i.test(original) ? original : hlsUrl;
    const variants = hlsVariantUrls(body, base);
    if (variants.length) {
      const variant = variants[variants.length - 1]!;
      body = await fetchPlaylist(relayMediaUrl(variant));
      base = variant;
      const nested = hlsVariantUrls(body, base);
      if (nested.length) {
        const leaf = nested[nested.length - 1]!;
        body = await fetchPlaylist(relayMediaUrl(leaf));
        base = leaf;
      }
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const rewritten = rewriteHlsManifest(body, base, undefined, origin);
    const src = URL.createObjectURL(
      new Blob([rewritten], { type: "application/vnd.apple.mpegurl" }),
    );
    return { src, revoke: () => URL.revokeObjectURL(src) };
  } catch {
    return { src: direct, revoke: () => undefined };
  }
}

async function fetchPlaylist(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}
