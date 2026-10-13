import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { textVerdict } from '../../scripts/lib/first-ocr-guard.mjs';

// Served Yigdzin reads from #5660 shard 0, each labelled by eye against its page image (read-from-image).
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/first-ocr-guard-5660.json'), 'utf8'));

describe('first-ocr-guard: the three gate-0 inventions are flagged (#5660)', () => {
  it('blank leaf read as shad noise + two syllables', () => expect(textVerdict(fx.blank).flags).toContain('punct_noise'));
  it('title leaf + repeated དགེའོ', () => expect(textVerdict(fx.title).flags).toContain('dominant_unit'));
  it('cursive loop with variation in one line', () => expect(textVerdict(fx.cursive).flags).toContain('line_loop'));
  it('a dge slong / dge\'o tail appended after real lines', () => expect(textVerdict(fx.tail_loop).flags).toContain('local_loop'));
});

describe('first-ocr-guard: genuine repetition is not flagged', () => {
  it('a red-ink Prajñāpāramitā leaf (པ = 21 % of syllables) passes', () => expect(textVerdict(fx.pp_clean).flag).toBe(false));
  it('an ordinary two-leaf manuscript page passes', () => expect(textVerdict(fx.ms_clean).flag).toBe(false));
});
