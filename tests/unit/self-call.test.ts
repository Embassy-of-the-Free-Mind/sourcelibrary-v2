import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { selfCallHeaders } from '@/lib/self-call';

describe('selfCallHeaders', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.VERCEL_URL = 'sourcelibrary-v2-abc123-dereklomas-projects.vercel.app';
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-secret';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('attaches the bypass secret to this deployment\'s own URL', () => {
    expect(selfCallHeaders('https://sourcelibrary-v2-abc123-dereklomas-projects.vercel.app/api/books/x/index'))
      .toEqual({ 'x-vercel-protection-bypass': 'test-secret' });
  });

  it('never sends the secret off-site', () => {
    expect(selfCallHeaders('https://archive.org/download/book/page.jpg')).toEqual({});
    expect(selfCallHeaders('https://sourcelibrary.org/api/books/x')).toEqual({});
    // A host that merely CONTAINS ours is a different host.
    expect(selfCallHeaders('https://sourcelibrary-v2-abc123-dereklomas-projects.vercel.app.evil.example/x')).toEqual({});
  });

  it('is a no-op without the secret, without VERCEL_URL, or on a bad URL', () => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    expect(selfCallHeaders('https://sourcelibrary-v2-abc123-dereklomas-projects.vercel.app/')).toEqual({});
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-secret';
    delete process.env.VERCEL_URL;
    expect(selfCallHeaders('https://sourcelibrary-v2-abc123-dereklomas-projects.vercel.app/')).toEqual({});
    process.env.VERCEL_URL = 'x.vercel.app';
    expect(selfCallHeaders('not a url')).toEqual({});
  });
});
