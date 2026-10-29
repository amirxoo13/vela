import { create } from "zustand";
import { useCatalog, type Track } from "@/lib/catalog-store";
import { useLibrary, type FollowedArtist, type SavedAlbum } from "@/lib/library";
import { canonicalMediaUrl, relayMediaUrl } from "@/lib/media-relay";
import { apiUrl, english } from "@/lib/music-api";
import { usePlayer, type ThemeId } from "@/lib/player-store";
import {
  isLibraryPrompt,
  runMuted,
  setSyncHandler,
  type PlaylistSnap,
  type SyncEvent,
  type TrackSnap,
} from "@/lib/sync-events";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  avatar: { type: "preset"; id: string } | { type: "upload"; url: string };
  createdAt: number;
};

export type LibraryDoc = {
  imported: boolean;
  liked: TrackSnap[];
  playlists: PlaylistSnap[];
  history: Array<TrackSnap & { at: number }>;
  follows: FollowedArtist[];
  albums: SavedAlbum[];
  theme: ThemeId;
};

type AccountState = {
  status: "loading" | "guest" | "user";
  user: PublicUser | null;
  prompt: string | null;
  error: string;
  busy: boolean;
  boot: () => Promise<void>;
  askSignIn: () => void;
  dismiss: () => void;
  signup: (input: { email: string; password: string; displayName: string }) => Promise<boolean>;
  login: (input: { email: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  updateProfile: (patch: { displayName?: string; avatarPreset?: string; avatarData?: string }) => Promise<boolean>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<boolean>;
  deleteAccount: (password: string) => Promise<boolean>;
  onSync: (event: SyncEvent) => void;
};

const OWNER_KEY = "melobi-owner";
const PROMPT = "Sign in to keep likes, playlists, and follows with your Melobi account.";

class AccountError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let bootPromise: Promise<void> | null = null;
let held: SyncEvent[] = [];
let flushing = false;

function outboxKey(userId: string) {
  return `melobi-outbox:${userId}`;
}

function readBox(userId: string): SyncEvent[] {
  try {
    const raw = localStorage.getItem(outboxKey(userId));
    const data = raw ? (JSON.parse(raw) as SyncEvent[]) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeBox(userId: string, events: SyncEvent[]) {
  localStorage.setItem(outboxKey(userId), JSON.stringify(events.slice(-80)));
}

async function send<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AccountError(0, "OFFLINE", "No connection");
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    const message = english(payload?.error?.message) || "Something went wrong";
    if (response.status === 401 && path.startsWith("/api/v1/me")) {
      localStorage.setItem(OWNER_KEY, "guest");
      useAccount.setState({ status: "guest", user: null, busy: false, error: "Your session expired. Sign in again." });
    }
    throw new AccountError(response.status, payload?.error?.code || "HTTP", message);
  }
  return payload?.data as T;
}

function showTrack<T extends TrackSnap>(track: T): T {
  return {
    ...track,
    cover: relayMediaUrl(track.cover || ""),
    streamUrl: relayMediaUrl(track.streamUrl || ""),
  };
}

function storeTrack<T extends TrackSnap>(track: T): T {
  return {
    ...track,
    cover: canonicalMediaUrl(track.cover || ""),
    streamUrl: canonicalMediaUrl(track.streamUrl || ""),
  };
}

function asTrack(track: TrackSnap): Track {
  const shown = showTrack(track);
  return {
    id: shown.id,
    title: shown.title,
    artist: shown.artist,
    albumId: "",
    duration: shown.duration,
    cover: shown.cover,
    streamUrl: shown.streamUrl,
    downloadPath: shown.downloadPath,
    plays: null,
    likes: null,
  };
}

function ensure(track: TrackSnap) {
  if (!track.id || !track.title || track.title === "Track") return;
  const known = useCatalog.getState().trackMap[track.id];
  if (!known) useCatalog.getState().ensureTrack(asTrack(track));
}

function themeOf(value: string): ThemeId {
  return value === "crimson" || value === "night" || value === "ice" || value === "green" ? value : "green";
}

export function guestSnapshot() {
  const library = useLibrary.getState();
  const player = usePlayer.getState();
  const likedIds = Object.keys(player.liked).filter((id) => player.liked[id]);
  const follows = library.follows.length
    ? library.follows
    : Object.keys(player.posts)
        .filter((id) => player.posts[id])
        .map((id) => {
          const story = useCatalog.getState().stories.find((item) => item.id === id);
          return { id, name: story?.title || "Artist", image: canonicalMediaUrl(story?.image || "") };
        });
  const snap = (id: string): TrackSnap => {
    const known = useCatalog.getState().trackMap[id];
    if (known?.title) {
      return storeTrack({
        id: known.id,
        title: known.title,
        artist: known.artist,
        cover: known.cover,
        duration: known.duration,
        streamUrl: known.streamUrl,
        downloadPath: known.downloadPath,
      });
    }
    const history = library.history.find((item) => item.id === id);
    if (history) return storeTrack(history);
    return { id, title: "Track", artist: "", cover: "", duration: 0, streamUrl: "", downloadPath: "" };
  };
  return {
    liked: likedIds.map(snap),
    playlists: library.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      tracks: playlist.trackIds.map(snap),
    })),
    history: library.history.map(storeTrack),
    follows: follows.map((artist) => ({ ...artist, image: canonicalMediaUrl(artist.image || "") })),
    albums: library.savedAlbums.map((album) => ({ ...album, cover: canonicalMediaUrl(album.cover || "") })),
    theme: player.theme,
  };
}

function applyServerLibrary(doc: LibraryDoc) {
  runMuted(() => {
    const liked: Record<string, boolean> = {};
    const likedTracks = doc.liked.map(showTrack);
    const history = doc.history.map(showTrack);
    const playlists = doc.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(showTrack) }));
    const follows = doc.follows.map((artist) => ({ ...artist, image: relayMediaUrl(artist.image || "") }));
    const albums = doc.albums.map((album) => ({ ...album, cover: relayMediaUrl(album.cover || "") }));
    for (const track of likedTracks) {
      liked[track.id] = true;
      ensure(track);
    }
    for (const track of history) ensure(track);
    for (const playlist of playlists) for (const track of playlist.tracks) ensure(track);
    const posts: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(usePlayer.getState().posts)) {
      if (!id.startsWith("artist:") && !id.startsWith("user:")) posts[id] = on;
    }
    for (const artist of follows) posts[artist.id] = true;
    usePlayer.setState({ liked, posts, theme: themeOf(doc.theme) });
    usePlayer.getState().commit();
    useLibrary.setState({
      history: history.filter((item) => item.id && item.title).slice(0, 80),
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        trackIds: playlist.tracks.map((track) => track.id),
      })),
      follows,
      savedAlbums: albums,
      hydrated: true,
    });
    useLibrary.getState().commitLocal();
  });
}

function clearLocalLibrary() {
  runMuted(() => {
    const posts: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(usePlayer.getState().posts)) {
      if (!id.startsWith("artist:") && !id.startsWith("user:")) posts[id] = on;
    }
    usePlayer.setState({ liked: {}, posts });
    usePlayer.getState().commit();
    useLibrary.setState({ history: [], playlists: [], follows: [], savedAlbums: [], hydrated: true });
    useLibrary.getState().commitLocal();
  });
}

function fold(event: SyncEvent) {
  runMuted(() => {
    const player = usePlayer.getState();
    const library = useLibrary.getState();
    if (event.type === "like") {
      usePlayer.setState({ liked: { ...player.liked, [event.track.id]: true } });
      ensure(event.track);
    } else if (event.type === "unlike") {
      usePlayer.setState({ liked: { ...player.liked, [event.id]: false } });
    } else if (event.type === "history") {
      const history = [event.track, ...library.history.filter((item) => item.id !== event.track.id)].slice(0, 80);
      useLibrary.setState({ history });
      ensure(event.track);
    } else if (event.type === "playlist") {
      const next = {
        id: event.playlist.id,
        name: event.playlist.name,
        trackIds: event.playlist.tracks.map((track) => track.id),
      };
      const exists = library.playlists.some((playlist) => playlist.id === next.id);
      useLibrary.setState({
        playlists: exists
          ? library.playlists.map((playlist) => (playlist.id === next.id ? next : playlist))
          : [next, ...library.playlists],
      });
      for (const track of event.playlist.tracks) ensure(track);
    } else if (event.type === "playlist-delete") {
      useLibrary.setState({ playlists: library.playlists.filter((playlist) => playlist.id !== event.id) });
    } else if (event.type === "follow") {
      usePlayer.setState({ posts: { ...usePlayer.getState().posts, [event.artist.id]: true } });
      useLibrary.setState({
        follows: [event.artist, ...useLibrary.getState().follows.filter((artist) => artist.id !== event.artist.id)],
      });
    } else if (event.type === "unfollow") {
      usePlayer.setState({ posts: { ...usePlayer.getState().posts, [event.id]: false } });
      useLibrary.setState({ follows: useLibrary.getState().follows.filter((artist) => artist.id !== event.id) });
    } else if (event.type === "album") {
      useLibrary.setState({
        savedAlbums: [event.album, ...library.savedAlbums.filter((album) => album.id !== event.album.id)],
      });
    } else if (event.type === "album-remove") {
      useLibrary.setState({ savedAlbums: library.savedAlbums.filter((album) => album.id !== event.id) });
    } else if (event.type === "theme") {
      usePlayer.setState({ theme: event.theme });
    }
    usePlayer.getState().commit();
    useLibrary.getState().commitLocal();
  });
}

async function pushEvent(event: SyncEvent) {
  switch (event.type) {
    case "like":
      await send("/api/v1/me/likes", "PUT", { track: storeTrack(event.track) });
      return;
    case "unlike":
      await send(`/api/v1/me/likes/${encodeURIComponent(event.id)}`, "DELETE");
      return;
    case "history":
      await send("/api/v1/me/history", "POST", { track: storeTrack(event.track), at: event.track.at });
      return;
    case "playlist":
      try {
        await send(`/api/v1/me/playlists/${encodeURIComponent(event.playlist.id)}`, "PATCH", {
          name: event.playlist.name,
          tracks: event.playlist.tracks.map(storeTrack),
        });
      } catch (error) {
        if (error instanceof AccountError && error.status === 404) {
          await send("/api/v1/me/playlists", "POST", {
            ...event.playlist,
            tracks: event.playlist.tracks.map(storeTrack),
          });
          return;
        }
        throw error;
      }
      return;
    case "playlist-delete":
      await send(`/api/v1/me/playlists/${encodeURIComponent(event.id)}`, "DELETE");
      return;
    case "follow":
      await send("/api/v1/me/follows", "PUT", { ...event.artist, image: canonicalMediaUrl(event.artist.image || "") });
      return;
    case "unfollow":
      await send(`/api/v1/me/follows/${encodeURIComponent(event.id)}`, "DELETE");
      return;
    case "album":
      await send("/api/v1/me/albums", "PUT", { ...event.album, cover: canonicalMediaUrl(event.album.cover || "") });
      return;
    case "album-remove":
      await send(`/api/v1/me/albums/${encodeURIComponent(event.id)}`, "DELETE");
      return;
    case "theme":
      await send("/api/v1/me/settings", "PATCH", { theme: event.theme });
      return;
    default:
      return;
  }
}

async function flushOutbox(userId: string) {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const box = readBox(userId);
      const event = box[0];
      if (!event) break;
      try {
        await pushEvent(event);
      } catch (error) {
        if (error instanceof AccountError && (error.status === 401 || error.status === 0)) break;
        usePlayer.getState().flash("Couldn't save to your account");
        break;
      }
      writeBox(userId, readBox(userId).slice(1));
    }
  } finally {
    flushing = false;
  }
  if (readBox(userId).length && useAccount.getState().user?.id === userId) void flushOutbox(userId);
}

function enqueue(userId: string, event: SyncEvent) {
  writeBox(userId, [...readBox(userId), event]);
  void flushOutbox(userId);
}

async function adopt(user: PublicUser) {
  const owner = localStorage.getItem(OWNER_KEY) || "guest";
  await flushOutbox(user.id);
  let doc = await send<LibraryDoc>("/api/v1/me/library");
  if (!doc.imported && (owner === "guest" || owner === user.id)) {
    doc = await send<LibraryDoc>("/api/v1/me/library/import", "POST", guestSnapshot());
  }
  applyServerLibrary(doc);
  localStorage.setItem(OWNER_KEY, user.id);
  const pending = held;
  held = [];
  for (const event of pending) {
    fold(event);
    enqueue(user.id, event);
  }
  useAccount.setState({ status: "user", user, prompt: null, error: "", busy: false });
}

function fail(error: unknown) {
  const message = error instanceof AccountError ? error.message : "Something went wrong";
  useAccount.setState({ error: message, busy: false });
  return false;
}

export const useAccount = create<AccountState>((set, get) => ({
  status: "loading",
  user: null,
  prompt: null,
  error: "",
  busy: false,
  boot: () => {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      try {
        await useCatalog.getState().load();
        const data = await send<{ user: PublicUser | null } | null>("/api/v1/auth/me");
        const user = data?.user ?? null;
        if (!user) {
          const pending = held;
          held = [];
          set({ status: "guest", user: null, busy: false });
          if (pending.some(isLibraryPrompt)) set({ prompt: PROMPT });
          return;
        }
        await adopt(user);
      } catch {
        const pending = held;
        held = [];
        set({ status: "guest", user: null, busy: false });
        if (pending.some(isLibraryPrompt)) set({ prompt: PROMPT });
      }
    })();
    return bootPromise;
  },
  askSignIn: () => {
    if (get().status === "user" || get().prompt) return;
    set({ prompt: PROMPT });
  },
  dismiss: () => set({ prompt: null, error: "" }),
  signup: async (input) => {
    await get().boot();
    set({ busy: true, error: "" });
    try {
      const data = await send<{ user: PublicUser }>("/api/v1/auth/signup", "POST", input);
      await adopt(data.user);
      return true;
    } catch (error) {
      return fail(error);
    }
  },
  login: async (input) => {
    await get().boot();
    set({ busy: true, error: "" });
    try {
      const data = await send<{ user: PublicUser }>("/api/v1/auth/login", "POST", input);
      await adopt(data.user);
      return true;
    } catch (error) {
      return fail(error);
    }
  },
  logout: async () => {
    const userId = get().user?.id;
    set({ busy: true, error: "" });
    try {
      await send("/api/v1/auth/logout", "POST");
    } catch {
      /* still leave the device signed out */
    }
    if (userId) localStorage.removeItem(outboxKey(userId));
    clearLocalLibrary();
    localStorage.setItem(OWNER_KEY, "guest");
    held = [];
    set({ status: "guest", user: null, busy: false, prompt: null, error: "" });
    usePlayer.getState().setScreen("home");
  },
  updateProfile: async (patch) => {
    set({ busy: true, error: "" });
    try {
      const data = await send<{ user: PublicUser }>("/api/v1/auth/me", "PATCH", patch);
      set({ user: data.user, busy: false, error: "" });
      return true;
    } catch (error) {
      return fail(error);
    }
  },
  changePassword: async (input) => {
    set({ busy: true, error: "" });
    try {
      await send("/api/v1/auth/password", "POST", input);
      set({ busy: false, error: "" });
      usePlayer.getState().flash("Password updated");
      return true;
    } catch (error) {
      return fail(error);
    }
  },
  deleteAccount: async (password) => {
    const userId = get().user?.id;
    set({ busy: true, error: "" });
    try {
      await send("/api/v1/auth/me", "DELETE", { password });
      if (userId) localStorage.removeItem(outboxKey(userId));
      clearLocalLibrary();
      localStorage.setItem(OWNER_KEY, "guest");
      held = [];
      set({ status: "guest", user: null, busy: false, prompt: null, error: "" });
      usePlayer.getState().setScreen("home");
      usePlayer.getState().flash("Account deleted");
      return true;
    } catch (error) {
      return fail(error);
    }
  },
  onSync: (event) => {
    const state = get();
    if (state.status === "loading") {
      held.push(event);
      return;
    }
    if (state.status !== "user" || !state.user) {
      if (isLibraryPrompt(event)) state.askSignIn();
      return;
    }
    enqueue(state.user.id, event);
  },
}));

setSyncHandler((event) => {
  useAccount.getState().onSync(event);
});
