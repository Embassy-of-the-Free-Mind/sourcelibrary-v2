/**
 * The archiver host-lane table (#5448 step 4): scripts/catalog-coverage/archive-lanes.json.
 *
 * PRIOR ART: tests/unit/lanes-registry.test.ts guards the pipeline lane registry (which code paths do
 * work), not which hosts an archiver drains at what rate; the hand-kept /etc conf this replaces had
 * no test at all.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getDomainLimit, gallicaOpenApiUrl, upgradeToFullRes } from '../../scripts/lib/iiif-utils.mjs';
import {
  loadLaneTable, laneTableProblems, confLines, laneArgs, thisBox, FROZEN_HOSTS,
} from '../../scripts/catalog-coverage/archive-lanes.mjs';

const ROOT = path.resolve(__dirname, '../..');
const domainLimitOf = (h: string) => getDomainLimit(`https://${h}/x`);
const table = loadLaneTable();

describe('archive lane table (#5448)', () => {
  it('is valid: rates within DOMAIN_LIMITS, one lane per host, no MDZ lane, boxes within budget', () => {
    expect(laneTableProblems(table, { domainLimitOf })).toEqual([]);
  });

  it('refuses the shapes it exists to refuse', () => {
    const base = { name: 'x', box: 'main', hosts: ['a.example.org'], providers: ['p'], rate: { 'a.example.org': 1 }, page_concurrency: 1 };
    const t = (lanes: any[], budget: any = { main: 4 }) => laneTableProblems({ box_page_budget: budget, lanes }, { domainLimitOf: () => 2 });
    expect(t([{ ...base, rate: { 'a.example.org': 3 } }]).join()).toMatch(/above its DOMAIN_LIMITS/);
    expect(t([base, { ...base, name: 'y' }]).join()).toMatch(/already belongs to lane x/);
    expect(t([{ ...base, hosts: [FROZEN_HOSTS[0]], rate: { [FROZEN_HOSTS[0]]: 1 } }]).join()).toMatch(/frozen/);
    expect(t([{ ...base, page_concurrency: 3 }, { ...base, name: 'y', hosts: ['b.example.org'], rate: { 'b.example.org': 1 }, page_concurrency: 2 }]).join()).toMatch(/over its budget/);
    expect(t([{ ...base, box: 'nowhere' }]).join()).toMatch(/no page budget/);
    expect(t([{ ...base, flags: ['--raise-rate'] }]).join()).toMatch(/unknown flag/);
    expect(t([{ ...base, rate: {} }]).join()).toMatch(/give every host a rate/);
  });

  it('names a lane for every host the 2026-10-25 plan asked for, MDZ excepted', () => {
    const hosts = new Set(table.lanes.flatMap((l: any) => l.hosts));
    for (const h of ['iiif.archive.org', 'www.e-rara.ch', 'content.staatsbibliothek-berlin.de', 'images.sub.uni-goettingen.de', 'www.nb.no', 'api.nb.no', 'mps.lib.harvard.edu', 'gallica.bnf.fr']) {
      expect(hosts.has(h), h).toBe(true);
    }
    expect(hosts.has('api.digitale-sammlungen.de')).toBe(false);
  });

  it('turns a row into archive-acquired flags that the script actually parses', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/catalog-coverage/archive-acquired.ts'), 'utf8');
    for (const flag of ['providers', 'hosts', 'host-rate']) expect(src).toContain(`listArg('${flag}')`);
    for (const flag of ['--gallica-openapi', '--lazy-only']) expect(src).toContain(`process.argv.includes('${flag}')`);
    const g = table.lanes.find((l: any) => l.name === 'gallica');
    expect(laneArgs(g)).toBe('--providers gallica --hosts gallica.bnf.fr --host-rate openapi.bnf.fr=2 --gallica-openapi');
    for (const line of confLines(table, 'l7a')) expect(line).toMatch(/^[a-z0-9-]+\|[1-8]\|--providers \S+ --hosts \S+/);
    expect(confLines(table, 'mac')).toHaveLength(1);
  });

  it('box from the hostname, as the job wrapper decides it', () => {
    expect(thisBox({}, 'earthai-l7a')).toBe('l7a');
    expect(thisBox({}, 'gex45-1')).toBe('gex45');
    expect(thisBox({}, 'some-hetzner')).toBe('main');
    expect(thisBox({ ARCHIVE_LANES_BOX: 'mac' }, 'earthai-l7a')).toBe('mac');
  });

  it('gallica via openapi.bnf.fr: only full-region page URLs are rewritten, to Image API 3.0 `max`', () => {
    expect(gallicaOpenApiUrl(upgradeToFullRes('https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8728543t/f112/full/full/0/default.jpg')))
      .toBe('https://openapi.bnf.fr/iiif/image/v3/ark:/12148/bpt6k8728543t/f112/full/max/0/default.jpg');
    expect(gallicaOpenApiUrl('https://gallica.bnf.fr/iiif/ark:/12148/x/f1/0,0,10,10/full/0/default.jpg')).toBe('https://gallica.bnf.fr/iiif/ark:/12148/x/f1/0,0,10,10/full/0/default.jpg');
    expect(gallicaOpenApiUrl('https://example.org/a.jpg')).toBe('https://example.org/a.jpg');
    expect(getDomainLimit('https://openapi.bnf.fr/x')).toBeLessThanOrEqual(getDomainLimit('https://gallica.bnf.fr/x'));
  });

  it('the watchdog keeps a blocked lane down, and archive-lane.sh writes the marker it reads', () => {
    const revive = fs.readFileSync(path.join(ROOT, 'scripts/catalog-coverage/archive-lanes-revive.sh'), 'utf8');
    const lane = fs.readFileSync(path.join(ROOT, 'scripts/catalog-coverage/archive-lane.sh'), 'utf8');
    expect(revive).toContain('archive-lanes.mjs" --conf');
    expect(revive).toMatch(/if \[ -f "\$STATE\/\$name\.blocked" \]/);
    expect(lane).toMatch(/> "\$STATE\/\$LANE\.blocked"/);
  });
});
