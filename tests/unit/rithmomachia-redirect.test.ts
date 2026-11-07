/**
 * /rithmomachia hands readers to the standalone game (#7821), on the main site
 * only. A tenant host serves global routes directly, and next.config redirects
 * run before the proxy, so an unscoped rule here would send a partner's visitor
 * off their subdomain with nothing in src/proxy.ts to stop it.
 *
 * Matches with Next's own matcher, so the host pattern is tested as it runs.
 */
import { describe, expect, it } from 'vitest';
import type { BaseNextRequest } from 'next/dist/server/base-http';
import { matchHas } from 'next/dist/shared/lib/router/utils/prepare-destination';
import nextConfig from '../../next.config';

const PATHS = ['/rithmomachia', '/rithmomachia/guide', '/rithmomachia/scenarios'];

async function redirectFor(source: string, host: string) {
  const rules = (await nextConfig.redirects!()).filter((r) => r.source === source);
  const req = { headers: { host }, url: source } as unknown as BaseNextRequest;
  return rules.find((r) => matchHas(req, {}, r.has, r.missing));
}

describe('Rithmomachia redirect (#7821)', () => {
  for (const path of PATHS) {
    it(`${path} leaves the main site for the standalone game`, async () => {
      for (const host of ['sourcelibrary.org', 'www.sourcelibrary.org']) {
        const rule = await redirectFor(path, host);
        expect(rule?.destination).toMatch(/^https:\/\/rithmomachia-game\.vercel\.app\//);
      }
    });

    it(`${path} never redirects a tenant host off its subdomain`, async () => {
      for (const host of ['bph.sourcelibrary.org', 'bhutan.sourcelibrary.org']) {
        expect(await redirectFor(path, host)).toBeUndefined();
      }
    });
  }
});
