import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * #264 stage 2: a reference record for the sealed test-set frame is a reference only when it is the SAME edition
 * as our scan, it is not model-made and not a correction of our own output, its licence and holder are recorded,
 * and someone (a model or a human, named) looked at the image and the text together and found the same leaf.
 * `accepted` must say exactly that, so a scorer that reads `accepted` cannot score a record that fails a rule.
 * Records: scripts/eval/dataset/test-set-264/refs/<row>.json (+ .raw.txt, .txt). Every frame row a builder tried
 * has one line in refs/coverage.jsonl, so the coverage a cell reports is over the rows drawn, not the rows found.
 */
const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'scripts/eval/dataset/test-set-264');
const REFS = join(DIR, 'refs');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const frame = new Map(
  readFileSync(join(DIR, 'frame.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.row, r]),
);
const files = existsSync(REFS) ? readdirSync(REFS).filter((f) => f.endsWith('.json')) : [];
const recs = files.map((f) => ({ f, r: JSON.parse(readFileSync(join(REFS, f), 'utf8')) }));

export function rulesBroken(r: any): string[] {
  const out: string[] = [];
  if (!r.licence?.licence || !r.licence?.holder) out.push('licence');
  if (!r.leaf_check || !['ok', 'shifted', 'wrong-work', 'unchecked'].includes(r.leaf_check.status)) out.push('leaf_check shape');
  if (r.leaf_check?.status !== 'ok') out.push('leaf not ok');
  if (r.leaf_check?.status === 'ok' && (!r.leaf_check.by || !r.leaf_check.at)) out.push('leaf check without who/when');
  if (r.edition?.match !== 'same-edition') out.push('not same edition');
  if (!r.edition?.evidence) out.push('edition without evidence');
  if (r.made_by?.kind !== 'human' || r.made_by?.engine || /model-transcription/i.test(String(r.source))) out.push('model-made');
  if (r.own_output !== false || /corrected transcription|served ocr/i.test(String(r.source))) out.push('own output');
  if (typeof r.canonical !== 'boolean') out.push('canonical unset');
  return out;
}

describe('test-set #264 reference records', () => {
  it('there are records', () => {
    expect(recs.length).toBeGreaterThan(0);
  });

  it('accepted is true exactly when no rule is broken', () => {
    for (const { f, r } of recs) expect(r.accepted, `${f}: ${rulesBroken(r).join(', ')}`).toBe(rulesBroken(r).length === 0);
  });

  it('every record names a sealed frame row, and its page, image and cell are that row\'s', () => {
    for (const { f, r } of recs) {
      const row = frame.get(r.row);
      expect(row, `${f} names no frame row`).toBeTruthy();
      expect(f).toBe(`${r.row}.json`);
      expect(r.page_id).toBe(row.page_id);
      expect(r.book_id).toBe(row.book_id);
      expect(r.frame_cell).toBe(row.frame_cell);
      expect(r.reserve).toBe(row.reserve);
      expect(r.image_sha256).toBe(row.image?.sha256 ?? null);
    }
  });

  it('raw and normalised text are on disk and match their hashes; the unit is one leaf, not a volume', () => {
    for (const { f, r } of recs) {
      const raw = readFileSync(join(REFS, r.text.raw_file), 'utf8');
      const norm = readFileSync(join(REFS, r.text.file), 'utf8');
      expect(sha(raw), `${f} raw`).toBe(r.text.raw_sha256);
      expect(sha(norm), `${f} text`).toBe(r.text.sha256);
      expect(norm.length, `${f} empty`).toBeGreaterThan(0);
      expect(r.unit.chars, `${f} unit`).toBeLessThan(12000);
      for (const k of ['slug', 'source', 'source_url', 'source_revision', 'alignment', 'memorization_risk']) expect(r, `${f} ${k}`).toHaveProperty(k);
    }
  });

  it('a record that covers less than the whole image says what it leaves out', () => {
    // A Loeb spread keyed on the Greek side only, or a Kühn page without its Latin column: a scorer must know the
    // reference is part of the image (unit.covers), and which part is missing (unit.excludes).
    for (const { f, r } of recs) {
      const covers = r.unit?.covers ?? 'whole-page';
      if (covers !== 'whole-page') expect(r.unit.excludes?.length, `${f} covers ${covers} without excludes`).toBeGreaterThan(0);
    }
  });

  it('the guard rejects a record missing a licence, a leaf check or an edition match', () => {
    const good = recs.find(({ r }) => r.accepted)?.r;
    expect(good).toBeTruthy();
    expect(rulesBroken(good)).toEqual([]);
    expect(rulesBroken({ ...good, licence: { licence: 'CC0' } })).toContain('licence');
    expect(rulesBroken({ ...good, leaf_check: { status: 'unchecked' } })).toContain('leaf not ok');
    expect(rulesBroken({ ...good, leaf_check: { status: 'ok' } })).toContain('leaf check without who/when');
    expect(rulesBroken({ ...good, edition: { match: 'same-work-other-edition', evidence: 'x' } })).toContain('not same edition');
    expect(rulesBroken({ ...good, made_by: { kind: 'engine', engine: 'gemini' } })).toContain('model-made');
    expect(rulesBroken({ ...good, own_output: true })).toContain('own output');
  });

  it('coverage has one line per tried row per source, and every record is in it', () => {
    const cov = readFileSync(join(REFS, 'coverage.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const seen = new Set<string>();
    for (const c of cov) {
      expect(frame.has(c.row), `coverage row ${c.row}`).toBe(true);
      const k = `${c.row}|${c.source}`;
      expect(seen.has(k), `duplicate coverage ${k}`).toBe(false);
      seen.add(k);
    }
    for (const { r } of recs) {
      const c = cov.find((x) => x.row === r.row && x.source === r.source);
      expect(c, `${r.row} not in coverage`).toBeTruthy();
      expect(c.outcome === 'accepted').toBe(r.accepted);
    }
  });
});
