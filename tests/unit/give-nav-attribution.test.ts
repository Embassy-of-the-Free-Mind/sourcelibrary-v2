import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_EVENTS, ALLOWED_PROPS } from '@/lib/analytics-event-allowlist';

/**
 * Guards the only measurement that can attribute a visit to /give.
 *
 * The referrer cannot do it, in two independent ways: `/api/track` collapses
 * self-referrals to 'direct' (`if (hostname !== SITE_HOST)`), and Next's
 * client-side navigation leaves `document.referrer` as the ORIGINAL external
 * referrer. Measured 2026-08-07, /give had 7 visits — 4 'direct', 3 Google — and
 * not one could be attributed to the header pill or to a stranger typing the URL.
 *
 * So the event has to be fired AT the control, and if a refactor drops the
 * onClick the loss is silent: the page still works, the link still navigates, and
 * the funnel just reads zero forever — indistinguishable from nobody clicking,
 * which is exactly the question it exists to answer.
 *
 * The payload assertions run the REAL allowlists, so an event or prop that the
 * route would silently drop fails here rather than weeks later.
 */

const SRC = join(__dirname, '../../src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// Strip comments before matching: this file's own subject is heavily commented,
// and prose ABOUT the call must not satisfy a check for the call.
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('give_nav_click survives the analytics allowlist', () => {
  it('the event name is accepted by the route', () => {
    expect(ALLOWED_EVENTS.has('give_nav_click')).toBe(true);
  });

  it('both props it carries are persisted, not silently dropped', () => {
    for (const key of ['source', 'url']) {
      expect(ALLOWED_PROPS.has(key), `prop "${key}" is not allowlisted`).toBe(true);
    }
  });
});

describe('both giving controls are instrumented', () => {
  // Asserted as a composite string so the call cannot be satisfied by the token
  // appearing somewhere else in the file — the failure mode that let two earlier
  // guards in this repo pass with the code they guarded deleted (#3484/#3488).
  it('the header Support pill fires give_nav_click with source=header', () => {
    const header = code('components/layout/SiteHeader.tsx');
    expect(header).toMatch(
      /trackEvent\(\s*['"]give_nav_click['"]\s*,\s*\{[^}]*source:\s*['"]header['"]/,
    );
  });

  it('the footer Support link fires give_nav_click with source=footer', () => {
    const footer = code('components/layout/GlobalFooter.tsx');
    expect(footer).toMatch(
      /trackEvent\(\s*['"]give_nav_click['"]\s*,\s*\{[^}]*source:\s*['"]footer['"]/,
    );
  });

  it('each control records its DESTINATION, because the two differ', () => {
    // header pill → /give, footer link → /support. Merging them would average two
    // pages with different conversion odds into one meaningless rate.
    expect(code('components/layout/SiteHeader.tsx')).toMatch(
      /trackEvent\(\s*['"]give_nav_click['"][^)]*url:\s*['"]\/give['"]/,
    );
    expect(code('components/layout/GlobalFooter.tsx')).toMatch(
      /trackEvent\(\s*['"]give_nav_click['"][^)]*url:\s*link\.href/,
    );
  });

  it('the pill still points at /give — the event is worthless if the href moves', () => {
    expect(code('components/layout/SiteHeader.tsx')).toMatch(/href="\/give"/);
  });
});

describe('the transport can survive the navigation it triggers', () => {
  it('trackEvent uses sendBeacon', () => {
    // A plain fetch is cancelled when the click navigates away, so every one of
    // these events would be lost in flight — the instrument would read zero for a
    // reason that has nothing to do with readers.
    expect(code('lib/track-event.ts')).toMatch(/navigator\.sendBeacon/);
  });

  it('give_nav_click is a declared event type on trackEvent', () => {
    expect(code('lib/track-event.ts')).toMatch(/\|\s*['"]give_nav_click['"]/);
  });
});
