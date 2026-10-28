import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal-layout";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>Last updated October 28, 2026. This policy describes how Melobi at https://melobi.amirxo.ir handles information when you use the app.</p>
      <h2 className="font-display text-2xl leading-none text-paper">What we store</h2>
      <p>If you create an account, we store your email address, a hash of your password (not the password itself), your display name, and an avatar you pick or upload.</p>
      <p>Your library is stored with that account: liked songs, playlists you create, recently played songs, artists you follow, albums you save, and your color theme. Playback position on this device stays on the device.</p>
      <p>Guests can browse and play without an account. Library actions on this device stay in the browser until you sign in. The first time you sign in, that on-device library is copied into your account.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Sessions</h2>
      <p>Signing in sets an httpOnly session cookie on this site. Script on the page cannot read it. The cookie ends when you sign out, delete the account, or it expires. We store only a hash of the session token.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Music requests</h2>
      <p>Playing and searching send the song, album, or search text to Melobi's own API so it can load the catalog. Your password is not included in those requests. Audio and pictures may then load from the catalog's content network.</p>
      <h2 className="font-display text-2xl leading-none text-paper">What we don't do</h2>
      <p>We don't sell personal information. The app does not include third-party advertising trackers. We don't ask for your contacts, and we don't use your library to build an ad profile.</p>
      <h2 className="font-display text-2xl leading-none text-paper">How long we keep it</h2>
      <p>Account and library data stay until you delete the account from your profile. Deleting the account removes the profile, password hash, avatar, sessions, and library from our database.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Children</h2>
      <p>Melobi is not directed at children under 13, and we don't knowingly create accounts for them.</p>
      <h2 className="font-display text-2xl leading-none text-paper">Changes</h2>
      <p>If this policy changes, the updated version will be posted at /privacy with a new date.</p>
    </LegalLayout>
  );
}
