import { usePlayer } from "@/lib/player-store";

export function trackLink(id: string) {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("track", id);
  return url.toString();
}

/** System share sheet when the WebView provides one, otherwise copy the link. */
export async function shareTrack(track: { id: string; title: string; artist: string }): Promise<"shared" | "copied" | "dismissed"> {
  if (!track.id) return "dismissed";
  const url = trackLink(track.id);
  const payload = {
    title: track.title || "Melobi",
    text: track.artist ? `${track.artist} — ${track.title}` : track.title || "Melobi",
    url,
  };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const area = document.createElement("textarea");
    area.value = url;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  return "copied";
}

export async function shareAndToast(track: { id: string; title: string; artist: string }) {
  const result = await shareTrack(track);
  if (result === "copied") usePlayer.getState().flash("Link copied");
}
