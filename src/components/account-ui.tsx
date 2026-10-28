import { useEffect, useId, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { useAccount, type PublicUser } from "@/lib/account-store";
import { useCatalog } from "@/lib/catalog-store";
import { useLibrary } from "@/lib/library";
import { apiUrl } from "@/lib/music-api";
import { usePlayer } from "@/lib/player-store";
import { APP_VERSION } from "@/lib/version";

export const AVATAR_PRESETS = [
  { id: "1", color: "#102418", ink: "#f7fff8" },
  { id: "2", color: "#49b6e8", ink: "#070807" },
  { id: "3", color: "#e10600", ink: "#fff7f7" },
  { id: "4", color: "#ffb020", ink: "#070807" },
  { id: "5", color: "#7c5cbf", ink: "#fff7ff" },
  { id: "6", color: "#ff4d6a", ink: "#fff7f8" },
  { id: "7", color: "#128a78", ink: "#f4fffc" },
  { id: "8", color: "#f4f1ea", ink: "#070807" },
];

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={id} className="block text-left text-sm font-bold">
      {label}
      <input
        id={id}
        {...props}
        className="mt-1 min-h-11 w-full rounded-full bg-ink/25 px-4 text-sm font-semibold text-paper outline-none placeholder:text-paper/50"
      />
    </label>
  );
}

export function LegalLinks() {
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-paper/80" aria-label="About Melobi">
      <a href="/privacy" className="min-h-11 py-2">Privacy</a>
      <a href="/terms" className="min-h-11 py-2">Terms</a>
      <a href="/about" className="min-h-11 py-2">About</a>
    </nav>
  );
}

export function AvatarBadge({ user, size = 72 }: { user: PublicUser; size?: number }) {
  const initial = (user.displayName || "?").slice(0, 1).toUpperCase();
  const avatar = user.avatar;
  if (avatar.type === "upload") {
    return (
      <img
        src={apiUrl(avatar.url)}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const preset = AVATAR_PRESETS.find((item) => item.id === avatar.id) ?? AVATAR_PRESETS[0];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-display ring-2 ring-ink/50"
      style={{ width: size, height: size, background: preset?.color, color: preset?.ink, fontSize: size * 0.38 }}
    >
      {initial}
    </span>
  );
}

export function AuthForm({ onDone }: { onDone?: () => void }) {
  const signup = useAccount((s) => s.signup);
  const login = useAccount((s) => s.login);
  const busy = useAccount((s) => s.busy);
  const error = useAccount((s) => s.error);
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok =
      mode === "create"
        ? await signup({ email, password, displayName })
        : await login({ email, password });
    if (ok) onDone?.();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 rounded-full bg-ink/20 p-1" role="tablist" aria-label="Account">
        {(
          [
            ["signin", "Sign in"],
            ["create", "Create account"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`min-h-11 rounded-full text-sm font-extrabold ${mode === id ? "bg-paper text-ink" : "text-paper"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "create" ? (
        <Field label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={40} />
      ) : null}
      <Field label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete={mode === "create" ? "new-password" : "current-password"}
        minLength={8}
        required
      />
      {error ? <p className="text-sm font-bold text-paper">{error}</p> : null}
      <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-paper px-4 text-sm font-extrabold text-ink disabled:opacity-60">
        {busy ? "Please wait" : mode === "create" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl bg-ink/15 px-2 py-3 text-center">
      <span className="block font-display text-2xl leading-none">{value}</span>
      <span className="mt-1 block text-xs font-bold text-paper/80">{label}</span>
    </button>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="size-20 animate-pulse rounded-full bg-ink/20" />
      <div className="h-8 w-40 animate-pulse rounded-full bg-ink/20" />
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-2xl bg-ink/15" />
        ))}
      </div>
    </div>
  );
}

export function ProfileScreen() {
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const error = useAccount((s) => s.error);
  const busy = useAccount((s) => s.busy);
  const updateProfile = useAccount((s) => s.updateProfile);
  const changePassword = useAccount((s) => s.changePassword);
  const deleteAccount = useAccount((s) => s.deleteAccount);
  const logout = useAccount((s) => s.logout);
  const liked = usePlayer((s) => s.liked);
  const playlists = useLibrary((s) => s.playlists);
  const follows = useLibrary((s) => s.follows);
  const albums = useLibrary((s) => s.savedAlbums);
  const setScreen = usePlayer((s) => s.setScreen);
  const [name, setName] = useState(user?.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [removePassword, setRemovePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    if (user) setName(user.displayName);
  }, [user]);

  if (status === "loading") return <ProfileSkeleton />;
  if (!user || status !== "user") {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div>
          <h2 className="font-display text-4xl leading-none">Your library</h2>
          <p className="mt-2 text-sm text-paper/80">
            Browse and play as a guest. Sign in to keep a profile, liked songs, playlists, history, artists, and albums.
          </p>
        </div>
        <AuthForm />
        <button type="button" onClick={() => setScreen("home")} className="min-h-11 text-sm font-bold text-paper/80">
          Continue as guest
        </button>
        <LegalLinks />
      </div>
    );
  }

  const likeCount = Object.values(liked).filter(Boolean).length;
  const joined = new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) {
      usePlayer.getState().flash("Couldn't read that image");
      return;
    }
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    bitmap.close();
    await updateProfile({ avatarData: canvas.toDataURL("image/jpeg", 0.85) });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <AvatarBadge user={user} size={84} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-4xl leading-none">{user.displayName}</h2>
          <p className="mt-1 truncate text-sm text-paper/80">{user.email}</p>
          <p className="text-xs font-bold text-paper/70">Listener since {joined}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
        <Stat label="Liked" value={likeCount} onClick={() => setScreen("favorites")} />
        <Stat label="Playlists" value={playlists.length} onClick={() => setScreen("playlists")} />
        <Stat label="Artists" value={follows.length} onClick={() => setScreen("following")} />
        <Stat label="Albums" value={albums.length} onClick={() => setScreen("saved")} />
      </div>

      <section className="rounded-3xl bg-ink/15 p-4">
        <h3 className="text-sm font-extrabold">Profile</h3>
        <form
          className="mt-3 flex flex-col gap-3 min-[700px]:flex-row min-[700px]:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void updateProfile({ displayName: name });
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Display name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
          </div>
          <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-paper px-4 text-sm font-extrabold text-ink">
            Save name
          </button>
        </form>
        <p className="mt-4 text-sm font-bold">Avatar</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Avatar colors">
          {AVATAR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-label={`Avatar ${preset.id}`}
              aria-pressed={user.avatar.type === "preset" && user.avatar.id === preset.id}
              onClick={() => void updateProfile({ avatarPreset: preset.id })}
              className={`size-11 rounded-full border-2 ${user.avatar.type === "preset" && user.avatar.id === preset.id ? "border-paper" : "border-transparent"}`}
              style={{ background: preset.color }}
            />
          ))}
        </div>
        <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink/25 px-4 text-sm font-extrabold">
          Upload photo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void pickFile(file);
            }}
          />
        </label>
        {error ? <p className="mt-3 text-sm font-bold">{error}</p> : null}
      </section>

      <section className="rounded-3xl bg-ink/15 p-4">
        <h3 className="text-sm font-extrabold">Library</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setScreen("favorites")} className="min-h-11 rounded-full bg-paper/15 px-4 text-sm font-bold">Liked songs</button>
          <button type="button" onClick={() => setScreen("playlists")} className="min-h-11 rounded-full bg-paper/15 px-4 text-sm font-bold">Playlists</button>
          <button type="button" onClick={() => setScreen("history")} className="min-h-11 rounded-full bg-paper/15 px-4 text-sm font-bold">Recently played</button>
          <button type="button" onClick={() => setScreen("following")} className="min-h-11 rounded-full bg-paper/15 px-4 text-sm font-bold">Artists</button>
          <button type="button" onClick={() => setScreen("saved")} className="min-h-11 rounded-full bg-paper/15 px-4 text-sm font-bold">Albums</button>
        </div>
      </section>

      <section className="rounded-3xl bg-ink/15 p-4">
        <h3 className="text-sm font-extrabold">Settings</h3>
        <p className="mt-2 text-sm text-paper/80">Color theme follows this account.</p>
        <div className="mt-3">
          <ThemeRow />
        </div>
        <div className="mt-4">
          <LegalLinks />
        </div>
        <p className="mt-2 text-xs font-bold text-paper/60">Melobi {APP_VERSION}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void logout()} className="min-h-11 rounded-full bg-paper px-4 text-sm font-extrabold text-ink">
          Sign out
        </button>
        <button type="button" onClick={() => setShowPassword((open) => !open)} className="min-h-11 rounded-full bg-ink/25 px-4 text-sm font-bold">
          Change password
        </button>
        <button type="button" onClick={() => setShowDelete((open) => !open)} className="min-h-11 rounded-full bg-ink/25 px-4 text-sm font-bold">
          Delete account
        </button>
      </div>

      {showPassword ? (
        <form
          className="flex max-w-md flex-col gap-3 rounded-3xl bg-ink/15 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void changePassword({ currentPassword, newPassword }).then((ok) => {
              if (ok) {
                setCurrentPassword("");
                setNewPassword("");
                setShowPassword(false);
              }
            });
          }}
        >
          <Field label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
          <Field label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
          <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-paper px-4 text-sm font-extrabold text-ink">
            Update password
          </button>
        </form>
      ) : null}

      {showDelete ? (
        <form
          className="flex max-w-md flex-col gap-3 rounded-3xl bg-ink/15 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void deleteAccount(removePassword);
          }}
        >
          <p className="text-sm text-paper/85">This removes your profile and library from Melobi. Songs in the catalog stay available.</p>
          <Field label="Password" type="password" value={removePassword} onChange={(event) => setRemovePassword(event.target.value)} autoComplete="current-password" required />
          <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-hot px-4 text-sm font-extrabold text-paper">
            Delete account
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ThemeRow() {
  const theme = usePlayer((s) => s.theme);
  const setTheme = usePlayer((s) => s.setTheme);
  const items = [
    { id: "green" as const, label: "Green", swatch: "swatch-green" },
    { id: "crimson" as const, label: "Crimson", swatch: "swatch-crimson" },
    { id: "ice" as const, label: "Ice", swatch: "swatch-ice" },
    { id: "night" as const, label: "Night", swatch: "swatch-night" },
  ];
  return (
    <div className="flex gap-2" role="group" aria-label="Color themes">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          aria-pressed={theme === item.id}
          onClick={() => setTheme(item.id)}
          className={`size-9 rounded-full border-2 ${item.swatch} ${theme === item.id ? "border-ink" : "border-transparent"}`}
        />
      ))}
    </div>
  );
}

export function FollowingScreen() {
  const follows = useLibrary((s) => s.follows);
  const setFollow = useLibrary((s) => s.setFollow);
  const posts = usePlayer((s) => s.posts);
  const togglePost = usePlayer((s) => s.togglePost);
  if (!follows.length) return <p className="text-sm text-paper/80">Artists you save show up here.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {follows.map((artist) => (
        <li key={artist.id} className="flex items-center gap-3 rounded-2xl bg-ink/15 p-2">
          {artist.image ? (
            <img src={artist.image} alt="" className="size-14 rounded-full object-cover" />
          ) : (
            <span className="grid size-14 place-items-center rounded-full bg-ink/30 text-sm font-extrabold">{artist.name.slice(0, 1)}</span>
          )}
          <span className="min-w-0 flex-1 truncate font-extrabold">{artist.name}</span>
          <button
            type="button"
            onClick={() => {
              if (artist.id in posts) togglePost(artist.id);
              else setFollow(artist, false);
            }}
            className="min-h-11 rounded-full bg-paper/15 px-3 text-xs font-extrabold"
          >
            Unfollow
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SavedAlbumsScreen() {
  const albums = useLibrary((s) => s.savedAlbums);
  const openAlbum = usePlayer((s) => s.openAlbum);
  const setSavedAlbum = useLibrary((s) => s.setSavedAlbum);
  const known = useCatalog((s) => s.albumMap);
  if (!albums.length) return <p className="text-sm text-paper/80">Albums you save show up here.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
      {albums.map((album) => (
        <article key={album.id} className="text-left">
          <button type="button" onClick={() => known[album.id] && openAlbum(album.id)} className="block w-full text-left">
            {album.cover ? (
              <img src={album.cover} alt="" className="aspect-square w-full rounded-2xl object-cover" />
            ) : (
              <span className="block aspect-square w-full rounded-2xl bg-ink/30" />
            )}
            <p className="mt-2 font-extrabold">{album.title}</p>
            <p className="text-sm text-paper/80">{album.artist}</p>
          </button>
          <button type="button" onClick={() => setSavedAlbum(album, false)} className="mt-1 min-h-11 text-xs font-bold text-paper/75">
            Remove
          </button>
        </article>
      ))}
    </div>
  );
}

export function SignInSheet() {
  const prompt = useAccount((s) => s.prompt);
  const dismiss = useAccount((s) => s.dismiss);
  const status = useAccount((s) => s.status);
  if (!prompt || status === "user") return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/75 p-3 min-[700px]:items-center" role="dialog" aria-modal="true" aria-labelledby="signin-title">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[28px] bg-panel p-4 text-paper shadow-2xl">
        <h2 id="signin-title" className="font-display text-3xl leading-none">Save it to Melobi</h2>
        <p className="mt-2 text-sm text-paper/80">{prompt}</p>
        <div className="mt-4">
          <AuthForm onDone={dismiss} />
        </div>
        <button type="button" onClick={dismiss} className="mt-2 min-h-11 w-full text-sm font-bold text-paper/80">
          Not now
        </button>
      </div>
    </div>
  );
}

export function OfflineGate() {
  const reload = useCatalog((s) => s.reload);
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    const sync = () => {
      const down = typeof navigator !== "undefined" && navigator.onLine === false;
      setOffline(down);
      if (!down) setNote("");
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink px-6 text-center text-paper">
      <div className="max-w-sm">
        <p className="text-xs font-extrabold tracking-[0.28em] text-paper/70">MELOBI</p>
        <h2 className="mt-3 font-display text-5xl leading-none">No connection</h2>
        <p className="mt-3 text-sm text-paper/80">Melobi needs a network to load music. Your library stays on this device until you are back online.</p>
        {note ? <p className="mt-3 text-sm font-bold">{note}</p> : null}
        <button
          type="button"
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.onLine === false) {
              setNote("Still offline. Try again when you have a signal.");
              return;
            }
            setOffline(false);
            setNote("");
            void reload();
          }}
          className="mt-5 min-h-11 rounded-full bg-paper px-5 text-sm font-extrabold text-ink"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
