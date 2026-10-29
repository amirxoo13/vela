export type RepeatMode = "off" | "all" | "one";

export type Advance =
  | { type: "restart" }
  | { type: "stop" }
  | { type: "play"; id: string; heard: string[]; radio: boolean };

export type AdvanceInput = {
  order: string[];
  trackId: string;
  repeat: RepeatMode;
  shuffle: boolean;
  heard: string[];
  /** Tracks to continue with after this queue, like a Spotify radio. */
  related: string[];
  rng?: () => number;
};

function clean(ids: string[], skip?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || id === skip || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * What should play when the current song ends, or when the listener hits Next.
 * Pure: no DOM, no timers, no network. `radio` means the id is outside `order`.
 */
export function advanceQueue(input: AdvanceInput): Advance {
  const rng = input.rng ?? Math.random;
  const order = clean(input.order);
  const related = clean(input.related).filter((id) => !order.includes(id));
  if (input.repeat === "one" && input.trackId) return { type: "restart" };

  if (input.shuffle && order.length) {
    const heard = input.heard.filter((id) => order.includes(id) || id === input.trackId);
    if (input.trackId && !heard.includes(input.trackId)) heard.push(input.trackId);
    let pool = order.filter((id) => !heard.includes(id));
    if (!pool.length && input.repeat === "all") {
      heard.length = 0;
      if (input.trackId) heard.push(input.trackId);
      pool = order.filter((id) => id !== input.trackId);
      if (!pool.length) pool = order.slice();
    }
    if (pool.length) {
      const id = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] ?? pool[0]!;
      if (!heard.includes(id)) heard.push(id);
      return { type: "play", id, heard, radio: false };
    }
    if (related[0]) return { type: "play", id: related[0], heard: [], radio: true };
    return { type: "stop" };
  }

  if (!order.length) {
    if (related[0]) return { type: "play", id: related[0], heard: [], radio: true };
    return { type: "stop" };
  }
  const index = order.indexOf(input.trackId);
  if (index === -1) return { type: "play", id: order[0]!, heard: [], radio: false };
  if (index < order.length - 1) return { type: "play", id: order[index + 1]!, heard: input.heard, radio: false };
  if (input.repeat === "all") return { type: "play", id: order[0]!, heard: [], radio: false };
  if (related[0]) return { type: "play", id: related[0], heard: [], radio: true };
  return { type: "stop" };
}
