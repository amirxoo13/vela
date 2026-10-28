import { create } from "zustand";
import {
  collectTracks,
  english,
  getData,
  getHome,
  getTrack,
  getTrackList,
  isApiTrack,
  MusicApiError,
  searchMusic,
  type ApiTrack,
} from "@/lib/music-api";

export type AlbumKind = "chart" | "playlist" | "release" | "podcast";

export type Album = {
  id: string;
  title: string;
  year: string;
  cover: string;
  variant: number;
  artist: string;
  count: number;
  kind: AlbumKind;
  remoteId: string;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  albumId: string;
  duration: number;
  cover: string;
  streamUrl: string;
  downloadPath: string;
  plays: number | null;
  likes: number | null;
};

export type Video = {
  id: string;
  title: string;
  meta: string;
  image: string;
  trackId: string;
  /** Progressive MP4 when the feed has one. */
  mediaUrl: string;
  /** HLS playlist when the feed has one. */
  hlsUrl: string;
};

export type LiveDate = {
  id: string;
  city: string;
  country: string;
  date: string;
};

export type Story = {
  id: string;
  title: string;
  body: string;
  image: string;
};

export type SearchView = {
  query: string;
  trackIds: string[];
  albums: Album[];
  videos: Video[];
  podcasts: Album[];
  artists: Story[];
};

type Draft = {
  albums: Album[];
  albumMap: Record<string, Album>;
  trackMap: Record<string, Track>;
  membership: Record<string, string[]>;
  playOrder: string[];
  loaded: Record<string, boolean>;
};

type State = Draft & {
  videos: Video[];
  events: LiveDate[];
  stories: Story[];
  search: SearchView;
  ready: boolean;
  error: string;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  loadAlbum: (id: string) => Promise<void>;
  searchFor: (query: string) => Promise<void>;
  resolveVideoTrack: (videoId: string) => Promise<string>;
  ensureRemote: (id: string) => Promise<boolean>;
  rememberVideo: (video: Video) => void;
  noteDuration: (id: string, seconds: number) => void;
  ensureTrack: (track: Track) => void;
};

export const EMPTY_TRACK: Track = {
  id: "",
  title: "",
  artist: "",
  albumId: "",
  duration: 0,
  cover: "",
  streamUrl: "",
  downloadPath: "",
  plays: null,
  likes: null,
};

export const EMPTY_ALBUM: Album = {
  id: "",
  title: "",
  year: "",
  cover: "",
  variant: 0,
  artist: "",
  count: 0,
  kind: "chart",
  remoteId: "",
};

const emptySearch: SearchView = {
  query: "",
  trackIds: [],
  albums: [],
  videos: [],
  podcasts: [],
  artists: [],
};

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^https?:\/\//i.test(text) ? text : "";
}

function yearOf(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const match = text.match(/\d{4}/);
  return match?.[0] ?? "";
}

function optInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["items", "albums", "videos", "podcasts", "events", "mp3s", "result", "list"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function fromApi(raw: ApiTrack, albumId: string): Track | null {
  const title = english(raw.song) || english(raw.title);
  if (!title || raw.id == null) return null;
  const id = String(raw.id);
  return {
    id,
    title,
    artist: english(raw.artist),
    albumId,
    duration: raw.durationSec ?? 0,
    cover: httpUrl(raw.artworkUrl) || httpUrl(raw.thumbnailUrl),
    streamUrl: httpUrl(raw.streamUrl),
    downloadPath: typeof raw.downloadPath === "string" && raw.downloadPath.startsWith("/")
      ? raw.downloadPath
      : `/api/v1/tracks/${id}/download`,
    plays: raw.plays ?? null,
    likes: raw.likes ?? null,
  };
}

function blankDraft(): Draft {
  return { albums: [], albumMap: {}, trackMap: {}, membership: {}, playOrder: [], loaded: {} };
}

function fromState(state: Draft): Draft {
  return {
    albums: state.albums.slice(),
    albumMap: { ...state.albumMap },
    trackMap: { ...state.trackMap },
    membership: { ...state.membership },
    playOrder: state.playOrder.slice(),
    loaded: { ...state.loaded },
  };
}

function putAlbum(draft: Draft, album: Album, listed: boolean) {
  const prev = draft.albumMap[album.id];
  draft.albumMap[album.id] = prev ? { ...album, variant: prev.variant } : album;
  if (listed && !draft.albums.some((item) => item.id === album.id)) {
    draft.albums.push(draft.albumMap[album.id]!);
  }
}

function putTrack(draft: Draft, track: Track, albumId: string, ordered: boolean) {
  const prev = draft.trackMap[track.id];
  draft.trackMap[track.id] = prev
    ? {
        ...prev,
        ...track,
        albumId: prev.albumId || albumId || track.albumId,
        downloadPath: track.downloadPath || prev.downloadPath,
        streamUrl: track.streamUrl || prev.streamUrl,
        cover: track.cover || prev.cover,
        duration: track.duration || prev.duration,
        plays: track.plays ?? prev.plays,
        likes: track.likes ?? prev.likes,
        title: track.title || prev.title,
        artist: track.artist || prev.artist,
      }
    : { ...track, albumId: albumId || track.albumId };
  if (albumId) {
    const list = draft.membership[albumId] ? draft.membership[albumId].slice() : [];
    if (!list.includes(track.id)) list.push(track.id);
    draft.membership[albumId] = list;
  }
  if (ordered && !draft.playOrder.includes(track.id)) draft.playOrder.push(track.id);
}

function addChart(draft: Draft, id: string, title: string, raws: ApiTrack[], variant: number) {
  let cover = "";
  let year = "";
  let count = 0;
  for (const raw of raws) {
    const track = fromApi(raw, id);
    if (!track) continue;
    putTrack(draft, track, id, true);
    count += 1;
    if (!cover) cover = track.cover;
    if (!year) year = yearOf(raw.releaseDate);
  }
  putAlbum(
    draft,
    { id, title, year, cover, variant, artist: "", count, kind: "chart", remoteId: "" },
    true,
  );
  draft.loaded[id] = true;
}

function albumFromPlaylist(raw: Record<string, unknown>, variant: number): Album | null {
  const title = english(raw.title) || english(raw.name);
  if (!title || raw.id == null) return null;
  return {
    id: `playlist:${raw.id}`,
    title,
    year: yearOf(raw.created_at),
    cover: httpUrl(raw.photo_player) || httpUrl(raw.photo) || httpUrl(raw.thumbnail),
    variant: variant % 4,
    artist: english(raw.created_title),
    count: optInt(raw.items_count ?? raw.count) ?? 0,
    kind: "playlist",
    remoteId: String(raw.id),
  };
}

function unwrapPlaylist(value: unknown): Record<string, unknown> | null {
  const row = record(value);
  if (!row) return null;
  const nested = record(row.playlist);
  return nested ?? row;
}

function videoFrom(value: unknown, fallbackMeta: string): Video | null {
  const row = record(value);
  if (!row || row.id == null) return null;
  if (row.type && row.type !== "video") return null;
  const title = english(row.song) || english(row.title);
  if (!title) return null;
  const mp3 = record(row.mp3_item);
  return {
    id: String(row.id),
    title,
    meta: english(row.artist) || fallbackMeta,
    image: httpUrl(row.photo_player) || httpUrl(row.photo) || httpUrl(row.thumbnail),
    trackId: mp3?.id != null ? String(mp3.id) : "",
    mediaUrl:
      httpUrl(row.low_web) ||
      httpUrl(row.link) ||
      httpUrl(row.high_web) ||
      httpUrl(row.lq_link) ||
      httpUrl(row.hq_link),
    hlsUrl: httpUrl(row.hls),
  };
}

function storyFromArtist(value: unknown): Story | null {
  const row = record(value);
  if (!row) return null;
  const title = english(row.name) || english(row.display_name) || english(row.title);
  if (!title) return null;
  const count = optInt(row.count);
  const subtitle = english(row.item_subtitle) || english(row.display_subtitle);
  return {
    id: `artist:${row.id ?? title}`,
    title,
    body: subtitle || (count ? `${count.toLocaleString("en-US")} tracks` : "Artist"),
    image: httpUrl(row.photo) || httpUrl(row.thumbnail),
  };
}

function storyFromProfile(value: unknown): Story | null {
  const row = record(value);
  if (!row) return null;
  const title = english(row.display_name) || english(row.username);
  if (!title) return null;
  return {
    id: `user:${row.username ?? title}`,
    title,
    body: english(row.username) ? `@${english(row.username)}` : "Profile",
    image: httpUrl(row.thumbnail) || httpUrl(row.photo),
  };
}

function groupReleases(draft: Draft, raws: ApiTrack[]) {
  const groups = new Map<string, ApiTrack[]>();
  for (const raw of raws) {
    const name = english(raw.album);
    if (!name) continue;
    const id = raw.albumId != null ? `album:${raw.albumId}` : `album:${name}`;
    const list = groups.get(id) ?? [];
    list.push(raw);
    groups.set(id, list);
  }
  for (const [id, list] of groups) {
    const first = list[0];
    if (!first) continue;
    const remoteId = first.albumId != null ? String(first.albumId) : "";
    putAlbum(
      draft,
      {
        id,
        title: english(first.album) || "Album",
        year: yearOf(first.releaseDate),
        cover: httpUrl(first.artworkUrl) || httpUrl(first.thumbnailUrl),
        variant: draft.albums.length % 4,
        artist: english(first.artist),
        count: list.length,
        kind: "release",
        remoteId,
      },
      true,
    );
    for (const raw of list) {
      const track = fromApi(raw, id);
      if (track) putTrack(draft, track, id, false);
    }
    if (remoteId) draft.loaded[id] = true;
  }
}

function summaryAlbums(draft: Draft, data: unknown) {
  for (const item of asArray(data)) {
    const row = record(item);
    if (!row || row.id == null || isApiTrack(row)) continue;
    const title = english(row.title) || english(row.name);
    if (!title) continue;
    const kind: AlbumKind = row.type === "playlist" ? "playlist" : row.type === "podcast" ? "podcast" : "release";
    const id = `${kind}:${row.id}`;
    if (draft.albumMap[id]) continue;
    putAlbum(
      draft,
      {
        id,
        title,
        year: yearOf(row.created_at ?? row.releaseDate ?? row.date),
        cover: httpUrl(row.photo_player) || httpUrl(row.photo) || httpUrl(row.thumbnail) || httpUrl(row.artworkUrl),
        variant: draft.albums.length % 4,
        artist: english(row.artist) || english(row.created_title),
        count: optInt(row.items_count ?? row.count) ?? 0,
        kind,
        remoteId: String(row.id),
      },
      true,
    );
  }
}

function addPodcast(draft: Draft, value: unknown, variant: number): Album | null {
  const row = record(value);
  if (!row) return null;
  const title = english(row.title) || english(row.name);
  if (!title || row.id == null) return null;
  const id = `podcast:${row.id}`;
  const cover = httpUrl(row.photo_player) || httpUrl(row.photo) || httpUrl(row.thumbnail);
  const artist = english(row.podcast_artist) || english(row.artist);
  const nested = collectTracks(row).map((raw) => fromApi(raw, id)).filter((track): track is Track => !!track);
  const link = httpUrl(row.link) || httpUrl(row.hq_link) || httpUrl(row.lq_link);
  if (!nested.length && link) {
    putTrack(
      draft,
      {
        id,
        title,
        artist,
        albumId: "podcasts",
        duration: optInt(row.duration) ?? 0,
        cover,
        streamUrl: link,
        downloadPath: "",
        plays: optInt(row.plays),
        likes: optInt(row.likes),
      },
      "podcasts",
      false,
    );
    return null;
  }
  const album: Album = {
    id,
    title,
    year: yearOf(row.created_at ?? row.date),
    cover,
    variant: variant % 4,
    artist,
    count: nested.length || (optInt(row.count) ?? 0),
    kind: "podcast",
    remoteId: String(row.id),
  };
  putAlbum(draft, album, true);
  for (const track of nested) putTrack(draft, track, id, false);
  if (nested.length) draft.loaded[id] = true;
  return album;
}

function ensurePodcastChart(draft: Draft) {
  const ids = draft.membership.podcasts ?? [];
  if (!ids.length) return;
  const first = draft.trackMap[ids[0] ?? ""];
  putAlbum(
    draft,
    {
      id: "podcasts",
      title: "Podcasts",
      year: "",
      cover: first?.cover ?? "",
      variant: 3,
      artist: "",
      count: ids.length,
      kind: "chart",
      remoteId: "",
    },
    true,
  );
  draft.loaded.podcasts = true;
}

function homeBuckets(data: unknown) {
  const sections = asArray(record(data)?.sections ?? data);
  const playlists: Record<string, unknown>[] = [];
  const videos: unknown[] = [];
  const artists: unknown[] = [];
  for (const section of sections) {
    const items = asArray(record(section)?.items);
    for (const item of items) {
      const row = record(item);
      if (!row) continue;
      if (row.type === "playlist") playlists.push(row);
      else if (row.type === "video") videos.push(row);
      else if (row.type === "artist") artists.push(row);
    }
  }
  return { playlists, videos, artists };
}

function eventFrom(value: unknown): LiveDate | null {
  const row = record(value);
  if (!row) return null;
  const city = english(row.city) || english(row.venue) || english(row.title) || english(row.name);
  if (!city) return null;
  const when = row.date ?? row.starts_at ?? row.start_date ?? row.short_date;
  let date = "";
  if (typeof when === "string" && when.trim()) {
    const parsed = new Date(when);
    date = Number.isNaN(parsed.getTime())
      ? english(when)
      : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return {
    id: String(row.id ?? city),
    city,
    country: english(row.country) || english(row.location) || english(row.city_name),
    date,
  };
}

function view(draft: Draft) {
  return {
    albums: draft.albums,
    albumMap: draft.albumMap,
    trackMap: draft.trackMap,
    membership: draft.membership,
    playOrder: draft.playOrder,
    loaded: draft.loaded,
  };
}

let loadPromise: Promise<void> | null = null;
let searchSeq = 0;
const inflight = new Set<string>();

export const useCatalog = create<State>((set, get) => ({
  ...blankDraft(),
  videos: [],
  events: [],
  stories: [],
  search: emptySearch,
  ready: false,
  error: "",
  load: () => {
    if (get().ready && !get().error) return Promise.resolve();
    if (!loadPromise) {
      loadPromise = ingest().finally(() => {
        if (!useCatalog.getState().ready) loadPromise = null;
      });
    }
    return loadPromise;

    async function ingest() {
      const [home, trending, featured, popular, albumList, videosT, videosF, videosP, podPopular, podShows, podDj, events] =
        await Promise.allSettled([
          getHome(),
          getTrackList("trending"),
          getTrackList("featured"),
          getTrackList("popular"),
          getData("/api/v1/albums/trending"),
          getData("/api/v1/videos/trending"),
          getData("/api/v1/videos/featured"),
          getData("/api/v1/videos/popular"),
          getData("/api/v1/podcasts/popular"),
          getData("/api/v1/podcasts/shows"),
          getData("/api/v1/podcasts/dj"),
          getData("/api/v1/events"),
        ]);
      const draft = blankDraft();
      const value = <T,>(result: PromiseSettledResult<T>, fallback: T): T =>
        result.status === "fulfilled" ? result.value : fallback;
      addChart(draft, "trending", "Trending", value(trending, []), 0);
      addChart(draft, "featured", "Featured", value(featured, []), 1);
      addChart(draft, "popular", "Popular", value(popular, []), 2);

      const homeData = value(home, null);
      const buckets = homeBuckets(homeData);
      buckets.playlists.forEach((playlist, index) => {
        const album = albumFromPlaylist(playlist, index);
        if (album && !draft.albumMap[album.id]) putAlbum(draft, album, true);
      });

      const albumPayload = value(albumList, null);
      const albumTracks = collectTracks(albumPayload);
      if (albumTracks.length) groupReleases(draft, albumTracks);
      else summaryAlbums(draft, albumPayload);

      [value(podPopular, null), value(podShows, null), value(podDj, null)].forEach((payload, index) => {
        for (const item of asArray(payload)) addPodcast(draft, item, index);
        for (const item of collectTracks(payload)) {
          const track = fromApi(item, "podcasts");
          if (track) putTrack(draft, { ...track, downloadPath: track.streamUrl ? "" : track.downloadPath }, "podcasts", false);
        }
      });
      ensurePodcastChart(draft);

      const videos: Video[] = [];
      const seen = new Set<string>();
      const pushVideo = (video: Video | null) => {
        if (!video || seen.has(video.id)) return;
        seen.add(video.id);
        videos.push(video);
      };
      for (const item of buckets.videos) pushVideo(videoFrom(item, "Video"));
      const labeled: Array<[PromiseSettledResult<unknown>, string]> = [
        [videosT, "Trending"],
        [videosF, "Featured"],
        [videosP, "Popular"],
      ];
      for (const [result, label] of labeled) {
        for (const item of asArray(value(result, null))) pushVideo(videoFrom(item, label));
      }

      const stories = buckets.artists.map(storyFromArtist).filter((story): story is Story => !!story);
      const live = asArray(value(events, null)).map(eventFrom).filter((item): item is LiveDate => !!item);

      const homeOk = home.status === "fulfilled";
      const trendOk = trending.status === "fulfilled";
      const offline =
        (home.status === "rejected" && home.reason instanceof MusicApiError && home.reason.code === "OFFLINE") ||
        (trending.status === "rejected" && trending.reason instanceof MusicApiError && trending.reason.code === "OFFLINE");
      set({
        ...view(draft),
        videos,
        stories,
        events: live,
        ready: true,
        error: !homeOk && !trendOk ? (offline ? "No connection. Check your network and try again." : "Couldn't load music") : "",
      });
    }
  },
  reload: () => {
    loadPromise = null;
    set({ ready: false, error: "" });
    return get().load();
  },
  loadAlbum: async (id) => {
    const album = get().albumMap[id];
    if (!album || album.kind === "chart" || get().loaded[id] || !album.remoteId || inflight.has(id)) return;
    inflight.add(id);
    const path =
      album.kind === "playlist"
        ? `/api/v1/playlists/${encodeURIComponent(album.remoteId)}`
        : album.kind === "podcast"
          ? `/api/v1/podcasts/${encodeURIComponent(album.remoteId)}`
          : `/api/v1/albums/${encodeURIComponent(album.remoteId)}`;
    try {
      const data = await getData(path);
      const raws = collectTracks(data);
      set((state) => {
        const draft = fromState(state);
        for (const raw of raws) {
          const track = fromApi(raw, id);
          if (track) putTrack(draft, track, id, false);
        }
        const row = record(data);
        const link = httpUrl(row?.link) || httpUrl(row?.hq_link);
        if (!raws.length && link && row) {
          const title = english(row.title) || album.title;
          putTrack(
            draft,
            {
              id: `${id}:audio`,
              title,
              artist: english(row.podcast_artist) || english(row.artist) || album.artist,
              albumId: id,
              duration: optInt(row.duration) ?? 0,
              cover: httpUrl(row.photo) || album.cover,
              streamUrl: link,
              downloadPath: "",
              plays: optInt(row.plays),
              likes: optInt(row.likes),
            },
            id,
            false,
          );
        }
        draft.loaded[id] = true;
        const count = draft.membership[id]?.length ?? album.count;
        const current = draft.albumMap[id];
        if (current) draft.albumMap[id] = { ...current, count: count || current.count };
        return view(draft);
      });
    } catch {
      set((state) => ({ loaded: { ...state.loaded, [id]: true } }));
    } finally {
      inflight.delete(id);
    }
  },
  searchFor: async (query) => {
    const text = query.trim();
    const seq = ++searchSeq;
    if (!text) {
      set({ search: emptySearch });
      return;
    }
    if (text.length > 100) return;
    try {
      const data = await searchMusic(text);
      if (seq !== searchSeq) return;
      const tracks = (Array.isArray(data.tracks) ? data.tracks : []).filter(isApiTrack);
      const albums: Album[] = [];
      const podcasts: Album[] = [];
      set((state) => {
        const draft = fromState(state);
        draft.membership.search = [];
        const ids: string[] = [];
        for (const raw of tracks) {
          const track = fromApi(raw, "search");
          if (!track) continue;
          putTrack(draft, track, "search", false);
          ids.push(track.id);
        }
        draft.albumMap.search = {
          id: "search",
          title: "Search",
          year: "",
          cover: draft.trackMap[ids[0] ?? ""]?.cover ?? "",
          variant: 0,
          artist: "",
          count: ids.length,
          kind: "chart",
          remoteId: "",
        };
        draft.loaded.search = true;
        for (const item of asArray(data.playlists)) {
          const album = albumFromPlaylist(unwrapPlaylist(item) ?? {}, draft.albums.length);
          if (!album) continue;
          if (!draft.albumMap[album.id]) putAlbum(draft, album, false);
          albums.push(draft.albumMap[album.id] ?? album);
        }
        const releaseTracks = collectTracks(data.albums);
        if (releaseTracks.length) groupReleases(draft, releaseTracks);
        const seenRelease = new Set<string>();
        for (const raw of releaseTracks) {
          const name = english(raw.album);
          if (!name) continue;
          const id = raw.albumId != null ? `album:${raw.albumId}` : `album:${name}`;
          const album = draft.albumMap[id];
          if (album && !seenRelease.has(id)) {
            seenRelease.add(id);
            albums.push(album);
          }
        }
        for (const item of asArray(data.podcasts)) {
          const created = addPodcast(draft, item, 0);
          if (created) podcasts.push(draft.albumMap[created.id] ?? created);
          const row = record(item);
          const episode = row?.id != null ? draft.trackMap[`podcast:${row.id}`] : undefined;
          if (episode && !ids.includes(episode.id)) ids.push(episode.id);
        }
        ensurePodcastChart(draft);
        return {
          ...view(draft),
          search: {
            query: text,
            trackIds: ids,
            albums,
            videos: asArray(data.videos).map((item) => videoFrom(item, "Video")).filter((item): item is Video => !!item),
            podcasts,
            artists: [
              ...asArray(data.artists).map(storyFromArtist),
              ...asArray(data.profiles).map(storyFromProfile),
            ].filter((item): item is Story => !!item),
          },
        };
      });
    } catch {
      if (seq !== searchSeq) return;
      set({ search: { ...emptySearch, query: text } });
    }
  },
  resolveVideoTrack: async (videoId) => {
    const video = get().videos.find((item) => item.id === videoId) ?? get().search.videos.find((item) => item.id === videoId);
    if (!video) return "";
    const known = video.trackId ? get().trackMap[video.trackId] : undefined;
    if (known?.streamUrl) return known.id;
    if (!video.mediaUrl) return "";
    const id = `video:${video.id}`;
    const track: Track = {
      id,
      title: video.title,
      artist: video.meta,
      albumId: "videos",
      duration: 0,
      cover: video.image,
      streamUrl: video.mediaUrl,
      downloadPath: "",
      plays: null,
      likes: null,
    };
    set((state) => {
      const draft = fromState(state);
      putTrack(draft, track, "videos", false);
      if (!draft.albumMap.videos) {
        draft.albumMap.videos = {
          id: "videos",
          title: "Videos",
          year: "",
          cover: video.image,
          variant: 0,
          artist: "",
          count: 1,
          kind: "chart",
          remoteId: "",
        };
      }
      draft.loaded.videos = true;
      return view(draft);
    });
    return id;
  },
  ensureRemote: async (id) => {
    const known = get().trackMap[id];
    if (known?.streamUrl || known?.downloadPath) return true;
    try {
      const raw = await getTrack(id);
      const albumId = raw.albumId != null ? `album:${raw.albumId}` : "trending";
      const track = fromApi(raw, albumId);
      if (!track) return false;
      set((state) => {
        const draft = fromState(state);
        putTrack(draft, track, track.albumId, false);
        return view(draft);
      });
      return true;
    } catch {
      return false;
    }
  },
  rememberVideo: (video) => {
    if (!video.id || get().videos.some((item) => item.id === video.id)) return;
    set({ videos: [video, ...get().videos] });
  },
  ensureTrack: (track) => {
    if (!track.id) return;
    if (get().trackMap[track.id]) return;
    set((state) => ({ trackMap: { ...state.trackMap, [track.id]: track } }));
  },
  noteDuration: (id, seconds) => {
    const track = get().trackMap[id];
    if (!track || !Number.isFinite(seconds) || seconds <= 0) return;
    if (track.duration > 0 && Math.abs(track.duration - seconds) < 1.5) return;
    set({ trackMap: { ...get().trackMap, [id]: { ...track, duration: Math.round(seconds) } } });
  },
}));

export function trackById(id: string): Track {
  return useCatalog.getState().trackMap[id] ?? EMPTY_TRACK;
}

export function albumById(id: string): Album {
  return useCatalog.getState().albumMap[id] ?? EMPTY_ALBUM;
}

export function queueIds(albumId: string, trackId: string): string[] {
  const state = useCatalog.getState();
  const group = state.membership[albumId];
  if (group?.includes(trackId)) return group;
  if (state.playOrder.length) return state.playOrder;
  return group ?? [];
}
