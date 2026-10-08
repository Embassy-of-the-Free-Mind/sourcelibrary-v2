#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/en-ocr-reference-5124.mjs (--stage=pool/draw/fetch: pairs our pages with
 * en.wikisource `Page:` text by IA identifier — English only, Wikisource only);
 * scripts/eval/build-reference-groundtruth.mjs (one hand-curated passage per work, no page join).
 * Neither reads Coptic SCRIPTORIUM, whose reference is cut by manuscript page or by Bible verse.
 *
 * coptic-5778/build-sample — pair up to 15 of our Coptic pages with a Coptic SCRIPTORIUM text (#5778).
 * Read-only on Mongo. Writes sample.jsonl (page, stored OCR, served English, image URL, reference
 * units). References whose licence forbids redistribution (Sahidica NT: "academic use only") are
 * written to --private-dir instead, and sample.jsonl keeps only their location and length.
 *
 *   node --env-file=… scripts/eval/coptic-5778/build-sample.mjs --corpora <SCRIPTORIUM checkout> \
 *     --out scripts/eval/results/coptic-5778 --private-dir <dir outside the repo>
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { parseTT, normCoptic } from './coptic-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CORPORA = arg('--corpora'); const OUT = arg('--out'); const PRIV = arg('--private-dir');
if (!CORPORA || !OUT || !PRIV) { console.error('need --corpora --out --private-dir'); process.exit(1); }

// The pairing, made by locating our stored OCR in the corpora by shared 10-letter runs (printed
// books) and by the holding institution's own page labels (manuscripts). `unit: 'page'` = the
// reference is cut to this manuscript page; `unit: 'verse'` = scored on the verses the page holds.
const IA2 = '69cf7d866d17d9f121ccf51d', CL2 = 'd882e2d7-5639-4cca-a7a0-2cf5daf1cace', VAT = '6abe3e91dbb76766e36bb6a7';
const HB = '69920b7de0a548a13d883364', HS = '69920b83e0a548a13d8835ea', BB = '69af55d3ec9e6c278212dcf1', BP = '69e012c74e6773d06085687d';
const TH = ['thomas.gospel_TT/thomas_gospel.tt'];
const FR = [1, 2, 3, 4].map((n) => `lit.fragments_TT/life.empdaughter.frg${n}_giron.tt`);
const SAMPLE = [
  { book: IA2, page: 63, stratum: 'manuscript', unit: 'page', docs: TH, ref_page: 'NHAM02.34', same_edition: true },
  { book: IA2, page: 69, stratum: 'manuscript', unit: 'page', docs: TH, ref_page: 'NHAM02.40', same_edition: true },
  { book: IA2, page: 75, stratum: 'manuscript', unit: 'page', docs: TH, ref_page: 'NHAM02.46', same_edition: true },
  { book: CL2, page: 36, stratum: 'manuscript', unit: 'page', docs: TH, ref_page: 'NHAM02.36', same_edition: true },
  { book: CL2, page: 43, stratum: 'manuscript', unit: 'page', docs: TH, ref_page: 'NHAM02.43', same_edition: true },
  { book: VAT, page: 3, stratum: 'manuscript', unit: 'page', docs: FR, ref_page: 'clm1853-15', same_edition: true },
  { book: VAT, page: 5, stratum: 'manuscript', unit: 'page', docs: FR, ref_page: 'clm1853-17', same_edition: true },
  { book: HB, page: 192, stratum: 'printed', unit: 'verse', docs: ['05', '06', '07'].map((c) => `bohairic.nt_TT/01_Matthew_${c}.tt`) },
  { book: HB, page: 498, stratum: 'printed', unit: 'verse', docs: ['05', '06', '07'].map((c) => `bohairic.nt_TT/02_Mark_${c}.tt`) },
  { book: HS, page: 154, stratum: 'printed', unit: 'verse', docs: ['06', '07', '09'].map((c) => `sahidica.nt_TT/43_John_${c}.tt`) },
  { book: HS, page: 258, stratum: 'printed', unit: 'verse', docs: ['14', '15', '16'].map((c) => `sahidica.nt_TT/43_John_${c}.tt`) },
  { book: BB, page: 115, stratum: 'printed', unit: 'verse', docs: ['08', '09', '10'].map((c) => `sahidic.ot_TT/05_Deuteronomy_${c}.tt`) },
  { book: BB, page: 216, stratum: 'printed', unit: 'verse', docs: ['01', '02', '03'].map((c) => `sahidic.ot_TT/32_Jonah_${c}.tt`) },
  { book: BP, page: 77, stratum: 'printed', unit: 'verse', docs: ['053', '054', '055'].map((c) => `sahidic.ot_TT/19_Psalms_${c}.tt`) },
  { book: BP, page: 152, stratum: 'printed', unit: 'verse', docs: ['0117', '0118', '0119'].map((c) => `sahidic.ot_TT/19_Psalms_${c}.tt`) },
];

const strip = (s) => (s || '').replace(/<[^<>]*>/g, '').trim();
const isPrivate = (licence) => /academic use only|\(c\)/i.test(licence);

function loadUnits(s) {
  const units = []; let meta = null;
  for (const d of s.docs) {
    const f = path.join(CORPORA, d);
    if (!fs.existsSync(f)) { console.error('missing reference file', f); continue; }
    const t = parseTT(f); meta ??= t.meta;
    const doc = path.basename(d, '.tt');
    if (s.unit === 'page') {
      const byPage = new Map();
      for (const u of t.units) { const k = `${doc}#${u.page}`; if (!byPage.has(k)) byPage.set(k, { id: k, page: u.page, text: '', extant: '' }); const p = byPage.get(k); p.text += (p.text ? ' ' : '') + u.text; p.extant += (p.extant ? ' ' : '') + u.extant; }
      units.push(...byPage.values());
    } else {
      t.units.forEach((u, i) => units.push({ id: `${doc}#${u.verse}`, seq: units.length, text: u.text, english: u.english && u.english !== '...' ? u.english : null }));
    }
  }
  return { units, meta };
}

fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PRIV, { recursive: true });
await withMongo(async (db) => {
  const rows = [], priv = [];
  for (const s of SAMPLE) {
    const book = await db.collection('books').findOne({ id: s.book }, { projection: { id: 1, title: 1, year: 1, published: 1, visible: 1, 'image_source.provider': 1, ia_identifier: 1 } });
    const page = await db.collection('pages').findOne({ book_id: s.book, page_number: s.page });
    if (!book || !page) { console.error('missing', s.book, s.page); continue; }
    const { units, meta } = loadUnits(s);
    const licence = strip(meta.license), secret = isPrivate(licence);
    const id = `${s.book.slice(0, 8)}-p${s.page}`;
    const row = {
      id, book_id: s.book, title: book.title, year: book.year ?? book.published, visible: !!book.visible, provider: book.image_source?.provider,
      page_number: s.page, page_id: page.id, stratum: s.stratum, unit: s.unit, same_edition: !!s.same_edition, ref_page: s.ref_page ?? null,
      image_url: getPageSource(page),
      stored: page.ocr?.data ? { model: page.ocr.model ?? null, source: page.ocr.source ?? null, updated_at: page.ocr.updated_at ?? null, text: page.ocr.data } : null,
      served_english: page.translation?.data ? { model: page.translation.model ?? null, text: page.translation.data } : null,
      reference: {
        corpus: meta.corpus, licence, private: secret, source: strip(meta.source) || strip(meta.Coptic_edition) || null, edition: strip(meta.Coptic_edition) || null,
        english_source: meta.translation && meta.translation !== 'none' ? strip(meta.translation) : null, version: meta.version_n, docs: s.docs,
        units: secret ? units.map((u) => ({ id: u.id, letters: normCoptic(u.text).length })) : units,
      },
    };
    if (secret) priv.push({ id, units });
    rows.push(row);
    console.log(id, s.stratum, `stored=${row.stored?.model ?? 'none'}`, `english=${row.served_english ? 'yes' : 'no'}`, `units=${units.length}`, licence, secret ? '(private)' : '');
  }
  fs.writeFileSync(path.join(OUT, 'sample.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(PRIV, 'private-refs.jsonl'), priv.map((r) => JSON.stringify(r)).join('\n') + '\n');
});
