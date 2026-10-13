/**
 * The embedding/CLIP server's shared-secret check (#6206), tested as a pure function.
 * Rollout mode (no key configured) must allow everything so the code can deploy before the key exists.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs worker module, no type declarations
import { checkEmbedAuth, embedAuthHeaders } from '../../scripts/workers/lib/embed-auth.mjs';

const KEY = 'correct-horse-battery-staple';

describe('checkEmbedAuth', () => {
  it('allows everything when no key is configured (rollout mode)', () => {
    expect(checkEmbedAuth({ key: undefined, headerValue: undefined, path: '/clip/embed-text' }).ok).toBe(true);
    expect(checkEmbedAuth({ key: '', headerValue: 'anything', path: '/embed' }).ok).toBe(true);
  });

  it('allows a request carrying the right key', () => {
    expect(checkEmbedAuth({ key: KEY, headerValue: KEY, path: '/embed' }).ok).toBe(true);
  });

  it('rejects a wrong key of the same length', () => {
    expect(checkEmbedAuth({ key: KEY, headerValue: KEY.replace(/.$/, 'X'), path: '/embed' }).ok).toBe(false);
  });

  it('rejects a missing, empty, or array-valued header', () => {
    expect(checkEmbedAuth({ key: KEY, headerValue: undefined, path: '/embed' }).ok).toBe(false);
    expect(checkEmbedAuth({ key: KEY, headerValue: '', path: '/embed' }).ok).toBe(false);
    expect(checkEmbedAuth({ key: KEY, headerValue: [KEY], path: '/embed' }).ok).toBe(false);
  });

  it('rejects a different-length header without throwing', () => {
    expect(() => checkEmbedAuth({ key: KEY, headerValue: 'short', path: '/clip/embed-text' })).not.toThrow();
    expect(checkEmbedAuth({ key: KEY, headerValue: 'short', path: '/clip/embed-text' }).ok).toBe(false);
    expect(checkEmbedAuth({ key: KEY, headerValue: KEY + 'x', path: '/clip/embed-text' }).ok).toBe(false);
  });

  it('lets the bare health check through without a header, but nothing that merely starts with it', () => {
    expect(checkEmbedAuth({ key: KEY, headerValue: undefined, path: '/health' }).ok).toBe(true);
    expect(checkEmbedAuth({ key: KEY, headerValue: undefined, path: '/health?x=1' }).ok).toBe(true);
    expect(checkEmbedAuth({ key: KEY, headerValue: undefined, path: '/clip/health' }).ok).toBe(false);
    expect(checkEmbedAuth({ key: KEY, headerValue: undefined, path: '/healthz' }).ok).toBe(false);
  });
});

describe('embedAuthHeaders', () => {
  it('adds x-embed-key only when the key is set', () => {
    expect(embedAuthHeaders({})['x-embed-key']).toBeUndefined();
    expect(embedAuthHeaders({ EMBED_SERVER_KEY: KEY })['x-embed-key']).toBe(KEY);
  });
});
