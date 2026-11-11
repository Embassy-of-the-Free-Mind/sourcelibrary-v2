import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// infrastructure/hetzner-crontab has been STALE since 2026-11-08 (#8283): main's live
// schedule is scripts/workers/crontab.production. Lines kept being added to the stale
// file anyway, and since nothing installs it they never ran: the nightly card-cover
// backfill (#6920), search suggestions (dead since 2026-03-31) and the public catalog
// CSV (dead since 2026-04-07) were found there on 2026-11-11 (#7057, #8549).
//
// This pins the file: its scheduled lines may be removed, never added. A new cron line
// belongs in scripts/workers/crontab.production (and on the box), not here.
const FROZEN_MAX_LINES = 61;

describe('stale infrastructure/hetzner-crontab', () => {
  it('gains no scheduled line', () => {
    const text = readFileSync(join(__dirname, '..', '..', 'infrastructure', 'hetzner-crontab'), 'utf8');
    const scheduled = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(
      scheduled.length,
      'infrastructure/hetzner-crontab is stale and never installed. Put the new line in scripts/workers/crontab.production, install it on main, and lower FROZEN_MAX_LINES if you removed lines here.',
    ).toBeLessThanOrEqual(FROZEN_MAX_LINES);
  });
});
