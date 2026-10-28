import { create } from "zustand";
import { albumById, trackById, tracks } from "@/data/catalog";
import { startBeat, stopBeat } from "@/lib/tone";

export type ThemeId = "green" | "crimson" | "night" | "ice";

export type Screen = "home" | "albums" | "album" | "videos" | "socials" | "tour" | "editor";

export type Sticker = { uid: string; kind: StickerKind; x: number; y: number };

export type StickerKind = "star" | "bolt" | "flame" | "disc" | "spark" | "moon" | "heart" | "drop";

type Persisted = {
  liked: Record<string, boolean>;
  holds: Record<string, boolean>;
  posts: Record<string, boolean>;
  stickers: Sticker[];
  trackId: string;
  theme: ThemeId;
};

type State = Persisted & {
  screen: Screen;
  albumId: string;
  videoId: string;
  session: number;
  playing: boolean;
  position: number;
  playerOpen: boolean;
  notice: string;
  hydrated: boolean;
  setScreen: (screen: Screen) => void;
  openAlbum: (albumId: string) => void;
  openVideo: (videoId: string, trackId: string) => void;
  setSession: (session: number) => void;
  togglePlay: () => void;
  playTrack: (trackId: string) => void;
  next: () => void;
  prev: () => void;
  seek: (position: number) => void;
  advance: (dt: number) => void;
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
  };
}

export const usePlayer = create<State>((set, get) => ({
  screen: "home",
  albumId: "voltage",
  videoId: "room-lisbon",
  session: 0,
  trackId: "glass-hour",
  playing: false,
  position: 0,
  playerOpen: false,
  liked: {},
  holds: {},
  posts: {},
  stickers: seedStickers,
  notice: "",
  hydrated: false,
  theme: "green",
  setScreen: (screen) => set({ screen, playerOpen: false }),
  openAlbum: (albumId) => set({ albumId, screen: "album", playerOpen: false }),
  openVideo: (videoId, trackId) => {
    set({ videoId, trackId, position: 0, playing: true, screen: "videos" });
    startBeat(variantFor(trackId));
  },
  setSession: (session) => set({ session }),
  togglePlay: () => {
    const s = get();
    if (s.playing) {
      stopBeat();
      set({ playing: false });
      return;
    }
    startBeat(variantFor(s.trackId));
    set({ playing: true });
  },
  playTrack: (trackId) => {
    set({ trackId, position: 0, playing: true });
    startBeat(variantFor(trackId));
    persist(snapshot(get()));
  },
  next: () => {
    const s = get();
    const i = tracks.findIndex((t) => t.id === s.trackId);
    const n = tracks[(i + 1) % tracks.length] ?? tracks[0];
    set({ trackId: n.id, position: 0 });
    if (s.playing) startBeat(variantFor(n.id));
    persist(snapshot(get()));
  },
  prev: () => {
    const s = get();
    if (s.position > 3) {
      set({ position: 0 });
      return;
    }
    const i = tracks.findIndex((t) => t.id === s.trackId);
    const n = tracks[(i - 1 + tracks.length) % tracks.length] ?? tracks[0];
    set({ trackId: n.id, position: 0 });
    if (s.playing) startBeat(variantFor(n.id));
    persist(snapshot(get()));
  },
  seek: (position) => {
    const dur = trackById(get().trackId).duration;
    set({ position: Math.min(dur - 0.2, Math.max(0, position)) });
  },
  advance: (dt) => {
    const s = get();
    if (!s.playing) return;
    const dur = trackById(s.trackId).duration;
    const position = s.position + dt;
    if (position >= dur) {
      get().next();
      return;
    }
    set({ position });
  },
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
        trackId: data.trackId && tracks.some((t) => t.id === data.trackId) ? data.trackId : "glass-hour",
        theme: data.theme === "crimson" || data.theme === "night" || data.theme === "ice" || data.theme === "green" ? data.theme : "green",
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
}));
