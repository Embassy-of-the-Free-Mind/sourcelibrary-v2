/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * Write-time tag validation (page-error taxonomy D1, #5159) and the buried-translation unwrap
 * (T3, #5148) at the translation door.
 *
 * D1: every pipeline writer passes through sanitizeTranslationTags(), which now holds the text to
 * the closed tag vocabulary. Negative control: a page that uses only known, balanced tags comes
 * back byte-identical.
 *
 * T3: the fixture is the taxonomy's own example (Agrippa, Armatae militiae p.233: wrapper 3,520
 * characters, body 8) pulled from the mirror; the negatives are the shapes the unwrap must leave
 * alone — a long note beside a real body, a short continuity meta, a page with no source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  writePageTranslation, contentHash, assessTranslationHealth, sanitizeTranslationTags, validateTranslationTags,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';
import {
  hiddenTranslation, unwrapHiddenTranslation, HIDDEN_BURIED_BODY_SHARE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/hidden-translation.mjs';
import {
  notRecorded,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/write-provenance.mjs';

const QW = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/page-integrity/quick-wins.json'), 'utf8')).cases as Record<string, any>;
const agrippa = QW['agrippa-p233-buried-meta'];
const beside = QW['note-beside-body'];

describe('D1 · translation held to the closed tag vocabulary (#5159)', () => {
  it('NEGATIVE CONTROL: known, balanced tags come back byte-identical, with no changes', () => {
    const t = '<page-num>27</page-num>\n<header>Book Two</header>\nThe <term>stone</term> is <unclear>fixed</unclear>.<note>cf. Geber</note>\n<column-break/>\n<margin>Nota</margin> text <leaf-break /> more<br>\n<meta>continues</meta>\n| a | b |\n**bold** <sup>3</sup> <a href="#n1">1</a>';
    expect(validateTranslationTags(t)).toEqual({ text: t, changes: [] });
    expect(sanitizeTranslationTags(t)).toBe(t);
  });
  it('NEGATIVE CONTROL: angle brackets that are not tags are text (arrows, comparisons, centering)', () => {
    const t = '->The Title<- and 3 < 4 > 2, a <- b';
    expect(validateTranslationTags(t)).toEqual({ text: t, changes: [] });
  });
  it('unwraps a paired unknown tag and keeps its text', () => {
    expect(validateTranslationTags('Bold <b>word</b> and <center>c</center>.')).toEqual({ text: 'Bold word and c.', changes: [{ op: 'unwrap', tag: 'b' }, { op: 'unwrap', tag: 'center' }] });
  });
  it('keeps the word of a LONE unknown tag as ⟨word⟩ — an editorial supplement or a footnote key, never deleted', () => {
    expect(validateTranslationTags('Ille <et> Deus dixit').text).toBe('Ille ⟨et⟩ Deus dixit');
    expect(validateTranslationTags('the key<a> and <b> here').text).toBe('the key⟨a⟩ and ⟨b⟩ here');
  });
  it('rejoins the split <margin> of D1 (real shape: Barlaam p.8) instead of pushing the note into the body', () => {
    const r = validateTranslationTags('deadly torture against the God-fearing.\n\n<margin></margin>\nColossians 3.\n</margin>');
    expect(r.text).toBe('deadly torture against the God-fearing.\n\n<margin>\nColossians 3.\n</margin>');
    expect(r.changes).toEqual([{ op: 'rejoin', tag: 'margin' }]);
  });
  it('drops a lone empty annotation and an orphan closing tag', () => {
    expect(validateTranslationTags('x <note> </note> y').text).toBe('x  y');
    expect(validateTranslationTags('a </gloss> b')).toEqual({ text: 'a  b', changes: [{ op: 'drop-orphan', tag: 'gloss' }] });
  });
  it('sanitizeTranslationTags still closes an unterminated inline tag before validating', () => {
    expect(sanitizeTranslationTags('text <gloss>open to the end')).toBe('text <gloss>open to the end</gloss>');
  });
});

function makeDbStub() {
  const calls: { updates: any[]; revisions: unknown[] } = { updates: [], revisions: [] };
  const pageDoc = { id: 'p1', book_id: 'b1', translation: { data: 'old ai', source: 'ai' } };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => pageDoc,
        find: () => ({ toArray: async () => [pageDoc] }),
        updateOne: async (...args: unknown[]) => { if (name === 'pages') calls.updates.push(args); return { modifiedCount: 1 }; },
        insertOne: async (doc: unknown) => { if (name === 'page_revisions') calls.revisions.push(doc); return {}; },
        insertMany: async (docs: unknown[]) => { if (name === 'page_revisions') calls.revisions.push(...docs); return {}; },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return { db, calls };
}
const promptRef = { id: 'x', name: 'Standard Translation', version: 12 };
const engine = notRecorded('unit test');

describe('writePageTranslation unwraps a buried translation (T3, #5148)', () => {
  it('stores the Agrippa p.233 translation as body text, not inside <meta>', async () => {
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1', page_type: 'text', ocr: { data: agrippa.ocr } };
    const r = await writePageTranslation(db, { page, book: { language: 'latin' }, text: agrippa.tr, promptRef, engine });
    expect(r.written).toBe(true);
    const stored = calls.updates[0][1].$set.translation;
    expect(stored.data).not.toMatch(/<meta>/i);
    expect(stored.data).toContain('...as having power over the things within it');
    expect(stored.data).toContain('<term>Ptolemy</term>');
    expect(stored.content_hash).toBe(contentHash(stored.data));
  });
  it('the unwrapped text passes the health gate that the wrapped text failed', async () => {
    expect(assessTranslationHealth(agrippa.ocr, agrippa.tr).healthy).toBe(false); // body 8 → collapsed
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1', page_type: 'text', ocr: { data: agrippa.ocr } };
    const r = await writePageTranslation(db, { page, book: { language: 'latin' }, text: agrippa.tr, promptRef, engine, refuseUnhealthy: true });
    expect(r).toMatchObject({ written: true });
    expect(calls.updates.length).toBe(1);
  });
  it('NEGATIVE CONTROL: leaves a long <note> beside a real body exactly as written', async () => {
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1', page_type: 'text', ocr: { data: beside.ocr } };
    await writePageTranslation(db, { page, book: { language: 'latin' }, text: beside.tr, promptRef, engine });
    expect(calls.updates[0][1].$set.translation.data).toBe(sanitizeTranslationTags(beside.tr));
  });
  it('NEGATIVE CONTROL: does not unwrap when the page carries no OCR (the rule needs the source)', () => {
    expect(unwrapHiddenTranslation({ tr: agrippa.tr })).toMatchObject({ unwrapped: false, why: 'no-source' });
  });
});

describe('T3 · translation hidden in a <meta>/<note> wrapper (#5148)', () => {
  it('the Agrippa p.233 example: the whole translation inside one labelled <meta>, body 0 — hidden AND buried', () => {
    const h = hiddenTranslation(QW['agrippa-p233-buried-meta']);
    expect(h).toMatchObject({ judged: true, wrapper: 'meta', hidden: true, buried: true, labelled: true, body: 0 });
    expect(h.wrapperLen).toBeGreaterThan(2000);
  });
  it('a long <note> BESIDE a real body is hidden by the loose rule but not buried', () => {
    const h = hiddenTranslation(QW['note-beside-body']);
    expect(h).toMatchObject({ judged: true, wrapper: 'note', hidden: true, buried: false });
    expect(h.body).toBeGreaterThan(HIDDEN_BURIED_BODY_SHARE * h.wrapperLen);
  });
  it('a <note> with no body at all is buried (unlabelled)', () => {
    expect(hiddenTranslation(QW['buried-note'])).toMatchObject({ judged: true, wrapper: 'note', hidden: true, buried: true, labelled: false, body: 0 });
  });
  it('passes a short continuity <meta> beside the body, and two short <note>s', () => {
    expect(hiddenTranslation(QW['prayer-p333-short-meta'])).toMatchObject({ judged: true, hidden: false, buried: false, labelled: true });
    expect(hiddenTranslation(QW['kircher-p317-notes'])).toMatchObject({ judged: true, hidden: false });
  });
  it('never judges a plate, a short source, or a wrapper that DESCRIBES the page', () => {
    const a = QW['agrippa-p233-buried-meta'];
    expect(hiddenTranslation({ ...a, type: 'illustration' })).toEqual({ judged: false, why: 'non-prose' });
    expect(hiddenTranslation({ ...a, ocr: '<page-type>text</page-type>\nshort' })).toEqual({ judged: false, why: 'short-source' });
    const described = { ...a, tr: '<note>This page shows a woodcut of the zodiac with twelve signs around a central sun; ' + 'the engraving is finely hatched and the border carries acanthus leaves. '.repeat(4) + '</note>' };
    expect(hiddenTranslation(described)).toMatchObject({ judged: true, hidden: false, described: true });
  });
  it('unwrapHiddenTranslation opens ONLY the buried tier, drops the label, keeps the text byte-for-byte', () => {
    const a = QW['agrippa-p233-buried-meta'];
    const u = unwrapHiddenTranslation(a);
    expect(u.unwrapped).toBe(true);
    expect(u.text.startsWith('<header>Book Two</header>\n\n...as having power over the things within it')).toBe(true);
    expect(u.text).not.toMatch(/<meta>/i);
    expect(u.text).not.toMatch(/continues from previous page/i);
    expect(u.text).toContain('<term>Ptolemy</term>');
    // idempotent, and the re-read page has a body
    expect(unwrapHiddenTranslation({ ...a, tr: u.text })).toMatchObject({ unwrapped: false, why: 'not-hidden' });
    expect(hiddenTranslation({ ...a, tr: u.text }).body).toBeGreaterThan(2000);
    // not buried → untouched
    const n = QW['note-beside-body'];
    expect(unwrapHiddenTranslation(n)).toMatchObject({ unwrapped: false, why: 'hidden-not-buried', text: n.tr });
    // no source → untouched (the rule cannot tell a hidden translation from a long honest note)
    expect(unwrapHiddenTranslation({ tr: a.tr, type: 'text' })).toMatchObject({ unwrapped: false, why: 'no-source', text: a.tr });
  });
  it('a "$" in the buried text survives the unwrap (function replacer)', () => {
    const a = QW['agrippa-p233-buried-meta'];
    const tr = a.tr.replace('as having power', () => 'as having $& power');
    expect(unwrapHiddenTranslation({ ...a, tr }).text).toContain('as having $& power');
  });
});

