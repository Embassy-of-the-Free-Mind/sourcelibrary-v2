#!/usr/bin/env node
/**
 * #6056 / #4572 — fill `published` on live books that say "Unknown" while the dating run (#6721) read the edition
 * year off the book's own title page or colophon with a quoted imprint (class `published-unknown-title-page-dated`,
 * scripts/audit/catalogue-field-contradictions.mjs; 3,982 live books on 2026-10-20). Approved by Derek 2026-10-20.
 *
 * PRIOR ART: scripts/maintenance/apply-byline-proposals-3894.mjs — the shape copied here (dry run by default,
 * merge-on-id backup with --revert, sweep_log + field_provenance rows, books_catalog mirror, revalidate). It writes
 * `author` from a proposals file; this one writes `published` from source_work_dates_meta.edition, through
 * setCatalogueFields() (scripts/lib/catalogue-fields.mjs, the gated imprint write path, #6327).
 * scripts/maintenance/correct-imprint-from-titlepage.mjs is the one-book CLI for the same field.
 *
 * WHAT IT WRITES, per book that passes every rule below:
 *   - `books.published` → the edition year as a string ("1695"), or the edition `display` when the edition is a
 *     plain range ("1891-1894"). Never a place or a printer. `year` is not touched (#3307 owns it).
 *   - the field_provenance stamp + history entry (setCatalogueFields), and one `field_provenance` collection row.
 *   - one `sweep_log` row, written BEFORE the book write.
 *   - `books_catalog.published` with `updated_at`.
 * Then revalidates /book/<id> in batches.
 *
 * EXCLUDED, first matching reason wins (counts printed and written to the plan):
 *   published-not-unknown    `published` is no longer a placeholder (also re-checked at write time)
 *   human-edited             a field_provenance stamp, history entry or collection row for `published` that a person
 *                            wrote, or source_work_dates_meta.edited_by
 *   portrait-or-life-date    the evidence is a caption: aetatis / florvit / natus / obiit … (spot check: "FLORVIT ANNO
 *                            1659 ET AETATIS XXXIX" is a sitter's age)
 *   cjk-script               the evidence is in Chinese/Japanese/Korean (spot check: a Siku collation date, 1779)
 *   era-formula              a reign or non-Christian era (Samvat, Śaka, Hijri, Qianlong …) the year was converted from
 *   hand-note                the evidence mentions handwriting, a pencil note, an MS. date, or a reader's "vid. in fine"
 *   release-or-copy-date     a digital release ("Release date: May 17, 2008") or the date a copy was made
 *   other-volume             the date was read off a sibling volume (`from_book`), not this book's leaves
 *   other-year-in-evidence   the span prints another year outside the edition window ("ŚAKE 1807. on 05 July 2013.
 *                            A. C. 1886." gave 2013, the scan date)
 *   year-not-printed         the year is not printed in the evidence in Arabic or Roman figures
 *   label-or-describing      the evidence reads like a library label or a sentence about the scan (date-works screens)
 *   display-not-plain        the display is prose ("1585 or soon after", "1945 (reprint …)"), not "YYYY" or "YYYY-YYYY"
 *   evidence-page-not-found  the evidence is not on any of the leaves the dater read, so there is no page to cite
 *
 * Usage (node --env-file=/root/sourcelibrary/.env.production.local …):
 *   fill-published-from-title-page-6056.mjs                       plan (dry run; writes the plan file only)
 *   fill-published-from-title-page-6056.mjs --sample 20 --seed N  plan + a seeded draw for the by-eye check
 *   fill-published-from-title-page-6056.mjs --apply               write
 *   fill-published-from-title-page-6056.mjs --revert [--apply]    put back every `before` the backup holds
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { setCatalogueFields } from '../lib/catalogue-fields.mjs';
import { findImprint, loose, DESCRIBING, LABEL } from '../lib/date-works.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';
import { makeRng } from '../eval/lib/paired-stats.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'eval', 'results', 'published-fill-6056');
const BACKUP = join(RESULTS, 'backup.json');
const RUN = 'published-fill-6056';
const SCRIPT = 'scripts/maintenance/fill-published-from-title-page-6056.mjs';
const METHOD = 'title-page imprint via dating run #6721';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = +opt('sample', 0);
const SEED = +opt('seed', 20261020);
const PLAN = opt('plan', join(process.env.JOB_SCRATCH || '/tmp', 'published-fill-6056-plan.jsonl'));

// Same set as the audit that defines the class.
export const UNKNOWN_PUBLISHED = new Set(['', 'unknown', 'n.d', 'n.d.', '[n.d.]', 's.d.', 's.d', '[s.d.]', 'undated']);
const isUnknown = (v) => UNKNOWN_PUBLISHED.has(v == null ? '' : String(v).trim().toLowerCase());

export const LIFE_DATE = /\b(?:aetat\w*|florvit|floruit|natus|obiit|denatus)\b/i; // "anno aetatis" is covered by aetat\w*
export const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;
export const ERA = /\b(samvat|sa[mṃ]vat|[sś]ak[ae]|shaka|hijr\w*|a\.\s?h\.|kangxi|yongzheng|qianlong|jiaqing|daoguang|xianfeng|tongzhi|guangxu|xuantong|meiji|taish[oō]|sh[oō]wa|kaei|ansei|bunsei|tenp[oō]|kyōhō|rabjung|regni)\b|संवत|शक|शके|ई०|हिजरी|هجر|سنة|ཟླ|ལོ་/iu;
export const HAND = /hand(?:written|schrift\w*)?\b|by hand|pencil|manuscript note|\bms\.|\bvid\. in fine|inscri(?:bed|ption)/i;
export const RELEASE = /release date|posting date|e-?text|vervaardigd|copied by|abgeschrieben/i;
const PLAIN_RANGE =/^\d{4}\s*[-–—/]\s*\d{2,4}$/;
const HUMAN_SOURCE = /admin|editor|manual|human|by[-_ ]?hand|curator|platform|derek|user/i;

/** The value to write, or null with a reason. Pure: tested by the by-eye draw, not by a fixture. */
export function judge(b, prov) {
  const ed = b.source_work_dates_meta?.edition;
  if (!isUnknown(b.published)) return { reason: 'published-not-unknown' };
  const stamps = [b.field_provenance?.published, ...(b.field_provenance_history?.published || []), ...prov].filter(Boolean);
  if (b.source_work_dates_meta?.edited_by || stamps.some((s) => s.edited_by || s.user || HUMAN_SOURCE.test(`${s.source || ''} ${s.method || ''}`))) return { reason: 'human-edited' };
  const ev = String(ed.evidence || '');
  if (LIFE_DATE.test(ev)) return { reason: 'portrait-or-life-date' };
  if (CJK.test(ev)) return { reason: 'cjk-script' };
  if (ERA.test(ev) || ERA.test(String(ed.display || ''))) return { reason: 'era-formula' };
  if (HAND.test(ev)) return { reason: 'hand-note' };
  if (RELEASE.test(ev)) return { reason: 'release-or-copy-date' };
  if (ed.from_book) return { reason: 'other-volume' };
  const others = [...ev.matchAll(/(?<!\d)(1[4-9]\d\d|20[0-3]\d)(?!\d)/g)].map((m) => +m[1]).filter((y) => y < ed.from || y > ed.to);
  if (others.length) return { reason: 'other-year-in-evidence' };
  if (!findImprint(ev, ed.year)) return { reason: 'year-not-printed' };
  if (!ed.rule && (DESCRIBING.test(ev) || LABEL.test(ev))) return { reason: 'label-or-describing' };
  const range = ed.from !== ed.to;
  if (range && !PLAIN_RANGE.test(String(ed.display).trim())) return { reason: 'display-not-plain' };
  if (!range && String(ed.display).trim() !== String(ed.year)) return { reason: 'display-not-plain' };
  return { value: range ? String(ed.display).trim() : String(ed.year) };
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function supabaseSet(id, published) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ published, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(b) ? b.length : 0 };
}
function mergeBackup(rows) {
  const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { run: RUN, entries: [] };
  const byId = new Map(prior.entries.map((e) => [e.book_id, e]));
  for (const r of rows) if (!byId.has(r.book_id)) byId.set(r.book_id, r);
  mkdirSync(dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify({ run: RUN, entries: [...byId.values()] }, null, 0).replace(/},{/g, '},\n{'));
}
async function revalidate(id) {
  if (!process.env.CRON_SECRET) return false;
  const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  return !!r?.ok;
}
async function revalidateAll(ids) {
  let ok = 0;
  for (let i = 0; i < ids.length; i += 8) {
    const res = await Promise.all(ids.slice(i, i + 8).map(revalidate));
    ok += res.filter(Boolean).length;
    if (i % 400 === 0) console.log(`  revalidated ${ok}/${Math.min(i + 8, ids.length)}`);
  }
  return ok;
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`no backup at ${BACKUP}`); process.exit(1); }
  const { entries } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0, changed = 0;
  const done = [];
  for (const e of entries) {
    const b = await books.findOne({ id: e.book_id }, { projection: { published: 1 } });
    if (!b || b.published !== e.after.published) { changed++; continue; } // edited since: leave it
    if (!APPLY) { n++; continue; }
    await recordSweepAction(db, { sweep: RUN, book_id: e.book_id, action: 'published-reverted', detail: { from: e.after.published, to: e.before.published } });
    const r = await setCatalogueFields(db, e.book_id, { published: e.before.published }, { source: 'revert', script: SCRIPT, run: RUN, method: `revert of ${RUN}` });
    if (r.modified) { n++; done.push(e.book_id); await supabaseSet(e.book_id, e.before.published); }
  }
  if (APPLY) await revalidateAll(done);
  console.log(APPLY ? `reverted ${n} of ${entries.length}` : `would revert ${n} of ${entries.length} (add --apply)`, `· ${changed} changed since, left alone`);
  await mc.close(); process.exit(0);
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const cands = await books.find({ visible: true, pages_count: { $gt: 0 }, 'source_work_dates_meta.edition.basis': { $in: ['title_page', 'colophon'] } }, {
  projection: { _id: 0, id: 1, title: 1, published: 1, pages_count: 1, field_provenance: 1, field_provenance_history: 1, 'source_work_dates_meta.edition': 1,
    'source_work_dates_meta.edited_by': 1, 'source_work_dates_meta.run_id': 1 },
}).toArray();
const inClass = cands.filter((b) => { const ed = b.source_work_dates_meta.edition; return isUnknown(b.published) && typeof ed.year === 'number' && ed.evidence; });
console.log(`class published-unknown-title-page-dated: ${inClass.length} live books`);
const provRows = await db.collection('field_provenance').find({ book_id: { $in: inClass.map((b) => b.id) }, field: 'published' }).toArray();
const provBy = new Map();
for (const r of provRows) provBy.set(r.book_id, [...(provBy.get(r.book_id) || []), r]);

const plan = [];
const reasons = {};
for (const b of inClass) {
  const j = judge(b, provBy.get(b.id) || []);
  plan.push({ id: b.id, title: String(b.title || '').slice(0, 100), before: b.published ?? null, ...j, edition: b.source_work_dates_meta.edition, pages_count: b.pages_count, dating_run: b.source_work_dates_meta.run_id ?? null });
  if (j.reason) reasons[j.reason] = (reasons[j.reason] || 0) + 1;
}

// locate the evidence leaf: pages ≤ 12 for a title page, the last four for a colophon (what the dater read)
const toFind = plan.filter((p) => p.value);
for (let i = 0; i < toFind.length; i += 150) {
  const chunk = toFind.slice(i, i + 150);
  const rows = await db.collection('pages').find({
    $or: chunk.map((p) => (p.edition.basis === 'colophon' ? { book_id: p.id, page_number: { $gt: p.pages_count - 4 } } : { book_id: p.id, page_number: { $lte: 12 } })),
    'ocr.data': { $type: 'string', $ne: '' },
  }, { projection: { _id: 0, book_id: 1, page_number: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1, text: { $substrCP: ['$ocr.data', 0, 2400] } }, maxTimeMS: 120_000 }).toArray();
  const by = new Map();
  for (const r of rows) by.set(r.book_id, [...(by.get(r.book_id) || []), r]);
  for (const p of chunk) {
    const want = loose(p.edition.evidence);
    const hit = (by.get(p.id) || []).sort((a, b) => a.page_number - b.page_number)
      .find((r) => loose(stripMarkupTags(stripEditorialWrappers(r.text || '') || '', ' ')).includes(want));
    if (hit) { p.page = hit.page_number; p.image = getPageSource(hit); } else {
      p.reason = 'evidence-page-not-found'; reasons[p.reason] = (reasons[p.reason] || 0) + 1; delete p.value;
    }
  }
  if (i % 1500 === 0) console.log(`  located ${Math.min(i + 150, toFind.length)}/${toFind.length}`);
}
const ready = plan.filter((p) => p.value);
writeFileSync(PLAN, plan.map((p) => JSON.stringify(p)).join('\n') + '\n');
console.log(`\nwould write: ${ready.length}   excluded: ${plan.length - ready.length}`);
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`plan → ${PLAN}`);

if (SAMPLE) {
  const rng = makeRng(SEED);
  const pool = [...ready];
  const draw = [];
  while (draw.length < SAMPLE && pool.length) draw.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  mkdirSync(RESULTS, { recursive: true });
  const f = join(RESULTS, `sample-seed${SEED}.json`);
  writeFileSync(f, JSON.stringify({ seed: SEED, rng: 'mulberry32 (paired-stats makeRng)', pool: ready.length, n: draw.length,
    rows: draw.map((p) => ({ id: p.id, title: p.title, value: p.value, page: p.page, image: p.image, basis: p.edition.basis, rule: p.edition.rule ?? null, evidence: p.edition.evidence,
      url: `https://sourcelibrary.org/book/${p.id}?page=${p.page}` })) }, null, 1));
  console.log(`sample of ${draw.length} → ${f}`);
}

if (!APPLY) { console.log('\n-- dry run (nothing written) --'); await mc.close(); process.exit(0); }

// ── apply ────────────────────────────────────────────────────────────────────────────────────────────────────────
const at = new Date().toISOString();
mergeBackup(ready.map((p) => ({ book_id: p.id, before: { published: p.before }, after: { published: p.value }, page: p.page, at })));
console.log(`backup (${ready.length} entries) → ${BACKUP}`);
let wrote = 0, sb = 0;
const skipped = [], written = [];
for (const p of ready) {
  const cur = await books.findOne({ id: p.id }, { projection: { published: 1 } });
  if (!cur || !isUnknown(cur.published)) { skipped.push([p.id, `published now ${JSON.stringify(cur?.published)}`]); continue; }
  const evidence = { quote: p.edition.evidence, page_number: p.page, basis: p.edition.basis, rule: p.edition.rule ?? null, dating_run: p.dating_run };
  await recordSweepAction(db, { sweep: RUN, book_id: p.id, action: 'published-from-title-page', detail: { before: p.before, after: p.value, page_number: p.page, evidence: p.edition.evidence } });
  let r;
  try {
    r = await setCatalogueFields(db, p.id, { published: p.value }, { source: 'title_page_imprint', script: SCRIPT, run: RUN, method: METHOD, evidence });
  } catch (e) { skipped.push([p.id, e.message]); continue; }
  if (!r.modified) { skipped.push([p.id, 'nothing to change']); continue; }
  wrote++; written.push(p.id);
  await db.collection('field_provenance').insertOne({ book_id: p.id, field: 'published', value: p.value, previous_value: p.before, source: 'title_page_imprint', method: METHOD, run: RUN, evidence, created_at: new Date() });
  const s = await supabaseSet(p.id, p.value);
  if (s.ok && s.rows > 0) sb++;
  if (wrote % 250 === 0) console.log(`  wrote ${wrote}`);
}
console.log(`\n-- applied --\n  written: ${wrote} · books_catalog mirrored: ${sb} · skipped: ${skipped.length}`);
for (const [id, why] of skipped) console.log(`      ${id}  ${why}`);
console.log(`  revalidated: ${await revalidateAll(written)} of ${written.length}`);
await mc.close();
