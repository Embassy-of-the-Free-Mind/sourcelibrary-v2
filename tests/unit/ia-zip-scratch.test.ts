// IA item-zip scratch cleanup (#90 item 5): a dir whose owner died goes at once; an item whose
// zip attempts keep dying is refused after three, so the lane stops downloading it again.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sweepStaleZipDirs, unfinishedZipAttempts, noteZipAttempt, clearZipAttempt, openIaZip } from '../../scripts/lib/ia-zip-ledger.mjs';

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iazip-t-'));
const mkdir = (r: string, name: string, pid?: number) => {
  const d = path.join(r, name);
  fs.mkdirSync(d);
  if (pid !== undefined) fs.writeFileSync(path.join(d, '.owner-pid'), String(pid));
  return d;
};

describe('sweepStaleZipDirs', () => {
  it('removes a fresh dir whose owner is dead, keeps one whose owner is alive', () => {
    const r = root();
    const dead = mkdir(r, 'sl-iazip-a-1', 999001);
    const live = mkdir(r, 'sl-iazip-b-2', 999002);
    const n = sweepStaleZipDirs(r, { isAlive: (pid: number) => pid === 999002 });
    expect(n).toBe(1);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
  });
  it('keeps the age rule for a dir with no owner file, and never touches the attempts file', () => {
    const r = root();
    const d = mkdir(r, 'sl-iazip-c-3');
    noteZipAttempt(r, 'item-c');
    expect(sweepStaleZipDirs(r, { isAlive: () => false })).toBe(0);
    expect(sweepStaleZipDirs(r, { now: Date.now() + 7 * 3600_000, isAlive: () => false })).toBe(1);
    expect(fs.existsSync(d)).toBe(false);
    expect(unfinishedZipAttempts(r, 'item-c')).toBe(1);
  });
});

describe('unfinished zip attempts', () => {
  it('counts per item, clears on close, and forgets after 24 h', () => {
    const r = root();
    noteZipAttempt(r, 'x'); noteZipAttempt(r, 'x'); noteZipAttempt(r, 'y');
    expect(unfinishedZipAttempts(r, 'x')).toBe(2);
    clearZipAttempt(r, 'x');
    expect(unfinishedZipAttempts(r, 'x')).toBe(0);
    expect(unfinishedZipAttempts(r, 'y')).toBe(1);
    expect(unfinishedZipAttempts(r, 'y', { now: Date.now() + 25 * 3600_000 })).toBe(0);
  });
  it('openIaZip refuses an item after three unfinished attempts, before any request', async () => {
    const r = root();
    const id = 'bim_early-english-books-1475-1640_a-conc';
    for (let i = 0; i < 3; i++) noteZipAttempt(r, id);
    const reasons: string[] = [];
    let fetched = 0;
    const z = await openIaZip({
      manifestUrl: `https://iiif.archive.org/iiif/3/${id}/manifest.json`,
      photos: [], tmpRoot: r, onRefuse: (why: string) => reasons.push(why),
      fetchImpl: (async () => { fetched++; throw new Error('no network in tests'); }) as unknown as typeof fetch,
    });
    expect(z).toBeNull();
    // On a box without opj_decompress/unzip the tool check refuses first; either way nothing is fetched.
    expect(reasons[0]).toMatch(/never finished|opj_decompress/);
    expect(fetched).toBe(0);
  });
});
