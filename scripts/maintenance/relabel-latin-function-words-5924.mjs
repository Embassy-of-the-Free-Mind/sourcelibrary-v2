#!/usr/bin/env node
/**
 * relabel-latin-function-words-5924.mjs — find books catalogued `Latin` whose pages are another
 * language (German Fraktur, French, Dutch …), from STORED OCR text only, and relabel them (#5924).
 *
 * PRIOR ART: scripts/maintenance/relabel-language-4884.mjs — the writer shape (sweep_log row,
 * field_provenance.language, live-job skip, guarded updateOne, --undo) is copied from it; its
 * candidate rule is script-family disagreement (Greek label / Latin letters), which cannot see a
 * German book filed as Latin because both are Latin script. scripts/lib/language-content-classify.mjs
 * is a stopword DENSITY classifier whose lists share words across languages (et, de, in, la, qui), so
 * a French page votes Latin; here only words exclusive to one language count. scripts/lib/page-language.mjs
 * reads the `<language>` tag only; here the tag is the SECOND instrument (language-fields.md, #4781).
 *
 * Phases ($0 throughout — no model call):
 *   --scan       6 spread pairs of consecutive OCR'd interior leaves per book (--redo-thin rescans rows with < 4), function-word counts per language, the page's own
 *                `<language>` tag, `<script>` tag and pages.script_type → scan.jsonl (resumable)
 *   --propose    flag Latin < 50% of function words; decide flip / mixed / review per book → proposals.jsonl
 *   --eye-sample 20 flags drawn at random for the by-eye gate                          → eye-sample.json
 *   --write      dry run unless --commit; precision gate must be recorded in gate.json first
 *   --undo       dry run unless --commit; restores every book from its sweep_log row
 *
 * Writes only `language`, `languages[]`, `language_multi`, `field_provenance.language`, `updated_at`
 * (and `original_language` when EMPTY on a translation edition, as #4884 did). A flip onto the language
 * the #3958 `language_review` queue already detected also clears that flag (restored by --undo). One sweep_log row per
 * book, logged BEFORE the book write. No page is written, so no page_revisions row exists to make.
 *
 * Env: RELABEL_5924_DIR (default $JOB_SCRATCH/out or scripts/eval/results/relabel-5924).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { stripOcrMetadata } from '../lib/language-content-classify.mjs';

export const SWEEP = 'relabel-latin-5924';
const DIR = path.resolve(process.env.RELABEL_5924_DIR || 'scripts/eval/results/relabel-5924');
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (f, d) => { const a = args.find((x) => x.startsWith(`--${f}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const inDir = (f) => path.join(DIR, f);

/**
 * Function words EXCLUSIVE to one language among the seven. Words two of them share (et, est, de, in,
 * la, le, non, per, qui, que, die, den, des, als, en, te, si) are left out on purpose: they are what
 * makes a French or Italian page read as Latin in a density count. Early-modern spellings included
 * (vnd, auff, daß, seyn, bey; ende, oock, sijn, aen).
 */
export const FW = {
  Latin: 'quod cum ad sed ut sunt enim hoc esse aut nam atque ab ex quae quam ipse autem etiam vel nec quia eius ejus ita igitur tamen ergo sicut quibus quoque inter apud sive seu ac sub eum eam eorum hic haec id iam jam dum quo qua sibi ubi tum tunc vero unde quidem nisi post propter omnia omnes omnibus',
  German: 'und vnd vnnd das ist nicht zu mit von sich auch auf auff ein eine einen einem einer im dem der wird werden für aus auß nach bei bey dass daß seyn sein seine ihr jhr aber oder ich sie wann wenn welche welcher welches durch diese dieser dieses nur haben hat kan kann dann denn wol wohl solche solchen mich mir uns vns ihm jhm ihn jhn sind seind',
  French: 'les du une dans pour avec sur au aux il ils elle ne pas nous vous leur cette ces ont sont estre être mais comme tout tous fait peut aussi ainsi dont luy lui par',
  Italian: 'della delle dello degli che di gli nel nella nelle alla alle dal dalla sono anche più piu questo questa quello quella come essere ancora ogni perche perché cosi così suo sua ed',
  Spanish: 'los las y el más como pero esta porque sobre sus para',
  Dutch: 'het een ende van niet zijn voor wordt door ook deze dese hij hy aan aen uit uyt ons haer haar maar sijn oock dat met op wel',
  English: 'the and of to that with which for this be are his it by not from have was they or but',
};
const FW_SETS = Object.fromEntries(Object.entries(FW).map(([k, v]) => [k, new Set(v.split(' '))]));
export const LANGS = Object.keys(FW);

/** Function-word counts for one page of OCR text. */
// The OCR model writes ENGLISH inside its own blocks (image descriptions, `<detected-images>` JSON,
// warnings). Left in, they read as English pages: a Latin MS of Digby 83 scored 76% English.
export function functionWordCounts(ocrData) {
  const t = stripOcrMetadata(String(ocrData || '').replace(/<(vocab|image-desc|detected-images|meta|warning|note)>[\s\S]*?<\/\1>/gi, ' '))
    .replace(/ſ/g, 's').toLowerCase();
  const words = t.match(/\p{L}+/gu) || [];
  const counts = Object.fromEntries(LANGS.map((l) => [l, 0]));
  for (const w of words) for (const l of LANGS) if (FW_SETS[l].has(w)) counts[l]++;
  const greek = (t.match(/[Ͱ-Ͽἀ-῿]/g) || []).length;
  return { counts, words: words.length, greek };
}

/** The OCR model's own per-page tags. `<language>` is current; `<lang>` is an older prompt's. */
export function pageTags(ocrData) {
  const s = String(ocrData || '').slice(0, 600);
  const lang = (s.match(/<(?:language|lang)>\s*([^<]{1,60}?)\s*<\/(?:language|lang)>/i) || [])[1] || null;
  const script = (s.match(/<script>\s*([^<]{1,60}?)\s*<\/script>/i) || [])[1] || null;
  return { lang: lang && lang.toLowerCase(), script: script && script.toLowerCase() };
}

/** `n` page numbers spread over the interior (skip the first 15% and last 5%, where apparatus lives). */
export function spreadPageNumbers(pagesCount, n) {
  const from = Math.max(1, Math.floor(pagesCount * 0.15)), to = Math.max(from, Math.ceil(pagesCount * 0.95));
  const span = to - from + 1;
  if (span <= n) return Array.from({ length: span }, (_, i) => from + i);
  return Array.from({ length: n }, (_, i) => from + Math.floor((i + 0.5) * span / n));
}

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 8 }); await client.connect();
  try { return await fn(client.db('bookstore')); } finally { await client.close(); }
}

const MIN_PAGE_WORDS = 60;
const PAIRS = 6; // 6 spread facing pairs = up to 12 leaves with body text

async function phaseScan() {
  fs.mkdirSync(DIR, { recursive: true });
  const out = inDir('scan.jsonl');
  if (has('redo-thin')) {
    // Drop rows sampled under the pages_count spread that found < 4 OCR'd leaves; they are rescanned.
    const keep = readJsonl(out).filter((r) => r.pages.length >= 4);
    fs.writeFileSync(out, keep.map((o) => JSON.stringify(o)).join('\n') + (keep.length ? '\n' : ''));
  }
  const done = new Set(readJsonl(out).map((r) => r.book_id));
  const limit = Number(arg('limit', 0)) || 0;
  await withDb(async (db) => {
    const frame = await db.collection('books').find(
      { language: 'Latin', pages_ocr: { $gte: 20 } },
      { projection: { id: 1, title: 1, author: 1, published: 1, language: 1, languages: 1, language_multi: 1, original_language: 1, text_role: 1, visible: 1, pages_count: 1, pages_ocr: 1, 'book_class.class': 1, 'image_source.provider': 1 } },
    ).toArray();
    fs.writeFileSync(inDir('frame.summary.json'), JSON.stringify({ at: new Date(), frame: frame.length, filter: "language: 'Latin', pages_ocr >= 20" }, null, 2));
    const todo = frame.filter((b) => !done.has(b.id)).slice(0, limit || undefined);
    console.log(`frame ${frame.length}; already scanned ${done.size}; to scan ${todo.length}`);
    const fd = fs.openSync(out, 'a');
    let n = 0;
    const worker = async (queue) => {
      for (let b; (b = queue.shift());) {
        // Spread over the leaves that HAVE OCR: on ~11K of these books OCR covers only part of the
        // book, so spreading over pages_count lands on unread leaves. And sample consecutive PAIRS:
        // an evenly stepped sample can land on one parity only, and a Loeb (Latin verso, English
        // recto) then reads as an English book — the first run proposed exactly that flip.
        const ocrd = (await db.collection('pages').find({ book_id: b.id, 'ocr.data': { $type: 'string' } }, { projection: { _id: 0, page_number: 1 } }).toArray())
          .map((p) => p.page_number).sort((x, y) => x - y);
        const want = spreadPageNumbers(Math.max(0, ocrd.length - 1), PAIRS).flatMap((i) => [ocrd[i - 1], ocrd[i]]).filter((n) => n != null);
        const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $in: want } }, { projection: { page_number: 1, script_type: 1, 'ocr.data': 1 } }).toArray();
        pages.sort((x, y) => x.page_number - y.page_number);
        const per = [];
        for (const p of pages) {
          if (typeof p.ocr?.data !== 'string') continue;
          const fw = functionWordCounts(p.ocr.data);
          if (fw.words < MIN_PAGE_WORDS) continue;
          per.push({ page_number: p.page_number, ...fw, ...pageTags(p.ocr.data), script_type: p.script_type ?? null });
        }
        const picked = per;
        fs.writeSync(fd, JSON.stringify({
          book_id: b.id, title: b.title || null, author: b.author || null, published: b.published || null, language: b.language,
          languages: b.languages ?? null, language_multi: b.language_multi ?? null, original_language: b.original_language ?? null,
          text_role: b.text_role ?? null, visible: !!b.visible, pages_count: b.pages_count, provider: b.image_source?.provider || null,
          book_class: b.book_class?.class || null, pages: picked,
        }) + '\n');
        if (++n % 500 === 0) console.log(`scanned ${n}/${todo.length}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, () => worker(todo)));
    fs.closeSync(fd);
    console.log(`scanned ${n}`);
  });
}

// ── --propose ──────────────────────────────────────────────────────────────────────────────────

/** Map an OCR page tag onto one of the seven names, or 'other' / null. Stages fold to the family. */
export function tagLang(tag) {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (/^(none|n\/a|unknown|null|-)$/.test(t)) return null;
  if (t.includes(',') || t.includes('/') || / and |-/.test(t)) return 'multi';
  for (const [re, l] of [[/latin|^la$|^lat$/, 'Latin'], [/german|deutsch|^de$|^deu$|^ger$/, 'German'], [/french|^fr$|^fra$/, 'French'], [/italian|^it$|^ita$/, 'Italian'], [/spanish|castil|^es$|^spa$/, 'Spanish'], [/dutch|flemish|^nl$|^nld$/, 'Dutch'], [/english|^en$|^eng$/, 'English']]) if (re.test(t)) return l;
  return 'other';
}

const MIN_BOOK_FW = 150; // fewer function words than this over the sample: too thin to judge
const PAGE_MIN_FW = 12;
const MIN_SPAN = 0.3; // sampled leaves must span this share of pages_count

export function decideBook(r) {
  const tot = Object.fromEntries(LANGS.map((l) => [l, 0]));
  let fwAll = 0, greek = 0;
  const pageDom = {};
  let judged = 0;
  for (const p of r.pages) {
    const s = LANGS.reduce((a, l) => a + p.counts[l], 0);
    for (const l of LANGS) tot[l] += p.counts[l];
    fwAll += s; greek += p.greek || 0;
    if (s >= PAGE_MIN_FW) {
      judged++;
      const top = LANGS.reduce((a, l) => (p.counts[l] > p.counts[a] ? l : a), 'Latin');
      // A page counts for a language only if that language holds a majority of its function words.
      const k = p.counts[top] / s >= 0.6 ? top : 'mixed-page';
      pageDom[k] = (pageDom[k] || 0) + 1;
    }
  }
  const share = Object.fromEntries(LANGS.map((l) => [l, fwAll ? +(tot[l] / fwAll).toFixed(3) : 0]));
  const other = LANGS.filter((l) => l !== 'Latin').reduce((a, l) => (tot[l] > tot[a] ? l : a), 'German');
  const tags = {};
  for (const p of r.pages) { const t = tagLang(p.lang); if (t) tags[t] = (tags[t] || 0) + 1; }
  const tagged = Object.values(tags).reduce((a, b) => a + b, 0);
  const handwritten = r.pages.filter((p) => p.script_type === 'handwritten' || /hand|manuscript|cursive|script(?!ura)/.test(p.script || '') && !/print|typeset|roman|italic|black|fraktur|gothic/.test(p.script || '')).length;
  const base = { share, other, pages_sampled: r.pages.length, pages_judged: judged, page_dominant: pageDom, tags, tagged, fw: fwAll, greek, handwritten };
  if (r.pages.length < 4 || fwAll < MIN_BOOK_FW) return { ...base, flag: false, decision: 'thin' };
  if (share.Latin >= 0.5) return { ...base, flag: false, decision: 'latin' };
  // OCR often covers only part of a book. A Loeb with OCR on leaves 1–25 is its English introduction,
  // and read as an English book; the sample must reach across the book before it can relabel it.
  const nums = r.pages.map((p) => p.page_number);
  const span = r.pages_count ? (Math.max(...nums) - Math.min(...nums) + 1) / r.pages_count : 0;
  base.span = +span.toFixed(2);
  if (span < MIN_SPAN) return { ...base, flag: true, decision: 'review', to: other, why: `sample spans ${base.span} of the book (OCR is partial): pages ${Math.min(...nums)}–${Math.max(...nums)} of ${r.pages_count}` };
  const latinPages = pageDom.Latin || 0, otherPages = pageDom[other] || 0;
  const tagOther = (tags[other] || 0) / (tagged || 1), tagLatin = (tags.Latin || 0) / (tagged || 1);
  let decision, why;
  if (share.Latin <= 0.15 && latinPages <= 1 && otherPages >= Math.max(3, Math.ceil(judged * 0.7)) && tagged >= 3 && tagOther >= 0.7) {
    decision = 'flip'; why = `${other} ${share[other]} of function words, ${otherPages}/${judged} pages ${other}-dominant; OCR tag ${other} on ${tags[other] || 0}/${tagged}`;
  } else if (latinPages >= 2 && otherPages >= 2 && (tags.Latin || 0) >= 1 && (tags[other] || 0) + (tags.multi || 0) >= 1) {
    decision = 'mixed'; why = `Latin on ${latinPages} pages, ${other} on ${otherPages} of ${judged}; tags Latin ${tags.Latin || 0} / ${other} ${tags[other] || 0} / multi ${tags.multi || 0}`;
  } else {
    decision = 'review'; why = `instruments do not agree: Latin share ${share.Latin}, ${other} ${share[other]}, pages ${JSON.stringify(pageDom)}, tags ${JSON.stringify(tags)}`;
  }
  return { ...base, flag: true, decision, to: other, why, tag_other_share: +tagOther.toFixed(2), tag_latin_share: +tagLatin.toFixed(2) };
}

const TRANSLATION_ROLES = new Set(['modern-translation', 'period-translation', 'translation']);

function phasePropose() {
  const rows = readJsonl(inDir('scan.jsonl'));
  const props = [], ms = [];
  const tally = {};
  for (const r of rows) {
    const d = decideBook(r);
    tally[d.decision] = (tally[d.decision] || 0) + 1;
    const head = { book_id: r.book_id, title: r.title, author: r.author, published: r.published, visible: r.visible, language: r.language, languages: r.languages, text_role: r.text_role, original_language: r.original_language, book_class: r.book_class, provider: r.provider, pages_count: r.pages_count };
    if (d.flag) props.push({ ...head, ...d, pages: r.pages.map((p) => ({ page_number: p.page_number, lang: p.lang, counts: p.counts })) });
    // Manuscript filed as print: catalogue (book_class) says printed, most sampled leaves say handwritten.
    if (r.book_class === 'printed' && r.pages.length >= 4 && d.handwritten / r.pages.length >= 0.6) {
      ms.push({ ...head, handwritten_pages: d.handwritten, sampled: r.pages.length, scripts: [...new Set(r.pages.map((p) => p.script || p.script_type))].slice(0, 5) });
    }
  }
  fs.writeFileSync(inDir('proposals.jsonl'), props.map((o) => JSON.stringify(o)).join('\n') + '\n');
  fs.writeFileSync(inDir('manuscript-filed-as-print.jsonl'), ms.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const byTo = {}; for (const p of props) { const k = `${p.decision} → ${p.to}`; byTo[k] = (byTo[k] || 0) + 1; }
  const summary = { at: new Date(), scanned: rows.length, decisions: tally, flagged: props.length, by_target: byTo, manuscript_filed_as_print: ms.length,
    flagged_translation_role: props.filter((p) => TRANSLATION_ROLES.has(p.text_role)).length, flagged_visible: props.filter((p) => p.visible).length };
  fs.writeFileSync(inDir('proposals.summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** 20 flags for the by-eye gate, stratified: flips first (they write `language`), then mixed. */
function phaseEyeSample() {
  const props = readJsonl(inDir('proposals.jsonl')).filter((p) => p.decision === 'flip' || p.decision === 'mixed');
  const r = rng(5924);
  const shuffled = props.map((p) => [r(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const flips = shuffled.filter((p) => p.decision === 'flip'), mixed = shuffled.filter((p) => p.decision === 'mixed');
  const nMixed = Math.min(mixed.length, Math.round(20 * mixed.length / (props.length || 1)) || (mixed.length ? 1 : 0));
  const sample = [...flips.slice(0, 20 - nMixed), ...mixed.slice(0, nMixed)];
  fs.writeFileSync(inDir('eye-sample.json'), JSON.stringify(sample.map((p) => ({ book_id: p.book_id, title: p.title, decision: p.decision, to: p.to, share: p.share, pages: p.pages.map((x) => x.page_number) })), null, 2));
  console.log(`eye sample: ${sample.length} (flip ${sample.length - nMixed}, mixed ${nMixed}) of ${props.length} writable flags`);
}

// ── --write / --undo ───────────────────────────────────────────────────────────────────────────

const IN_FLIGHT_STATUS = new Set(['ocr_queued', 'enrolled', 'ocr_processing', 'translating', 'translation_queued', 'processing']);
const LIVE_JOB = ['pending', 'processing', 'in_progress', 'running', 'submitted'];

async function booksWithLiveJobs(db, ids) {
  const live = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const j of await db.collection('jobs').find({ book_id: { $in: chunk }, status: { $in: LIVE_JOB } }, { projection: { book_id: 1, type: 1, status: 1 } }).toArray()) live.set(j.book_id, `jobs ${j.type} ${j.status}`);
  }
  const want = new Set(ids);
  for (const j of await db.collection('batch_jobs').find({ status: { $in: LIVE_JOB } }, { projection: { book_id: 1, book_ids: 1, type: 1, status: 1 } }).toArray()) {
    for (const id of [j.book_id, ...(j.book_ids || [])]) if (id && want.has(id)) live.set(id, `batch_jobs ${j.type} ${j.status}`);
  }
  return live;
}

async function phaseWrite() {
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const commit = has('commit');
  const gate = fs.existsSync(inDir('gate.json')) ? JSON.parse(fs.readFileSync(inDir('gate.json'), 'utf8')) : null;
  if (commit && !(gate && gate.correct / gate.checked >= 0.9 && gate.checked >= 20)) throw new Error('by-eye gate not passed (gate.json needs checked >= 20, precision >= 0.9)');
  const exclude = new Set(gate?.exclude || []);
  const props = readJsonl(inDir('proposals.jsonl')).filter((p) => (p.decision === 'flip' || p.decision === 'mixed') && (gate?.decisions || ['flip', 'mixed']).includes(p.decision));
  const written = [], skipped = [];
  await withDb(async (db) => {
    const books = db.collection('books');
    const done = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'relabel language' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
    const live = await booksWithLiveJobs(db, props.map((p) => p.book_id));
    for (const p of props) {
      if (exclude.has(p.book_id)) { skipped.push({ book_id: p.book_id, why: 'excluded at the by-eye gate' }); continue; }
      if (live.has(p.book_id)) { skipped.push({ book_id: p.book_id, why: `live job (${live.get(p.book_id)})` }); continue; }
      if (done.has(p.book_id)) { skipped.push({ book_id: p.book_id, why: 'already written' }); continue; }
      const b = await books.findOne({ id: p.book_id }, { projection: { id: 1, language: 1, languages: 1, language_multi: 1, original_language: 1, text_role: 1, visible: 1, 'field_provenance.language': 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, language_review: 1, language_review_detail: 1 } });
      if (!b) { skipped.push({ book_id: p.book_id, why: 'book not found' }); continue; }
      if (b.language !== 'Latin') { skipped.push({ book_id: p.book_id, why: `language changed since the scan (${JSON.stringify(b.language)})` }); continue; }
      const status = b.pipeline_auto?.status || null;
      if (!b.pipeline_auto?.hold && status && IN_FLIGHT_STATUS.has(status)) { skipped.push({ book_id: p.book_id, why: `pipeline status ${status}: possibly mid-run` }); continue; }
      // Mixed: the record keeps Latin first and gains the measured second language (rule 4: languages[0] = language).
      const after = p.decision === 'flip'
        ? { language: p.to, languages: [p.to], language_multi: false }
        : { language: 'Latin', languages: ['Latin', p.to], language_multi: true };
      const setOriginal = p.decision === 'flip' && TRANSLATION_ROLES.has(b.text_role) && !b.original_language ? 'Latin' : null;
      const now = new Date();
      const provenance = {
        source: SWEEP, value: after.language, chosen_from: 'page-text',
        claims: [
          { source: 'catalogue (previous value)', value: String(b.language) },
          { source: 'function-word share over stored OCR (6 spread leaf pairs)', value: `Latin ${p.share.Latin} / ${p.to} ${p.share[p.to]}` },
          { source: 'OCR <language> page tags', value: JSON.stringify(p.tags) },
        ],
        date: now,
      };
      // A flip that lands on the language the #3958 review queue already detected resolves that queue
      // item: clear the flag (before-values in the sweep row, restored by --undo). Mixed rows leave it.
      const clearReview = p.decision === 'flip' && b.language_review === true && String(b.language_review_detail?.detected || '').toLowerCase() === p.to.toLowerCase();
      const before = { language: b.language, languages: b.languages ?? null, language_multi: b.language_multi ?? null, field_provenance_language: b.field_provenance?.language ?? null,
        ...(clearReview ? { language_review: b.language_review, language_review_detail: b.language_review_detail ?? null } : {}) };
      const row = { book_id: b.id, title: p.title, decision: p.decision, visible: !!b.visible, text_role: b.text_role ?? null, before, after, original_language_set: setOriginal, review_cleared: clearReview, share: p.share, tags: p.tags };
      if (commit) {
        // Log first: a row whose book write then fails reads as "attempted", and --undo skips it harmlessly.
        await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'relabel language', detail: { decision: p.decision, why: p.why, before, after, ...(setOriginal ? { original_language_set: setOriginal } : {}), review_cleared: clearReview, share: p.share, tags: p.tags, pages: p.pages.map((x) => x.page_number) } });
        const res = await books.updateOne({ id: b.id, language: 'Latin' }, { $set: { ...after, ...(setOriginal ? { original_language: setOriginal } : {}), 'field_provenance.language': provenance, updated_at: now }, ...(clearReview ? { $unset: { language_review: '', language_review_detail: '' } } : {}) });
        if (res.modifiedCount !== 1) { await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'relabel not applied', detail: { why: 'changed underneath' } }); skipped.push({ book_id: p.book_id, why: 'not modified (changed underneath)' }); continue; }
      }
      written.push(row);
    }
  });
  fs.writeFileSync(inDir(commit ? 'written.jsonl' : 'write-dry-run.jsonl'), written.map((o) => JSON.stringify(o)).join('\n') + '\n');
  if (skipped.length) fs.writeFileSync(inDir(commit ? 'write-skipped.jsonl' : 'write-dry-run-skipped.jsonl'), skipped.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const t = {}; for (const w of written) { const k = `${w.decision} → ${w.after.language}${w.decision === 'mixed' ? ' +' + w.after.languages[1] : ''} | ${w.visible ? 'visible' : 'hidden'}`; t[k] = (t[k] || 0) + 1; }
  console.log(`${commit ? 'WROTE' : 'DRY RUN'}: ${written.length} books; skipped ${skipped.length}`);
  for (const [k, n] of Object.entries(t).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
  const st = {}; for (const x of skipped) { const k = x.why.replace(/\(.*\)/, ''); st[k] = (st[k] || 0) + 1; } console.log('skipped:', st);
}

/** Restore every book written by this sweep from its own sweep_log row. Skips a book relabelled again since. */
async function phaseUndo() {
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const commit = has('commit');
  await withDb(async (db) => {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'relabel language' }).toArray();
    const undone = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'undo relabel' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
    let n = 0, skipped = 0;
    for (const r of rows) {
      if (undone.has(r.book_id)) continue;
      const { before, after, original_language_set: orig } = r.detail;
      const set = { language: before.language, updated_at: new Date() }, unset = {};
      for (const k of ['languages', 'language_multi']) { if (before[k] == null) unset[k] = ''; else set[k] = before[k]; }
      if (before.field_provenance_language == null) unset['field_provenance.language'] = ''; else set['field_provenance.language'] = before.field_provenance_language;
      if (orig) unset.original_language = '';
      if (r.detail.review_cleared) { set.language_review = before.language_review; if (before.language_review_detail != null) set.language_review_detail = before.language_review_detail; }
      if (!commit) { n++; continue; }
      const res = await db.collection('books').updateOne({ id: r.book_id, language: after.language }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      if (res.modifiedCount === 1) { n++; await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'undo relabel', detail: { restored: before } }); } else skipped++;
    }
    console.log(`${commit ? 'UNDONE' : 'DRY RUN, would undo'}: ${n}; skipped (label changed since): ${skipped}`);
  });
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  if (has('scan')) await phaseScan();
  else if (has('propose')) phasePropose();
  else if (has('eye-sample')) phaseEyeSample();
  else if (has('write')) await phaseWrite();
  else if (has('undo')) await phaseUndo();
  else console.log('usage: --scan [--limit=N] | --propose | --eye-sample | --write [--commit] | --undo [--commit]');
}
