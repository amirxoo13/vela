import { useEffect, useRef, useState } from "react";
import type { Video } from "@/lib/catalog-store";
import { pauseMedia } from "@/lib/audio-engine";
import { nativeHlsSource } from "@/lib/hls-relay";
import { mediaRelayEnabled, relayMediaUrl } from "@/lib/media-relay";
import { syncVideoSession } from "@/lib/media-session";
import { usePlayer } from "@/lib/player-store";
import { bindStageVideo, releaseStageVideo } from "@/lib/stage-video";
import { stopBeat } from "@/lib/tone";

function isHls(url: string) {
  return /\.m3u8($|\?)/i.test(url);
}

/**
 * Visible music video. MP4 plays natively. HLS uses the browser, or hls.js
 * when the WebView has no native HLS. With the media relay enabled, hls.js
 * runs first so playlist, segment, and key URLs are rewritten; Safari without
 * Media Source falls back to a rewritten playlist. The song player is paused
 * while this runs.
 */
export function VideoPlayer({ video, autoPlay = false }: { video: Video; autoPlay?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(true);
  const rawSrc = !isHls(video.mediaUrl) && video.mediaUrl ? video.mediaUrl : "";
  const rawHls = video.hlsUrl || (isHls(video.mediaUrl) ? video.mediaUrl : "");
  const src = rawSrc ? relayMediaUrl(rawSrc) : "";
  const hlsUrl = rawHls ? relayMediaUrl(rawHls) : "";
  const poster = video.image ? relayMediaUrl(video.image) : "";

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    bindStageVideo(node);
    setError("");
    let dead = false;
    let hls: { destroy: () => void } | null = null;
    let revokeNative: () => void = () => undefined;

    const silenceMusic = () => {
      setPaused(false);
      stopBeat();
      pauseMedia();
      if (usePlayer.getState().playing) usePlayer.setState({ playing: false });
      syncVideoSession(video.title, video.meta, poster, true);
    };
    const onPause = () => {
      setPaused(true);
      syncVideoSession(video.title, video.meta, poster, false);
    };
    node.addEventListener("play", silenceMusic);
    node.addEventListener("pause", onPause);
    node.addEventListener("error", () => {
      if (node.error) setError("Couldn't play this video");
    });

    const attach = async () => {
      node.removeAttribute("src");
      node.load();
      if (src) {
        node.src = src;
      } else if (!hlsUrl) {
        setError("This video has no stream");
        return;
      } else if (!mediaRelayEnabled() && node.canPlayType("application/vnd.apple.mpegurl")) {
        node.src = hlsUrl;
      } else {
        const { default: Hls } = await import("hls.js");
        if (dead) return;
        if (Hls.isSupported()) {
          const player = new Hls({
            enableWorker: true,
            capLevelToPlayerSize: true,
            ...(mediaRelayEnabled()
              ? {
                  xhrSetup: (_xhr: XMLHttpRequest, _url: string, context: { url: string }) => {
                    context.url = relayMediaUrl(context.url);
                  },
                  fetchSetup: (context: { url: string }, initParams: RequestInit) => {
                    const url = relayMediaUrl(context.url);
                    context.url = url;
                    return new Request(url, initParams);
                  },
                }
              : {}),
          });
          hls = player;
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setError("Couldn't play this video");
          });
          player.loadSource(hlsUrl);
          player.attachMedia(node);
        } else if (node.canPlayType("application/vnd.apple.mpegurl")) {
          const prepared = await nativeHlsSource(rawHls || hlsUrl);
          if (dead) {
            prepared.revoke();
            return;
          }
          revokeNative = prepared.revoke;
          node.src = prepared.src;
        } else {
          setError("This browser cannot play this video");
          return;
        }
      }
      if (autoPlay) {
        const start = () => {
          void node.play().catch(() => undefined);
        };
        if (node.readyState >= 2) start();
        else node.addEventListener("canplay", start, { once: true });
      }
    };
    void attach();

    return () => {
      dead = true;
      node.removeEventListener("play", silenceMusic);
      node.removeEventListener("pause", onPause);
      hls?.destroy();
      revokeNative();
      releaseStageVideo(node);
    };
  }, [video.id, video.title, video.meta, poster, src, hlsUrl, rawHls, attempt, autoPlay]);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink">
      <video
        ref={ref}
        controls
        playsInline
        poster={poster || undefined}
        preload="metadata"
        className="aspect-video w-full bg-ink"
        aria-label={video.title || "Video"}
      />
      {paused && !error ? (
        <button
          type="button"
          aria-label="Play video"
          onClick={() => void ref.current?.play().catch(() => setError("Couldn't play this video"))}
          className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-paper text-ink"
        >
          <span className="ml-1 inline-block size-0 border-y-[8px] border-l-[14px] border-y-transparent border-l-ink" />
        </button>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <p className="text-sm text-paper/85">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="min-h-11 shrink-0 rounded-full bg-paper px-4 text-sm font-extrabold text-ink"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
