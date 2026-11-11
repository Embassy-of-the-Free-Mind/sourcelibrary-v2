import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';

// #8150 slice 8: traced bulk copies. Dark unless TRACED_COPIES=on; never on
// anonymous readers, reader pages or single quotes; the public decoder says a
// signed reference exists and never whose.
const SECRET = 'test-provenance-key-slice-8';

type Prov = typeof import('@/lib/provenance');
type Trace = typeof import('@/lib/trace-ref');
type Dec = typeof import('@/lib/mark-decoder');
let prov: Prov, trace: Trace, dec: Dec;

const BOOK = '6a3cbb6a3dce6cfad74a385c';
const TEXT =
  'The Philosophers Stone is nothing else but the matter of the wise, ' +
  'decocted unto perfect fixity. Whosoever hath eyes to see, let him read. ' +
  'For the work is one, and the vessel is one, and the fire is one.';

beforeAll(async () => {
  vi.stubEnv('PROVENANCE_SECRET_KEY', SECRET);
  vi.resetModules();
  prov = await import('@/lib/provenance');
  trace = await import('@/lib/trace-ref');
  dec = await import('@/lib/mark-decoder');
});
afterEach(() => { vi.stubEnv('TRACED_COPIES', ''); });

describe('switch', () => {
  it('is off by default: no ref for anyone', () => {
    expect(trace.traceRefFor({ userId: 'u1', apiKeyId: 'k1' })).toBeUndefined();
  });
  it('when on: none for an anonymous caller, stable and opaque for an account', () => {
    vi.stubEnv('TRACED_COPIES', 'on');
    expect(trace.traceRefFor({})).toBeUndefined();
    const a = trace.traceRefFor({ userId: '65f0c0ffee0000000000abcd' })!;
    expect(a).toMatch(/^SLA-[0-9a-f]{10}$/);
    expect(a).not.toContain('65f0');
    expect(trace.traceRefFor({ userId: '65f0c0ffee0000000000abcd' })).toBe(a);
    expect(trace.traceRefFor({ userId: 'someone-else' })).not.toBe(a);
    // a key wins over the session it belongs to
    expect(trace.traceRefFor({ userId: 'u1', apiKeyId: 'k1' })).toBe(trace.accountRefFor('key', 'k1', SECRET));
  });
});

describe('markForExport inside and outside the scope', () => {
  const ref = 'SLA-0123456789';

  it('no scope (reader pages, quotes): the same bytes as before', () => {
    expect(prov.markForExport(TEXT, BOOK)).toBe(trace.runWithTraceRef(undefined, () => prov.markForExport(TEXT, BOOK)));
    const v = prov.verifyExport(prov.markForExport(TEXT, BOOK));
    expect(v?.message ?? '').not.toMatch(trace.ACCOUNT_REF_PATTERN);
  });

  it('in scope: every passage carries the ref, and it survives awaits and a detached writer', async () => {
    const seen: string[] = [];
    await trace.runWithTraceRef(ref, async () => {
      seen.push(prov.markForExport(TEXT, BOOK));
      await new Promise(r => setTimeout(r, 5));
      seen.push(prov.markForExport(TEXT + ' Second page.', BOOK));
      // the PDF builders start an async writer inside the call and return
      (async () => { await new Promise(r => setTimeout(r, 5)); seen.push(prov.markForExport(TEXT + ' Third.', BOOK)); })();
    });
    await new Promise(r => setTimeout(r, 30));
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      const v = prov.verifyExport(s)!;
      expect(v.authentic).toBe(true);
      expect(v.message).toContain(ref);
    }
    // and outside the scope again, nothing
    expect(prov.verifyExport(prov.markForExport(TEXT, BOOK))?.message ?? '').not.toContain(ref);
  });

  it('an explicit ref (bot campaign, pool) still wins over the scope', () => {
    const s = trace.runWithTraceRef(ref, () => prov.markForExport(TEXT, BOOK, { ref: 'SL-deadbeef-2026-11' }));
    expect(prov.verifyExport(s)!.message).toContain('SL-deadbeef-2026-11');
  });
});

describe('public decoder', () => {
  it('says a signed reference exists, and the ref names nobody', () => {
    const s = trace.runWithTraceRef('SLA-abcdef0123', () => prov.markForExport(TEXT, BOOK));
    const r = dec.decodePastedText(s);
    expect(r.status).toBe('authentic');
    expect(r.signedReference).toBe(true);
    expect(dec.decodePastedText(prov.markForExport(TEXT, BOOK)).signedReference).toBe(false);
  });
});

describe('where the scope is opened', () => {
  it('only the two download routes open it (never a reader or quote route)', () => {
    const files = execSync("git grep -l 'runWithTraceRef(' -- src", { encoding: 'utf8' }).trim().split('\n').sort();
    expect(files).toEqual([
      'src/app/api/[tenant]/books/[id]/download/route.ts',
      'src/app/api/books/[id]/download/route.ts',
    ]);
  });
});
