/**
 * #5564 — "a rule broken twice becomes a check". A bare `/<[^>]+>/g` over OCR or
 * translation text deletes the body after a `->centred<-` line (the `<-` opens a
 * "tag" that runs to the next `>`). It was fixed once in translate-write.ts
 * (#5105) and survived in a dozen other places. Use `stripMarkupTags` from
 * src/lib/strip-markup-tags.ts (or scripts/lib/strip-markup-tags.mjs) instead.
 *
 * This fails when a NEW bare pattern appears in src/lib, scripts/lib or
 * scripts/eval/lib. Files already carrying one are listed below with why; shrink
 * the list when you fix one, never grow it without a reason.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['src/lib', 'scripts/lib', 'scripts/eval/lib'];
const BARE = '/<[^>]+>/g';

const ALLOW: Record<string, string> = {
  'src/lib/strip-markup-tags.ts': 'the helper itself (markers removed first)',
  'scripts/lib/strip-markup-tags.mjs': 'the helper itself (markers removed first)',
  'src/lib/strip-editorial-wrappers.ts': 'mentioned in a comment only',
  'scripts/eval/lib/wikisource-text.mjs': 'Wikisource wikitext/HTML references, never OCR output',
  // Follow-ups for #5564: these do run over OCR/translation text but were outside
  // the first pass. Remove each line as it is switched to stripMarkupTags.
  'scripts/lib/language-content-classify.mjs': 'follow-up #5564',
  'scripts/lib/ocr-plausibility.mjs': 'follow-up #5564',
  'scripts/lib/page-embedding-text.mjs': 'follow-up #5564',
  'scripts/lib/page-terms-parse.mjs': 'follow-up #5564',
  'scripts/lib/syriac-kraken-lane.mjs': 'follow-up #5564 (Syriac Kraken output, no centring markers expected)',
  'scripts/lib/title-page-ocr.mjs': 'follow-up #5564',
  'scripts/lib/translate-batch-chained.mjs': 'follow-up #5564',
  'scripts/lib/translit-skeleton.mjs': 'follow-up #5564',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders = (): string[] =>
  DIRS.flatMap(d => walk(path.join(ROOT, d)))
    .filter(f => fs.readFileSync(f, 'utf8').includes(BARE))
    .map(f => path.relative(ROOT, f).split(path.sep).join('/'));

describe('no new bare /<[^>]+>/g tag strip (#5564)', () => {
  it('every file carrying the bare pattern is on the allow-list', () => {
    expect(offenders().filter(f => !(f in ALLOW))).toEqual([]);
  });

  it('positive control: the scan finds the helper itself', () => {
    expect(offenders()).toContain('src/lib/strip-markup-tags.ts');
  });

  it('allow-list carries no stale entries', () => {
    const found = new Set(offenders());
    expect(Object.keys(ALLOW).filter(f => !found.has(f))).toEqual([]);
  });
});
