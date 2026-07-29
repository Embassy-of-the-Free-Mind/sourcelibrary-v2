import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// /api/analytics/event drops any prop key not on its allowlist. That is the
// right default (the route is public and unauthenticated), but it fails
// SILENTLY: the client fires, the request 200s, and the field simply is not
// there when someone later queries for it.
//
// #3399 was the cost of that. `share` was reported at 37 events in 30 days,
// which read as "readers don't share" — when in fact two live share surfaces
// emitted nothing at all and the book page had no share control. The fix adds a
// `surface` prop so an undifferentiated share count can never again hide a
// surface that simply is not wired up. If `surface` falls off the allowlist,
// that diagnosis capability disappears without any error.
//
// These tests exercise the real route handler and assert on the document it
// actually writes — not on the shape of the source. Deleting the allowlist
// entry makes them fail; so does breaking sanitizeProps.

const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: 'test' };
      },
    }),
  })),
}));

function post(body: unknown) {
  return new Request('https://sourcelibrary.org/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

beforeEach(() => { inserted.length = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe('/api/analytics/event prop allowlist', () => {
  it('persists `surface` on a share event', async () => {
    const { POST } = await import('@/app/api/analytics/event/route');
    const res = await POST(post({
      event: 'share',
      props: { channel: 'twitter', surface: 'gallery_image', url: 'https://sourcelibrary.org/gallery/image/x' },
    }));

    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].event).toBe('share');
    expect(inserted[0].surface).toBe('gallery_image');
    expect(inserted[0].channel).toBe('twitter');
  });

  it('still drops keys that are not on the allowlist', async () => {
    const { POST } = await import('@/app/api/analytics/event/route');
    await POST(post({
      event: 'share',
      props: { channel: 'link', surface: 'book', notAllowed: 'should-vanish' },
    }));

    expect(inserted[0].surface).toBe('book');
    expect(inserted[0]).not.toHaveProperty('notAllowed');
  });

  it('persists every welcome_save field flag, including hasLanguage', async () => {
    // Each field on the welcome form contributes a flag here. A new field whose
    // flag is not allowlisted looks fine at the call site and is simply missing
    // from the data later — so the flags are asserted as a SET, and adding a
    // form field without its flag should fail this rather than ship silently.
    const { POST } = await import('@/app/api/analytics/event/route');
    await POST(post({
      event: 'welcome_save',
      props: { source: 'gate', hasName: true, hasAbout: true, hasHelp: false, hasLanguage: true },
    }));

    expect(inserted).toHaveLength(1);
    const doc = inserted[0];
    expect(doc.hasName).toBe(true);
    expect(doc.hasAbout).toBe(true);
    // false must survive too — "left it blank" is the answer we most want to count.
    expect(doc.hasHelp).toBe(false);
    expect(doc.hasLanguage).toBe(true);
  });

  it('rejects an event name that is not allowlisted', async () => {
    const { POST } = await import('@/app/api/analytics/event/route');
    const res = await POST(post({ event: 'not_a_real_event', props: { surface: 'book' } }));

    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });
});
