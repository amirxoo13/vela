let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let bound: HTMLAudioElement | null = null;

function ac() {
  if (!ctx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.connect(ctx.destination);
  }
  return ctx;
}

/** Route real playback through the analyser so the existing level bars keep moving. */
export function bindMedia(el: HTMLAudioElement) {
  try {
    const context = ac();
    if (bound !== el) {
      const source = context.createMediaElementSource(el);
      source.connect(analyser!);
      bound = el;
    }
    void context.resume();
  } catch {
    /* element output still plays if the graph was already created */
  }
}

export function startBeat(_variant: number) {
  if (typeof window === "undefined") return;
  void ac().resume();
}

export function stopBeat() {
  /* pause is owned by the media element */
}

export function levels() {
  if (!analyser) return Array.from({ length: 22 }, () => 0.08);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const out: number[] = [];
  const take = 22;
  for (let i = 0; i < take; i++) {
    const idx = Math.min(bins.length - 1, Math.floor((i / take) * bins.length));
    out.push(Math.max(0.08, (bins[idx] ?? 0) / 255));
  }
  return out;
}
