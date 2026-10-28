import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hlsVariantUrls,
  originalMediaUrl,
  relayMediaUrl,
  rewriteHlsManifest,
} from "./media-relay.ts";

const MP3 = "https://host2.media-rj.com/media/mp3/mp3-256/157767-880301e690cf32c.mp3";
const PAGE = "https://melobi.amirxo.ir";

describe("relayMediaUrl", () => {
  it("leaves URLs unchanged when the relay base is unset", () => {
    assert.equal(relayMediaUrl(MP3), MP3);
    assert.equal(relayMediaUrl(MP3, ""), MP3);
    assert.equal(relayMediaUrl(`${MP3}?token=abc`, "   "), `${MP3}?token=abc`);
  });

  it("rewrites absolute media URLs to /m/<host>/<path>", () => {
    assert.equal(
      relayMediaUrl(MP3, "/m"),
      `/m/host2.media-rj.com/media/mp3/mp3-256/157767-880301e690cf32c.mp3`,
    );
    assert.equal(
      relayMediaUrl("https://assets.rjassets.com/static/mp3/novan/player.jpg", "/m"),
      "/m/assets.rjassets.com/static/mp3/novan/player.jpg",
    );
    assert.equal(
      relayMediaUrl("https://dxzgmlien7waz.cloudfront.net/media/stems/152298/music.m4a", "/m/"),
      "/m/dxzgmlien7waz.cloudfront.net/media/stems/152298/music.m4a",
    );
    assert.equal(relayMediaUrl("http://cdn.example.com/a.mp3", "m"), "/m/cdn.example.com/a.mp3");
  });

  it("keeps a non-default port on the host", () => {
    assert.equal(
      relayMediaUrl("https://cdn.example.com:8443/media/a.mp3", "/m"),
      "/m/cdn.example.com:8443/media/a.mp3",
    );
    assert.equal(
      relayMediaUrl("http://10.1.2.3:8080/stream/live.m3u8", "/m"),
      "/m/10.1.2.3:8080/stream/live.m3u8",
    );
  });

  it("preserves the query string and hash", () => {
    assert.equal(
      relayMediaUrl("https://host2.media-rj.com/media/a.mp3?token=abc&x=1", "/m"),
      "/m/host2.media-rj.com/media/a.mp3?token=abc&x=1",
    );
    assert.equal(
      relayMediaUrl("https://cdn.example.com:8443/a.jpg?b=hello%20world&c=2#still", "/m"),
      "/m/cdn.example.com:8443/a.jpg?b=hello%20world&c=2#still",
    );
  });

  it("does not touch relative URLs", () => {
    for (const url of [
      "/art/stage.jpg",
      "/art/dance-green.mp4",
      "/art/hero-clay.png",
      "/api/v1/tracks/157767/download",
      "/api/v1/tracks/157767/download?inline=1",
      "/m/host2.media-rj.com/media/a.mp3?x=1",
      "covers/a.jpg",
      "./a.jpg",
      "",
    ]) {
      assert.equal(relayMediaUrl(url, "/m"), url);
    }
  });

  it("does not touch data: or blob: URLs", () => {
    const data = "data:image/jpeg;base64,/9j/4AAQ";
    const blob = "blob:https://melobi.amirxo.ir/8c1d-4b2a";
    assert.equal(relayMediaUrl(data, "/m"), data);
    assert.equal(relayMediaUrl(blob, "/m"), blob);
    assert.equal(relayMediaUrl("DATA:image/png;base64,aaaa", "/m"), "DATA:image/png;base64,aaaa");
    assert.equal(relayMediaUrl("Blob:http://localhost/uuid", "/m"), "Blob:http://localhost/uuid");
  });

  it("does not rewrite same-origin URLs or an absolute relay URL", () => {
    assert.equal(
      relayMediaUrl(`${PAGE}/art/dance-green.mp4`, "/m", PAGE),
      `${PAGE}/art/dance-green.mp4`,
    );
    assert.equal(
      relayMediaUrl(`${PAGE}/m/host2.media-rj.com/media/seg.ts`, "/m", PAGE),
      `${PAGE}/m/host2.media-rj.com/media/seg.ts`,
    );
    const relay = "https://34-165-119-170.sslip.io/m";
    assert.equal(
      relayMediaUrl(`${relay}/host2.media-rj.com/media/a.mp3?x=1`, relay),
      `${relay}/host2.media-rj.com/media/a.mp3?x=1`,
    );
  });

  it("round-trips a relay path back to the original media URL", () => {
    const relayed = relayMediaUrl("https://cdn.example.com:8443/media/a.mp3?token=abc", "/m");
    assert.equal(
      originalMediaUrl(relayed, "/m"),
      "https://cdn.example.com:8443/media/a.mp3?token=abc",
    );
    assert.equal(originalMediaUrl("/art/dance-green.mp4", "/m"), "/art/dance-green.mp4");
    assert.equal(originalMediaUrl(MP3, "/m"), MP3);
  });

  it("still rewrites external URLs when a page origin is known", () => {
    assert.equal(
      relayMediaUrl(MP3, "/m", PAGE),
      `/m/host2.media-rj.com/media/mp3/mp3-256/157767-880301e690cf32c.mp3`,
    );
  });
});

describe("rewriteHlsManifest", () => {
  const playlist = "https://host2.media-rj.com/media/v/playlist.m3u8";

  it("rewrites absolute and relative segment and key URLs", () => {
    const manifest = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://host2.media-rj.com/media/v/key.bin",IV=0x01',
      "#EXTINF:6,",
      "seg-1.ts",
      "#EXTINF:6,",
      "https://host1.media-rj.com/media/v/seg-2.ts?token=abc",
      '#EXT-X-MAP:URI="init.mp4"',
    ].join("\n");
    const rewritten = rewriteHlsManifest(manifest, playlist, "/m");
    assert.match(rewritten, /URI="\/m\/host2\.media-rj\.com\/media\/v\/key\.bin"/);
    assert.match(rewritten, /^\/m\/host2\.media-rj\.com\/media\/v\/seg-1\.ts$/m);
    assert.match(rewritten, /^\/m\/host1\.media-rj\.com\/media\/v\/seg-2\.ts\?token=abc$/m);
    assert.match(rewritten, /URI="\/m\/host2\.media-rj\.com\/media\/v\/init\.mp4"/);
    assert.match(rewritten, /IV=0x01/);
  });

  it("prefixes an origin so a blob playlist stays absolute", () => {
    const rewritten = rewriteHlsManifest("#EXTM3U\nseg.ts\n", playlist, "/m", PAGE);
    assert.match(rewritten, new RegExp(`^${PAGE}/m/host2\\.media-rj\\.com/media/v/seg\\.ts$`, "m"));
  });

  it("leaves a manifest unchanged when the relay is off", () => {
    const manifest = "#EXTM3U\nhttps://host2.media-rj.com/a.ts\n";
    assert.equal(rewriteHlsManifest(manifest, playlist, ""), manifest);
  });

  it("picks variant playlists and orders them by bandwidth", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=200000",
      "low.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=800000",
      "https://host2.media-rj.com/media/v/hi.m3u8?x=1",
    ].join("\n");
    assert.deepEqual(hlsVariantUrls(master, playlist), [
      "https://host2.media-rj.com/media/v/low.m3u8",
      "https://host2.media-rj.com/media/v/hi.m3u8?x=1",
    ]);
    assert.deepEqual(hlsVariantUrls("#EXTM3U\n#EXTINF:1,\na.ts\n", playlist), []);
  });
});
