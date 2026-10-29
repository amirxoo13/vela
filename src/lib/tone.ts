/**
 * Visual stand-in for the old analyser bars.
 * Real playback stays on the <audio> element. Routing it through
 * createMediaElementSource silences it whenever the AudioContext is suspended,
 * which is the normal state on Android once the screen is off.
 */

let beating = false;

export function startBeat(_variant: number) {
  beating = true;
}

export function stopBeat() {
  beating = false;
}

/** Decorative levels from play state. Nothing here touches the audio element. */
export function levels() {
  const take = 22;
  if (!beating) return Array.from({ length: take }, () => 0.08);
  const t = Date.now() / 180;
  return Array.from({ length: take }, (_, i) => {
    const wave = 0.45 + 0.55 * Math.abs(Math.sin(t + i * 0.45));
    return Math.max(0.08, Math.min(1, wave));
  });
}
