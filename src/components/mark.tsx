import type { StickerKind } from "@/lib/player-store";

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Melobi" className="flex items-center gap-2">
      <img src="/brand/mark.png" alt="" className="size-9 shrink-0 object-contain" />
      <img src="/brand/wordmark.png" alt="" className="h-6 w-auto" />
    </button>
  );
}

export function StickerGlyph({ kind }: { kind: StickerKind }) {
  const tone =
    kind === "heart" || kind === "flame" ? "text-hot" : kind === "moon" || kind === "drop" ? "text-ink" : "text-paper";
  return (
    <span className={`block h-full w-full ${tone}`}>
      <svg viewBox="0 0 48 48" className="h-full w-full drop-shadow" aria-hidden>
        {kind === "star" && <path fill="currentColor" d="m24 3 5.2 13.2L43 18.2l-11 8.6 3.6 14.4L24 33.8 12.4 41.2 16 26.8 5 18.2l13.8-2z" />}
        {kind === "bolt" && <path fill="currentColor" d="M28 3 10 27h12l-2 18 18-26H26z" />}
        {kind === "flame" && <path fill="currentColor" d="M24 4s8 8 8 16a8 8 0 1 1-16 0c0-3 2-6 2-6s-6 4-6 12a14 14 0 1 0 28 0C40 16 24 4 24 4z" />}
        {kind === "disc" && (
          <>
            <circle cx="24" cy="24" r="16" fill="currentColor" />
            <circle cx="24" cy="24" r="5" fill="#01964c" />
          </>
        )}
        {kind === "spark" && <path fill="currentColor" d="M24 2 26 18 42 20 26 22 24 38 22 22 6 20 22 18Z" />}
        {kind === "moon" && <path fill="currentColor" d="M30 6a16 16 0 1 0 8 28 14 14 0 1 1-8-28z" />}
        {kind === "heart" && <path fill="currentColor" d="M24 40 8.8 24.2A9 9 0 0 1 22 12l2 2 2-2a9 9 0 0 1 13.2 12.2z" />}
        {kind === "drop" && <path fill="currentColor" d="M24 4s12 14 12 22a12 12 0 0 1-24 0C12 18 24 4 24 4z" />}
      </svg>
    </span>
  );
}
