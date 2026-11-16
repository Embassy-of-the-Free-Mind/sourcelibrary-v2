import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * #264: the OCR test-set frame is sealed. It was drawn once (seed in scripts/eval/test-set-264/seed.mjs, 2026-11-13);
 * a sealed row is never re-drawn, edited or removed (eval-design 3.4). A later stage records what it finds about a
 * page in that row's `checks`, which is the one change this pin allows (the pin leaves `checks` out, so appending to
 * it passes; anything else fails).
 *
 * The pin is over every row WITHOUT its `checks` array, so a changed page, image, cell, reserve flag or truth source
 * fails here; frame.meta.json and the public aggregates must name the same file.
 */
const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'scripts/eval/dataset/test-set-264');
const SEALED_ROWS_SHA256 = 'dde996830a28836fdb6dc26be18a386a83c2a29167c0d96b6a5f038ebf5dba80';
const SEALED_ROWS = 1990;

const body = readFileSync(join(DIR, 'frame.jsonl'), 'utf8');
const rows = body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const meta = JSON.parse(readFileSync(join(DIR, 'frame.meta.json'), 'utf8'));
const pub = JSON.parse(readFileSync(join(ROOT, 'src/data/test-set-264.json'), 'utf8'));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('test-set frame #264 is sealed', () => {
  it('rows, apart from their checks, are the rows sealed on 2026-11-13', () => {
    expect(rows.length).toBe(SEALED_ROWS);
    const frozen = rows.map(({ checks: _checks, ...r }) => JSON.stringify(r)).join('\n');
    expect(sha(frozen)).toBe(SEALED_ROWS_SHA256);
  });

  it('meta records the seed, the draw date and this file', () => {
    expect(meta.seed).toBe('test-set-264/2026-11-13');
    expect(meta.drawn_at).toMatch(/^2026-11-13T/);
    expect(meta.rows).toBe(rows.length);
    if (rows.every((r) => r.checks.length === 0)) expect(meta.frame_sha256).toBe(sha(body));
    expect(pub.seed).toBe(meta.seed);
  });

  it('one page per book per cell, reserve only on drawn rows, every row has the fields a score needs', () => {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = `${r.frame_cell}|${r.book_id}`;
      expect(seen.has(k), `second page of ${k}`).toBe(false);
      seen.add(k);
      if (r.reserve) expect(r.drawn).toBe(true);
      for (const f of ['row', 'book_id', 'page_id', 'frame_cell', 'router_cell', 'image', 'observed', 'canonical', 'licence']) expect(r, `${r.row} ${f}`).toHaveProperty(f);
      expect(Array.isArray(r.checks)).toBe(true);
      expect(r.observed.by === null || typeof r.observed.by === 'string').toBe(true);
    }
  });

  it('the public aggregates carry no page id and no reserve row', () => {
    const text = JSON.stringify(pub);
    for (const r of rows.filter((x) => x.reserve)) expect(text.includes(r.page_id), `reserve page ${r.row} published`).toBe(false);
    expect(text).not.toMatch(/"page_id"/);
  });
});
