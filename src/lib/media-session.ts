import { mediaDuration } from "@/lib/audio-engine";
import { albumById, trackById } from "@/lib/catalog-store";
import { relayMediaUrl } from "@/lib/media-relay";
import { usePlayer } from "@/lib/player-store";
import { pauseStageVideo, stageVideoElement, stageVideoPlaying } from "@/lib/stage-video";

function artwork(src: string): MediaImage[] {
  const relayed = relayMediaUrl(src);
  if (!relayed) return [];
  return [96, 128, 192, 256, 512].map((size) => ({
    src: relayed,
    sizes: `${size}x${size}`,
    type: "image/jpeg",
  }));
}

function publish(title: string, artist: string, album: string, cover: string, playing: boolean) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || "Melobi",
      artist: artist || "Melobi",
      album: album || "Melobi",
      artwork: artwork(cover),
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  } catch {
    /* a rejected artwork URL should not break playback */
  }
}

function position(current: number, duration: number) {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const pos = Math.min(Math.max(0, current), duration);
  try {
    navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: pos });
  } catch {
    /* ignore a transient mismatch while metadata loads */
  }
}

let armed = false;
let publishedId = "";

function armMusicHandlers() {
  if (!("mediaSession" in navigator) || armed) return;
  armed = true;
  const seekBy = (delta: number) => {
    const next = Math.max(0, usePlayer.getState().position + delta);
    usePlayer.getState().seek(next);
    usePlayer.getState().endScrub();
  };
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      pauseStageVideo();
      if (!usePlayer.getState().playing) usePlayer.getState().togglePlay();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (usePlayer.getState().playing) usePlayer.getState().togglePlay();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => usePlayer.getState().next());
    navigator.mediaSession.setActionHandler("previoustrack", () => usePlayer.getState().prev());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime !== "number") return;
      usePlayer.getState().seek(details.seekTime);
      usePlayer.getState().endScrub();
    });
    navigator.mediaSession.setActionHandler("seekbackward", (details) => seekBy(-(details.seekOffset || 10)));
    navigator.mediaSession.setActionHandler("seekforward", (details) => seekBy(details.seekOffset || 10));
  } catch {
    /* some handlers are missing on older WebViews */
  }
}

/** Lock-screen clock. Called from the audio element, not from a React render. */
export function notePlayback(playing: boolean, positionSec: number) {
  if (stageVideoPlaying()) return;
  armMusicHandlers();
  const player = usePlayer.getState();
  const track = trackById(player.trackId);
  const album = albumById(track.albumId || player.albumId);
  const duration = track.duration || mediaDuration();
  if (track.id !== publishedId || !publishedId) {
    publishedId = track.id;
    publish(track.title, track.artist, album.title, track.cover || album.cover, playing);
  } else if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }
  position(positionSec, duration);
}

export function syncMusicSession(playing: boolean, positionSec: number) {
  publishedId = "";
  notePlayback(playing, positionSec);
}

export function syncVideoSession(title: string, artist: string, cover: string, playing: boolean) {
  armed = false;
  publishedId = "";
  const node = stageVideoElement();
  publish(title, artist, "Video", cover, playing);
  if (node) position(node.currentTime || 0, node.duration || 0);
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      void node?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => node?.pause());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (node && typeof details.seekTime === "number") node.currentTime = details.seekTime;
    });
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      if (!node) return;
      node.currentTime = Math.max(0, node.currentTime - (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      if (!node) return;
      const end = Number.isFinite(node.duration) ? node.duration : node.currentTime + 30;
      node.currentTime = Math.min(end, node.currentTime + (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler("nexttrack", null);
    navigator.mediaSession.setActionHandler("previoustrack", null);
  } catch {
    /* ignore */
  }
}
