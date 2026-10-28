import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { relayUpstreamUrl } from './relay-url.ts';

describe('relayUpstreamUrl', () => {
  it('returns the original URL when the relay base is empty', () => {
    const target = new URL('https://host2.media-rj.com/media/a.mp3?x=1');
    assert.equal(relayUpstreamUrl(target, ''), target);
    assert.equal(relayUpstreamUrl(target, '   '), target);
  });

  it('builds <base>/<host>/<path>?<query> and keeps a non-default port', () => {
    const target = new URL('https://host2.media-rj.com:8443/media/mp3/a.mp3?token=abc&x=1');
    const out = relayUpstreamUrl(target, 'https://34-165-119-170.sslip.io/m/');
    assert.equal(
      out.href,
      'https://34-165-119-170.sslip.io/m/host2.media-rj.com:8443/media/mp3/a.mp3?token=abc&x=1',
    );
  });

  it('joins a prefix that already has no trailing slash', () => {
    const target = new URL('https://assets.rjassets.com/static/mp3/cover.jpg');
    const out = relayUpstreamUrl(target, 'https://relay.example/m');
    assert.equal(out.href, 'https://relay.example/m/assets.rjassets.com/static/mp3/cover.jpg');
  });
});
