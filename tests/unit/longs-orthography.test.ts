/**
 * The long-s pass's write path (#5924): an orthographic-only edit of `ocr.data` that must NOT make the page's
 * translation stale and must queue nothing.
 *
 * Translation staleness, gap-fill, the stale marker and the embeddings watermark all read `ocr.updated_at`
 * (scripts/lib/stale-translation.mjs). The pass writes ~1M pages; if this path stamped that clock, every one of them
 * would be queued for paid retranslation. So the path leaves the clock alone, and what makes that safe is that it can
 * write nothing but f → ſ: `assertOrthographicOnly` throws on any other difference. Both halves are pinned here.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as L from '../../scripts/lib/longs-orthography.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { translationStaleness, STALE_FIELD } from '../../scripts/lib/stale-translation.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as mjsWriter from '../../scripts/lib/page-text-writer.mjs';
import * as tsWriter from '@/lib/page-text-writer';

type Doc = Record<string, unknown>;
const get = (doc: Doc, p: string): unknown => p.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Doc)[k] : undefined), doc);
const setPath = (doc: Doc, p: string, v: unknown) => { const ks = p.split('.'); let o = doc; for (const k of ks.slice(0, -1)) o = (o[k] ??= {}) as Doc; o[ks[ks.length - 1]] = v; };
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Doc;
      if ('$in' in c) return (c.$in as unknown[]).some((x) => (x === null ? v === null || v === undefined : x === v));
      if ('$ne' in c) return v !== c.$ne;
    }
    return v === cond;
  });
}
/** A Db that records every collection it is asked for, so "nothing queued" is a fact, not a hope. */
function fakeDb(pages: Doc[], hooks: { beforeUpdate?: (store: Record<string, Doc[]>) => void } = {}) {
  const store: Record<string, Doc[]> = { pages: structuredClone(pages), page_revisions: [] };
  const touched = new Set<string>();
  const collection = (name: string) => {
    touched.add(name);
    store[name] ??= [];
    const rows = store[name];
    return {
      findOne: async (f: Doc) => { const d = rows.find((r) => matches(r, f)); return d ? structuredClone(d) : null; },
      insertOne: async (d: Doc) => { rows.push(structuredClone(d)); return { acknowledged: true }; },
      updateOne: async (f: Doc, u: Doc) => {
        if (name === 'pages') hooks.beforeUpdate?.(store);
        const d = rows.find((r) => matches(r, f));
        if (!d) return { matchedCount: 0 };
        for (const [k, v] of Object.entries((u.$set as Doc) || {})) setPath(d, k, structuredClone(v));
        return { matchedCount: 1 };
      },
    };
  };
  return { db: { collection } as never, store, touched };
}

const OCR_AT = new Date('2026-04-19T20:06:16Z');
const TR_AT = new Date('2026-04-20T09:00:00Z');
const LITE = 'Nam potest & corpus & animam mittere: cum nifi valde fit ftupidus, ferio trepidare necesse eft.';
const page = (id: string, ocr: Doc, extra: Doc = {}): Doc => ({
  id, book_id: 'b1', page_number: 1,
  ocr: { data: LITE, source: 'batch_api', model: 'gemini-3.1-flash-lite-preview', updated_at: OCR_AT, content_hash: 'old', ...ocr },
  translation: { data: 'For he can send both body and soul…', source: 'ai', updated_at: TR_AT },
  ...extra,
});
const NEXT = LITE.replace('nifi', 'niſi').replace('ftupidus', 'ſtupidus').replace('ferio', 'ſerio').replace('eft.', 'eſt.');

describe('assertOrthographicOnly — the guarantee the clock exception rests on', () => {
  it('accepts f → ſ and counts it', () => {
    expect(L.assertOrthographicOnly(LITE, NEXT)).toBe(4);
    expect(L.assertOrthographicOnly(LITE, LITE)).toBe(0);
  });
  it('refuses any other edit: a different letter, s → ſ, ſ → f, a deletion, an insertion', () => {
    expect(() => L.assertOrthographicOnly('fit', 'sit')).toThrow(/only f → ſ/);
    expect(() => L.assertOrthographicOnly('sit', 'ſit')).toThrow(/only f → ſ/);
    expect(() => L.assertOrthographicOnly('ſit', 'fit')).toThrow(/only f → ſ/);
    expect(() => L.assertOrthographicOnly('eft', 'ef')).toThrow(/length/);
    expect(() => L.assertOrthographicOnly('eft', 'eſt.')).toThrow(/length/);
    expect(() => L.assertOrthographicOnly('F', 'ſ')).toThrow(/only f → ſ/);
  });
  it('orthographicOcrValue keeps every key — ocr.updated_at above all — and rehashes the text', () => {
    const prior = (page('p', {}).ocr) as Doc;
    const v = L.orthographicOcrValue(prior, NEXT);
    expect(v.updated_at).toEqual(OCR_AT);
    expect(v.data).toBe(NEXT);
    expect(v.content_hash).not.toBe('old');
    expect({ ...v, data: undefined, content_hash: undefined }).toEqual({ ...prior, data: undefined, content_hash: undefined });
    expect(() => L.orthographicOcrValue(prior, NEXT.replace('niſi', 'nisi'))).toThrow();
    expect(() => L.orthographicOcrValue({ ...prior, source: 'manual' }, NEXT)).toThrow(/human-edited/);
  });
});

describe('writeOrthographicOcr — the translation is not marked stale and nothing is queued', () => {
  it('writes the text, a revision row, and leaves every staleness input untouched', async () => {
    const start = [page('p1', {}), page('p2', {}, { [STALE_FIELD]: { reason: 'ocr_newer', since: TR_AT } })];
    const { db, store, touched } = fakeDb(start);
    const before = start.map((p) => translationStaleness(p).stale);
    const out = await L.writeOrthographicOcr(db, start.map((p) => ({ page: structuredClone(p), next: NEXT })), { by: 'test', run_id: 'run-x', now: new Date('2026-10-23T00:00:00Z') });
    expect(out).toMatchObject({ written: 2 });
    for (const [i, p] of store.pages.entries()) {
      expect(get(p, 'ocr.data')).toBe(NEXT);
      expect(get(p, 'ocr.updated_at')).toEqual(OCR_AT);                     // the clock staleness reads
      expect(p.translation).toEqual(start[i].translation);                   // the English, byte for byte
      expect(p[STALE_FIELD]).toEqual(start[i][STALE_FIELD]);                 // marker neither set nor cleared
      expect(translationStaleness(p).stale).toBe(before[i]);
      expect(translationStaleness(p).stale).toBe(false);
    }
    // nothing but the page and its revision: no jobs, no translate runs, no queue of any kind
    expect([...touched].sort()).toEqual(['page_revisions', 'pages']);
    expect(store.page_revisions).toHaveLength(2);
    const rev = store.page_revisions[0];
    expect(rev).toMatchObject({ field: 'ocr', source: 'longs-pass-5924', run_id: 'run-x', data: LITE, writer: 'page-text-writer/1' });
    expect((rev.meta as Doc).source).toBe('batch_api');                      // the prior's own source is kept
    expect(mjsWriter.priorFieldFromRevision(rev)).toEqual(start[0].ocr);     // and the prior field restores exactly
  });

  it('a page rewritten since the pass read it is refused, not overwritten with a transform of the old text', async () => {
    const p = page('p1', {});
    const { db, store } = fakeDb([{ ...p, ocr: { ...(p.ocr as Doc), data: 'someone else wrote this' } }]);
    const out = await L.writeOrthographicOcr(db, [{ page: p, next: NEXT }], { by: 'test', run_id: 'run-x' });
    expect(out).toMatchObject({ written: 0, prior_changed: 1 });
    expect(get(store.pages[0], 'ocr.data')).toBe('someone else wrote this');
    expect(store.page_revisions).toHaveLength(0);
  });

  it('a page changed between the revision row and the write is a conflict, and its row is aborted', async () => {
    const p = page('p1', {});
    const { db, store } = fakeDb([p], { beforeUpdate: (st) => { setPath(st.pages[0], 'ocr.data', 'raced'); } });
    const out = await L.writeOrthographicOcr(db, [{ page: p, next: NEXT }], { by: 'test', run_id: 'run-x' });
    expect(out).toMatchObject({ written: 0, conflict: 1 });
    expect(get(store.pages[0], 'ocr.data')).toBe('raced');
    expect(store.page_revisions[0].aborted).toBe('conflict');
  });

  it('a human-edited transcription is refused before anything is written', async () => {
    const p = page('p1', { source: 'manual', edited_by: 'scholar@x' });
    const { db, store } = fakeDb([p]);
    await expect(L.writeOrthographicOcr(db, [{ page: p, next: NEXT }], { by: 'test', run_id: 'run-x' })).rejects.toThrow(/human-edited/);
    // and the writer refuses it too, even if a caller built the value another way
    const r = await mjsWriter.writePageText(db, 'p1', 'ocr', { ...(p.ocr as Doc), data: NEXT }, { by: 't', reason: 'r', verbatim: true });
    expect(r.status).toBe('refused_human_edit');
    expect(store.page_revisions).toHaveLength(0);
    expect(get(store.pages[0], 'ocr.data')).toBe(LITE);
  });

  it('cannot be used to write a reading: any non-orthographic text throws before a write', async () => {
    const p = page('p1', {});
    const { db, store } = fakeDb([p]);
    await expect(L.writeOrthographicOcr(db, [{ page: p, next: LITE.replace('corpus', 'corpvs') }], { by: 't', run_id: 'r' })).rejects.toThrow();
    expect(store.page_revisions).toHaveLength(0);
    expect(get(store.pages[0], 'ocr.data')).toBe(LITE);
  });
});

describe('applyLongS — what the pass may touch', () => {
  // A toy model: s-forms frequent, f-forms rare, except 'fit' (a real word, 'becomes').
  const uni: [string, number][] = [['est', 5000], ['nisi', 900], ['sit', 800], ['fit', 400], ['stupidus', 30], ['serio', 60], ['sed', 3000],
    ['potest', 700], ['et', 9000], ['necesse', 300], ['valde', 200], ['cum', 4000], ['trepidare', 10], ['ipse', 500], ['sua', 600], ['fig', 300], ['sig', 50]];
  const model = new L.Model({ uni, N: uni.reduce((k, [, n]) => k + n, 0), bi: [], ambig: [], lm: undefined });

  it('restores ſ in Latin body text, f → ſ only', () => {
    const o = L.applyLongS(LITE, model);
    expect(o.text).toContain('niſi'); expect(o.text).toContain('ſtupidus'); expect(o.text).toContain('eſt.');
    expect(L.assertOrthographicOnly(LITE, o.text)).toBe(o.kept);
  });
  it('never touches tags, English descriptions, capitalised words, or a German line', () => {
    // (the German line is two lines away: a German neighbour would hold the Latin line back too, by design)
    const t = ['Daß ift fich auff dem Feld fo gefunden, und nicht anders.', '<page-type>text</page-type>',
      '<image-desc>A figure of a furnace after the manner of Offa</image-desc>', 'Offa fed ipfe dixit: eft fua causa, nifi fit ftupidus et valde.'].join('\n');
    const o = L.applyLongS(t, model);
    const lines = o.text.split('\n');
    expect(lines[0]).toBe('Daß ift fich auff dem Feld fo gefunden, und nicht anders.');
    expect(lines[1]).toBe('<page-type>text</page-type>');
    expect(lines[2]).toContain('A figure of a furnace after the manner of Offa');
    expect(lines[3].startsWith('Offa ')).toBe(true);
    expect(lines[3]).toContain('ſed'); expect(lines[3]).toContain('eſt');
  });
  it('on a page without the ſ-as-f habit, a real f-word stays (fit); an abbreviation stays (fig.)', () => {
    const t = 'Hoc est quod sit, et sed est, ipse est sua potest; nunc fit calor, vide fig. 3, et nifi est.';
    const o = L.applyLongS(t, model);
    expect(o.habit.habit).toBe(false);
    expect(o.text).toContain(' fit calor'); expect(o.text).toContain('fig. 3'); expect(o.text).toContain('niſi');
  });
  it('a rare real f-word in the lexicon stays (infectatur, 2 vs 64); no ſ before r or word-initially before l', () => {
    const m2 = new L.Model({ uni: [...uni, ['infectatur', 2], ['insectatur', 64], ['flante', 10], ['slante', 1], ['fragmenta', 30]], N: 40000, bi: [], ambig: [], lm: undefined });
    const t = 'Hoc est quod sit, et sed est ipse; morbo infectatur, choro flante, fragmenta, nifi est.';
    const o = L.applyLongS(t, m2);
    expect(o.text).toContain('infectatur'); expect(o.text).toContain('flante'); expect(o.text).toContain('fragmenta'); expect(o.text).toContain('niſi');
  });
  it('a short word ending a line, continued in lower case, is not judged (fe|stiue)', () => {
    const m3 = new L.Model({ uni: [...uni, ['se', 5000]], N: 40000, bi: [], ambig: [], lm: undefined });
    const t = 'Hoc est quod sit, et sed est ipse, nifi fe\nstiue dixit; sed fe\nNam ipse est.';
    const o = L.applyLongS(t, m3);
    expect(o.text).toContain('fe\nstiue'); expect(o.text).toContain('ſe\nNam'); expect(o.text).toContain('niſi');
  });
  it('page gates: German text and gothic script are refused', () => {
    expect(L.pageLatinVerdict('Daß ift fich auff dem Feld fo gefunden, und nicht anders, der Herr ist mit dem Volck und den Leuten.').ok).toBe(false);
    expect(L.pageScriptVerdict('<script>gothic</script>\nfoo').ok).toBe(false);
    expect(L.pageScriptVerdict('<script>printed</script>\nfoo').ok).toBe(true);
  });
});

describe('revision_source — both writer twins label the row the same way', () => {
  it('ts and mjs agree, and the prior source moves to meta', () => {
    const p = page('p1', {});
    const args = { page: p, field: 'ocr' as const, next: { data: NEXT }, now: new Date(0), id: 'r', opts: { by: 'b', reason: 'r', revision_source: 'longs-pass-5924' } };
    const a = tsWriter.buildTextRevision(args as never), b = mjsWriter.buildTextRevision(args);
    expect(a).toEqual(b);
    expect(a.source).toBe('longs-pass-5924');
    const plain = tsWriter.buildTextRevision({ ...args, opts: { by: 'b', reason: 'r' } } as never);
    expect(plain.source).toBe('batch_api');
  });
});
