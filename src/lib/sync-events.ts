export type TrackSnap = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  duration: number;
  streamUrl: string;
  downloadPath: string;
};

export type SavedAlbumSnap = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  year: string;
};

export type FollowSnap = {
  id: string;
  name: string;
  image: string;
};

export type PlaylistSnap = {
  id: string;
  name: string;
  tracks: TrackSnap[];
};

export type SyncEvent =
  | { type: "like"; track: TrackSnap }
  | { type: "unlike"; id: string }
  | { type: "history"; track: TrackSnap & { at: number } }
  | { type: "playlist"; playlist: PlaylistSnap }
  | { type: "playlist-delete"; id: string }
  | { type: "follow"; artist: FollowSnap }
  | { type: "unfollow"; id: string }
  | { type: "album"; album: SavedAlbumSnap }
  | { type: "album-remove"; id: string }
  | { type: "theme"; theme: "green" | "crimson" | "night" | "ice" };

const PROMPTS = new Set<SyncEvent["type"]>([
  "like",
  "unlike",
  "playlist",
  "playlist-delete",
  "follow",
  "unfollow",
  "album",
  "album-remove",
]);

let muted = 0;
let handler: ((event: SyncEvent) => void) | null = null;

export function runMuted<T>(fn: () => T): T {
  muted += 1;
  try {
    return fn();
  } finally {
    muted -= 1;
  }
}

export function setSyncHandler(fn: (event: SyncEvent) => void) {
  handler = fn;
}

export function emitSync(event: SyncEvent) {
  if (muted || !handler) return;
  handler(event);
}

export function isLibraryPrompt(event: SyncEvent) {
  return PROMPTS.has(event.type);
}
