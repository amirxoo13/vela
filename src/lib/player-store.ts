import { create } from "zustand";
import { pauseMedia, playMedia, preloadMedia, seekMedia, mediaDuration } from "@/lib/audio-engine";
import { albumById, queueIds, trackById, useCatalog } from "@/lib/catalog-store";
import { playlistQueue, trackSnap, useLibrary } from "@/lib/library";
import { playbackSrc } from "@/lib/music-api";
import { advanceQueue } from "@/lib/playback-queue";
import { emitSync } from "@/lib/sync-events";
import { pauseStageVideo } from "@/lib/stage-video";
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
  | "favorites"
  | "profile"
  | "following"
  | "saved";

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
  buffering: boolean;
  position: number;
  scrubbing: boolean;
  playerOpen: boolean;
  notice: string;
  hydrated: boolean;
  searchSeed: string;
  videoAutoplay: boolean;
  setScreen: (screen: Screen) => void;
  openAlbum: (albumId: string) => void;
  openVideo: (videoId: string) => void;
  setSession: (session: number) => void;
  togglePlay: () => void;
  playTrack: (trackId: string, albumId?: string) => void;
  next: () => void;
  prev: () => void;
  failTrack: () => void;
  setBuffering: (waiting: boolean) => void;
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
  openSearch: (query: string) => void;
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
  if (albumId === "radio") {
    const radio = useCatalog.getState().membership.radio;
    if (radio?.includes(trackId)) return radio;
  }
  return playlistQueue(albumId, trackId) ?? queueIds(albumId, trackId);
}

function relatedFor(order: string[], trackId: string): string[] {
  const skip = new Set(order);
  if (trackId) skip.add(trackId);
  return Object.keys(useCatalog.getState().trackMap).filter((id) => {
    if (skip.has(id)) return false;
    const track = trackById(id);
    return Boolean(track.streamUrl || track.downloadPath);
  });
}

let heardIds: string[] = [];
let playGen = 0;
let misses = 0;
let advancing = false;
let fromPop = false;

function pushNav(screen: Screen, playerOpen: boolean) {
  if (fromPop || typeof history === "undefined") return;
  const current = history.state as { melobi?: Screen; player?: boolean } | null;
  if (current?.melobi === screen && Boolean(current.player) === playerOpen) return;
  history.pushState({ melobi: screen, player: playerOpen }, "");
}

export function applyHistory(screen: Screen, playerOpen: boolean) {
  fromPop = true;
  usePlayer.setState({ screen, playerOpen });
  fromPop = false;
}

function rememberRadio(ids: string[]) {
  const list = ids.filter(Boolean);
  useCatalog.setState((state) => ({
    membership: { ...state.membership, radio: list },
  }));
}

function peekSrc(albumId: string, trackId: string): string {
  const order = orderFor(albumId, trackId);
  const step = advanceQueue({
    order,
    trackId,
    repeat: usePlayer.getState().repeat,
    shuffle: usePlayer.getState().shuffle,
    heard: heardIds,
    related: relatedFor(order, trackId),
  });
  if (step.type !== "play") return "";
  return playbackSrc(trackById(step.id));
}

function listen(trackId: string) {
  const track = trackById(trackId);
  if (track.id) useLibrary.getState().remember(track);
}

function begin(trackId: string, position: number) {
  pauseStageVideo();
  const track = trackById(trackId);
  startBeat(variantFor(trackId));
  const src = playbackSrc(track);
  if (!src) {
    stopBeat();
    return Promise.reject(new Error("no-src"));
  }
  return playMedia(src, position);
}

function followUp(albumId: string, trackId: string) {
  const src = peekSrc(albumId, trackId);
  if (src) preloadMedia(src);
}

function startAt(trackId: string, albumId: string, position: number) {
  const gen = ++playGen;
  usePlayer.setState({ trackId, albumId, position, playing: true, buffering: true });
  persist(snapshot(usePlayer.getState()));
  listen(trackId);
  void begin(trackId, position).then(
    () => {
      if (gen !== playGen) return;
      misses = 0;
      usePlayer.setState({ buffering: false });
      followUp(albumId, trackId);
    },
    () => {
      if (gen !== playGen) return;
      usePlayer.getState().failTrack();
    },
  );
}

export const usePlayer = create<State>((set, get) => ({
  screen: "home",
  albumId: "",
  videoId: "",
  session: 0,
  trackId: "",
  playing: false,
  buffering: false,
  position: 0,
  scrubbing: false,
  playerOpen: false,
  liked: {},
  holds: {},
  posts: {},
  stickers: seedStickers,
  notice: "",
  hydrated: false,
  searchSeed: "",
  videoAutoplay: false,
  theme: "green",
  repeat: "all",
  shuffle: false,
  setScreen: (screen) => {
    set({ screen, playerOpen: false });
    if (screen === "home") {
      if (!fromPop && typeof history !== "undefined") history.replaceState({ melobi: "home", player: false }, "");
      return;
    }
    pushNav(screen, false);
  },
  openSearch: (query) => {
    set({ screen: "search", searchSeed: query, playerOpen: false });
    pushNav("search", false);
  },
  openAlbum: (albumId) => {
    set({ albumId, screen: "album", playerOpen: false });
    pushNav("album", false);
  },
  openVideo: (videoId) => {
    stopBeat();
    pauseMedia();
    pauseStageVideo();
    set({ videoId, screen: "videos", playing: false, playerOpen: false, videoAutoplay: true });
    pushNav("videos", false);
  },
  setSession: (session) => set({ session }),
  togglePlay: () => {
    const s = get();
    if (s.playing) {
      stopBeat();
      pauseMedia();
      set({ playing: false, buffering: false });
      return;
    }
    if (!s.trackId) return;
    startAt(s.trackId, s.albumId, s.position);
  },
  playTrack: (trackId, albumId) => {
    const track = trackById(trackId);
    const nextAlbum = albumId || track.albumId || get().albumId;
    if (nextAlbum !== get().albumId) heardIds = [];
    misses = 0;
    startAt(trackId, nextAlbum, 0);
  },
  next: () => {
    if (advancing) return;
    advancing = true;
    try {
    const s = get();
    const order = orderFor(s.albumId, s.trackId);
    const step = advanceQueue({
      order,
      trackId: s.trackId,
      repeat: s.repeat,
      shuffle: s.shuffle,
      heard: heardIds,
      related: relatedFor(order, s.trackId),
    });
    if (step.type === "stop") {
      pauseMedia();
      stopBeat();
      set({ playing: false, buffering: false, position: 0 });
      return;
    }
    if (step.type === "restart") {
      if (!s.playing) {
        seekMedia(0);
        set({ position: 0 });
        return;
      }
      startAt(s.trackId, s.albumId, 0);
      return;
    }
    heardIds = step.heard;
    let albumId = s.albumId;
    if (step.radio) {
      rememberRadio(relatedFor(order, s.trackId));
      albumId = "radio";
      heardIds = [];
    } else {
      const inAlbum = order.includes(step.id) || Boolean(playlistQueue(s.albumId, step.id));
      if (!inAlbum) albumId = trackById(step.id).albumId || s.albumId;
    }
    if (!s.playing) {
      set({ trackId: step.id, albumId, position: 0, buffering: false });
      persist(snapshot(get()));
      return;
    }
    startAt(step.id, albumId, 0);
    } finally {
      advancing = false;
    }
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
    const index = Math.max(0, order.indexOf(s.trackId));
    const id = order[(index - 1 + order.length) % order.length] ?? order[0];
    if (!id) return;
    const albumId = playlistQueue(s.albumId, id) || order.includes(id) ? s.albumId : trackById(id).albumId || s.albumId;
    if (!s.playing) {
      set({ trackId: id, albumId, position: 0 });
      persist(snapshot(get()));
      return;
    }
    startAt(id, albumId, 0);
  },
  failTrack: () => {
    misses += 1;
    if (misses > 4) {
      stopBeat();
      pauseMedia();
      set({ playing: false, buffering: false });
      get().flash("Couldn't play the next song");
      return;
    }
    get().next();
  },
  setBuffering: (buffering) => {
    if (get().buffering === buffering) return;
    set({ buffering });
  },
  seek: (position) => {
    const track = trackById(get().trackId);
    const dur = mediaDuration() || track.duration;
    const max = dur > 0.2 ? Math.max(0, dur - 0.01) : Math.max(position, 0);
    const nextPos = Math.min(max, Math.max(0, position));
    seekMedia(nextPos);
    set({ position: nextPos, scrubbing: true });
  },
  endScrub: () => set({ scrubbing: false }),
  toggleLike: (trackId) => {
    const id = trackId ?? get().trackId;
    if (!id) return;
    const on = !get().liked[id];
    const liked = { ...get().liked, [id]: on };
    set({ liked });
    persist(snapshot(get()));
    if (on) emitSync({ type: "like", track: trackSnap(id) });
    else emitSync({ type: "unlike", id });
  },
  toggleHold: (id) => {
    const holds = { ...get().holds, [id]: !get().holds[id] };
    set({ holds });
    persist(snapshot(get()));
  },
  togglePost: (id) => {
    const on = !get().posts[id];
    const posts = { ...get().posts, [id]: on };
    set({ posts });
    persist(snapshot(get()));
    const story = useCatalog.getState().stories.find((item) => item.id === id);
    useLibrary.getState().setFollow({ id, name: story?.title || "Artist", image: story?.image || "" }, on);
  },
  setPlayerOpen: (playerOpen) => {
    const was = get().playerOpen;
    set({ playerOpen });
    if (fromPop || typeof history === "undefined") return;
    if (playerOpen) pushNav(get().screen, true);
    else if (was && (history.state as { player?: boolean } | null)?.player) history.back();
  },
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
    emitSync({ type: "theme", theme });
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
