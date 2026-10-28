import { create } from "zustand";
import { trackById, useCatalog, type Track } from "@/lib/catalog-store";
import { relayMediaUrl } from "@/lib/media-relay";
import { emitSync, type FollowSnap, type PlaylistSnap, type SavedAlbumSnap, type TrackSnap } from "@/lib/sync-events";

export type HistoryItem = TrackSnap & { at: number };

export type UserPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
};

export type FollowedArtist = FollowSnap;
export type SavedAlbum = SavedAlbumSnap;

type LibraryState = {
  history: HistoryItem[];
  playlists: UserPlaylist[];
  follows: FollowedArtist[];
  savedAlbums: SavedAlbum[];
  hydrated: boolean;
  hydrate: () => void;
  commitLocal: () => void;
  remember: (track: Track) => void;
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, trackId: string) => void;
  removeFromPlaylist: (id: string, trackId: string) => void;
  moveInPlaylist: (id: string, trackId: string, dir: -1 | 1) => void;
  setFollow: (artist: FollowedArtist, on: boolean) => void;
  setSavedAlbum: (album: SavedAlbum, on: boolean) => void;
};

const KEY = "melobi-library";

function persist(state: Pick<LibraryState, "history" | "playlists" | "follows" | "savedAlbums">) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        history: state.history,
        playlists: state.playlists,
        follows: state.follows,
        savedAlbums: state.savedAlbums,
      }),
    );
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

export function trackSnap(id: string): TrackSnap {
  const live = trackById(id);
  const saved = live.id ? live : null;
  const history = saved ? null : useLibrary.getState().history.find((item) => item.id === id);
  const source = saved ?? history;
  if (!source?.id) {
    return { id, title: "Track", artist: "", cover: "", duration: 0, streamUrl: "", downloadPath: "" };
  }
  return {
    id: source.id,
    title: source.title,
    artist: source.artist,
    cover: relayMediaUrl(source.cover || ""),
    duration: source.duration,
    streamUrl: relayMediaUrl(source.streamUrl || ""),
    downloadPath: source.downloadPath,
  };
}

function playlistSnap(playlist: UserPlaylist): PlaylistSnap {
  return {
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.trackIds.map((id) => trackSnap(id)),
  };
}

export const useLibrary = create<LibraryState>((set, get) => ({
  history: [],
  playlists: [],
  follows: [],
  savedAlbums: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        set({ hydrated: true });
        return;
      }
      const data = JSON.parse(raw) as {
        history?: HistoryItem[];
        playlists?: UserPlaylist[];
        follows?: FollowedArtist[];
        savedAlbums?: SavedAlbum[];
      };
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
        follows: Array.isArray(data.follows)
          ? data.follows
              .filter((item) => item?.id && item.name)
              .map((item) => ({ ...item, image: relayMediaUrl(item.image || "") }))
          : [],
        savedAlbums: Array.isArray(data.savedAlbums)
          ? data.savedAlbums
              .filter((item) => item?.id && item.title)
              .map((item) => ({ ...item, cover: relayMediaUrl(item.cover || "") }))
          : [],
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  commitLocal: () => persist(get()),
  remember: (track) => {
    const item = snapshotOf(track);
    if (!item) return;
    const history = [item, ...get().history.filter((entry) => entry.id !== item.id)].slice(0, 80);
    set({ history });
    persist({ ...get(), history });
    const known = useCatalog.getState().trackMap[track.id];
    if (!known) useCatalog.getState().ensureTrack(track);
    emitSync({ type: "history", track: item });
  },
  createPlaylist: (name) => {
    const playlist: UserPlaylist = { id: `pl-${crypto.randomUUID()}`, name: name.trim() || "New playlist", trackIds: [] };
    const playlists = [playlist, ...get().playlists];
    set({ playlists });
    persist({ ...get(), playlists });
    emitSync({ type: "playlist", playlist: playlistSnap(playlist) });
    return playlist.id;
  },
  renamePlaylist: (id, name) => {
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id ? { ...playlist, name: name.trim() || playlist.name } : playlist,
    );
    set({ playlists });
    persist({ ...get(), playlists });
    const playlist = playlists.find((item) => item.id === id);
    if (playlist) emitSync({ type: "playlist", playlist: playlistSnap(playlist) });
  },
  deletePlaylist: (id) => {
    const playlists = get().playlists.filter((playlist) => playlist.id !== id);
    set({ playlists });
    persist({ ...get(), playlists });
    emitSync({ type: "playlist-delete", id });
  },
  addToPlaylist: (id, trackId) => {
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id && !playlist.trackIds.includes(trackId)
        ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
        : playlist,
    );
    set({ playlists });
    persist({ ...get(), playlists });
    const playlist = playlists.find((item) => item.id === id);
    if (playlist) emitSync({ type: "playlist", playlist: playlistSnap(playlist) });
  },
  removeFromPlaylist: (id, trackId) => {
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id ? { ...playlist, trackIds: playlist.trackIds.filter((item) => item !== trackId) } : playlist,
    );
    set({ playlists });
    persist({ ...get(), playlists });
    const playlist = playlists.find((item) => item.id === id);
    if (playlist) emitSync({ type: "playlist", playlist: playlistSnap(playlist) });
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
    persist({ ...get(), playlists });
    const playlist = playlists.find((item) => item.id === id);
    if (playlist) emitSync({ type: "playlist", playlist: playlistSnap(playlist) });
  },
  setFollow: (artist, on) => {
    const saved = { ...artist, image: relayMediaUrl(artist.image || "") };
    const follows = on
      ? [saved, ...get().follows.filter((item) => item.id !== saved.id)]
      : get().follows.filter((item) => item.id !== artist.id);
    set({ follows });
    persist({ ...get(), follows });
    emitSync(on ? { type: "follow", artist: saved } : { type: "unfollow", id: artist.id });
  },
  setSavedAlbum: (album, on) => {
    const saved = { ...album, cover: relayMediaUrl(album.cover || "") };
    const savedAlbums = on
      ? [saved, ...get().savedAlbums.filter((item) => item.id !== saved.id)]
      : get().savedAlbums.filter((item) => item.id !== album.id);
    set({ savedAlbums });
    persist({ ...get(), savedAlbums });
    emitSync(on ? { type: "album", album: saved } : { type: "album-remove", id: album.id });
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
    cover: relayMediaUrl(saved.cover || ""),
    streamUrl: relayMediaUrl(saved.streamUrl || ""),
    downloadPath: saved.downloadPath,
    plays: null,
    likes: null,
  };
}
