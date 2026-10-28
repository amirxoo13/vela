/**
 * Fetch URL for an allowlisted media object when MEDIA_RELAY_BASE is set.
 *
 *   https://<host>[:port]/<path>?<query>
 *     → ${MEDIA_RELAY_BASE}/<host>[:port]/<path>?<query>
 *
 * The host allowlist is applied to the original URL before this runs.
 * An empty base returns the original URL.
 */
export function relayUpstreamUrl(target: URL, relayBase: string): URL {
  const prefix = relayBase.trim().replace(/\/+$/, '');
  if (!prefix) return target;
  return new URL(`${prefix}/${target.host}${target.pathname}${target.search}`);
}
