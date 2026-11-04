import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertOne = vi.fn();
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({ collection: () => ({ insertOne }) }),
}));
vi.mock('@/lib/tenant-context', () => ({
  resolveTenantId: async (slug: string) => (slug === 'bph' ? 'bph-tenant' : null),
}));
vi.mock('@/lib/book-access', () => ({
  hasCronAuth: (request: Request) => request.headers.get('x-cron') === '1',
}));
vi.mock('@/lib/partner-embed-download-server', () => ({
  anonymousDownloadCapKey: () => 'anon-ip:hash',
}));

import { partnerTermsRefusal } from '@/lib/partner-terms';
import { PARTNER_TERMS_VERSION } from '@/lib/partner-terms-version';

const request = (query = '', headers: Record<string, string> = {}) =>
  new Request(`https://sourcelibrary.org/api/books/b/download?format=ocr${query}`, { headers });
const bph = { id: 'b', tenantId: 'bph-tenant' };
const ask = { userId: null, format: 'ocr' };

describe('partnerTermsRefusal', () => {
  beforeEach(() => {
    insertOne.mockReset();
    delete process.env.PARTNER_TERMS_ENFORCE;
    delete process.env.BPH_BOT_GATE_ENFORCE;
  });

  it('asks, with the version to send back, when a protected book has no agreement', async () => {
    const res = await partnerTermsRefusal(request(), bph, ask);
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body.terms_required).toBe(true);
    expect(body.terms_version).toBe(PARTNER_TERMS_VERSION);
    expect(body.terms_url).toContain('/terms#embassy-collection');
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('asks again when the agreement was to an older version', async () => {
    expect((await partnerTermsRefusal(request('&terms=2020-01-01'), bph, ask))?.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('records the agreement and lets the download go', async () => {
    const res = await partnerTermsRefusal(
      request(`&terms=${PARTNER_TERMS_VERSION}`, { referer: 'https://sourcelibrary.org/embed/bph/book/b', host: 'sourcelibrary.org' }),
      bph,
      { userId: 'u1', format: 'ocr' },
    );
    expect(res).toBeNull();
    expect(insertOne).toHaveBeenCalledTimes(1);
    const row = insertOne.mock.calls[0][0];
    expect(row).toMatchObject({ terms_version: PARTNER_TERMS_VERSION, book_id: 'b', format: 'ocr', surface: 'embed', user_id: 'u1' });
    // Evidence of who agreed, never the address itself.
    expect(JSON.stringify(row)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('does not cost a reader the download when the record cannot be written', async () => {
    insertOne.mockRejectedValueOnce(new Error('down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await partnerTermsRefusal(request(`&terms=${PARTNER_TERMS_VERSION}`), bph, ask)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('leaves every other book alone', async () => {
    expect(await partnerTermsRefusal(request(), { id: 'x', tenantId: 'other' }, ask)).toBeNull();
    expect(await partnerTermsRefusal(request(), { id: 'x' }, ask)).toBeNull();
    expect(await partnerTermsRefusal(request(), null, ask)).toBeNull();
  });

  it('leaves the pipeline alone, and has a switch', async () => {
    expect(await partnerTermsRefusal(request('', { 'x-cron': '1' }), bph, ask)).toBeNull();
    process.env.PARTNER_TERMS_ENFORCE = '0';
    expect(await partnerTermsRefusal(request(), bph, ask)).toBeNull();
  });
});
