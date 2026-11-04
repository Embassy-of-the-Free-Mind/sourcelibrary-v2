/**
 * #5274: an agy OCR read whose every image read the tool gate denied is not a read of the leaf. Seen 2026-11-04 on
 * 15 of 581 reads: the model asked for books/<page_id>/… instead of books/<book_id>/…, the gate denied it, and the
 * reply was a blank-page stub or an invented page (a Latin legal treatise written as a Dào Dé Jīng leaf's OCR).
 * The tool_calls arrays below are the recorded ones from that run.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { imageNeverOpened } from '../../scripts/lib/agy-cli.mjs';

describe('imageNeverOpened', () => {
  it('refuses an agy read whose only image read was denied', () => {
    expect(imageNeverOpened({ cli: 'agy', tool_calls: ['run_command:deny', 'read_file:deny'] })).toBe(true);
    expect(imageNeverOpened({ cli: 'agy', tool_calls: ['view_file:deny'] })).toBe(true);
    expect(imageNeverOpened({ cli: 'agy', tool_calls: [] })).toBe(true);
  });
  it('passes a read that opened the image, even after a denied turn', () => {
    expect(imageNeverOpened({ cli: 'agy', tool_calls: ['run_command:deny', 'read_file'] })).toBe(false);
    expect(imageNeverOpened({ cli: 'agy', tool_calls: ['read_file:deny', 'view_file'] })).toBe(false);
  });
  it('does not judge reads without a gate record or from another CLI', () => {
    expect(imageNeverOpened({ cli: 'agy' })).toBe(false);
    expect(imageNeverOpened({ cli: 'claude', tool_calls: [] })).toBe(false);
    expect(imageNeverOpened(null)).toBe(false);
  });
  it('cli-ocr apply checks it before writing a read', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
    const apply = src.slice(src.indexOf('for (const m of metas.sort('));
    const guard = apply.indexOf('if (imageNeverOpened(m))');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(apply.indexOf("collection('pages')"));
  });
});
