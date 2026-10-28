import { create } from "zustand";
import { pauseMedia, playMedia, seekMedia, mediaDuration } from "@/lib/audio-engine";
import { albumById, queueIds, trackById, useCatalog } from "@/lib/catalog-store";
import { playlistQueue, useLibrary } from "@/lib/library";
import { playbackSrc } from "@/lib/music-api";
import { startBeat, stopBeat } from "@/lib/tone";

export type ThemeId = "green" | "crimson" | "night" | "ice";
export type RepeatMode = "off" | "all" | "one";

export type Screen =
  | "home"
  | "search"
  | "albums"
  | "album"
  | "videos"
  | "socials"
  | "tour"
  | "editor"
  | "history"
  | "playlists"
  | "favorites";

export type Sticker = { uid: string; kind: StickerKind; x: number; y: number };

export type StickerKind = "star" | "bolt" | "flame" | "disc" | "spark" | "moon" | "heart" | "drop";

type Persisted = {
  liked: Record<string, boolean>;
  holds: Record<string, boolean>;
  posts: Record<string, boolean>;
  stickers: Sticker[];
  trackId: string;
  theme: ThemeId;
  repeat: RepeatMode;
  shuffle: boolean;
};

type State = Persisted & {
  screen: Screen;
  albumId: string;
  videoId: string;
  session: number;
  playing: boolean;
  position: number;
  scrubbing: boolean;
  playerOpen: boolean;
  notice: string;
  hydrated: boolean;
  setScreen: (screen: Screen) => void;
  openAlbum: (albumId: string) => void;
  openVideo: (videoId: string, trackId: string) => void;
  setSession: (session: number) => void;
  togglePlay: () => void;
  playTrack: (trackId: string, albumId?: string) => void;
  next: () => void;
  prev: () => void;
  seek: (position: number) => void;
  endScrub: () => void;
  toggleLike: (trackId?: string) => void;
  toggleHold: (id: string) => void;
  togglePost: (id: string) => void;
  setPlayerOpen: (open: boolean) => void;
  addSticker: (kind: StickerKind) => void;
  moveSticker: (uid: string, x: number, y: number) => void;
  clearStickers: () => void;
  commit: () => void;
  setTheme: (theme: ThemeId) => void;
  flash: (notice: string) => void;
  hydrate: () => void;
  setRepeat: (repeat: RepeatMode) => void;
  toggleShuffle: () => void;
};

const KEY = "vela-desk";

const seedStickers: Sticker[] = [
  { uid: "s1", kind: "star", x: 18, y: 22 },
  { uid: "s2", kind: "bolt", x: 68, y: 36 },
  { uid: "s3", kind: "disc", x: 34, y: 68 },
  { uid: "s4", kind: "spark", x: 74, y: 72 },
];

function variantFor(trackId: string) {
  return albumById(trackById(trackId).albumId).variant;
}

function persist(partial: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(partial));
  } catch {
    /* private mode */
  }
}

function snapshot(s: State): Persisted {
  return {
    liked: s.liked,
    holds: s.holds,
    posts: s.posts,
    stickers: s.stickers,
    trackId: s.trackId,
    theme: s.theme,
    repeat: s.repeat,
    shuffle: s.shuffle,
  };
}

function orderFor(albumId: string, trackId: string) {
  return playlistQueue(albumId, trackId) ?? queueIds(albumId, trackId);
}

function listen(trackId: string) {
  const track = trackById(trackId);
  if (track.id) useLibrary.getState().remember(track);
}

function begin(trackId: string, position: number) {
  const track = trackById(trackId);
  startBeat(variantFor(trackId));
  const src = playbackSrc(track);
  if (!src) {
    stopBeat();
    return Promise.reject(new Error("no-src"));
  }
  return playMedia(src, position);
}

export const usePlayer = create<State>((set, get) => ({
  screen: "home",
  albumId: "",
  videoId: "",
  session: 0,
  trackId: "",
  playing: false,
  position: 0,
  scrubbing: false,
  playerOpen: false,
  liked: {},
  holds: {},
  posts: {},
  stickers: seedStickers,
  notice: "",
  hydrated: false,
  theme: "green",
  repeat: "all",
  shuffle: false,
  setScreen: (screen) => set({ screen, playerOpen: false }),
  openAlbum: (albumId) => set({ albumId, screen: "album", playerOpen: false }),
  openVideo: (videoId, trackId) => {
    const track = trackById(trackId);
    set({
      videoId,
      trackId,
      albumId: track.albumId || get().albumId,
      position: 0,
      playing: true,
      screen: "videos",
    });
    listen(trackId);
    void begin(trackId, 0).catch(() => {
      stopBeat();
      set({ playing: false });
    });
  },
  setSession: (session) => set({ session }),
  togglePlay: () => {
    const s = get();
    if (s.playing) {
      stopBeat();
      pauseMedia();
      set({ playing: false });
      return;
    }
    set({ playing: true });
    listen(s.trackId);
    void begin(s.trackId, s.position).catch(() => {
      stopBeat();
      set({ playing: false });
    });
  },
  playTrack: (trackId, albumId) => {
    const track = trackById(trackId);
    const nextAlbum = albumId || track.albumId || get().albumId;
    set({ trackId, albumId: nextAlbum, position: 0, playing: true });
    persist(snapshot(get()));
    listen(trackId);
    void begin(trackId, 0).catch(() => {
      stopBeat();
      set({ playing: false });
    });
  },
  next: () => {
    const s = get();
    if (s.repeat === "one") {
      seekMedia(0);
      set({ position: 0, playing: true });
      listen(s.trackId);
      void begin(s.trackId, 0).catch(() => {
        stopBeat();
        set({ playing: false });
      });
      return;
    }
    const order = orderFor(s.albumId, s.trackId);
    if (!order.length) return;
    const index = order.indexOf(s.trackId);
    if (!s.shuffle && s.repeat === "off" && index === order.length - 1) {
      pauseMedia();
      stopBeat();
      set({ playing: false, position: 0 });
      return;
    }
    let id = order[(index + 1) % order.length] ?? order[0];
    if (s.shuffle && order.length > 1) {
      const pool = order.filter((item) => item !== s.trackId);
      id = pool[Math.floor(Math.random() * pool.length)] ?? id;
    }
    if (!id) return;
    const track = trackById(id);
    const inAlbum =
      (useCatalog.getState().membership[s.albumId] ?? []).includes(id) ||
      Boolean(playlistQueue(s.albumId, id));
    set({ trackId: id, albumId: inAlbum ? s.albumId : track.albumId || s.albumId, position: 0 });
    listen(id);
    if (s.playing) {
      void begin(id, 0).catch(() => {
        stopBeat();
        set({ playing: false });
      });
    }
    persist(snapshot(get()));
  },
  prev: () => {
    const s = get();
    if (s.position > 3) {
      seekMedia(0);
      set({ position: 0 });
      return;
    }
    const order = orderFor(s.albumId, s.trackId);
    if (!order.length) return;
    const index = order.indexOf(s.trackId);
    const id = order[(index - 1 + order.length) % order.length] ?? order[0];
    if (!id) return;
    const track = trackById(id);
    const inAlbum = Boolean(playlistQueue(s.albumId, id));
    set({ trackId: id, albumId: inAlbum ? s.albumId : track.albumId || s.albumId, position: 0 });
    listen(id);
    if (s.playing) {
      void begin(id, 0).catch(() => {
        stopBeat();
        set({ playing: false });
      });
    }
    persist(snapshot(get()));
  },
  seek: (position) => {
    const track = trackById(get().trackId);
    const dur = mediaDuration() || track.duration;
    const max = dur > 0.2 ? dur - 0.05 : Math.max(position, 0);
    const nextPos = Math.min(max, Math.max(0, position));
    seekMedia(nextPos);
    set({ position: nextPos, scrubbing: true });
  },
  endScrub: () => set({ scrubbing: false }),
  toggleLike: (trackId) => {
    const id = trackId ?? get().trackId;
    const liked = { ...get().liked, [id]: !get().liked[id] };
    set({ liked });
    persist(snapshot(get()));
  },
  toggleHold: (id) => {
    const holds = { ...get().holds, [id]: !get().holds[id] };
    set({ holds });
    persist(snapshot(get()));
  },
  togglePost: (id) => {
    const posts = { ...get().posts, [id]: !get().posts[id] };
    set({ posts });
    persist(snapshot(get()));
  },
  setPlayerOpen: (playerOpen) => set({ playerOpen }),
  addSticker: (kind) => {
    const stickers = [
      ...get().stickers,
      { uid: crypto.randomUUID(), kind, x: 30 + Math.random() * 40, y: 28 + Math.random() * 40 },
    ];
    set({ stickers });
    persist(snapshot(get()));
  },
  moveSticker: (uid, x, y) => {
    const stickers = get().stickers.map((s) =>
      s.uid === uid ? { ...s, x: Math.min(88, Math.max(8, x)), y: Math.min(88, Math.max(8, y)) } : s,
    );
    set({ stickers });
  },
  clearStickers: () => {
    set({ stickers: [] });
    persist(snapshot(get()));
  },
  commit: () => persist(snapshot(get())),
  setTheme: (theme) => {
    set({ theme });
    persist(snapshot(get()));
  },
  setRepeat: (repeat) => {
    set({ repeat });
    persist(snapshot(get()));
  },
  toggleShuffle: () => {
    set({ shuffle: !get().shuffle });
    persist(snapshot(get()));
  },
  flash: (notice) => {
    set({ notice });
    window.setTimeout(() => {
      if (get().notice === notice) set({ notice: "" });
    }, 1600);
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        set({ hydrated: true });
        return;
      }
      const data = JSON.parse(raw) as Partial<Persisted>;
      set({
        liked: data.liked ?? {},
        holds: data.holds ?? {},
        posts: data.posts ?? {},
        stickers: data.stickers?.length ? data.stickers : seedStickers,
        trackId: typeof data.trackId === "string" ? data.trackId : "",
        theme:
          data.theme === "crimson" || data.theme === "night" || data.theme === "ice" || data.theme === "green"
            ? data.theme
            : "green",
        repeat: data.repeat === "off" || data.repeat === "one" || data.repeat === "all" ? data.repeat : "all",
        shuffle: Boolean(data.shuffle),
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
}));
