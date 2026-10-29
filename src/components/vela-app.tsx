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
  Share2,
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
import { applyHistory, usePlayer, type RepeatMode, type Screen, type Sticker, type StickerKind, type ThemeId } from "@/lib/player-store";
import { FollowingScreen, OfflineGate, ProfileScreen, SavedAlbumsScreen, SignInSheet } from "@/components/account-ui";
import { HomeFeed } from "@/components/home-feed";
import { VideoPlayer } from "@/components/video-player";
import { Logo, StickerGlyph } from "@/components/mark";
import { useAccount } from "@/lib/account-store";
import { notePlayback, syncMusicSession } from "@/lib/media-session";
import { shareAndToast } from "@/lib/share";

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
      <SignInSheet />
      <OfflineGate />
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
        if (state.playing && !state.scrubbing) usePlayer.setState({ position: seconds });
        notePlayback(state.playing, state.scrubbing ? state.position : seconds);
      },
      onEnd: () => {
        if (usePlayer.getState().playing) usePlayer.getState().next();
      },
      onFail: () => {
        if (usePlayer.getState().playing) usePlayer.getState().failTrack();
      },
      onDuration: (seconds) => {
        useCatalog.getState().noteDuration(usePlayer.getState().trackId, seconds);
      },
      onWaiting: (waiting) => {
        usePlayer.getState().setBuffering(waiting && usePlayer.getState().playing);
      },
    });
    usePlayer.getState().hydrate();
    useLibrary.getState().hydrate();
    void useAccount.getState().boot();
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
    const screens = new Set<Screen>(["home", "search", "albums", "album", "videos", "socials", "tour", "editor", "history", "playlists", "favorites", "profile", "following", "saved"]);
    if (!history.state || typeof history.state !== "object" || !("melobi" in (history.state as object))) {
      history.replaceState({ melobi: usePlayer.getState().screen, player: usePlayer.getState().playerOpen }, "");
    }
    const onPop = () => {
      const state = history.state as { melobi?: Screen; player?: boolean } | null;
      const screen = state?.melobi && screens.has(state.melobi) ? state.melobi : "home";
      applyHistory(screen, Boolean(state?.player));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const position = usePlayer((s) => s.position);
  useEffect(() => {
    syncMusicSession(playing, position);
  }, [track, trackId, playing, position]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("track");
    if (!id || !/^\d{1,12}$/.test(id)) return;
    let cancel = false;
    void (async () => {
      await useCatalog.getState().load();
      if (cancel) return;
      const ok = await useCatalog.getState().ensureRemote(id);
      if (cancel) return;
      if (!ok) {
        usePlayer.getState().flash("Track not found");
        return;
      }
      usePlayer.getState().playTrack(id);
      usePlayer.getState().setPlayerOpen(true);
    })();
    return () => {
      cancel = true;
    };
  }, []);
  return (
    <audio
      ref={ref}
      preload="auto"
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
            <Chip label="Search" onClick={() => document.getElementById("home-search")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="Albums" onClick={() => document.getElementById("home-albums")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="Videos" onClick={() => document.getElementById("home-videos")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="Podcasts" onClick={() => document.getElementById("home-podcasts")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="Playlists" onClick={() => document.getElementById("home-playlists")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="History" onClick={() => document.getElementById("home-history")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="Favorites" onClick={() => document.getElementById("home-favorites")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <Chip label="Profile" onClick={() => setScreen("profile")} />
          </div>
          <ThemeSwitch />
          <div className="relative">
            <Hero compact />
            <div className="relative z-30 -mt-40 flex flex-col gap-3">
              <div id="home-live" className="scroll-mt-4">
                <LiveCard />
              </div>
              <PlayerCard />
              <AlbumsCard />
              <button
                type="button"
                onClick={() => setScreen("editor")}
                className={`${glass} flex min-h-11 items-center justify-between px-4 py-3 text-left`}
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
      <div className="mt-4 rounded-[28px] bg-panel px-3 py-4 text-paper">
        <HomeFeed />
      </div>
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
      <button type="button" onClick={() => setScreen("profile")}>Profile</button>
    </nav>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 shrink-0 rounded-full bg-ink/25 px-4 text-sm font-bold">
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

/** How much of this pixel is green-screen, 0–1. The first branch matches the original cut. */
function greenCoverage(r: number, g: number, b: number) {
  const other = r > b ? r : b;
  const score = g - other;
  if (g > 50 && score > 28) return score >= 96 ? 1 : (score - 28) / 68;
  if (g < 90 || g <= r || g <= b) return 0;
  const low = r < b ? r : b;
  const delta = g - low;
  if (delta < 40) return 0;
  let hue = (60 * (b - r)) / delta;
  if (hue < 0) hue += 360;
  const sat = delta / g;
  if (hue < 80 || hue > 160 || sat < 0.5) return 0;
  return Math.min(1, (sat - 0.35) * 1.6);
}

function parsePanel(raw: string): [number, number, number] | null {
  const text = raw.trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(text);
  if (hex?.[1]) {
    const n = hex[1];
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
  if (!rgb) return null;
  return [Math.round(Number(rgb[1])), Math.round(Number(rgb[2])), Math.round(Number(rgb[3]))];
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
    const ctx = canvas.getContext("2d");
    const scratch = document.createElement("canvas");
    const sctx = scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx || !sctx) return;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    if (!video.getAttribute("src")) video.src = "/art/dance-green.mp4";
    let frame = 0;
    let alive = true;
    let onscreen = true;
    let last = 0;
    let draws = 0;
    let failures = 0;
    let color = "";
    let pr = 0x1e;
    let pg = 0xd7;
    let pb = 0x60;
    let image: ImageData | null = null;
    const frameGap = 1000 / 30;
    const hide = () => {
      if (!shownRef.current) return;
      shownRef.current = false;
      setShown(false);
    };
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
      if (scratch.width !== w || scratch.height !== h) {
        scratch.width = w;
        scratch.height = h;
        image = null;
      }
      const raw = getComputedStyle(canvas).getPropertyValue("--color-panel");
      if (raw !== color) {
        const parsed = parsePanel(raw);
        if (parsed) {
          color = raw;
          pr = parsed[0];
          pg = parsed[1];
          pb = parsed[2];
        }
      }
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const scale = Math.max(w / srcW, h / srcH);
      const cropW = w / scale;
      const cropH = h / scale;
      const sx = (srcW - cropW) * 0.5;
      const sy = (srcH - cropH) * 0.08;
      try {
        sctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, w, h);
        image = sctx.getImageData(0, 0, w, h);
      } catch {
        failures += 1;
        hide();
        if (failures > 8) {
          alive = false;
          video.pause();
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
        }
        return;
      }
      const px = image.data;
      let matted = 0;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        const amount = greenCoverage(r, g, b);
        if (amount <= 0) continue;
        if (amount >= 0.95) matted += 1;
        const keep = 1 - amount;
        px[i] = Math.round(r * keep + pr * amount);
        px[i + 1] = Math.round(g * keep + pg * amount);
        px[i + 2] = Math.round(b * keep + pb * amount);
      }
      // An unkeyed or unreadable frame stays off the visible canvas. The still remains.
      if (matted < (w * h) * 0.08) {
        hide();
        return;
      }
      failures = 0;
      sctx.putImageData(image, 0, 0);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(scratch, 0, 0);
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
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          aria-hidden
          className="pointer-events-none"
          style={{ position: "fixed", width: 2, height: 2, left: -9999, top: 0, opacity: 0 }}
        />
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

function playVideo(videoId: string) {
  const catalog = useCatalog.getState();
  const video =
    catalog.videos.find((item) => item.id === videoId) ??
    catalog.search.videos.find((item) => item.id === videoId);
  if (video) catalog.rememberVideo(video);
  usePlayer.getState().openVideo(videoId);
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
  const buffering = usePlayer((s) => s.buffering);
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
      <span className="w-9 text-right text-xs tabular-nums text-mute">{buffering ? "…" : fmt(duration)}</span>
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
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
        <button type="button" aria-label={`Share ${track.title || "track"}`} onClick={() => void shareAndToast(track)} className="grid size-11 shrink-0 place-items-center rounded-full bg-ink/30">
          <Share2 className="size-4" />
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
      <div className="w-full max-w-[420px] max-h-[92dvh] overflow-y-auto rounded-[28px] bg-panel p-5 text-paper" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Now playing">
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
            <button type="button" aria-label={`Share ${track.title || "track"}`} onClick={() => void shareAndToast(track)} className="grid size-11 place-items-center rounded-full bg-ink/25">
              <Share2 className="size-5" />
            </button>
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
        <div className="mt-3 flex flex-wrap gap-2">
          {album.id ? (
            <button
              type="button"
              onClick={() => {
                setPlayerOpen(false);
                usePlayer.getState().openAlbum(album.id);
              }}
              className="min-h-11 rounded-full bg-ink/25 px-4 text-xs font-bold"
            >
              Album
            </button>
          ) : null}
          {track.artist ? (
            <button
              type="button"
              onClick={() => {
                setPlayerOpen(false);
                usePlayer.getState().openSearch(track.artist);
              }}
              className="min-h-11 rounded-full bg-ink/25 px-4 text-xs font-bold"
            >
              Artist
            </button>
          ) : null}
        </div>
        <SleepTimer />
        <UpNext trackId={track.id} albumId={album.id || track.albumId} />
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
    screen === "profile" ? "Profile" :
    screen === "following" ? "Artists" :
    screen === "saved" ? "Albums" :
    "Cover lab";
  const browsing = screen === "search" || screen === "albums" || screen === "album" || screen === "history" || screen === "playlists" || screen === "favorites" || screen === "profile" || screen === "following" || screen === "saved";
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
        {screen === "profile" && <ProfileScreen />}
        {screen === "following" && <FollowingScreen />}
        {screen === "saved" && <SavedAlbumsScreen />}
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

function SaveAlbumButton() {
  const albumId = usePlayer((s) => s.albumId);
  const album = useCatalog((s) => s.albumMap[albumId]);
  const saved = useLibrary((s) => s.savedAlbums.some((item) => item.id === albumId));
  if (!album?.id) return null;
  return (
    <button
      type="button"
      onClick={() =>
        useLibrary.getState().setSavedAlbum(
          { id: album.id, title: album.title, artist: album.artist, cover: album.cover, year: album.year },
          !saved,
        )
      }
      className="mt-2 min-h-11 rounded-full bg-ink/25 px-4 text-sm font-bold"
    >
      {saved ? "Saved album" : "Save album"}
    </button>
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
  const loaded = useCatalog((s) => !!s.loaded[albumId]);
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
        <SaveAlbumButton />
      </div>
      {!list.length && album.kind !== "chart" && album.remoteId && !loaded ? (
        <div className="mt-4 flex flex-col gap-2" aria-hidden>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-2xl bg-ink/15" />
          ))}
        </div>
      ) : null}
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
      <button type="button" aria-label={`Share ${track.title}`} onClick={() => void shareAndToast(track)} className="grid size-11 place-items-center">
        <Share2 className="size-4" />
      </button>
      <DownloadLink track={track} />
      <button type="button" aria-label="Like track" onClick={onLike} className="grid size-11 place-items-center">
        <Heart className={`size-4 ${liked ? "fill-hot text-hot" : ""}`} />
      </button>
    </li>
  );
}

function SearchPage() {
  const seed = usePlayer((s) => s.searchSeed);
  const [q, setQ] = useState(seed);
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
    if (seed) setQ(seed);
  }, [seed]);
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
  const autoPlay = usePlayer((s) => s.videoAutoplay);
  const ready = useCatalog((s) => s.ready);
  const error = useCatalog((s) => s.error);
  const reload = useCatalog((s) => s.reload);
  const videos = useCatalog((s) => s.videos);
  const active = videos.find((video) => video.id === videoId) ?? videos[0];
  return (
    <div>
      {!ready ? <div className="aspect-video w-full animate-pulse rounded-3xl bg-ink/20" /> : null}
      {ready && error && !videos.length ? (
        <div className="rounded-3xl bg-ink/15 p-4">
          <p className="text-sm font-extrabold">{error}</p>
          <button type="button" onClick={() => void reload()} className="mt-3 min-h-11 rounded-full bg-paper px-4 text-sm font-extrabold text-ink">
            Try again
          </button>
        </div>
      ) : null}
      {ready && !error && !videos.length ? <p className="text-sm text-paper/80">No videos yet.</p> : null}
      {active ? (
        <>
          <VideoPlayer video={active} autoPlay={autoPlay && active.id === videoId} />
          <p className="mt-3 font-extrabold">{active.title}</p>
          <p className="text-xs text-paper/80">{active.meta}</p>
        </>
      ) : null}
      <ul className="mt-3 flex flex-col gap-2">
        {videos.map((video) => (
          <li key={video.id}>
            <button
              type="button"
              onClick={() => playVideo(video.id)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-2xl p-2 text-left ${video.id === active?.id ? "bg-ink/25" : "bg-ink/10"}`}
            >
              {video.image ? (
                <img src={video.image} alt="" className="size-16 rounded-xl object-cover" />
              ) : (
                <span className="size-16 shrink-0 rounded-xl bg-ink/30" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-extrabold">{video.title}</span>
                <span className="text-xs text-paper/75">{video.meta}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialsPage() {
  const saved = usePlayer((s) => s.posts);
  const togglePost = usePlayer((s) => s.togglePost);
  const stories = useCatalog((s) => s.stories);
  if (!stories.length) return <p className="text-sm text-paper/80">No artists yet.</p>;
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

function SleepTimer() {
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (!minutes) return;
    const id = window.setTimeout(() => {
      if (usePlayer.getState().playing) usePlayer.getState().togglePlay();
      usePlayer.getState().flash("Sleep timer");
      setMinutes(0);
    }, minutes * 60 * 1000);
    return () => window.clearTimeout(id);
  }, [minutes]);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-extrabold">Sleep</span>
      {[0, 15, 30, 60].map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={minutes === value}
          onClick={() => setMinutes(value)}
          className={`min-h-11 rounded-full px-3 text-xs font-bold ${minutes === value ? "bg-paper text-ink" : "bg-ink/25"}`}
        >
          {value === 0 ? "Off" : `${value}m`}
        </button>
      ))}
    </div>
  );
}

function UpNext({ trackId, albumId }: { trackId: string; albumId: string }) {
  const membership = useCatalog((s) => s.membership);
  const playOrder = useCatalog((s) => s.playOrder);
  const trackMap = useCatalog((s) => s.trackMap);
  const playTrack = usePlayer((s) => s.playTrack);
  const ids = membership[albumId]?.includes(trackId) ? membership[albumId] : playOrder;
  const start = ids.indexOf(trackId);
  const upcoming = (start >= 0 ? ids.slice(start + 1, start + 4) : []).map((id) => trackMap[id]).filter((track): track is Track => !!track);
  if (!upcoming.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-extrabold tracking-widest">UP NEXT</p>
      <ul className="mt-2 flex flex-col gap-1">
        {upcoming.map((track) => (
          <li key={track.id}>
            <button type="button" onClick={() => playTrack(track.id, albumId)} className="flex min-h-11 w-full items-center gap-2 rounded-2xl bg-ink/15 px-3 text-left">
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{track.title}</span>
              <span className="truncate text-xs text-paper/70">{track.artist}</span>
            </button>
          </li>
        ))}
      </ul>
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
  if (!tracks.length) return <p className="text-sm text-paper/80">Songs you like show up here.</p>;
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
