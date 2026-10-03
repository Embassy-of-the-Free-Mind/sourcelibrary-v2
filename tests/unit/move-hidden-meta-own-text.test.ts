/**
 * The hidden-meta mover (#5376 tq11): a page's own text, written into its continuity <meta>, is
 * moved into the visible body — only when the scan's classifier, re-run on the live page, still
 * says `own-text`, and never over a human edit, a #5148 unwrap, a held book or changed text.
 */
import { describe, it, expect } from 'vitest';
import { planMove, pickPilot, HAZARD, MAX_IN_BODY } from '../../scripts/maintenance/move-hidden-meta-own-text.mjs';
import { continuityMeta } from '../../scripts/lib/hidden-translation.mjs';

const MEDIANS = { latin: 1.172, _all: 1.095 };
const PAYLOAD = 'The philosophers consider the substance of mercury and the principle of nature, the operation of metals and the generation of minerals';
const BODY = 'Then the third chapter teaches how the fire is governed, slowly at first and afterwards more strongly, until the vessel shows its colours.';
const OCR = 'Philosophi considerant substantiam mercurii et principium naturae, operationem metallorum et generationem mineralium. Deinde capitulum tertium docet quomodo ignis regatur, primo lente, postea fortius, donec vas colores ostendat.';
const PREV_OCR = 'Von der Bereitung des Salzes und wie man es reinigen soll, damit es weiß werde wie Schnee und keine Unreinigkeit behalte.';
const PREV_TR = 'On the preparation of the salt and how one should purify it, so that it becomes white as snow and keeps no impurity.';
const tr = (payload = PAYLOAD, body = BODY) => `<meta>continues from previous page: ${payload}</meta>\n\n${body}`;
const words = continuityMeta(tr())!.words;

const page = (over: Record<string, unknown> = {}, trans: Record<string, unknown> = {}) => ({
  id: 'p2', book_id: 'b1', page_number: 2, ocr: { data: OCR }, translation: { data: tr(), source: 'ai', ...trans }, ...over,
});
const prev = { id: 'p1', book_id: 'b1', page_number: 1, ocr: { data: PREV_OCR }, translation: { data: PREV_TR } };
const cand = { book: 'b1', p: 2, words };
const plan = (o: Partial<Parameters<typeof planMove>[0]> = {}) => planMove({ cand, page: page(), prev, bookLang: 'Latin', medians: MEDIANS, ...o });

describe('planMove — the write', () => {
  it('moves this page\'s own text out of the meta, word for word, behind a bare marker', () => {
    const r = plan();
    expect(r.write).toBe(true);
    expect(r.cls).toBe('own-text');
    expect(r.text.startsWith('<meta>continues from previous page</meta>\n\n')).toBe(true);
    expect(r.text).toContain(PAYLOAD);
    expect(r.text).toContain(BODY);
    expect(continuityMeta(r.text)!.form).toBe('bare');
    expect(r.before_hash).not.toBe(r.after_hash);
  });
});

describe('planMove — every refusal', () => {
  it('a human-edited translation (source manual, or edited_by)', () => {
    expect(plan({ page: page({}, { source: 'manual' }) })).toMatchObject({ write: false, why: 'human-edited' });
    expect(plan({ page: page({}, { edited_by: 'someone' }) })).toMatchObject({ write: false, why: 'human-edited' });
  });
  it('a page #5148 already unwrapped, a hidden page, a held book, a missing page', () => {
    expect(plan({ page: page({}, { unwrapped_by: 'repair-t3-t12-5354' }) }).why).toBe('unwrapped-5148');
    expect(plan({ page: page({ hidden: true }) }).why).toBe('hidden-page');
    expect(plan({ held: true }).why).toBe('held');
    expect(plan({ page: null }).why).toBe('page-missing');
  });
  it('the six #5148 hazard pages', () => {
    const [book, p] = [...HAZARD][0].split(':');
    expect(plan({ cand: { book, p: Number(p), words } }).why).toBe('hazard-5148');
  });
  it('text that changed since it was classified (word count differs)', () => {
    expect(plan({ cand: { ...cand, words: words + 1 } }).why).toBe('changed-since-classification');
  });
  it('a payload already moved (bare marker now)', () => {
    expect(plan({ page: page({}, { data: `<meta>continues from previous page</meta>\n\n${PAYLOAD} ${BODY}` }) }).why).toBe('no-payload-now');
  });
  it('a payload that is the previous page\'s translation handed back — live class is no longer own-text', () => {
    const copied = 'On the preparation of the salt and how one should purify it, so that it becomes white as snow and keeps no impurity.';
    const r = plan({ page: page({}, { data: tr(copied) }), cand: { ...cand, words: continuityMeta(tr(copied))!.words } });
    expect(r).toMatchObject({ write: false, why: 'class-now:copied-previous' });
  });
  it(`a payload the body already carries (inBody > ${MAX_IN_BODY}) — it would be shown twice`, () => {
    const r = plan({ page: page({}, { data: tr(PAYLOAD, `${PAYLOAD.split(' ').slice(0, 14).join(' ')} ${BODY}`) }) });
    expect(r.write).toBe(false);
    expect(['in-body', 'class-now:duplicate-of-body']).toContain(r.why);
  });
});

describe('pickPilot', () => {
  it('one page per book, N pages, every severity represented', () => {
    const sevs = ['whole-page (>=80%)', 'half (50-80%)', 'part (20-50%)', 'opening (<20%)'];
    const cands = Array.from({ length: 400 }, (_, i) => ({ book: `b${i % 60}`, p: i, sev: sevs[i % 4], words: 10 }));
    const picks = pickPilot(cands, 20);
    expect(picks).toHaveLength(20);
    expect(new Set(picks.map(p => p.book)).size).toBe(20);
    expect(new Set(picks.map(p => p.sev)).size).toBe(4);
  });
});
