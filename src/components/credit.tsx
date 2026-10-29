export const CONTACT_EMAIL = "kami@amirxo.com";

export function Credit({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-paper/60 ${className}`}>
      Created by AmirXo © 2026
      <span className="px-1.5" aria-hidden>
        ·
      </span>
      <a href={`mailto:${CONTACT_EMAIL}`} className="underline decoration-paper/30 underline-offset-2">
        {CONTACT_EMAIL}
      </a>
    </p>
  );
}
