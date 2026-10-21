#!/usr/bin/env node
/**
 * Audit: on an English-original book, is the text we SERVE the author's words? (#7100)
 *
 * PRIOR ART: scripts/audit/translation-state-audit.mjs — the seeded weekly sample, the
 *   three-value exit, the positive control that makes a run `probe_broken` when it does not
 *   fire, and the one-open-issue filing via .github/scripts/file-or-update-issue.sh; copied in
 *   shape. scripts/audit/ia-model-ocr-off-leaf.mjs compares OCR with neighbouring leaves, not
 *   served English with its own OCR. Nothing measured the served door on English books.
 *
 * WHY. Before #5384 the translate lanes ran English pages through the translator, and the
 * reader and quote API serve that stored "translation" ahead of the transcription. On 2,173
 * English-original books, 578 served a paraphrase or another text (#7100: Hall's "WHEN
 * confronted with a problem involving the use of the reasoning faculties" is served as "When
 * faced with a problem that requires the use of reason"). Once the serving fix lands, every
 * English leaf should be served from its OCR (`text_source: ocr_original`). This detector
 * is what keeps it that way.
 *
 * HOW
 *   1. FRAME. Live books (visible, pages_count > 0) that are English-original
 *      (`translation_state.english_original`, or isEnglishOriginal(books.language)) and hold
 *      stored translations. One seeded page per book with both OCR and translation.
 *   2. STORED. Word-bigram overlap of the stored translation against the page's own OCR
 *      (scripts/lib/english-served-divergence.mjs). A leaf that is not purely English
 *      (`isEnglishOriginalPage` false: Loeb facing pages, Irish, Sanskrit…) is `bilingual`
 *      and out of scope: a translation is the right thing to serve there. An English leaf
 *      under SAME_TEXT_OVERLAP is a CANDIDATE: its stored English is not the transcription.
 *   3. SERVED. Each candidate (capped, seeded order) is requested from the public quote API,
 *      `/api/books/<id>/quote?page=N`. `text_source: ocr_original` = verbatim. A translation
 *      served on an English leaf is measured against the OCR; under SAME_TEXT_OVERLAP it
 *      DIVERGES. That is the finding.
 *   4. POSITIVE CONTROL, every run. Hall's *Secret Teachings* p.40 (stored paraphrase, kept
 *      in the data on purpose; #7100) is put through the same comparator as if it were
 *      served; it must come back `diverges`. A control that does not fire, or a probe set
 *      where more than 10% of responses are unreadable (rate limit, crawler page, 5xx),
 *      makes the run `probe_broken`.
 *
 * Before the serving fix this flags Hall and most of the 578 (#7100 table). After it,
 * the served count should be 0. Stored divergence is reported, never failed: the data is
 * kept on purpose (#7100 "Keep the data; no deletion").
 *
 * READS ONLY. Nothing is written to Mongo or Supabase. Each probe is one page served by
 * the quote API, so it counts against this box's anonymous daily page budget (api-budget.ts);
 * keep --max-probes well under it. With --file-issue it files or comments on ONE GitHub
 * issue (title prefix below) and closes it on the next PASS.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/english-served-divergence.mjs
 *   node … --seed $(date +%G%V) --max-probes 200 --file-issue --json /var/log/sourcelibrary/english-served-divergence-last.json
 *   node … --include 69a5526e1e2c2347112f0300   # force a book into the sample (and probe it first)
 *   node … --no-probe                            # stored overlap only; no HTTP, verdict probe_broken
 *
 * EXIT: 0 = PASS, 1 = FAIL (served English diverges from an English leaf), 2 = could not run or probe_broken.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { isEnglishOriginal } from '../lib/page-counts.mjs';
import {
  bigramOverlap, isEnglishOriginalPage, servedVerdict, SAME_TEXT_OVERLAP,
} from '../lib/english-served-divergence.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flag = (f, d) => (has(f) ? args[args.indexOf(f) + 1] : d);
const all = (f) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}${String(week).padStart(2, '0')}`;
}

const SEED = String(flag('--seed', isoWeek()));
const MAX_PROBES = Number(flag('--max-probes', 200));
const INCLUDE = all('--include');
const JSON_OUT = flag('--json', null);
const FILE_ISSUE = has('--file-issue');
const NO_PROBE = has('--no-probe');
const SITE = String(flag('--site', 'https://sourcelibrary.org')).replace(/\/$/, '');
// No "http"/"bot"/"curl" in the UA: proxy.ts's looksLikeBot would put the run on the
// 10-requests-a-minute crawler limiter and answer with the crawler pitch instead of JSON.
const UA = 'sl-audit english-served-divergence/1 (issue 7100)';
const ISSUE_PREFIX = 'English served divergence: ';
const CONTROL = { book: '69a5526e1e2c2347112f0300', page: 40 };
const UNREADABLE_MAX = 0.1;

const log = (s) => console.log(s);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const seededKey = (s) => sha(SEED + s);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

// ── 1. frame ─────────────────────────────────────────────────────────────────
async function frameBooks(db) {
  const rows = await db.collection('books').find({
    visible: true, pages_count: { $gt: 0 },
    $or: [{ 'translation_state.english_original': true }, { language: { $regex: /^\s*(english|en|eng)\b/i } }],
  }, { projection: { _id: 1, id: 1, title: 1, language: 1, pages_count: 1, pages_translated: 1, 'translation_state.english_original': 1, 'translation_state.translated': 1 } }).toArray();
  const frame = rows.filter((b) => (b.translation_state?.english_original || isEnglishOriginal(b.language))
    && ((b.translation_state?.translated ?? b.pages_translated ?? 0) > 0));
  for (const id of INCLUDE) {
    if (frame.some((b) => (b.id || String(b._id)) === id)) continue;
    const b = await db.collection('books').findOne({ id }, { projection: { _id: 1, id: 1, title: 1, language: 1, pages_count: 1 } });
    if (!b) throw new Error(`--include ${id}: no such book`);
    frame.push(b);
  }
  return frame;
}

// One seeded page per book: the first translated page at or after a seeded position.
async function samplePage(pages, book) {
  const id = book.id || String(book._id);
  const at = 1 + (parseInt(seededKey(id).slice(0, 8), 16) % Math.max(1, book.pages_count || 1));
  const proj = { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.source': 1 } };
  const q = { book_id: id, 'translation.data': { $exists: true, $ne: '' }, 'ocr.data': { $exists: true, $ne: '' } };
  return (await pages.find({ ...q, page_number: { $gte: at } }, proj).sort({ page_number: 1 }).limit(1).next())
    || pages.find({ ...q, page_number: { $lt: at } }, proj).sort({ page_number: -1 }).limit(1).next();
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const at = i++; out[at] = await fn(items[at]); }
  }));
  return out;
}

// ── 3. served probe ──────────────────────────────────────────────────────────
async function probe(book, page) {
  try {
    const res = await fetch(`${SITE}/api/books/${encodeURIComponent(book)}/quote?page=${page}`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    let j;
    try { j = JSON.parse(body); } catch { return { unreadable: `HTTP ${res.status}, not JSON: ${body.slice(0, 60).replace(/\s+/g, ' ')}` }; }
    if (!res.ok) return res.status === 404 ? { gone: `HTTP 404 ${j.error || ''}`.trim() } : { unreadable: `HTTP ${res.status} ${j.error || ''}`.trim() };
    const q = j.quote || {};
    return { textSource: q.text_source ?? null, servedText: q.translation ?? q.original ?? '' };
  } catch (e) { return { unreadable: e.message }; }
}

// ── report ───────────────────────────────────────────────────────────────────
function fileIssue(report) {
  const body = `${process.env.TMPDIR || '/tmp'}/english-served-divergence-issue-${process.pid}.md`;
  const block = '```json\n' + JSON.stringify({
    seed: report.seed, frame: report.frame, sampled: report.sampled, stored: report.stored,
    probed: report.served.probed, diverging: report.served.diverging.slice(0, 25), unreadable: report.served.unreadable.slice(0, 10),
    control: report.control,
  }, null, 1) + '\n```';
  const day = report.checked_at.slice(0, 10);
  try {
    const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--search', `"${ISSUE_PREFIX}" in:title`, '--json', 'number,title'], { encoding: 'utf8' }))
      .filter((i) => i.title.startsWith(ISSUE_PREFIX));
    if (report.verdict !== 'PASS') {
      const head = report.verdict === 'FAIL'
        ? `${report.served.diverging.length} of ${report.served.probed} probed English leaves serve English that is not their transcription`
        : report.broken.join('; ');
      fs.writeFileSync(body, `Weekly \`scripts/audit/english-served-divergence.mjs\` (seed ${report.seed}): **${report.verdict}**: ${head}.\n\n` +
        'Reading it: on an English-original leaf the reader, the quote API and every export should serve the transcription (`text_source: ocr_original`). ' +
        'A `diverges` row is a stored model "translation" served in its place, a paraphrase or another leaf\'s text (#7100). Find which door serves it (`resolveQuoteText`, the reader page, `/text`) before touching data; the stored text is kept on purpose. ' +
        'Another leaf\'s text, confirmed with the image open, is contained (`.claude/docs/invariants/containment-on-finding.md`). ' +
        '`probe_broken` means the quote API answered unreadably or the Hall control did not fire: fix the audit, the corpus is not judged.\n\n' + `${block}\n`);
      execFileSync('bash', ['.github/scripts/file-or-update-issue.sh', ISSUE_PREFIX, `${ISSUE_PREFIX}${report.verdict}: ${head} (${day})`, body, 'bug'], { stdio: 'inherit' });
    } else {
      for (const i of open) {
        fs.writeFileSync(body, `This week's run (seed ${report.seed}) passes: ${report.served.probed} probed English leaves, none serving English that differs from the transcription. Closing; the next failing run files again.\n\n${block}\n`);
        execFileSync('gh', ['issue', 'close', String(i.number), '--comment', fs.readFileSync(body, 'utf8')], { stdio: 'inherit' });
      }
    }
  } catch (e) {
    log(`could not file/close the issue: ${e.message}`);
  }
}

const client = new MongoClient(uri);
let exit = 2;
try {
  await client.connect();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const now = new Date();

  const frame = await frameBooks(db);
  const sampled = await pool(frame, 8, async (b) => {
    const id = b.id || String(b._id);
    const p = await samplePage(pages, b);
    if (!p) return { id, title: b.title, status: 'no_page' };
    if (p.translation?.source && !['ai', 'batch_api', 'system'].includes(p.translation.source)) {
      // Human-edited English is someone's deliberate text, not a model's rewrite.
      return { id, title: b.title, page: p.page_number, status: 'human_edited' };
    }
    if (!isEnglishOriginalPage(p.ocr.data)) return { id, title: b.title, page: p.page_number, status: 'bilingual' };
    const overlap = bigramOverlap(p.translation.data, p.ocr.data);
    if (overlap === null) return { id, title: b.title, page: p.page_number, status: 'unjudged' };
    return { id, title: b.title, page: p.page_number, overlap: r3(overlap), status: overlap >= SAME_TEXT_OVERLAP ? 'same' : 'candidate', ocr: p.ocr.data };
  });

  const by = (s) => sampled.filter((r) => r.status === s);
  const candidates = by('candidate').sort((a, b) => {
    const fa = INCLUDE.includes(a.id) ? 0 : 1; const fb = INCLUDE.includes(b.id) ? 0 : 1;
    return fa - fb || (seededKey(a.id) < seededKey(b.id) ? -1 : 1);
  });
  const bins = { '0.6-0.9': 0, '0.3-0.6': 0, '<0.3': 0 };
  for (const c of candidates) bins[c.overlap >= 0.6 ? '0.6-0.9' : c.overlap >= 0.3 ? '0.3-0.6' : '<0.3']++;

  // Control: Hall p.40's stored paraphrase must read as diverging if served.
  const ctl = await pages.findOne({ book_id: CONTROL.book, page_number: CONTROL.page }, { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1 } });
  const ctlV = ctl?.translation?.data ? servedVerdict({ ocrData: ctl.ocr?.data, servedText: ctl.translation.data, textSource: 'translation' }) : null;
  const control = { book: CONTROL.book, page: CONTROL.page, got: ctlV?.verdict ?? 'missing', overlap: r3(ctlV?.overlap), ok: ctlV?.verdict === 'diverges' };

  const served = { probed: 0, verbatim: 0, diverging: [], gone: [], unreadable: [], bilingual: 0, unjudged: 0, cap: MAX_PROBES, candidates: candidates.length };
  if (!NO_PROBE) {
    for (const c of candidates.slice(0, MAX_PROBES)) {
      const r = await probe(c.id, c.page);
      if (r.unreadable) { served.unreadable.push({ id: c.id, page: c.page, reason: r.unreadable }); continue; }
      if (r.gone) { served.gone.push({ id: c.id, page: c.page, reason: r.gone }); continue; }
      served.probed++;
      const v = servedVerdict({ ocrData: c.ocr, servedText: r.servedText, textSource: r.textSource });
      if (v.verdict === 'verbatim') served.verbatim++;
      else if (v.verdict === 'bilingual') served.bilingual++;
      else if (v.verdict === 'unjudged') served.unjudged++;
      else served.diverging.push({ id: c.id, page: c.page, title: (c.title || '').slice(0, 60), text_source: r.textSource, overlap: r3(v.overlap), url: `${SITE}/book/${c.id}?page=${c.page}` });
      await new Promise((ok) => setTimeout(ok, 300));
    }
  }
  const attempted = served.probed + served.unreadable.length + served.gone.length;
  const broken = [
    ...(control.ok ? [] : [`the Hall control did not fire (got ${control.got})`]),
    ...(NO_PROBE ? ['--no-probe: the served doors were not measured'] : []),
    ...(attempted && served.unreadable.length / attempted > UNREADABLE_MAX ? [`${served.unreadable.length} of ${attempted} probes unreadable (first: ${served.unreadable[0].reason})`] : []),
  ];
  const verdict = broken.length ? 'probe_broken' : served.diverging.length ? 'FAIL' : 'PASS';
  exit = verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2;

  const report = {
    checked_at: now.toISOString(), seed: SEED, verdict, broken, control,
    frame: frame.length,
    sampled: { books: sampled.length, no_page: by('no_page').length, human_edited: by('human_edited').length, bilingual: by('bilingual').length, unjudged: by('unjudged').length, same: by('same').length, candidates: candidates.length },
    stored: { overlap_bins: bins, forced: INCLUDE },
    served: { ...served, unreadable: served.unreadable.slice(0, 50) },
  };

  log(`english-served-divergence — seed ${SEED}, ${report.checked_at}`);
  log(`\n1. frame: ${frame.length.toLocaleString('en-US')} live English-original books with stored translations${INCLUDE.length ? ` (+ forced ${INCLUDE.join(', ')})` : ''}`);
  log(`   one page each: ${report.sampled.same} near-copy (≥ ${SAME_TEXT_OVERLAP}), ${candidates.length} stored English differs, ${report.sampled.bilingual} bilingual/non-English leaf, ${report.sampled.unjudged} too short, ${report.sampled.human_edited} human-edited, ${report.sampled.no_page} no page with both texts`);
  log(`2. stored divergence on English leaves (reported, not failed): ${Object.entries(bins).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  log(`3. served (quote API), ${NO_PROBE ? 'NOT PROBED' : `${served.probed} probed of ${candidates.length} candidates (cap ${MAX_PROBES})`}: ${served.verbatim} verbatim, ${served.diverging.length} DIVERGE, ${served.bilingual} bilingual, ${served.unjudged} unjudged, ${served.gone.length} 404, ${served.unreadable.length} unreadable`);
  for (const d of served.diverging.slice(0, 20)) log(`   diverges  ${String(d.overlap).padEnd(5)} ${d.url}  "${d.title}"`);
  for (const u of served.unreadable.slice(0, 5)) log(`   unreadable ${u.id} p${u.page}: ${u.reason}`);
  log(`4. control: Hall p.${CONTROL.page} stored paraphrase → ${control.got} (overlap ${control.overlap}) ${control.ok ? 'fired' : 'DID NOT FIRE'}`);
  log(`\n${verdict}${broken.length ? ' — ' + broken.join('; ') : served.diverging.length ? ` — ${served.diverging.length} English leaves serve English that is not their transcription` : ''}`);

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  if (FILE_ISSUE) fileIssue(report);
} catch (err) {
  console.error(`Audit could not run: ${err?.message || err}`);
  exit = 2;
} finally {
  await client.close().catch(() => {});
}
process.exit(exit);
