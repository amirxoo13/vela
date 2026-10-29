import { relayMediaUrl } from "@/lib/media-relay";

type Listener = {
  onTime: (seconds: number) => void;
  onEnd: () => void;
  onFail: () => void;
  onDuration: (seconds: number) => void;
  onWaiting: (waiting: boolean) => void;
};

let el: HTMLAudioElement | null = null;
let listener: Listener | null = null;
let preloadEl: HTMLAudioElement | null = null;
let token = 0;

export function mountAudio(node: HTMLAudioElement | null, next: Listener | null) {
  el = node;
  listener = next;
  if (!el) return;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.onended = () => listener?.onEnd();
  el.onerror = () => {
    if (el?.error) listener?.onFail();
  };
  el.ontimeupdate = () => {
    if (el) listener?.onTime(el.currentTime || 0);
  };
  el.onloadedmetadata = () => {
    const duration = el?.duration ?? 0;
    if (Number.isFinite(duration) && duration > 0) listener?.onDuration(duration);
  };
  el.onwaiting = () => listener?.onWaiting(true);
  el.onstalled = () => listener?.onWaiting(true);
  el.onplaying = () => listener?.onWaiting(false);
  el.oncanplay = () => listener?.onWaiting(false);
}

export function mediaDuration(): number {
  const duration = el?.duration ?? 0;
  return Number.isFinite(duration) ? duration : 0;
}

export function mediaPlaying(): boolean {
  return !!el && !el.paused && !el.ended;
}

export function seekMedia(position: number) {
  if (!el) return;
  const next = Math.max(0, position);
  try {
    if (Math.abs((el.currentTime || 0) - next) > 0.05) el.currentTime = next;
  } catch {
    /* metadata not ready yet */
  }
}

export function pauseMedia() {
  el?.pause();
}

/**
 * Start playback in this turn.
 *
 * `play()` has to run before the first await. The song-ended event (and a
 * lock-screen Next press while the screen is off) is only allowed to start
 * the following audio if `play()` is called synchronously. Waiting for
 * metadata, or for a timer, drops that permission — Android then sits on
 * silence until someone presses Next again. Metadata seeking happens after
 * playback has already been accepted.
 */
export function playMedia(url: string, position: number): Promise<void> {
  const node = el;
  if (!node || !url) return Promise.reject(new Error("Nothing to play"));
  const src = relayMediaUrl(url);
  const mine = ++token;
  const absolute = new URL(src, window.location.href).href;
  if (node.src !== absolute) node.src = src;
  else if (position <= 0 && (node.ended || node.currentTime > 0.25)) {
    try {
      node.currentTime = 0;
    } catch {
      /* the following play() restarts an ended element */
    }
  }
  if (position > 0) {
    const apply = () => {
      if (mine !== token || !el) return;
      seekMedia(position);
    };
    if (node.readyState >= 1) apply();
    else node.addEventListener("loadedmetadata", apply, { once: true });
  }
  const started = node.play();
  return Promise.resolve(started).then(
    () => {
      if (mine !== token) return;
    },
    (error: Error) => {
      if (mine !== token || error?.name === "AbortError") return;
      throw error;
    },
  );
}

/** Fetch the following song while this one is still going, so the gap is just a src swap. */
export function preloadMedia(url: string) {
  if (!url || typeof Audio === "undefined") return;
  const src = relayMediaUrl(url);
  if (!preloadEl) {
    preloadEl = new Audio();
    preloadEl.preload = "auto";
  }
  try {
    const absolute = new URL(src, window.location.href).href;
    if (preloadEl.src !== absolute) preloadEl.src = src;
  } catch {
    /* a bad URL should not stop the song that is already playing */
  }
}
