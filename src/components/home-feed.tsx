import { type ReactNode } from "react";
import { useCatalog, type Album, type Track, type Video } from "@/lib/catalog-store";
import { resolveListenTrack, useLibrary, type HistoryItem } from "@/lib/library";
import { usePlayer } from "@/lib/player-store";

function ShowAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 rounded-full bg-paper/15 px-3 text-xs font-bold">
      {label}
    </button>
  );
}

function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CoverButton({ image, title, subtitle, onClick }: { image: string; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-28 shrink-0 text-left">
      {image ? (
        <img src={image} alt="" className="aspect-square w-full rounded-2xl object-cover" />
      ) : (
        <span className="block aspect-square w-full rounded-2xl bg-ink/25" />
      )}
      <span className="mt-1 block truncate text-xs font-extrabold">{title}</span>
      {subtitle ? <span className="block truncate text-[11px] text-paper/75">{subtitle}</span> : null}
    </button>
  );
}

function Rail({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 overflow-x-auto pb-1">{children}</div>;
}

function Bones() {
  return (
    <div className="flex gap-3" aria-hidden>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-28 w-28 shrink-0 animate-pulse rounded-2xl bg-ink/20" />
      ))}
    </div>
  );
}

function playHistory(item: HistoryItem) {
  const known = resolveListenTrack(item.id);
  const track: Track = known ?? {
    id: item.id,
    title: item.title,
    artist: item.artist,
    albumId: "",
    duration: item.duration,
    cover: item.cover,
    streamUrl: item.streamUrl,
    downloadPath: item.downloadPath,
    plays: null,
    likes: null,
  };
  useCatalog.getState().ensureTrack(track);
  usePlayer.getState().playTrack(track.id, track.albumId);
}

function albumOf(kind: Album["kind"]) {
  return useCatalog.getState().albums.filter((album) => album.kind === kind);
}

export function HomeFeed() {
  const ready = useCatalog((s) => s.ready);
  const error = useCatalog((s) => s.error);
  const reload = useCatalog((s) => s.reload);
  const albums = useCatalog((s) => s.albums);
  const videos = useCatalog((s) => s.videos);
  const stories = useCatalog((s) => s.stories);
  const membership = useCatalog((s) => s.membership);
  const trackMap = useCatalog((s) => s.trackMap);
  const history = useLibrary((s) => s.history);
  const liked = usePlayer((s) => s.liked);
  const setScreen = usePlayer((s) => s.setScreen);
  const openAlbum = usePlayer((s) => s.openAlbum);
  const openSearch = usePlayer((s) => s.openSearch);
  const playTrack = usePlayer((s) => s.playTrack);

  const trending = (membership.trending ?? []).map((id) => trackMap[id]).filter((track): track is Track => !!track);
  const releases = albums.filter((album) => album.kind === "release" || album.kind === "chart");
  const playlists = albums.filter((album) => album.kind === "playlist");
  const podcasts = albums.filter((album) => album.kind === "podcast" || album.id === "podcasts");
  const favorites = Object.keys(liked)
    .filter((id) => liked[id])
    .map((id) => trackMap[id] ?? resolveListenTrack(id))
    .filter((track): track is Track => !!track?.id);

  const openVideo = (video: Video) => {
    useCatalog.getState().rememberVideo(video);
    usePlayer.getState().openVideo(video.id);
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div className="glass-card rounded-3xl p-4">
          <p className="text-sm font-extrabold">{error}</p>
          <button type="button" onClick={() => void reload()} className="mt-3 min-h-11 rounded-full bg-paper px-4 text-sm font-extrabold text-ink">
            Try again
          </button>
        </div>
      ) : null}

      <Section id="home-search" title="Search">
        <button
          type="button"
          onClick={() => setScreen("search")}
          className="min-h-11 w-full rounded-full bg-ink/25 px-4 text-left text-sm font-bold text-paper/70"
        >
          Search songs, albums, artists
        </button>
      </Section>

      <Section
        id="home-trending"
        title="Trending"
        action={<ShowAll label="Show all" onClick={() => openAlbum("trending")} />}
      >
        {!ready ? <Bones /> : trending.length ? (
          <Rail>
            {trending.slice(0, 12).map((track) => (
              <CoverButton
                key={track.id}
                image={track.cover}
                title={track.title}
                subtitle={track.artist}
                onClick={() => playTrack(track.id, "trending")}
              />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">Nothing here yet.</p>
        )}
      </Section>

      <Section id="home-albums" title="Albums" action={<ShowAll label="Show all" onClick={() => setScreen("albums")} />}>
        {!ready ? <Bones /> : releases.length ? (
          <Rail>
            {releases.slice(0, 12).map((album) => (
              <CoverButton key={album.id} image={album.cover} title={album.title} subtitle={album.artist} onClick={() => openAlbum(album.id)} />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">No albums yet.</p>
        )}
      </Section>

      <Section id="home-videos" title="Videos" action={<ShowAll label="Show all" onClick={() => setScreen("videos")} />}>
        {!ready ? <Bones /> : videos.length ? (
          <Rail>
            {videos.slice(0, 12).map((video) => (
              <button key={video.id} type="button" onClick={() => openVideo(video)} className="w-40 shrink-0 text-left">
                {video.image ? (
                  <img src={video.image} alt="" className="aspect-video w-full rounded-2xl object-cover" />
                ) : (
                  <span className="block aspect-video w-full rounded-2xl bg-ink/25" />
                )}
                <span className="mt-1 block truncate text-xs font-extrabold">{video.title}</span>
                <span className="block truncate text-[11px] text-paper/75">{video.meta}</span>
              </button>
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">No videos yet.</p>
        )}
      </Section>

      <Section
        id="home-podcasts"
        title="Podcasts"
        action={<ShowAll label="Show all" onClick={() => (albumOf("podcast").length ? openAlbum(albumOf("podcast")[0]?.id || "podcasts") : setScreen("albums"))} />}
      >
        {!ready ? <Bones /> : podcasts.length ? (
          <Rail>
            {podcasts.slice(0, 12).map((album) => (
              <CoverButton key={album.id} image={album.cover} title={album.title} subtitle={album.artist || "Podcast"} onClick={() => openAlbum(album.id)} />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">No podcasts yet.</p>
        )}
      </Section>

      <Section
        id="home-playlists"
        title="Playlists"
        action={<ShowAll label="Your playlists" onClick={() => setScreen("playlists")} />}
      >
        {!ready ? <Bones /> : playlists.length ? (
          <Rail>
            {playlists.slice(0, 12).map((album) => (
              <CoverButton key={album.id} image={album.cover} title={album.title} subtitle={album.artist} onClick={() => openAlbum(album.id)} />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">No playlists yet.</p>
        )}
      </Section>

      <Section id="home-artists" title="Artists" action={<ShowAll label="Show all" onClick={() => setScreen("socials")} />}>
        {!ready ? <Bones /> : stories.length ? (
          <Rail>
            {stories.slice(0, 12).map((story) => (
              <CoverButton key={story.id} image={story.image} title={story.title} subtitle={story.body} onClick={() => openSearch(story.title)} />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">No artists yet.</p>
        )}
      </Section>

      <Section id="home-history" title="Recently played" action={<ShowAll label="Show all" onClick={() => setScreen("history")} />}>
        {history.length ? (
          <Rail>
            {history.slice(0, 12).map((item) => (
              <CoverButton key={item.id} image={item.cover} title={item.title} subtitle={item.artist} onClick={() => playHistory(item)} />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">Songs you play will show up here.</p>
        )}
      </Section>

      <Section id="home-favorites" title="Favorites" action={<ShowAll label="Show all" onClick={() => setScreen("favorites")} />}>
        {favorites.length ? (
          <Rail>
            {favorites.slice(0, 12).map((track) => (
              <CoverButton key={track.id} image={track.cover} title={track.title} subtitle={track.artist} onClick={() => playTrack(track.id, track.albumId)} />
            ))}
          </Rail>
        ) : (
          <p className="text-sm text-paper/75">Hearts you tap are kept on this device.</p>
        )}
      </Section>
    </div>
  );
}
