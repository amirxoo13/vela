import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Ticket,
} from "lucide-react";
import { fmt, formatCount } from "@/data/catalog";
import { mountAudio } from "@/lib/audio-engine";
import {
  EMPTY_ALBUM,
  EMPTY_TRACK,
  useCatalog,
  type Album,
  type Story,
  type Track,
} from "@/lib/catalog-store";
import { resolveListenTrack, useLibrary, type HistoryItem, type UserPlaylist } from "@/lib/library";
import { downloadHref, getData } from "@/lib/music-api";
import { levels } from "@/lib/tone";
import { usePlayer, type RepeatMode, type Sticker, type StickerKind, type ThemeId } from "@/lib/player-store";
import { Logo, StickerGlyph } from "@/components/mark";

const glass = "glass-card rounded-3xl text-paper";
const kinds: StickerKind[] = ["star", "bolt", "flame", "disc", "spark", "moon", "heart", "drop"];
const STAGE_QUERY = "(min-width: 1100px)";

/** null until hydration so the first render matches the server (both trees, CSS picks one). */
function useWideStage() {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia(STAGE_QUERY);
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return wide;
}

export function VelaApp() {
  const screen = usePlayer((s) => s.screen);
  const playerOpen = usePlayer((s) => s.playerOpen);
  const notice = usePlayer((s) => s.notice);
  const theme = usePlayer((s) => s.theme);
  const wide = useWideStage();

  return (
    <div className="min-h-dvh bg-ink text-paper" data-theme={theme}>
      <Engine />
      {screen === "home" ? (
        <>
          {(wide === null || !wide) && (
            <div key="mobile" className={wide === null ? "min-[1100px]:hidden" : undefined}>
              <MobileHome />
            </div>
          )}
          {(wide === null || wide) && (
            <div key="desktop" className={wide === null ? "hidden min-[1100px]:block" : undefined}>
              <DesktopPoster />
            </div>
          )}
        </>
      ) : (
        <Section />
      )}
      {screen === "home" && wide !== true ? (
        <div className={wide === null ? "min-[1100px]:hidden" : undefined}>
          <NowBar />
        </div>
      ) : null}
      {screen !== "home" ? <NowBar /> : null}
      {playerOpen && <FullPlayer />}
      {notice && (
        <p className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-paper px-4 py-2 text-sm font-bold text-ink">
          {notice}
        </p>
      )}
    </div>
  );
}

function Engine() {
  const ref = useRef<HTMLAudioElement>(null);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const track = useCatalog((s) => s.trackMap[trackId]);
  useEffect(() => {
    mountAudio(ref.current, {
      onTime: (seconds) => {
        const state = usePlayer.getState();
        if (!state.playing || state.scrubbing) return;
        usePlayer.setState({ position: seconds });
      },
      onEnd: () => {
        if (usePlayer.getState().playing) usePlayer.getState().next();
      },
      onDuration: (seconds) => {
        useCatalog.getState().noteDuration(usePlayer.getState().trackId, seconds);
      },
    });
    usePlayer.getState().hydrate();
    useLibrary.getState().hydrate();
    void useCatalog.getState().load().then(() => {
      const catalog = useCatalog.getState();
      const player = usePlayer.getState();
      const known = catalog.trackMap[player.trackId];
      const first = catalog.playOrder[0];
      if (!known && first) {
        usePlayer.setState({
          trackId: first,
          albumId: catalog.trackMap[first]?.albumId || "trending",
          position: 0,
          playing: false,
        });
      } else if (known && !catalog.albumMap[player.albumId]) {
        usePlayer.setState({ albumId: known.albumId || "trending" });
      }
      if (catalog.videos.length && !catalog.videos.some((video) => video.id === player.videoId)) {
        usePlayer.setState({ videoId: catalog.videos[0]?.id ?? "" });
      }
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (e.code === "Space") {
        e.preventDefault();
        usePlayer.getState().togglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        usePlayer.getState().seek(usePlayer.getState().position + 5);
        usePlayer.getState().endScrub();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        usePlayer.getState().seek(usePlayer.getState().position - 5);
        usePlayer.getState().endScrub();
      } else if (e.key === "n" || e.key === "N") {
        usePlayer.getState().next();
      } else if (e.key === "p" || e.key === "P") {
        usePlayer.getState().prev();
      } else if (e.key === "l" || e.key === "L") {
        usePlayer.getState().toggleLike();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const current = track ?? useCatalog.getState().trackMap[trackId];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current?.title || "Melobi",
        artist: current?.artist || "Melobi",
        album: "Melobi",
        artwork: current?.cover ? [{ src: current.cover }] : [],
      });
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      navigator.mediaSession.setActionHandler("play", () => {
        if (!usePlayer.getState().playing) usePlayer.getState().togglePlay();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        if (usePlayer.getState().playing) usePlayer.getState().togglePlay();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => usePlayer.getState().next());
      navigator.mediaSession.setActionHandler("previoustrack", () => usePlayer.getState().prev());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") {
          usePlayer.getState().seek(details.seekTime);
          usePlayer.getState().endScrub();
        }
      });
    } catch {
      /* metadata artwork can reject a cross-origin URL */
    }
  }, [track, trackId, playing]);
  return (
    <audio
      ref={ref}
      preload="metadata"
      crossOrigin="anonymous"
      className="pointer-events-none absolute size-px opacity-0"
    />
  );
}

function ScenePanel({ children, cutout = false, notch = true }: { children: ReactNode; cutout?: boolean; notch?: boolean }) {
  const raw = useId().replace(/:/g, "");
  const id = `scene-${raw}`;
  return (
    <div className="scene-glow relative">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <mask id={id} maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
          <rect width="1" height="1" rx="0.04" ry="0.055" fill="white" />
          {notch ? <rect x="0.18" y="-0.002" width="0.64" height="0.07" rx="0.035" ry="0.045" fill="black" /> : null}
          {cutout ? <rect x="0.68" y="0.76" width="0.34" height="0.26" rx="0.05" ry="0.07" fill="black" /> : null}
        </mask>
      </svg>
      <div
        className="bg-panel shadow-[0_28px_70px_rgb(0_0_0/42%)]"
        style={{ mask: `url(#${id})`, WebkitMask: `url(#${id})` }}
      >
        {children}
      </div>
    </div>
  );
}

function MobileHome() {
  const setScreen = usePlayer((s) => s.setScreen);
  return (
    <div className="relative mx-auto w-full max-w-[480px] px-3 pb-28 pt-6">
      <ScenePanel notch={false}>
        <div className="relative px-3 pb-4 pt-12">
          <div className="flex items-center justify-between gap-3">
            <Logo onClick={() => setScreen("home")} />
            <TourPill />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <Chip label="Search" onClick={() => setScreen("search")} />
            <Chip label="Albums" onClick={() => setScreen("albums")} />
            <Chip label="Videos" onClick={() => setScreen("videos")} />
            <Chip label="Socials" onClick={() => setScreen("socials")} />
            <Chip label="History" onClick={() => setScreen("history")} />
            <Chip label="Playlists" onClick={() => setScreen("playlists")} />
            <Chip label="Favorites" onClick={() => setScreen("favorites")} />
          </div>
          <ThemeSwitch />
          <div className="relative">
            <Hero compact />
            <div className="relative z-30 -mt-40 flex flex-col gap-3">
              <LiveCard />
              <PlayerCard />
              <AlbumsCard />
              <button
                type="button"
                onClick={() => setScreen("editor")}
                className={`${glass} flex items-center justify-between px-4 py-3 text-left`}
              >
                <span>
                  <span className="block text-sm font-extrabold">Create cover art</span>
                  <span className="text-xs text-mute">Stickers stay on this device</span>
                </span>
                <Plus className="size-5" />
              </button>
              <TourCard />
            </div>
          </div>
        </div>
      </ScenePanel>
    </div>
  );
}

function DesktopPoster() {
  const setScreen = usePlayer((s) => s.setScreen);
  return (
    <div className="relative mx-auto max-w-[1240px] px-6 pb-10 pt-8">
      <div className="absolute left-1/2 top-3 z-40 flex max-w-[92%] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-b-[28px] bg-ink px-5 pb-3 pt-2 shadow-[0_12px_30px_rgb(0_0_0/45%)]">
        <NavText />
        <TourPill />
        <ThemeSwitch />
      </div>
      <ScenePanel cutout>
        <div className="relative min-h-[780px]">
          <div className="absolute left-5 top-6 z-30">
            <Logo onClick={() => setScreen("home")} />
          </div>
          <div className="pointer-events-none absolute inset-x-8 top-2 z-0">
            <Hero />
          </div>
          <div className="absolute left-4 top-24 z-30 w-[250px]">
            <LiveCard />
          </div>
          <div className={`${glass} absolute bottom-24 left-5 z-30 w-[230px] p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-extrabold">Create cover art</p>
              <button type="button" onClick={() => setScreen("socials")} className="rounded-full bg-paper/15 px-2 py-1 text-xs font-bold">
                Explore
              </button>
            </div>
            <CoverStage tall={false} />
            <StickerTray />
          </div>
          <div className="absolute bottom-8 left-1/2 z-30 w-[min(46%,400px)] -translate-x-1/2">
            <AlbumsCard />
          </div>
          <div className="absolute right-8 top-8 z-30 w-[240px]">
            <PlayerCard />
          </div>
          <button
            type="button"
            aria-label="Open cover lab"
            onClick={() => setScreen("editor")}
            className="absolute bottom-28 right-8 z-30 grid size-12 place-items-center rounded-full bg-deep text-paper shadow-lg"
          >
            <Plus />
          </button>
        </div>
      </ScenePanel>
      <div className="absolute bottom-2 right-6 z-40 w-[250px]">
        <TourCard />
      </div>
    </div>
  );
}

function NavText() {
  const setScreen = usePlayer((s) => s.setScreen);
  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm font-semibold">
      <button type="button" onClick={() => setScreen("search")}>Search</button>
      <button type="button" onClick={() => setScreen("albums")}>Albums</button>
      <button type="button" onClick={() => setScreen("videos")}>Videos</button>
      <button type="button" onClick={() => setScreen("socials")}>Socials</button>
      <button type="button" onClick={() => setScreen("history")}>History</button>
      <button type="button" onClick={() => setScreen("playlists")}>Playlists</button>
      <button type="button" onClick={() => setScreen("favorites")}>Favorites</button>
    </nav>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 rounded-full bg-ink/25 px-4 py-2 text-sm font-bold">
      {label}
    </button>
  );
}

function TourPill() {
  const setScreen = usePlayer((s) => s.setScreen);
  return (
    <button type="button" onClick={() => setScreen("tour")} className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs font-extrabold tracking-wide text-paper">
      <Ticket className="size-4" />
      WORLD TOUR
    </button>
  );
}

function ThemeSwitch() {
  const theme = usePlayer((s) => s.theme);
  const setTheme = usePlayer((s) => s.setTheme);
  const items: { id: ThemeId; label: string; swatch: string }[] = [
    { id: "green", label: "Green", swatch: "swatch-green" },
    { id: "crimson", label: "Crimson", swatch: "swatch-crimson" },
    { id: "ice", label: "Ice", swatch: "swatch-ice" },
    { id: "night", label: "Night", swatch: "swatch-night" },
  ];
  return (
    <div className="mt-3 flex gap-2 min-[1100px]:mt-0" role="group" aria-label="Color themes">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          aria-pressed={theme === item.id}
          onClick={() => setTheme(item.id)}
          className={`size-7 rounded-full border-2 ${item.swatch} ${theme === item.id ? "border-ink" : "border-transparent"}`}
        />
      ))}
    </div>
  );
}

function useGaze(enabled: boolean) {
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let next = { x: 0, y: 0 };
    const onMove = (event: PointerEvent) => {
      next = {
        x: Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1)),
        y: Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1)),
      };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setGaze(next));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [enabled]);
  return enabled ? gaze : { x: 0, y: 0 };
}

function Hero({ compact = false }: { compact?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shownRef = useRef(false);
  const [reduce, setReduce] = useState(false);
  const [shown, setShown] = useState(false);
  const [armed, setArmed] = useState(false);
  const gaze = useGaze(!reduce);
  useEffect(() => {
    if (playing) setArmed(true);
  }, [playing]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!video || !canvas || !root) return;
    const visible = root.getClientRects().length > 0;
    if (!(playing && visible && !reduce)) {
      video.pause();
      shownRef.current = false;
      setShown(false);
      return;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    if (!video.getAttribute("src")) video.src = "/art/dance-green.mp4";
    let frame = 0;
    let alive = true;
    let onscreen = true;
    let last = 0;
    let draws = 0;
    let color = "";
    let pr = 0x1e;
    let pg = 0xd7;
    let pb = 0x60;
    let image: ImageData | null = null;
    const frameGap = 1000 / 30;
    const paint = (now: number) => {
      if (!alive) return;
      if (document.hidden || !onscreen) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(paint);
      if (now - last < frameGap) return;
      last = now;
      if (video.currentTime > 1.2) video.currentTime = 0.02;
      if (video.readyState < 2 || !video.videoWidth) return;
      const box = canvas.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(box.width * dpr));
      const h = Math.max(2, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        image = null;
      }
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--color-panel").trim();
      const hex = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "#1ed760";
      if (hex !== color) {
        color = hex;
        pr = parseInt(hex.slice(1, 3), 16);
        pg = parseInt(hex.slice(3, 5), 16);
        pb = parseInt(hex.slice(5, 7), 16);
      }
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const scale = Math.max(w / srcW, h / srcH);
      const cropW = w / scale;
      const cropH = h / scale;
      const sx = (srcW - cropW) * 0.5;
      const sy = (srcH - cropH) * 0.08;
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, w, h);
      image = ctx.getImageData(0, 0, w, h);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        const score = g - (r > b ? r : b);
        if (g > 50 && score > 28) {
          const blend = score >= 96 ? 1 : (score - 28) / 68;
          px[i] = Math.round(r * (1 - blend) + pr * blend);
          px[i + 1] = Math.round(g * (1 - blend) + pg * blend);
          px[i + 2] = Math.round(b * (1 - blend) + pb * blend);
        }
      }
      ctx.putImageData(image, 0, 0);
      draws += 1;
      (canvas as HTMLCanvasElement & { draws?: number }).draws = draws;
      if (!shownRef.current) {
        shownRef.current = true;
        setShown(true);
      }
    };
    const hold = () => {
      video.pause();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const resume = () => {
      if (!alive || document.hidden || !onscreen) return;
      void video.play().catch(() => setShown(false));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const io = new IntersectionObserver(([entry]) => {
      onscreen = !!entry?.isIntersecting;
      if (!onscreen) hold();
      else resume();
    }, { threshold: 0.05 });
    io.observe(root);
    const onVis = () => {
      if (document.hidden) hold();
      else resume();
    };
    document.addEventListener("visibilitychange", onVis);
    video.playbackRate = 0.7;
    if (video.currentTime > 1.2) video.currentTime = 0;
    void video.play().catch(() => setShown(false));
    frame = requestAnimationFrame(paint);
    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      video.pause();
    };
  }, [playing, reduce, compact, armed]);
  const word = compact ? "text-[3.4rem]" : "text-[7.2rem]";
  const look = reduce
    ? undefined
    : {
        transform: `translate(${gaze.x * (compact ? 8 : 16)}px, ${gaze.y * 6}px) rotate(${gaze.x * 5.5}deg)`,
        transformOrigin: "50% 20%",
        transition: "transform 200ms ease-out",
      };
  return (
    <div ref={rootRef} className={`pointer-events-none relative ${compact ? "h-[430px]" : "h-[680px]"}`}>
      <div className={`absolute inset-x-0 z-[5] flex items-start justify-between font-display leading-[0.78] text-paper ${compact ? "top-[44%] px-1" : "top-[42%] px-4 pr-[20%]"} ${word}`}>
        <span>MEL</span>
        <span>OBI</span>
      </div>
      <p className="absolute left-1/2 top-3 z-20 -translate-x-1/2 text-xs font-extrabold tracking-[0.28em] text-paper/90">
        {playing ? "LIVE" : "MELOBI"}
      </p>
      <div className="absolute inset-x-[8%] top-0 z-10 h-[92%]" style={look}>
        <div className={!playing && !reduce ? "idle-sway h-full" : "h-full"}>
          <img
            src="/art/hero-clay.png"
            alt="Melobi"
            className="absolute inset-0 h-full w-full object-cover object-[center_8%] transition-opacity duration-500"
            style={{ opacity: shown && !reduce ? 0 : 1 }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full transition-opacity duration-500"
            style={{ opacity: shown && !reduce ? 1 : 0 }}
          />
        </div>
      </div>
      {armed ? (
        <video ref={videoRef} muted loop playsInline preload="none" className="pointer-events-none absolute size-px opacity-0" />
      ) : null}
    </div>
  );
}

function useNow() {
  const trackId = usePlayer((s) => s.trackId);
  const albumId = usePlayer((s) => s.albumId);
  const track = useCatalog((s) => s.trackMap[trackId]) ?? EMPTY_TRACK;
  const membership = useCatalog((s) => s.membership[albumId]);
  const screenAlbum = useCatalog((s) => s.albumMap[albumId]);
  const ownAlbum = useCatalog((s) => s.albumMap[track.albumId]);
  const album = (track.id && membership?.includes(track.id) ? screenAlbum : ownAlbum) ?? EMPTY_ALBUM;
  return { track, album };
}

async function playVideo(videoId: string) {
  const id = await useCatalog.getState().resolveVideoTrack(videoId);
  if (id) usePlayer.getState().openVideo(videoId, id);
}

function LiveCard() {
  const session = usePlayer((s) => s.session);
  const setSession = usePlayer((s) => s.setSession);
  const setScreen = usePlayer((s) => s.setScreen);
  const sessions = useCatalog((s) => s.videos);
  const item = sessions[session] ?? sessions[0];
  const shift = (dir: number) => {
    if (!sessions.length) return;
    setSession((session + dir + sessions.length) % sessions.length);
  };
  return (
    <article className={`${glass} p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-extrabold">Live Session</h2>
        <button type="button" onClick={() => setScreen("videos")} className="rounded-full bg-paper/15 px-2 py-1 text-xs font-bold">
          Show all
        </button>
      </div>
      <div className="relative overflow-hidden rounded-2xl">
        {item?.image ? (
          <img src={item.image} alt="" className="aspect-video w-full object-cover" />
        ) : (
          <div className="aspect-video w-full bg-ink/30" />
        )}
        <p className="absolute bottom-3 left-3 max-w-[70%] text-sm font-extrabold leading-tight">{item?.title ?? ""}</p>
        <button type="button" aria-label="Previous session" onClick={() => shift(-1)} className="absolute left-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-ink/50">
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label={item ? `Play ${item.title}` : "Play session"}
          onClick={() => item && void playVideo(item.id)}
          className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-paper text-ink"
        >
          <Play className="size-5 fill-current" />
        </button>
        <button type="button" aria-label="Next session" onClick={() => shift(1)} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-ink/50">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </article>
  );
}

function PlayerCard() {
  const { track, album } = useNow();
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const liked = usePlayer((s) => s.liked);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const openAlbum = usePlayer((s) => s.openAlbum);
  const setPlayerOpen = usePlayer((s) => s.setPlayerOpen);
  const on = !!liked[track.id];
  const cover = track.cover || album.cover;
  return (
    <article className={`${glass} p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Open album" onClick={() => album.id && openAlbum(album.id)} className="grid size-9 place-items-center rounded-full bg-paper/10">
          <span className="flex flex-col gap-1">
            <span className="block h-0.5 w-4 bg-paper" />
            <span className="block h-0.5 w-4 bg-paper" />
            <span className="block h-0.5 w-3 bg-paper" />
          </span>
        </button>
        <div className="flex items-center gap-2">
          <DownloadLink track={track} compact />
          <button type="button" aria-label={on ? "Unlike" : "Like"} onClick={() => toggleLike()} className="grid size-9 place-items-center rounded-full bg-paper/10">
            <Heart className={`size-4 ${on ? "fill-hot text-hot" : ""}`} />
          </button>
        </div>
      </div>
      <button type="button" onClick={() => setPlayerOpen(true)} aria-label="Open player" className="relative mx-auto grid size-36 place-items-center min-[1100px]:size-28">
        <span className="absolute inset-0 rounded-full bg-paper shadow-[0_10px_24px_rgb(0_0_0/35%)]" />
        {cover ? (
          <img src={cover} alt="" className={`relative size-[78%] rounded-full object-cover disc-spin ${playing ? "is-on" : ""}`} />
        ) : (
          <span className="relative size-[78%] rounded-full bg-ink" />
        )}
      </button>
      <div className="mt-3 flex items-center justify-between px-6">
        <button type="button" aria-label="Previous" onClick={prev} className="grid size-11 place-items-center rounded-full bg-paper/10">
          <SkipBack className="size-4 fill-current" />
        </button>
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay} className="grid size-12 place-items-center rounded-full bg-paper text-ink">
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
        </button>
        <button type="button" aria-label="Next" onClick={next} className="grid size-11 place-items-center rounded-full bg-paper/10">
          <SkipForward className="size-4 fill-current" />
        </button>
      </div>
      <button type="button" onClick={() => setPlayerOpen(true)} className="mt-3 w-full text-center">
        <p className="truncate text-sm font-extrabold">{track.artist ? `${track.artist} — ${track.title}` : track.title}</p>
        <p className="text-xs font-bold tracking-wide text-mute">{album.title.toUpperCase()}</p>
      </button>
      <div className="mt-2">
        <Seek position={position} duration={track.duration} />
      </div>
    </article>
  );
}

function DownloadLink({ track, compact = false }: { track: Track; compact?: boolean }) {
  const href = track.downloadPath ? downloadHref(track) : "";
  if (!href) return null;
  return (
    <a
      href={href}
      aria-label="Download"
      className={compact ? "grid size-9 place-items-center rounded-full bg-paper/10" : "grid size-11 place-items-center"}
    >
      <Download className={compact ? "size-4" : "size-4"} />
    </a>
  );
}

function Seek({ position, duration }: { position: number; duration: number }) {
  const seek = usePlayer((s) => s.seek);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const jump = (el: HTMLDivElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
    seek(Math.min(1, Math.max(0, ratio)) * duration);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 text-xs tabular-nums text-mute">{fmt(position)}</span>
      <div
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        tabIndex={0}
        className="relative h-6 flex-1 cursor-pointer"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          jump(el, e.clientX);
          const move = (ev: PointerEvent) => jump(el, ev.clientX);
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            usePlayer.getState().endScrub();
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(position + 5);
          if (e.key === "ArrowLeft") seek(position - 5);
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") usePlayer.getState().endScrub();
        }}
      >
        <span className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-paper/30" />
        <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-paper" style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper" style={{ left: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-mute">{fmt(duration)}</span>
    </div>
  );
}

function AlbumsCard() {
  const setScreen = usePlayer((s) => s.setScreen);
  const openAlbum = usePlayer((s) => s.openAlbum);
  const albums = useCatalog((s) => s.albums);
  return (
    <article className={`${glass} p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-extrabold">Last Albums</h2>
        <button type="button" onClick={() => setScreen("albums")} className="rounded-full bg-paper/15 px-2 py-1 text-xs font-bold">
          Show all
        </button>
      </div>
      <div className="flex gap-2">
        {albums.slice(0, 4).map((album) => (
          <button key={album.id} type="button" onClick={() => openAlbum(album.id)} className="min-w-0 flex-1">
            {album.cover ? (
              <img src={album.cover} alt={album.title} className="aspect-square w-full rounded-xl object-cover" />
            ) : (
              <span className="block aspect-square w-full rounded-xl bg-ink/30" />
            )}
          </button>
        ))}
      </div>
    </article>
  );
}

function TourCard() {
  const setScreen = usePlayer((s) => s.setScreen);
  const events = useCatalog((s) => s.events);
  return (
    <article className="glass-card overflow-hidden rounded-3xl">
      <button type="button" onClick={() => setScreen("tour")} className="block w-full text-left">
        <div className="relative">
          <img src="/art/stage.jpg" alt="" className="h-28 w-full object-cover object-top" />
          <div className="absolute inset-x-3 bottom-3">
            <p className="font-display text-xl leading-none">LIVE</p>
            <p className="text-[10px] font-extrabold tracking-widest">EVENTS</p>
          </div>
        </div>
        <div className="bg-panel px-3 py-3 text-paper">
          <p className="text-center text-sm font-extrabold">Events</p>
          <p className="mb-2 text-center text-xs text-paper/80">{events.length ? `${events.length} dates` : "Dates"}</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {events.slice(0, 6).map((stop) => (
              <li key={stop.id} className="flex justify-between gap-2 border-b border-paper/15 py-0.5">
                <span className="truncate">{stop.city}</span>
                <span className="tabular-nums">{stop.date}</span>
              </li>
            ))}
          </ul>
        </div>
      </button>
    </article>
  );
}

function NowBar() {
  const { track, album } = useNow();
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const setPlayerOpen = usePlayer((s) => s.setPlayerOpen);
  const pct = track.duration > 0 ? Math.min(100, (position / track.duration) * 100) : 0;
  const cover = track.cover || album.cover;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
      <div className="mx-auto flex max-w-[520px] items-center gap-3 rounded-2xl bg-glass px-3 py-2 shadow-lg min-[1100px]:max-w-[720px]">
        <button type="button" onClick={() => setPlayerOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {cover ? (
            <img src={cover} alt="" className="size-12 rounded-xl object-cover" />
          ) : (
            <span className="size-12 shrink-0 rounded-xl bg-ink/40" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold">{track.title}</span>
            <span className="block truncate text-xs text-mute">{track.artist}</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-paper/20">
              <span className="block h-full bg-paper" style={{ width: `${pct}%` }} />
            </span>
          </span>
        </button>
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay} className="grid size-11 shrink-0 place-items-center rounded-full bg-paper text-ink">
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </button>
      </div>
    </div>
  );
}

function FullPlayer() {
  const { track, album } = useNow();
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const liked = usePlayer((s) => s.liked);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const setPlayerOpen = usePlayer((s) => s.setPlayerOpen);
  const on = !!liked[track.id];
  const cover = track.cover || album.cover;
  const detail = [
    track.plays != null ? `${formatCount(track.plays)} plays` : "",
    track.likes != null ? `${formatCount(track.likes)} likes` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/75 p-3 min-[1100px]:items-center" onClick={() => setPlayerOpen(false)}>
      <div className="w-full max-w-[420px] rounded-[28px] bg-panel p-5 text-paper" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Now playing">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-extrabold tracking-widest">NOW PLAYING</p>
          <button type="button" onClick={() => setPlayerOpen(false)} className="rounded-full bg-ink/25 px-3 py-1 text-xs font-bold">
            Close
          </button>
        </div>
        {cover ? (
          <img src={cover} alt="" className="mx-auto aspect-square w-full max-w-[280px] rounded-3xl object-cover" />
        ) : (
          <div className="mx-auto aspect-square w-full max-w-[280px] rounded-3xl bg-ink/30" />
        )}
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl leading-none">{track.title}</h2>
            <p className="mt-1 text-sm font-semibold text-paper/80">{[track.artist, album.title].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex items-center gap-2">
            {track.downloadPath ? (
              <a href={downloadHref(track)} aria-label="Download" className="grid size-11 place-items-center rounded-full bg-ink/25">
                <Download className="size-5" />
              </a>
            ) : null}
            <button type="button" aria-label={on ? "Unlike" : "Like"} onClick={() => toggleLike()} className="grid size-11 place-items-center rounded-full bg-ink/25">
              <Heart className={`size-5 ${on ? "fill-hot text-hot" : ""}`} />
            </button>
          </div>
        </div>
        <div className="mt-4">
          <Seek position={position} duration={track.duration} />
        </div>
        <div className="mt-4 flex items-center justify-center gap-4">
          <button type="button" aria-label="Previous" onClick={prev} className="grid size-12 place-items-center rounded-full bg-ink/25">
            <SkipBack className="fill-current" />
          </button>
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay} className="grid size-16 place-items-center rounded-full bg-paper text-ink">
            {playing ? <Pause className="size-7 fill-current" /> : <Play className="size-7 fill-current" />}
          </button>
          <button type="button" aria-label="Next" onClick={next} className="grid size-12 place-items-center rounded-full bg-ink/25">
            <SkipForward className="fill-current" />
          </button>
        </div>
        <TransportModes />
        <SaveToPlaylist trackId={track.id} />
        <p className="mt-4 text-center text-xs text-paper/75">{detail || "Now playing"}</p>
      </div>
    </div>
  );
}

function Section() {
  const screen = usePlayer((s) => s.screen);
  const setScreen = usePlayer((s) => s.setScreen);
  const albumId = usePlayer((s) => s.albumId);
  const albumTitle = useCatalog((s) => s.albumMap[albumId]?.title ?? "");
  const title =
    screen === "search" ? "Search" :
    screen === "albums" ? "Albums" :
    screen === "album" ? albumTitle :
    screen === "videos" ? "Videos" :
    screen === "socials" ? "Socials" :
    screen === "tour" ? "World Tour" :
    screen === "history" ? "History" :
    screen === "playlists" ? "Playlists" :
    screen === "favorites" ? "Favorites" :
    "Cover lab";
  const browsing = screen === "search" || screen === "albums" || screen === "album" || screen === "history" || screen === "playlists" || screen === "favorites";
  return (
    <div className="mx-auto w-full max-w-[480px] px-3 pb-28 pt-3 min-[1100px]:max-w-[1100px] min-[1100px]:px-8">
      <div className="min-h-[calc(100dvh-6rem)] rounded-[28px] bg-panel p-4">
        <header className="mb-4 flex items-center gap-3">
          <button type="button" aria-label="Back home" onClick={() => setScreen("home")} className="grid size-11 place-items-center rounded-full bg-ink/20">
            <ChevronLeft />
          </button>
          <Logo onClick={() => setScreen("home")} />
          <h1 className="ml-auto font-display text-xl leading-none">{title}</h1>
        </header>
        {browsing ? <CharacterWait /> : null}
        {screen === "search" && <SearchPage />}
        {screen === "albums" && <AlbumsPage />}
        {screen === "album" && <AlbumPage />}
        {screen === "videos" && <VideosPage />}
        {screen === "socials" && <SocialsPage />}
        {screen === "tour" && <TourPage />}
        {screen === "editor" && <EditorPage />}
        {screen === "history" && <HistoryPage />}
        {screen === "playlists" && <PlaylistsPage />}
        {screen === "favorites" && <FavoritesPage />}
      </div>
    </div>
  );
}

function albumMeta(album: Album, count: number) {
  const total = count || album.count;
  return [album.artist, album.year, total ? `${total} tracks` : ""].filter(Boolean).join(" · ");
}

function AlbumsPage() {
  const openAlbum = usePlayer((s) => s.openAlbum);
  const albums = useCatalog((s) => s.albums);
  const membership = useCatalog((s) => s.membership);
  return (
    <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
      {albums.map((album) => (
        <button key={album.id} type="button" onClick={() => openAlbum(album.id)} className="text-left">
          {album.cover ? (
            <img src={album.cover} alt="" className="aspect-square w-full rounded-2xl object-cover" />
          ) : (
            <span className="block aspect-square w-full rounded-2xl bg-ink/30" />
          )}
          <p className="mt-2 font-extrabold">{album.title}</p>
          <p className="text-sm text-paper/80">{albumMeta(album, membership[album.id]?.length ?? 0)}</p>
        </button>
      ))}
    </div>
  );
}

function AlbumPage() {
  const albumId = usePlayer((s) => s.albumId);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const liked = usePlayer((s) => s.liked);
  const playTrack = usePlayer((s) => s.playTrack);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  const album = useCatalog((s) => s.albumMap[albumId]) ?? EMPTY_ALBUM;
  const ids = useCatalog((s) => s.membership[albumId]);
  const trackMap = useCatalog((s) => s.trackMap);
  const list = (ids ?? []).map((id) => trackMap[id]).filter((track): track is Track => !!track);
  useEffect(() => {
    if (albumId) void useCatalog.getState().loadAlbum(albumId);
  }, [albumId]);
  return (
    <div className="min-[1100px]:grid min-[1100px]:grid-cols-[280px_minmax(0,1fr)] min-[1100px]:gap-6">
      <div>
        {album.cover ? (
          <img src={album.cover} alt="" className="aspect-square w-full rounded-3xl object-cover" />
        ) : (
          <div className="aspect-square w-full rounded-3xl bg-ink/30" />
        )}
        <p className="mt-3 font-display text-4xl leading-none">{album.title}</p>
        <p className="mt-1 text-sm">{[album.artist, album.year].filter(Boolean).join(" · ")}</p>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              await useCatalog.getState().loadAlbum(album.id);
              const first = useCatalog.getState().membership[album.id]?.[0];
              if (first) playTrack(first, album.id);
            })();
          }}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm font-extrabold text-ink"
        >
          <Play className="size-4 fill-current" /> Play album
        </button>
      </div>
      <ol className="mt-4 flex flex-col gap-1 min-[1100px]:mt-0">
        {list.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            active={track.id === trackId}
            playing={playing}
            liked={!!liked[track.id]}
            onPlay={() => (track.id === trackId && playing ? togglePlay() : playTrack(track.id, album.id))}
            onLike={() => toggleLike(track.id)}
          />
        ))}
      </ol>
    </div>
  );
}

function TrackRow({
  track,
  index,
  active,
  playing,
  liked,
  onPlay,
  onLike,
}: {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  liked: boolean;
  onPlay: () => void;
  onLike: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-ink/15 px-2 py-1">
      <button type="button" onClick={onPlay} className="grid size-11 place-items-center" aria-label={`Play ${track.title}`}>
        {active && playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
      </button>
      <span className="w-5 text-sm tabular-nums text-paper/70">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-left font-bold">{track.title}</span>
      <span className="text-xs tabular-nums text-paper/75">{fmt(track.duration)}</span>
      <DownloadLink track={track} />
      <button type="button" aria-label="Like track" onClick={onLike} className="grid size-11 place-items-center">
        <Heart className={`size-4 ${liked ? "fill-hot text-hot" : ""}`} />
      </button>
    </li>
  );
}

function SearchPage() {
  const [q, setQ] = useState("");
  const search = useCatalog((s) => s.search);
  const trackMap = useCatalog((s) => s.trackMap);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const liked = usePlayer((s) => s.liked);
  const playTrack = usePlayer((s) => s.playTrack);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  const openAlbum = usePlayer((s) => s.openAlbum);
  const searchFor = useCatalog((s) => s.searchFor);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void searchFor(q);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [q, searchFor]);
  const tracks = search.trackIds.map((id) => trackMap[id]).filter((track): track is Track => !!track);
  const cards = [
    ...search.albums.map((album) => ({ key: album.id, title: album.title, subtitle: albumMeta(album, 0), image: album.cover, onClick: () => openAlbum(album.id) })),
    ...search.podcasts.map((album) => ({ key: album.id, title: album.title, subtitle: album.artist || "Podcast", image: album.cover, onClick: () => openAlbum(album.id) })),
    ...search.videos.map((video) => ({ key: `video:${video.id}`, title: video.title, subtitle: video.meta, image: video.image, onClick: () => void playVideo(video.id) })),
    ...search.artists.map((artist) => ({
      key: artist.id,
      title: artist.title,
      subtitle: artist.body,
      image: artist.image,
      onClick: () => {
        if (artist.id.startsWith("user:")) {
          void getData(`/api/v1/users/${encodeURIComponent(artist.id.slice(5))}`).catch(() => undefined);
        }
        setQ(artist.title);
      },
    })),
  ];
  const quiet = q.trim().length > 0 && !tracks.length && !cards.length;
  return (
    <div>
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search"
        aria-label="Search"
        className="mb-3 w-full rounded-full bg-ink/25 px-4 py-2 text-sm font-bold text-paper outline-none placeholder:text-paper/60"
      />
      {quiet ? <p className="text-sm text-paper/80">No results</p> : null}
      {tracks.length > 0 ? (
        <ol className="flex flex-col gap-1">
          {tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              active={track.id === trackId}
              playing={playing}
              liked={!!liked[track.id]}
              onPlay={() => (track.id === trackId && playing ? togglePlay() : playTrack(track.id, "search"))}
              onLike={() => toggleLike(track.id)}
            />
          ))}
        </ol>
      ) : null}
      {cards.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
          {cards.map((card) => (
            <button key={card.key} type="button" onClick={card.onClick} className="text-left">
              {card.image ? (
                <img src={card.image} alt="" className="aspect-square w-full rounded-2xl object-cover" />
              ) : (
                <span className="block aspect-square w-full rounded-2xl bg-ink/30" />
              )}
              <p className="mt-2 font-extrabold">{card.title}</p>
              <p className="text-sm text-paper/80">{card.subtitle}</p>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VideosPage() {
  const videoId = usePlayer((s) => s.videoId);
  const playing = usePlayer((s) => s.playing);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const videos = useCatalog((s) => s.videos);
  const active = videos.find((video) => video.id === videoId) ?? videos[0];
  return (
    <div>
      <div className="relative overflow-hidden rounded-3xl">
        {active?.image ? (
          <img src={active.image} alt="" className="aspect-video w-full object-cover" />
        ) : (
          <div className="aspect-video w-full bg-ink/30" />
        )}
        <div className="absolute inset-0 bg-ink/35" />
        <div className="absolute inset-x-4 bottom-4">
          <Bars />
          <p className="mt-2 font-extrabold">{active?.title ?? ""}</p>
          <p className="text-xs text-paper/80">{active?.meta ?? ""}</p>
        </div>
        <button
          type="button"
          aria-label={playing ? "Pause session" : "Play session"}
          onClick={() => {
            if (playing) togglePlay();
            else if (active) void playVideo(active.id);
          }}
          className="absolute left-1/2 top-1/3 grid size-14 -translate-x-1/2 place-items-center rounded-full bg-paper text-ink"
        >
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {videos.map((video) => (
          <li key={video.id}>
            <button type="button" onClick={() => void playVideo(video.id)} className={`flex w-full items-center gap-3 rounded-2xl p-2 text-left ${video.id === active?.id ? "bg-ink/25" : "bg-ink/10"}`}>
              {video.image ? (
                <img src={video.image} alt="" className="size-16 rounded-xl object-cover" />
              ) : (
                <span className="size-16 shrink-0 rounded-xl bg-ink/30" />
              )}
              <span>
                <span className="block font-extrabold">{video.title}</span>
                <span className="text-xs text-paper/75">{video.meta}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars() {
  const playing = usePlayer((s) => s.playing);
  const [vals, setVals] = useState<number[]>(() => Array.from({ length: 22 }, () => 0.08));
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setVals(levels()), 90);
    return () => window.clearInterval(id);
  }, [playing]);
  return (
    <div className="flex h-14 items-end gap-1" aria-hidden>
      {vals.map((v, i) => (
        <span key={i} className="flex-1 rounded-full bg-paper" style={{ height: `${Math.round(v * 100)}%` }} />
      ))}
    </div>
  );
}

function SocialsPage() {
  const saved = usePlayer((s) => s.posts);
  const togglePost = usePlayer((s) => s.togglePost);
  const stories = useCatalog((s) => s.stories);
  return (
    <div className="grid gap-3 min-[1100px]:grid-cols-3">
      {stories.map((story) => (
        <StoryCard key={story.id} story={story} saved={!!saved[story.id]} onSave={() => togglePost(story.id)} />
      ))}
    </div>
  );
}

function StoryCard({ story, saved, onSave }: { story: Story; saved: boolean; onSave: () => void }) {
  return (
    <article className="overflow-hidden rounded-3xl bg-ink/20">
      {story.image ? (
        <img src={story.image} alt="" className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="aspect-[4/3] w-full bg-ink/30" />
      )}
      <div className="p-3">
        <h2 className="font-extrabold">{story.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-paper/85">{story.body}</p>
        <button type="button" onClick={onSave} className="mt-3 inline-flex items-center gap-2 rounded-full bg-paper/15 px-3 py-2 text-xs font-extrabold">
          <Heart className={`size-4 ${saved ? "fill-hot text-hot" : ""}`} />
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </article>
  );
}

function TourPage() {
  const holds = usePlayer((s) => s.holds);
  const toggleHold = usePlayer((s) => s.toggleHold);
  const events = useCatalog((s) => s.events);
  const count = events.filter((stop) => holds[stop.id]).length;
  return (
    <div>
      <div className="overflow-hidden rounded-3xl">
        <img src="/art/stage.jpg" alt="" className="h-48 w-full object-cover" />
      </div>
      <p className="mt-3 font-display text-4xl leading-none">Events</p>
      <p className="text-sm text-paper/80">{count} seat {count === 1 ? "hold" : "holds"} on this device</p>
      <ul className="mt-4 flex flex-col gap-2">
        {events.map((stop) => {
          const on = !!holds[stop.id];
          return (
            <li key={stop.id} className="flex items-center gap-3 rounded-2xl bg-ink/15 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{stop.city}</p>
                <p className="text-xs text-paper/75">{stop.country}</p>
              </div>
              <span className="tabular-nums text-sm font-bold">{stop.date}</span>
              <button
                type="button"
                onClick={() => toggleHold(stop.id)}
                className={`rounded-full px-3 py-2 text-xs font-extrabold ${on ? "bg-paper text-ink" : "bg-ink/30 text-paper"}`}
              >
                {on ? "Held" : "Hold"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditorPage() {
  return (
    <div className="mx-auto max-w-[420px]">
      <CoverStage tall />
      <StickerTray />
    </div>
  );
}

function CoverStage({ tall }: { tall: boolean }) {
  const stickers = usePlayer((s) => s.stickers);
  const move = usePlayer((s) => s.moveSticker);
  const cover = useCatalog((s) => s.albums.find((album) => album.cover)?.cover || s.trackMap[s.playOrder[0] ?? ""]?.cover || "");
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-ink ${tall ? "aspect-square" : "h-36"}`}>
      {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
      {stickers.map((s) => (
        <Draggable key={s.uid} sticker={s} onMove={move} />
      ))}
    </div>
  );
}

function Draggable({ sticker, onMove }: { sticker: Sticker; onMove: (uid: string, x: number, y: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`${sticker.kind} sticker`}
      className="absolute size-10 -translate-x-1/2 -translate-y-1/2 touch-none"
      style={{ left: `${sticker.x}%`, top: `${sticker.y}%` }}
      onPointerDown={(e) => {
        const parent = e.currentTarget.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        e.currentTarget.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const x = ((ev.clientX - rect.left) / rect.width) * 100;
          const y = ((ev.clientY - rect.top) / rect.height) * 100;
          onMove(sticker.uid, x, y);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onPointerUp={() => usePlayer.getState().commit()}
    >
      <StickerGlyph kind={sticker.kind} />
    </button>
  );
}

function CharacterWait() {
  const [reduce, setReduce] = useState(false);
  const gaze = useGaze(!reduce);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return (
    <div className="relative mb-3 h-40 overflow-hidden rounded-3xl bg-ink/15">
      <div
        className="flex h-full justify-center"
        style={
          reduce
            ? undefined
            : { transform: `translateX(${gaze.x * 12}px) rotate(${gaze.x * 4}deg)`, transformOrigin: "50% 30%" }
        }
      >
        <img
          src="/art/hero-clay.png"
          alt=""
          className={`h-64 w-auto max-w-none -translate-y-2 object-cover object-top ${reduce ? "" : "idle-sway"}`}
        />
      </div>
    </div>
  );
}

function TransportModes() {
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const setRepeat = usePlayer((s) => s.setRepeat);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycle = () => {
    const next: RepeatMode = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
    setRepeat(next);
  };
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <button
        type="button"
        aria-label="Shuffle"
        aria-pressed={shuffle}
        onClick={toggleShuffle}
        className={`grid size-10 place-items-center rounded-full ${shuffle ? "bg-paper text-ink" : "bg-ink/25"}`}
      >
        <Shuffle className="size-4" />
      </button>
      <button type="button" aria-label={`Repeat ${repeat}`} onClick={cycle} className="grid size-10 place-items-center rounded-full bg-ink/25">
        {repeat === "one" ? <Repeat1 className="size-4" /> : <Repeat className={`size-4 ${repeat === "all" ? "text-paper" : "opacity-60"}`} />}
      </button>
    </div>
  );
}

function SaveToPlaylist({ trackId }: { trackId: string }) {
  const playlists = useLibrary((s) => s.playlists);
  const add = useLibrary((s) => s.addToPlaylist);
  if (!trackId || !playlists.length) return null;
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      {playlists.map((playlist) => (
        <button
          key={playlist.id}
          type="button"
          onClick={() => add(playlist.id, trackId)}
          className="rounded-full bg-ink/25 px-3 py-1 text-xs font-bold"
        >
          Add to {playlist.name}
        </button>
      ))}
    </div>
  );
}

function playSaved(item: HistoryItem) {
  const track = resolveListenTrack(item.id) ?? {
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
  usePlayer.getState().playTrack(track.id);
}

function HistoryPage() {
  const history = useLibrary((s) => s.history);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const liked = usePlayer((s) => s.liked);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  if (!history.length) return <p className="text-sm text-paper/80">Songs you play will show up here.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {history.map((item, index) => (
        <TrackRow
          key={item.id}
          track={{
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
          }}
          index={index}
          active={item.id === trackId}
          playing={playing}
          liked={!!liked[item.id]}
          onPlay={() => (item.id === trackId && playing ? togglePlay() : playSaved(item))}
          onLike={() => toggleLike(item.id)}
        />
      ))}
    </ol>
  );
}

function FavoritesPage() {
  const liked = usePlayer((s) => s.liked);
  const trackMap = useCatalog((s) => s.trackMap);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  const ids = Object.keys(liked).filter((id) => liked[id]);
  const tracks = ids
    .map((id) => trackMap[id] ?? resolveListenTrack(id))
    .filter((track): track is Track => !!track?.id);
  if (!tracks.length) return <p className="text-sm text-paper/80">Hearts you tap are kept on this device.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          active={track.id === trackId}
          playing={playing}
          liked
          onPlay={() => (track.id === trackId && playing ? togglePlay() : playSaved({ ...track, at: 0 }))}
          onLike={() => toggleLike(track.id)}
        />
      ))}
    </ol>
  );
}

function PlaylistsPage() {
  const playlists = useLibrary((s) => s.playlists);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const [name, setName] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const current = playlists.find((playlist) => playlist.id === active) ?? null;
  return (
    <div>
      {current ? (
        <PlaylistDetail playlist={current} onBack={() => setActive(null)} />
      ) : (
        <>
          <form
            className="mb-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const id = createPlaylist(name);
              setName("");
              setActive(id);
            }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Playlist name"
              placeholder="New playlist"
              className="min-w-0 flex-1 rounded-full bg-ink/25 px-4 py-2 text-sm font-bold outline-none placeholder:text-paper/60"
            />
            <button type="submit" className="rounded-full bg-paper px-4 py-2 text-sm font-extrabold text-ink">
              Create
            </button>
          </form>
          <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
            {playlists.map((playlist) => (
              <button key={playlist.id} type="button" onClick={() => setActive(playlist.id)} className={`${glass} p-4 text-left`}>
                <p className="font-extrabold">{playlist.name}</p>
                <p className="text-sm text-paper/80">{playlist.trackIds.length} tracks</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PlaylistDetail({ playlist, onBack }: { playlist: UserPlaylist; onBack: () => void }) {
  const rename = useLibrary((s) => s.renamePlaylist);
  const removeList = useLibrary((s) => s.deletePlaylist);
  const removeTrack = useLibrary((s) => s.removeFromPlaylist);
  const move = useLibrary((s) => s.moveInPlaylist);
  const add = useLibrary((s) => s.addToPlaylist);
  const trackId = usePlayer((s) => s.trackId);
  const playing = usePlayer((s) => s.playing);
  const liked = usePlayer((s) => s.liked);
  const playTrack = usePlayer((s) => s.playTrack);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const toggleLike = usePlayer((s) => s.toggleLike);
  const [title, setTitle] = useState(playlist.name);
  const rows = playlist.trackIds
    .map((id) => resolveListenTrack(id))
    .filter((track): track is Track => !!track);
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-sm font-bold text-paper/80">
        All playlists
      </button>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          rename(playlist.id, title);
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Rename playlist"
          className="min-w-0 flex-1 rounded-full bg-ink/25 px-4 py-2 text-sm font-bold outline-none"
        />
        <button type="submit" className="rounded-full bg-paper px-3 py-2 text-xs font-extrabold text-ink">
          Rename
        </button>
      </form>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const first = rows[0];
            if (first) playTrack(first.id, playlist.id);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm font-extrabold text-ink"
        >
          <Play className="size-4 fill-current" /> Play
        </button>
        <button
          type="button"
          onClick={() => trackId && add(playlist.id, trackId)}
          className="rounded-full bg-ink/25 px-4 py-2 text-sm font-bold"
        >
          Add current song
        </button>
        <button
          type="button"
          onClick={() => {
            removeList(playlist.id);
            onBack();
          }}
          className="rounded-full bg-ink/25 px-4 py-2 text-sm font-bold"
        >
          Delete
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((track, index) => (
          <div key={track.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <TrackRow
                track={track}
                index={index}
                active={track.id === trackId}
                playing={playing}
                liked={!!liked[track.id]}
                onPlay={() => (track.id === trackId && playing ? togglePlay() : playTrack(track.id, playlist.id))}
                onLike={() => toggleLike(track.id)}
              />
            </div>
            <button type="button" aria-label="Move up" className="text-xs font-bold" onClick={() => move(playlist.id, track.id, -1)}>
              Up
            </button>
            <button type="button" aria-label="Move down" className="text-xs font-bold" onClick={() => move(playlist.id, track.id, 1)}>
              Down
            </button>
            <button type="button" aria-label="Remove from playlist" className="text-xs font-bold" onClick={() => removeTrack(playlist.id, track.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StickerTray() {
  const add = usePlayer((s) => s.addSticker);
  const clear = usePlayer((s) => s.clearStickers);
  const flash = usePlayer((s) => s.flash);
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-extrabold tracking-wide">Stickers</p>
        <div className="flex gap-2">
          <button type="button" onClick={clear} className="text-xs font-bold text-paper/80">Clear</button>
          <button type="button" onClick={() => flash("Saved on this device")} className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-ink">
            Save
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {kinds.map((k) => (
          <button key={k} type="button" aria-label={`Add ${k}`} onClick={() => add(k)} className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink/25">
            <span className="size-7">
              <StickerGlyph kind={k} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
