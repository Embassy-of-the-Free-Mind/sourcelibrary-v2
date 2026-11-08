#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundaries.mjs — the corpus LEAK audit (sharedRun, the source-repeat
// exemption), but over the local mirror and the whole corpus, not "what was written yesterday". scripts/lib/neighbour-guard.mjs
// neighbourVerdict / neighbourGate in translate-core.mjs — the write-time rule this re-runs after the fact; it only sees
// writers that go through the door. scripts/lib/lane-book-list.mjs (lane_job_books, #7301) — opt-in per lane, so it
// cannot say what EVERY writer touched; pages.translation.updated_at (indexed) can.
/**
 * new-translation-leaks — the third layer of #5026: did any translation written in the last 24 h put a neighbouring
 * page's English on a page? The first two layers prevent it (the write-time neighbourGate, #8401; no previous-page
 * English in the prompt, #8410); this one would notice if something still gets through.
 *
 * Which writes: every page whose `translation.updated_at` is in the window (index { 'translation.updated_at': -1 }).
 * Every model writer stamps it — the door (translate-core writePageTranslation and its TS twin), the collectors, the
 * Lambda, hand edits. What it misses: a writer that sets translation.data without updated_at (none known), and a
 * restore that writes back an old updated_at (its text is not new).
 *
 * For each such book, from Atlas by { book_id, page_number } (indexed), every consecutive pair with at least one page
 * written in the window is flagged when either:
 *   - 'shared-run'  the two Englishes share a run >= RUN_MIN chars (leakNorm: editorial blocks and tags out) and the
 *                   two SOURCES share no LEAK_MIN_CHARS run (the book repeating itself), as the corpus audit does;
 *   - the guard's own verdict (neighbourVerdict, against that one neighbour, with the book's K) refuses the page
 *     written in the window: 'neighbour-leak' or 'absorbs-neighbour'.
 *
 * Output: <out-dir>/<YYYY-MM-DD>.jsonl, one line per flagged pair, and a summary line on stdout. A pair is NEW when
 * its key (book, pages, hash of the receiving page's English) is in no earlier file in out-dir. One ntfy line to
 * sourcelibrary-uptime when any new pair appears, naming book, pages, lane (translation.engine.call_site) and model.
 * Silent at zero, except Mondays: "checked N books, 0 leaks", so silence is visibly not breakage. A crash pages too.
 *
 * Read-only. No model calls.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/new-translation-leaks.mjs
 *        [--hours=24] [--since=ISO] [--books=id,id] [--out-dir=/data/scratch/sl/new-translation-leaks]
 *        [--date=YYYY-MM-DD] [--no-ntfy]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { sharedRun, leakNorm, neighbourVerdict, bookLengthRatioK, LEAK_MIN_CHARS } from '../lib/neighbour-guard.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';

export const RUN_MIN = 500;
export const NTFY_URL = 'https://ntfy.sh/sourcelibrary-uptime';
const DEFAULT_OUT = '/data/scratch/sl/new-translation-leaks';

const enOf = (p) => (typeof p?.translation?.data === 'string' ? p.translation.data : '');
const srcOf = (p) => (typeof p?.ocr?.data === 'string' ? p.ocr.data : '');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Who wrote a page's English: lane (engine call site), model, job, when. */
export function writerOf(p) {
  const t = p?.translation || {};
  return {
    page: p?.page_number, model: t.model ?? t.engine?.model ?? null,
    lane: t.engine?.call_site ?? (t.source === 'manual' ? 'human' : null), job: t.engine?.run?.job_id ?? null,
    at: t.updated_at ? new Date(t.updated_at).toISOString() : null,
  };
}

/**
 * The flags for one book. `pages`: rows with page_number, page_type, ocr.data, translation.data/updated_at/model/engine;
 * `windowed`: Set of page_numbers written in the window; `k`: the book's median log(en/src) or null.
 * Returns one record per flagged consecutive pair.
 */
export function bookFlags({ bookId, pages, windowed, k = null }) {
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const out = [];
  const nums = [...new Set([...windowed].flatMap((n) => [n - 1, n]))].sort((a, b) => a - b);
  for (const n of nums) {
    const A = byNum.get(n), B = byNum.get(n + 1);
    if (!A || !B || !enOf(A).trim() || !enOf(B).trim()) continue;
    if (!windowed.has(n) && !windowed.has(n + 1)) continue;
    const rules = [];
    let receiver = null, len = 0, text = '';

    const run = sharedRun(leakNorm(enOf(B)), leakNorm(enOf(A)), LEAK_MIN_CHARS);
    const sourcesRepeat = sharedRun(leakNorm(srcOf(B)), leakNorm(srcOf(A)), LEAK_MIN_CHARS).len >= LEAK_MIN_CHARS;
    if (run.len >= RUN_MIN && !sourcesRepeat) {
      rules.push('shared-run');
      len = run.len; text = run.text;
      // The side that holds the copy carries more English per source character (the guard's ratio condition).
      const ratio = (p) => (srcOf(p).length ? enOf(p).length / srcOf(p).length : Infinity);
      receiver = ratio(B) >= ratio(A) ? B : A;
    }
    // The guard's own rule, on each page of the pair written in the window, against this one neighbour.
    for (const [P, side, nb] of [[B, 'prev', A], [A, 'next', B]]) {
      if (!windowed.has(P.page_number)) continue;
      const v = neighbourVerdict({
        page: { src: srcOf(P), en: enOf(P), type: P.page_type ?? null },
        [side]: { src: srcOf(nb), en: enOf(nb) }, k,
      });
      if (v.refuse) { rules.push(`guard:${v.reason}@${P.page_number}`); receiver ||= P; if (!text) text = v.detail; }
    }
    if (!rules.length) continue;
    const other = receiver === A ? B : A;
    out.push({
      key: `${bookId}:${n}-${n + 1}:${hash(enOf(receiver))}`,
      book: bookId, prev: n, next: n + 1, rules, run_len: run.len,
      share: +(run.len / Math.max(1, leakNorm(enOf(B)).length)).toFixed(3), sources_repeat: sourcesRepeat,
      receiver: writerOf(receiver), receiver_in_window: windowed.has(receiver.page_number),
      other: writerOf(other), text: String(text).slice(0, 200),
    });
  }
  return out;
}

/** Keys flagged on an earlier day (every .jsonl in outDir but today's). */
export function seenKeys(outDir, todayFile) {
  const seen = new Set();
  if (!fs.existsSync(outDir)) return seen;
  for (const f of fs.readdirSync(outDir)) {
    if (!f.endsWith('.jsonl') || f === todayFile) continue;
    for (const line of fs.readFileSync(path.join(outDir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { seen.add(JSON.parse(line).key); } catch { /* a torn line is not a key */ }
    }
  }
  return seen;
}

/** The one ntfy line, or null when nothing should be said. */
export function ntfyLine({ fresh, titles, books, pages, date, monday }) {
  if (fresh.length) {
    const items = fresh.slice(0, 5).map((f) => {
      const t = (titles.get(f.book) || f.book).slice(0, 50);
      // An old stored page that holds the copy, beside a page written today: name both writers.
      const who = f.receiver_in_window
        ? `p.${f.receiver.page} by ${f.receiver.lane || '?'}, ${f.receiver.model || '?'}`
        : `held by old p.${f.receiver.page} (${(f.receiver.at || '?').slice(0, 10)}, ${f.receiver.model || '?'}); new p.${f.other.page} by ${f.other.lane || '?'}, ${f.other.model || '?'}`;
      return `${t} p.${f.prev}→${f.next} (${f.rules.join('+')}; ${who})`;
    });
    const more = fresh.length > 5 ? `; +${fresh.length - 5} more` : '';
    return `new-translation-leaks ${date}: ${fresh.length} NEW neighbour-text pair(s) in ${new Set(fresh.map((f) => f.book)).size} book(s) — ${items.join('; ')}${more} (#5026)`;
  }
  if (monday) return `new-translation-leaks weekly: checked ${books} books / ${pages} pages written in the last 24 h, 0 new leaks (#5026)`;
  return null;
}

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

async function main() {
  const now = new Date();
  const since = arg('since') ? new Date(arg('since')) : new Date(now.getTime() - Number(arg('hours', 24)) * 36e5);
  const only = arg('books') ? arg('books').split(',').filter(Boolean) : null;
  const outDir = arg('out-dir', DEFAULT_OUT);
  const date = arg('date', now.toISOString().slice(0, 10));
  const noNtfy = process.argv.includes('--no-ntfy');
  const todayFile = `${date}.jsonl`;

  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const pagesC = db.collection('pages');
    const q = { 'translation.updated_at': { $gte: since } };
    if (only) q.book_id = { $in: only };
    const written = await pagesC.find(q, { projection: { _id: 0, book_id: 1, page_number: 1 } }).toArray();
    const byBook = new Map();
    for (const r of written) {
      if (!r.book_id || !Number.isFinite(r.page_number)) continue;
      if (!byBook.has(r.book_id)) byBook.set(r.book_id, new Set());
      byBook.get(r.book_id).add(r.page_number);
    }

    const flags = [];
    for (const [bookId, windowed] of byBook) {
      const want = [...new Set([...windowed].flatMap((n) => [n - 1, n, n + 1]))];
      const pages = [];
      for (let i = 0; i < want.length; i += 500) {
        pages.push(...await pagesC.find({ book_id: bookId, page_number: { $in: want.slice(i, i + 500) } }, {
          projection: { _id: 0, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1,
            'translation.model': 1, 'translation.source': 1, 'translation.engine.call_site': 1, 'translation.engine.model': 1,
            'translation.engine.run.job_id': 1 },
        }).toArray());
      }
      const k = await bookLengthRatioK(db, bookId);
      flags.push(...bookFlags({ bookId, pages, windowed, k }));
    }

    const titles = new Map();
    if (flags.length) {
      const ids = [...new Set(flags.map((f) => f.book))];
      for (const b of await db.collection('books').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, title: 1 } }).toArray()) titles.set(b.id, b.title || b.id);
    }
    const seen = seenKeys(outDir, todayFile);
    const fresh = flags.filter((f) => !seen.has(f.key));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, todayFile), flags.map((f) => JSON.stringify({
      ...f, date, title: titles.get(f.book) || null, new: !seen.has(f.key), window_from: since.toISOString(),
    }) + '\n').join(''));

    const pagesN = [...byBook.values()].reduce((s, v) => s + v.size, 0);
    console.log(JSON.stringify({ at: now.toISOString(), since: since.toISOString(), books: byBook.size, pages: pagesN, flagged: flags.length, new: fresh.length, out: path.join(outDir, todayFile) }));
    const line = ntfyLine({ fresh, titles, books: byBook.size, pages: pagesN, date, monday: now.getUTCDay() === 1 });
    if (line && !noNtfy) await ntfyPost(NTFY_URL, { headers: { Title: 'new-translation-leaks', Tags: fresh.length ? 'warning' : 'white_check_mark' }, body: line });
    else if (line) console.log(`[no-ntfy] ${line}`);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error(e);
    if (!process.argv.includes('--no-ntfy')) {
      await ntfyPost(NTFY_URL, { headers: { Title: 'new-translation-leaks failed' }, body: `new-translation-leaks crashed: ${String(e?.message || e).slice(0, 200)} — the daily #5026 check did not run` }).catch(() => {});
    }
    process.exit(1);
  });
}
