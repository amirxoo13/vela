import { create } from "zustand";
import { trackById, useCatalog, type Track } from "@/lib/catalog-store";
import { relayMediaUrl } from "@/lib/media-relay";

export type HistoryItem = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  duration: number;
  streamUrl: string;
  downloadPath: string;
  at: number;
};

export type UserPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
};

type LibraryState = {
  history: HistoryItem[];
  playlists: UserPlaylist[];
  hydrated: boolean;
  hydrate: () => void;
  remember: (track: Track) => void;
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, trackId: string) => void;
  removeFromPlaylist: (id: string, trackId: string) => void;
  moveInPlaylist: (id: string, trackId: string, dir: -1 | 1) => void;
};

const KEY = "melobi-library";

function persist(state: Pick<LibraryState, "history" | "playlists">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ history: state.history, playlists: state.playlists }));
  } catch {
    /* private mode */
  }
}

function snapshotOf(track: Track): HistoryItem | null {
  if (!track.id || !track.title) return null;
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: relayMediaUrl(track.cover),
    duration: track.duration,
    streamUrl: relayMediaUrl(track.streamUrl),
    downloadPath: track.downloadPath,
    at: Date.now(),
  };
}

export const useLibrary = create<LibraryState>((set, get) => ({
  history: [],
  playlists: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        set({ hydrated: true });
        return;
      }
      const data = JSON.parse(raw) as { history?: HistoryItem[]; playlists?: UserPlaylist[] };
      set({
        history: Array.isArray(data.history)
          ? data.history
              .filter((item) => item?.id && item.title)
              .slice(0, 80)
              .map((item) => ({
                ...item,
                cover: relayMediaUrl(item.cover || ""),
                streamUrl: relayMediaUrl(item.streamUrl || ""),
              }))
          : [],
        playlists: Array.isArray(data.playlists)
          ? data.playlists.filter((item) => item?.id && typeof item.name === "string")
          : [],
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  remember: (track) => {
    const item = snapshotOf(track);
    if (!item) return;
    const history = [item, ...get().history.filter((entry) => entry.id !== item.id)].slice(0, 80);
    set({ history });
    persist({ history, playlists: get().playlists });
    const known = useCatalog.getState().trackMap[track.id];
    if (!known) useCatalog.getState().ensureTrack(track);
  },
  createPlaylist: (name) => {
    const id = `pl-${crypto.randomUUID()}`;
    const playlists = [{ id, name: name.trim() || "New playlist", trackIds: [] }, ...get().playlists];
    set({ playlists });
    persist({ history: get().history, playlists });
    return id;
  },
  renamePlaylist: (id, name) => {
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id ? { ...playlist, name: name.trim() || playlist.name } : playlist,
    );
    set({ playlists });
    persist({ history: get().history, playlists });
  },
  deletePlaylist: (id) => {
    const playlists = get().playlists.filter((playlist) => playlist.id !== id);
    set({ playlists });
    persist({ history: get().history, playlists });
  },
  addToPlaylist: (id, trackId) => {
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id && !playlist.trackIds.includes(trackId)
        ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
        : playlist,
    );
    set({ playlists });
    persist({ history: get().history, playlists });
  },
  removeFromPlaylist: (id, trackId) => {
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id ? { ...playlist, trackIds: playlist.trackIds.filter((item) => item !== trackId) } : playlist,
    );
    set({ playlists });
    persist({ history: get().history, playlists });
  },
  moveInPlaylist: (id, trackId, dir) => {
    const playlists = get().playlists.map((playlist) => {
      if (playlist.id !== id) return playlist;
      const index = playlist.trackIds.indexOf(trackId);
      const next = index + dir;
      if (index < 0 || next < 0 || next >= playlist.trackIds.length) return playlist;
      const trackIds = playlist.trackIds.slice();
      const [item] = trackIds.splice(index, 1);
      if (item) trackIds.splice(next, 0, item);
      return { ...playlist, trackIds };
    });
    set({ playlists });
    persist({ history: get().history, playlists });
  },
}));

export function playlistQueue(albumId: string, trackId: string): string[] | null {
  const playlist = useLibrary.getState().playlists.find((item) => item.id === albumId);
  if (!playlist?.trackIds.includes(trackId)) return null;
  return playlist.trackIds;
}

export function resolveListenTrack(id: string): Track | null {
  const live = trackById(id);
  if (live.id) return live;
  const saved = useLibrary.getState().history.find((item) => item.id === id);
  if (!saved) return null;
  return {
    id: saved.id,
    title: saved.title,
    artist: saved.artist,
    albumId: "",
    duration: saved.duration,
    cover: saved.cover,
    streamUrl: saved.streamUrl,
    downloadPath: saved.downloadPath,
    plays: null,
    likes: null,
  };
}
