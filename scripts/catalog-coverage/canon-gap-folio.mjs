#!/usr/bin/env node
/**
 * Snapshot ONE Derge Tengyur side for the "one page through the pipeline" figure on
 * /research/canon-gap (#5846). Read-only; writes results/canon-gap-folio-2026-10.json, which
 * the page imports at build time (the route is `revalidate = false`, so it never fetches).
 *
 * The side was picked by eye: vol. 98 (Madhyamaka), folio 106b, a reply to the Cārvāka
 * materialists. Its English carries both repair passes, so the figure can show a real
 * before/after: #5797's false "illegible" tag, and the #5800 review's corrections.
 *
 * Every text in the output is copied from the page record or its revision rows; the only
 * processing is stripping translation markup and a word diff between successive versions.
 *
 * PRIOR ART: scripts/catalog-coverage/canon-gap-status.mjs — counts every canon, has no
 *   per-page text; this script snapshots a single page and its revision history.
 *
 * Usage: node --env-file=.env.production.local scripts/catalog-coverage/canon-gap-folio.mjs
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BOOK_ID = '6abeb20a896ea18127c82b01'; // Derge Tengyur, vol. 98
const PAGE_NUMBER = 211; // folio 106b
const VOLUME = 98;
const SECTION = 'Madhyamaka';
// The figure follows the passage from the Cārvāka objection to the end of the side.
const EXCERPT_FROM = 'Alternatively, to establish the position of the materialists';
// The karma formula as the woodblock has it; the draft added a fifth item.
const FORMULA_FROM = 'ལས་བདག་གིར་བྱ་བ་དང་།';
const FORMULA_TO = 'ལས་ཀྱི་བགོ་སྐལ་བའོ';
// Lines are bands of the 2001×292 image, measured by row darkness and checked by eye: the
// headline of line k sits at y ≈ 30 + 36.5(k−1); each band runs from just above it to the next.
const LINE_BANDS = [[6, 46], [46, 84], [84, 120], [120, 158], [158, 195], [195, 232], [232, 270]];

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'results/canon-gap-folio-2026-10.json');

/** English as a reader sees it: no term/gloss/meta/summary/keywords, notes in brackets. */
function plain(md) {
  return md
    .replace(/<(meta|summary|keywords)>[\s\S]*?<\/\1>/g, '')
    .replace(/\s*<term>[\s\S]*?<\/term>/g, '')
    .replace(/\s*<gloss>[\s\S]*?<\/gloss>/g, '')
    .replace(/<note>([\s\S]*?)<\/note>/g, '[$1]')
    .replace(/<unclear>([\s\S]*?)<\/unclear>/g, '[illegible: $1]')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function excerpt(text) {
  const i = text.indexOf(EXCERPT_FROM);
  if (i < 0) throw new Error(`excerpt start not found: ${EXCERPT_FROM}`);
  return text.slice(i);
}

/** Word-level diff (LCS) → [kind, text] runs, kind ∈ same | del | ins. Whitespace rides with words. */
function diff(a, b) {
  const A = a.split(/(?<=\s)/);
  const B = b.split(/(?<=\s)/);
  const L = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (k, t) => (out.length && out[out.length - 1][0] === k ? (out[out.length - 1][1] += t) : out.push([k, t]));
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]);
    else push('ins', B[j++]);
  }
  while (i < A.length) push('del', A[i++]);
  while (j < B.length) push('ins', B[j++]);
  return out;
}

/**
 * Lay successive diffs over one another: every run of text from any version, with the pass
 * that added it (`born`, null = in the first draft) and the pass that removed it (`died`).
 * Lets the figure strike and insert pass by pass on a single block of text.
 */
function track(first, diffs) {
  let segs = [{ t: first, born: null, died: null }];
  diffs.forEach((d, p) => {
    const out = [];
    let k = 0;
    // Take n visible characters from the front of segs, splitting a segment where needed.
    const take = (n, fn) => {
      while (n > 0) {
        const s = segs[k];
        if (s.died != null) { out.push(s); k++; continue; }
        if (s.t.length <= n) { out.push(fn(s)); n -= s.t.length; k++; }
        else { out.push(fn({ ...s, t: s.t.slice(0, n) })); segs[k] = { ...s, t: s.t.slice(n) }; n = 0; }
      }
    };
    for (const [kind, t] of d) {
      if (kind === 'ins') out.push({ t, born: p, died: null });
      else take(t.length, kind === 'del' ? (s) => ({ ...s, died: p }) : (s) => s);
    }
    while (k < segs.length) out.push(segs[k++]);
    segs = out;
  });
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.born === s.born && last.died === s.died) last.t += s.t;
    else merged.push({ ...s });
  }
  return merged;
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db('bookstore');

const book = await db.collection('books').findOne({ id: BOOK_ID }, { projection: { title: 1, visible: 1 } });
const page = await db.collection('pages').findOne({ book_id: BOOK_ID, page_number: PAGE_NUMBER });
if (!book || !page) throw new Error('book or page missing');
if (!page.translation?.data || !page.ocr?.data) throw new Error('page has no text or no English');

const revs = await db.collection('page_revisions')
  .find({ page_id: String(page._id), field: 'translation' })
  .sort({ created_at: 1 })
  .toArray();
// Each revision row stores the text it replaced; chain them by content hash so the order is
// the order the texts actually followed each other, not just the order the rows were written.
const versions = revs.map((r) => ({ data: r.data, hash: r.content_hash, after: r.after_content_hash, source: r.source, issue: r.issue, reason: r.reason, at: r.created_at }));
for (let k = 1; k < versions.length; k++) {
  if (versions[k].hash !== versions[k - 1].after) throw new Error(`revision chain broken at ${versions[k].source}`);
}
if (versions.length && versions[versions.length - 1].after !== page.translation.content_hash) {
  throw new Error('last revision does not lead to the live English');
}
const texts = [...versions.map((v) => excerpt(plain(v.data))), excerpt(plain(page.translation.data))];

const ocrLines = page.ocr.data.split('\n').map((l) => l.trim()).filter(Boolean);
if (ocrLines.length !== LINE_BANDS.length) throw new Error(`expected ${LINE_BANDS.length} typed lines, got ${ocrLines.length}`);
const flat = ocrLines.join('');
const fa = flat.indexOf(FORMULA_FROM);
const fb = flat.indexOf(FORMULA_TO);
if (fa < 0 || fb < 0) throw new Error('karma formula not found in the typed text');
const formula = flat.slice(fa, fb + FORMULA_TO.length);

const te = page.ocr.text_edition;
const al = page.ocr.alignment;
const out = {
  generated_at: new Date().toISOString(),
  owner_issue: 5846,
  book_id: BOOK_ID,
  book_title: book.title,
  book_public: book.visible === true,
  volume: VOLUME,
  section: SECTION,
  page_number: PAGE_NUMBER,
  folio: te.folio,
  image: {
    url: page.archived_photo,
    bdrc: page.photo,
    source_ref: page.source_ref,
    width: page.image_width,
    height: page.image_height,
    line_bands: LINE_BANDS,
  },
  typed: {
    name: te.name,
    repo: te.repo,
    commit: te.commit,
    path: te.path,
    licence: te.licence,
    lines: ocrLines,
    karma_formula: formula.split(/(?<=དང་།)\s*/),
  },
  alignment: {
    method: al.method,
    read_engine: al.read_engine,
    samples: al.samples,
    min_identity: al.min_identity,
    max_control: al.max_control,
  },
  draft: {
    model: revs[0]?.model ?? page.translation.model,
    drafted_at: revs[0]?.original_date ?? page.translation.updated_at,
    text: texts[0],
  },
  // One entry per repair pass, in order: what it changed in the excerpt, and why.
  repairs: versions.map((v, k) => ({
    source: v.source,
    issue: v.issue,
    reason: v.reason,
    at: v.at,
    diff: diff(texts[k], texts[k + 1]),
  })),
  published_text: texts[texts.length - 1],
};
// The draft with every pass's changes marked: [text, born, died], pass indexes into `repairs`.
out.tracked = track(texts[0], out.repairs.map((r) => r.diff)).map((s) => [s.t, s.born, s.died]);
const live = out.tracked.filter(([, , died]) => died == null).map(([t]) => t).join('');
if (live !== out.published_text) throw new Error('tracked changes do not rebuild the published text');

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}: folio ${out.folio}, ${ocrLines.length} lines, ${out.repairs.length} repair passes`);
for (const r of out.repairs) console.log(`  ${r.source}: ${r.diff.filter(([k]) => k !== 'same').length} changed runs`);
await client.close();
