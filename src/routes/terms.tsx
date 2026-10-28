import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal-layout";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalLayout title="Terms of Use">
      <p>Last updated October 28, 2026. These terms cover your use of Melobi at https://melobi.amirxo.ir.</p>
      <h2 className="font-display text-2xl leading-none text-paper">The service</h2>
      <p>Melobi lets you browse, play, and organize music, videos, and podcasts. Catalog availability depends on the upstream music service and can change. A network connection is required to load new music.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Your account</h2>
      <p>You can use Melobi as a guest. An account needs an email address and a password you choose. You are responsible for activity under your account and for keeping the password private. One person should not share an account if they want separate libraries.</p>
      <p>You can change the password or delete the account from your profile. Deleting the account removes the library stored for it.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Your library</h2>
      <p>Playlists, likes, and other library items you create are for your personal use inside Melobi. Don't use the service to break the law, attack the site, or overload it. We may suspend an account that does.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Music</h2>
      <p>Songs and videos are streamed for listening inside Melobi. Saving a file with the download control, where it is offered, is for your personal listening. Melobi does not transfer ownership of the music.</p>
      <h2 className="font-display text-2xl leading-none text-paper">The app</h2>
      <p>The Melobi name, logo, and the app's original design belong to their owner. The stage artwork is part of the product and isn't a license to reuse it elsewhere.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Availability</h2>
      <p>Melobi is provided as-is. Playback, search, and the catalog can fail or change without notice. We don't promise uninterrupted service.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Changes</h2>
      <p>Updated terms will be posted at /terms. Continuing to use Melobi after the date on the page means you accept the current terms.</p>
    </LegalLayout>
  );
}
