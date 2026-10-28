import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "melobi-accounts-"));
process.env.MELOBI_DATA_DIR = dir;
process.env.COOKIE_SECURE = "0";
process.env.SESSION_SECRET = "test-secret-not-the-upstream-token";
process.env.USER_TOKEN = "super-secret-upstream-token";

const { closeAccounts, dispatchAccount } = await import("./accounts.mjs");

function jar(ip = "203.0.113.10") {
  let cookie = "";
  return {
    async call(method, path, body) {
      const result = await dispatchAccount({
        method,
        path,
        headers: { cookie, "content-type": "application/json" },
        body,
        ip,
      });
      assert.ok(result);
      for (const raw of result.cookies ?? []) {
        const pair = raw.split(";")[0] ?? "";
        if (!pair.startsWith("melobi_session=")) continue;
        const value = pair.slice("melobi_session=".length);
        cookie = value ? `melobi_session=${value}` : "";
      }
      return result;
    },
  };
}

test("two accounts keep separate libraries", async () => {
  const a = jar("203.0.113.20");
  const b = jar("203.0.113.21");
  const signupA = await a.call("POST", "/api/v1/auth/signup", {
    email: "a@example.com",
    password: "password-a-1",
    displayName: "Ava",
  });
  assert.equal(signupA.status, 200);
  assert.equal(signupA.json.data.user.displayName, "Ava");
  assert.equal(signupA.json.data.user.password_hash, undefined);
  assert.equal(JSON.stringify(signupA.json).includes("super-secret-upstream-token"), false);

  const signupB = await b.call("POST", "/api/v1/auth/signup", {
    email: "b@example.com",
    password: "password-b-1",
    displayName: "Bea",
  });
  assert.equal(signupB.status, 200);

  const like = await a.call("PUT", "/api/v1/me/likes", {
    track: { id: "157767", title: "Shodi Nooram", artist: "Novan", duration: 164 },
  });
  assert.equal(like.status, 200);
  const created = await a.call("POST", "/api/v1/me/playlists", { id: "pl-ava-1", name: "Ava mix", tracks: [] });
  assert.equal(created.status, 201);
  await a.call("POST", "/api/v1/me/history", { track: { id: "157767", title: "Shodi Nooram", artist: "Novan" }, at: 10 });
  await a.call("PUT", "/api/v1/me/follows", { id: "artist:novan", name: "Novan" });
  await a.call("PUT", "/api/v1/me/albums", { id: "album:1", title: "North", artist: "Novan", year: "2024" });
  await a.call("PATCH", "/api/v1/me/settings", { theme: "ice" });

  await b.call("PUT", "/api/v1/me/likes", { track: { id: "42", title: "Other", artist: "Bee" } });

  const libA = await a.call("GET", "/api/v1/me/library");
  const libB = await b.call("GET", "/api/v1/me/library");
  assert.deepEqual(libA.json.data.liked.map((track) => track.id), ["157767"]);
  assert.deepEqual(libB.json.data.liked.map((track) => track.id), ["42"]);
  assert.equal(libA.json.data.playlists[0].name, "Ava mix");
  assert.equal(libB.json.data.playlists.length, 0);
  assert.equal(libA.json.data.follows[0].id, "artist:novan");
  assert.equal(libB.json.data.follows.length, 0);
  assert.equal(libA.json.data.albums[0].title, "North");
  assert.equal(libA.json.data.theme, "ice");
  assert.equal(libB.json.data.theme, "green");
  assert.equal(libA.json.data.history[0].id, "157767");

  const gone = await a.call("POST", "/api/v1/auth/logout");
  assert.equal(gone.status, 200);
  const me = await a.call("GET", "/api/v1/auth/me");
  assert.equal(me.json.data, null);
  const blocked = await a.call("GET", "/api/v1/me/library");
  assert.equal(blocked.status, 401);

  const again = await a.call("POST", "/api/v1/auth/login", { email: "a@example.com", password: "password-a-1" });
  assert.equal(again.status, 200);
  const still = await a.call("GET", "/api/v1/me/library");
  assert.deepEqual(still.json.data.liked.map((track) => track.id), ["157767"]);
});

test("guest library imports once", async () => {
  const user = jar("203.0.113.30");
  await user.call("POST", "/api/v1/auth/signup", { email: "import@example.com", password: "password-c-1" });
  const first = await user.call("POST", "/api/v1/me/library/import", {
    liked: [{ id: "9", title: "Guest song", artist: "Guest" }],
    playlists: [{ id: "pl-guest", name: "From this phone", tracks: [{ id: "9", title: "Guest song" }] }],
    theme: "night",
  });
  assert.equal(first.json.data.imported, true);
  assert.equal(first.json.data.liked[0].title, "Guest song");
  assert.equal(first.json.data.theme, "night");
  const second = await user.call("POST", "/api/v1/me/library/import", {
    liked: [{ id: "8", title: "Should not merge", artist: "Nope" }],
  });
  assert.deepEqual(second.json.data.liked.map((track) => track.id), ["9"]);
});

test("password change, bad login, and account deletion", async () => {
  const user = jar("203.0.113.40");
  await user.call("POST", "/api/v1/auth/signup", { email: "pw@example.com", password: "password-d-1" });
  const wrong = await user.call("POST", "/api/v1/auth/login", { email: "pw@example.com", password: "nope-nope" });
  assert.equal(wrong.status, 401);
  const changed = await user.call("POST", "/api/v1/auth/password", {
    currentPassword: "password-d-1",
    newPassword: "password-d-2",
  });
  assert.equal(changed.status, 200);
  const old = await jar("203.0.113.41").call("POST", "/api/v1/auth/login", {
    email: "pw@example.com",
    password: "password-d-1",
  });
  assert.equal(old.status, 401);
  const next = await user.call("POST", "/api/v1/auth/login", { email: "pw@example.com", password: "password-d-2" });
  assert.equal(next.status, 200);
  const removed = await user.call("DELETE", "/api/v1/auth/me", { password: "password-d-2" });
  assert.equal(removed.status, 200);
  const after = await user.call("POST", "/api/v1/auth/login", { email: "pw@example.com", password: "password-d-2" });
  assert.equal(after.status, 401);
});

test("login is rate limited", async () => {
  const user = jar("203.0.113.50");
  let status = 0;
  for (let i = 0; i < 9; i += 1) {
    const result = await user.call("POST", "/api/v1/auth/login", { email: "nobody@example.com", password: "wrong-password" });
    status = result.status;
  }
  assert.equal(status, 429);
});

test.after(() => {
  closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});
