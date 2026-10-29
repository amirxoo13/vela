import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal-layout";
import { APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  return (
    <LegalLayout title="About">
      <p>Melobi is a music player for songs, albums, playlists, videos, and podcasts.</p>
      <p>
        Version <span className="font-extrabold">{APP_VERSION}</span>
      </p>
      <p>Create an account to keep your own profile and library: liked songs, playlists, recently played, followed artists, saved albums, and your theme. Guests can still browse and play.</p>
      <p>Melobi runs at https://melobi.amirxo.ir. Privacy details are on the privacy page, and the rules for using the app are on the terms page.</p>
      <p>
        Created by AmirXo © 2026. Contact{" "}
        <a href="mailto:kami@amirxo.com" className="font-extrabold underline decoration-paper/30 underline-offset-2">
          kami@amirxo.com
        </a>
        .
      </p>
    </LegalLayout>
  );
}
