/**
 * In-copyright reference texts may be scored but never published (#5488).
 *
 * This repo is public. A reference built from a modern edition or translation keeps only its
 * RECORD here (licence, edition, text_sha256); the text lives in the private ops repo. These tests
 * fail CI if the text slips into the repo, and prove the guard can fire (positive control) and that
 * the loader refuses a private text whose hash does not match its public record.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-expect-error — plain .mjs module without type declarations
import { findPrivateTextLeaks, loadRefText, writePrivateRef } from '../../scripts/eval/lib/private-refs.mjs';

const REPO_REFS = path.join(__dirname, '..', '..', 'scripts', 'eval', 'benchmark', 'refs');

describe('the public repo holds no in-copyright reference text', () => {
  it('no .txt sits beside a private record in scripts/eval/benchmark/refs', () => {
    expect(findPrivateTextLeaks(REPO_REFS)).toEqual([]);
  });

  it('no private record carries its text inline', () => {
    const inline = fs.readdirSync(REPO_REFS)
      .filter(f => f.endsWith('.json'))
      .filter(f => {
        const rec = JSON.parse(fs.readFileSync(path.join(REPO_REFS, f), 'utf8'));
        const isPrivate = rec.text_location === 'private' || rec.licence === 'in-copyright';
        return isPrivate && (rec.text != null || rec.reference != null);
      });
    expect(inline).toEqual([]);
  });
});

describe('private-refs loader', () => {
  let pub: string;
  let priv: string;
  const prevEnv = process.env.SL_PRIVATE_REFS_DIR;

  beforeEach(() => {
    pub = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-pub-'));
    priv = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-priv-'));
    process.env.SL_PRIVATE_REFS_DIR = priv;
  });
  afterEach(() => {
    fs.rmSync(pub, { recursive: true, force: true });
    fs.rmSync(priv, { recursive: true, force: true });
    if (prevEnv === undefined) delete process.env.SL_PRIVATE_REFS_DIR;
    else process.env.SL_PRIVATE_REFS_DIR = prevEnv;
  });

  it('writes text privately and only the hashed record publicly', () => {
    const rec = writePrivateRef(pub, 'latin-x-p1', 'Arcana quaedam verba', { licence: 'in-copyright', source: 'test edition' });
    expect(fs.existsSync(path.join(pub, 'latin-x-p1.txt'))).toBe(false);
    expect(fs.existsSync(path.join(priv, 'latin-x-p1.txt'))).toBe(true);
    expect(rec.text_location).toBe('private');
    expect(loadRefText(pub, 'latin-x-p1')).toEqual({ text: 'Arcana quaedam verba', private: true });
  });

  it('positive control: the guard fires on a leaked text', () => {
    writePrivateRef(pub, 'latin-x-p2', 'verba', { licence: 'in-copyright' });
    fs.writeFileSync(path.join(pub, 'latin-x-p2.txt'), 'verba');
    expect(findPrivateTextLeaks(pub)).toEqual(['latin-x-p2']);
  });

  it('refuses a private text that does not match its public hash', () => {
    writePrivateRef(pub, 'latin-x-p3', 'original', { licence: 'in-copyright' });
    fs.writeFileSync(path.join(priv, 'latin-x-p3.txt'), 'edited');
    expect(loadRefText(pub, 'latin-x-p3')).toEqual({ text: null, skipped: 'private-text-hash-mismatch' });
  });

  it('records a skip, not a crash, when the private text is not on this machine', () => {
    writePrivateRef(pub, 'latin-x-p4', 'verba', { licence: 'in-copyright' });
    fs.rmSync(path.join(priv, 'latin-x-p4.txt'));
    expect(loadRefText(pub, 'latin-x-p4')).toEqual({ text: null, skipped: 'private-text-unavailable' });
  });

  it('still reads ordinary public references', () => {
    fs.writeFileSync(path.join(pub, 'open-p1.json'), JSON.stringify({ licence: 'CC-BY-4.0' }));
    fs.writeFileSync(path.join(pub, 'open-p1.txt'), 'open text');
    expect(loadRefText(pub, 'open-p1')).toEqual({ text: 'open text', private: false });
  });
});
