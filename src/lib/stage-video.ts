/** The visible music-video element, so the song player can stop it. */
let node: HTMLVideoElement | null = null;

export function bindStageVideo(el: HTMLVideoElement | null) {
  node = el;
}

export function releaseStageVideo(el: HTMLVideoElement) {
  if (node === el) node = null;
}

export function pauseStageVideo() {
  if (node && !node.paused) node.pause();
}

export function stageVideoPlaying() {
  return !!node && !node.paused && !node.ended;
}

export function stageVideoElement() {
  return node;
}
