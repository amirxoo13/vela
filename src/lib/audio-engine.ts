import { bindMedia } from "@/lib/tone";

type Listener = {
  onTime: (seconds: number) => void;
  onEnd: () => void;
  onDuration: (seconds: number) => void;
};

let el: HTMLAudioElement | null = null;
let listener: Listener | null = null;

export function mountAudio(node: HTMLAudioElement | null, next: Listener | null) {
  el = node;
  listener = next;
  if (!el) return;
  el.crossOrigin = "anonymous";
  el.onended = () => listener?.onEnd();
  el.ontimeupdate = () => {
    if (el) listener?.onTime(el.currentTime || 0);
  };
  el.onloadedmetadata = () => {
    const duration = el?.duration ?? 0;
    if (Number.isFinite(duration) && duration > 0) listener?.onDuration(duration);
  };
}

export function mediaDuration(): number {
  const duration = el?.duration ?? 0;
  return Number.isFinite(duration) ? duration : 0;
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

function waitForMetadata(node: HTMLAudioElement) {
  if (node.readyState >= 1) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      node.removeEventListener("loadedmetadata", finish);
      node.removeEventListener("error", finish);
      resolve();
    };
    node.addEventListener("loadedmetadata", finish);
    node.addEventListener("error", finish);
    window.setTimeout(finish, 8000);
  });
}

export async function playMedia(url: string, position: number) {
  if (!el || !url) throw new Error("Nothing to play");
  bindMedia(el);
  const absolute = new URL(url, window.location.href).href;
  if (el.src !== absolute) {
    el.src = url;
    await waitForMetadata(el);
  }
  seekMedia(position);
  await el.play();
}
