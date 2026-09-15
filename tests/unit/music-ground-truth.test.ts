import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
// @ts-expect-error — plain .mjs script, no types; it only runs its CLI body when invoked directly
import { notesFromAbc } from '../../scripts/music/eval-transcription.mjs';

/**
 * Guards the music ground truth — the references every transcription number is
 * measured against (`scripts/music/eval-results/*`, issue #3161).
 *
 * A broken reference does not fail loudly. It scores. The scorer compares the
 * notes abcjs would PLAY, so a reference that parses differently than its
 * author intended silently changes every metric computed against it from then
 * on, in a direction nobody can see from the numbers. Two ways that happens,
 * both cheap to assert and neither visible on inspection:
 *
 *   - A repeat mark. `:|` makes abcjs play the enclosed bars twice, so the
 *     reference carries a note sequence its author never wrote and a correct
 *     candidate scores ~0.5. References write `||`; the run script normalises
 *     repeats out of candidates for the same reason.
 *   - A typo that still parses. abcjs is forgiving; it reports warnings rather
 *     than throwing, and the CLI prints them where nobody reads them.
 *
 * The manifest is the index the eval and the Mongo sync both read, so an .abc
 * missing from it is invisible to both, and an entry pointing at a missing file
 * makes `sync-ground-truth.mjs` throw mid-run.
 *
 * Negative control, run 2026-09-12 — what these assertions DO and DO NOT catch,
 * measured rather than assumed:
 *   caught — a typo'd pitch letter ("H4" → "Unknown character ignored"), a
 *     malformed header, a body that parses to no tune, a repeat mark, an .abc
 *     missing from the manifest or an entry pointing at a missing file.
 *   NOT caught by abcjs warnings — an unclosed slur (harmless: the scorer reads
 *     only pitch and duration, so slurs cannot move a metric) and a MISSING
 *     `K:` header (not harmless: the key changes pitches silently), which is
 *     why the required headers are asserted explicitly below rather than left
 *     to the parser.
 * Re-run the control if you change these assertions: break a reference, watch
 * the case go red, restore it.
 */

const GT = path.resolve(__dirname, '../../scripts/music/ground-truth');

type ManifestItem = {
  id: string;
  kind: string;
  file: string | null;
  book_id?: string;
  page_id?: string;
  page_number?: number;
  notation_system?: string;
  title?: string;
  span?: string;
  verified?: string;
};

const manifest = JSON.parse(readFileSync(path.join(GT, 'manifest.json'), 'utf8')) as {
  items: ManifestItem[];
};
const references = manifest.items.filter((x) => x.kind === 'reference');
const abcFiles = readdirSync(GT).filter((f) => f.endsWith('.abc'));

describe('music ground truth', () => {
  it('has at least one reference, so the suite cannot pass vacuously', () => {
    expect(abcFiles.length).toBeGreaterThan(0);
    expect(references.length).toBeGreaterThan(0);
  });

  it('indexes every .abc file in the manifest, and every indexed file exists', () => {
    const indexed = references.map((r) => r.file).filter(Boolean).sort();
    expect(indexed).toEqual(abcFiles.sort());
  });

  describe.each(abcFiles)('%s', (file) => {
    const abc = readFileSync(path.join(GT, file), 'utf8');

    it('parses as a tune with notes and zero abcjs warnings', () => {
      const { voices, warnings } = notesFromAbc(abc);
      expect(warnings).toEqual([]);
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].length).toBeGreaterThan(0);
    });

    it('declares the headers the scorer depends on (abcjs does not warn when K: is absent)', () => {
      for (const header of ['X:', 'T:', 'L:', 'K:']) {
        expect(abc, `${file}: missing ${header} header`).toMatch(new RegExp(`^${header}`, 'm'));
      }
    });

    it('carries no repeat mark (a repeat doubles the played sequence)', () => {
      const body = abc
        .split('\n')
        .filter((l) => !/^[A-Za-z]:/.test(l))
        .join('\n');
      expect(body).not.toMatch(/:\||\|:/);
    });

    it('is described by a manifest entry with the fields the eval and sync need', () => {
      const entry = references.find((r) => r.file === file);
      expect(entry, `no manifest entry for ${file}`).toBeDefined();
      for (const field of ['id', 'book_id', 'page_id', 'notation_system', 'title', 'span'] as const) {
        expect(entry![field], `${file}: manifest entry is missing ${field}`).toBeTruthy();
      }
      // `verified` is what makes it a reference rather than a draft; it must say
      // what was checked, not merely that something was.
      expect(entry!.verified?.length ?? 0).toBeGreaterThan(40);
    });
  });
});
