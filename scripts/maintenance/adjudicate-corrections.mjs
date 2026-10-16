#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/second-reader/ (second-reader.mjs, lib.mjs plantErrors) plants errors into whole PAGES and
 * scores free-form reader findings for a calibration study; it does not judge a list of span edits or write anything.
 * scripts/maintenance/tengyur-cli-6361/convergent/gemini-read.mjs and scripts/eval/run-cli-arm.py are the agy call
 * shape this reuses (plan mode, `@./file` image, one nudge on a non-JSON reply). scripts/maintenance/
 * apply-page-correction.mjs is the only writer; this decides which edits it gets. none other — looked in
 * scripts/maintenance, scripts/eval, scripts/audit for "adjudicat", "second reader", "decoy".
 *
 * The second reader for volunteer corrections (#6679, .claude/docs/volunteer-shifts-design.md).
 *
 * For each `page_corrections` proposal still `proposed`:
 *   1. download the scan (the 1,600 px proxy the book run shows, /api/review/book-run → page.scan_urls[0]);
 *   2. build a packet: each edit as FIND → REPLACE inside ±150 chars of the stored text, with the proposer's reason
 *      (never the proposer's identity, model or note), plus ONE planted decoy edit that is wrong — a correct word
 *      changed to a near-miss — at a random position;
 *   3. two readers from different families judge every edit against the scan (a translation edit against the
 *      transcription and the scan): Opus through `claude -p`, Gemini through `agy -p`, both on the subscriptions.
 *      Each returns correct | wrong | cant_tell and what the scan shows;
 *   4. a reader that calls the decoy `correct` has its verdicts for that packet discarded;
 *   5. per edit: both (kept) readers `correct` → accept; both `wrong` → reject; anything else → leave.
 *
 * Dry run by default: reads, prints the decisions, writes nothing to Mongo. Packets and reader replies are cached in
 * --out, keyed by the proposal and its base_hash, so `--apply` reuses the dry run's verdicts instead of re-asking.
 * `--apply` stores the `adjudication` on every proposal it judged, then calls apply-page-correction.mjs with
 * `--accept-edits` for the accepted edits (OCR proposals before translation ones, so a same-shift translation fix
 * passes the stale check), or `--reject` when every edit was rejected. A proposal with only left edits stays
 * `proposed`, verdicts recorded, and later runs skip it (same base_hash) unless --rejudge. Never applies an edit
 * both readers did not accept.
 *
 * What --apply SETS IN MOTION: each page whose OCR changes gets a newer ocr.updated_at, so its machine translation
 * goes stale and the stale lane re-translates it under the spend dial. The summary counts those pages.
 *
 *   node --env-file=.env.production.local scripts/maintenance/adjudicate-corrections.mjs --out=$JOB_SCRATCH/adj
 *   ... [--ids=a,b] [--parallel=3] [--gemini-model=gemini-3.8-flash-high] [--fresh] [--rejudge] [--packets-only] [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { contentHash } from '../lib/write-provenance.mjs';
import { translationStaleness } from '../lib/stale-translation.mjs';
import { applySpanEdits } from '../lib/span-edits.mjs';
import { recoverArray } from '../eval/second-reader/lib.mjs';
import { makeRng } from '../eval/lib/paired-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const OUT = path.resolve(args.out || path.join(process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp', 'adjudicate-corrections'));
const PARALLEL = Number(args.parallel || 3);
const OPUS_MODEL = args['opus-model'] || 'opus';
// No Gemini Pro on the box's agy (`agy models`, 2026-10-13): 3.8 Flash High is the strongest Gemini it offers.
const GEMINI_MODEL = args['gemini-model'] || 'gemini-3.8-flash-high';
const CONTEXT = 150;
const VERDICTS = new Set(['correct', 'wrong', 'cant_tell']);
const READERS = ['opus', 'gemini'];
export const ADJUDICATOR = 'adjudicator: opus + gemini';

// ── decoy ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Near-miss letter swaps, the kind a misreading would produce. Devanagari: vowel signs and look-alike consonants.
const SWAPS = [
  ['ि', 'ी'], ['ु', 'ू'], ['े', 'ै'], ['ो', 'ौ'], ['त', 'न'], ['प', 'ष'], ['म', 'भ'], ['व', 'ब'], ['घ', 'ध'], ['द', 'ढ'],
  ['e', 'c'], ['n', 'u'], ['a', 'o'], ['i', 'l'], ['m', 'n'], ['h', 'b'], ['r', 't'], ['u', 'v'],
];
// Translation decoys: a word flipped to a plausible wrong one.
const FLIPS = [
  ['east', 'west'], ['before', 'after'], ['king', 'queen'], ['father', 'mother'], ['son', 'daughter'], ['great', 'small'],
  ['first', 'last'], ['always', 'never'], ['many', 'few'], ['above', 'below'], ['enter', 'leave'], ['day', 'night'],
  ['old', 'young'], ['right', 'left'], ['his', 'her'], ['he', 'she'], ['heaven', 'earth'], ['gold', 'silver'],
  ['sun', 'moon'], ['open', 'closed'], ['true', 'false'], ['good', 'evil'], ['love', 'hate'], ['life', 'death'],
];

const count = (h, n) => h.split(n).length - 1;

/**
 * One wrong edit on `text`, not overlapping any real edit's span: an OCR word changed by a near-miss letter, or a
 * translation word flipped. Returns { find, replace, reason, kind } or null.
 */
export function makeDecoy(text, field, edits, rng) {
  const taken = edits.map((e) => { const s = text.indexOf(e.find); return [s - 20, s + e.find.length + 20]; });
  const tags = [...text.matchAll(/<[^>]*>/g)].map((m) => [m.index, m.index + m[0].length]);
  const free = (s, e) => ![...taken, ...tags].some(([a, b]) => s < b && e > a);
  const isTr = field === 'translation';
  const words = [...text.matchAll(isTr ? /\b[A-Za-z]{2,}\b/g : /[\p{L}\p{M}]{4,}/gu)].filter((m) => free(m.index, m.index + m[0].length));
  // OCR: plant in the script most of the real edits are in (Devanagari edits get a Devanagari decoy), so the decoy
  // tests the same reading the real edits need; other words stay as a fallback.
  const DEVA = /[\u0900-\u097F]/;
  const devaEdits = edits.filter((e) => DEVA.test(e.find)).length * 2 > edits.length;
  const rank = (w) => (isTr ? 0 : (DEVA.test(w[0]) === devaEdits ? 0 : 1));
  const shuffled = words.map((w) => [rank(w), rng(), w]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , w]) => w);
  // A translation with no flippable word gets a content word swapped for another word of the same page.
  const content = [...new Set(words.map((w) => w[0]).filter((w) => w.length >= 6 && w === w.toLowerCase()))];
  for (const pass of isTr ? ['flip', 'swap'] : ['swap']) for (const m of shuffled) {
    const word = m[0];
    let replace = null, kind = null;
    if (isTr && pass === 'flip') {
      const lw = word.toLowerCase();
      const f = FLIPS.find(([a, b]) => a === lw || b === lw);
      if (!f) continue;
      const to = f[0] === lw ? f[1] : f[0];
      replace = word[0] === word[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
      kind = 'word-flip';
    } else if (isTr) {
      if (word.length < 6 || word !== word.toLowerCase()) continue;
      const others = content.filter((w) => w !== word);
      if (!others.length) continue;
      replace = others[Math.floor(rng() * others.length)];
      kind = 'word-swap';
    } else {
      const opts = [];
      for (const [a, b] of SWAPS) {
        for (const [x, y] of [[a, b], [b, a]]) {
          for (let i = 1; i < word.length; i++) if (word[i] === x) opts.push(word.slice(0, i) + y + word.slice(i + 1));
        }
      }
      if (!opts.length) continue;
      replace = opts[Math.floor(rng() * opts.length)];
      kind = 'near-miss';
    }
    // Widen the find by neighbouring characters until it is unique, keeping it clear of the real edits.
    for (let pad = 0; pad <= 24; pad += 4) {
      const s = Math.max(0, m.index - pad), e = Math.min(text.length, m.index + word.length + pad);
      if (!free(s, e)) break;
      const find = text.slice(s, e);
      if (count(text, find) !== 1) continue;
      const rep = text.slice(s, m.index) + replace + text.slice(m.index + word.length, e);
      const reason = kind === 'word-flip' ? `The original says "${replace}", not "${word}"; the English reverses it.`
        : kind === 'word-swap' ? `The original means "${replace}" here; the English has "${word}".`
          : `Scan reads ${replace}.`;
      return { find, replace: rep, reason, kind, word, to: replace };
    }
  }
  return null;
}

// ── packet ────────────────────────────────────────────────────────────────────────────────────────────────────

function context(text, find) {
  const at = text.indexOf(find);
  return { before: text.slice(Math.max(0, at - CONTEXT), at), after: text.slice(at + find.length, at + find.length + CONTEXT) };
}

function buildPacket(corr, page, book, rng) {
  const field = corr.field;
  const text = page[field].data;
  const decoy = makeDecoy(text, field, corr.edits, rng);
  if (!decoy) return null;
  const n = corr.edits.length;
  const decoyAt = Math.floor(rng() * (n + 1)); // position among n+1 slots
  const slots = [...corr.edits.map((e, i) => ({ src: i + 1, ...e }))];
  slots.splice(decoyAt, 0, { src: 'decoy', ...decoy });
  const items = slots.map((e, k) => ({ label: `E${k + 1}`, src: e.src, find: e.find, replace: e.replace, reason: e.reason ?? null, ...context(text, e.find) }));
  return {
    correction_id: corr.id, base_hash: corr.base_hash, field, page_id: page.id, page_number: page.page_number,
    book_title: book?.display_title || book?.title || '', language: book?.language || '',
    decoy: { label: items[decoyAt].label, kind: decoy.kind, find: decoy.find, replace: decoy.replace, word: decoy.word, to: decoy.to },
    items,
    transcription: field === 'translation' ? page.ocr?.data ?? '' : null,
  };
}

function promptFor(packet, imagePath, reader) {
  const isTr = packet.field === 'translation';
  const lines = [
    'You are a second reader for a digital library of historical books. Someone proposed corrections to one page.',
    `Check each proposed edit against the page itself. Proposers can be wrong, and some edits in these packets are planted wrong on purpose to check the reader, so judge every edit on its own evidence, not on its stated reason.`,
    '',
    `Book: ${packet.book_title}${packet.language ? ` (${packet.language})` : ''}, page ${packet.page_number}.`,
    `What is being corrected: ${isTr ? 'the English TRANSLATION of the page' : 'the TRANSCRIPTION (OCR) of the page'}.`,
    reader === 'opus'
      ? `The scan of the page (1,600 px wide): ${imagePath} — open it with the Read tool before judging. Look closely at each spot.`
      : 'The scan of the page (1,600 px wide) is attached: @./scan.jpg — look closely at each spot.',
    '',
    isTr
      ? 'A translation edit is judged against the TRANSCRIPTION below (what the page says in its own language) and the scan: is the replacement a more faithful rendering of what this page says than the stored English? The transcription may itself contain OCR slips; trust the scan where they differ.'
      : 'The transcription is diplomatic: it should record what is printed, with the page\'s own spelling, abbreviations, long s, and transliteration conventions, not a normalised or modernised form. Tags such as <margin>, <note>, <header>, <page-num> are its structure; judge whether their content and placement match the scan.',
    '',
  ];
  if (isTr) lines.push('TRANSCRIPTION OF THE PAGE:', '<<<', packet.transcription, '>>>', '');
  lines.push('PROPOSED EDITS. Each shows the stored text just before the span, the span to change (FIND), what it would become (REPLACE), the stored text just after, and the proposer\'s reason:', '');
  for (const it of packet.items) {
    lines.push(`${it.label}`, `  before:  …${it.before}`, `  FIND:    ${JSON.stringify(it.find)}`, `  REPLACE: ${JSON.stringify(it.replace)}`, `  after:   ${it.after}…`, `  reason:  ${it.reason ?? '(none given)'}`, '');
  }
  lines.push(
    'For every edit give a verdict:',
    `- "correct": with the edit, this span matches ${isTr ? 'what the page says (a faithful rendering of the transcription/scan)' : 'what the scan prints'}, and it is better than the stored text;`,
    '- "wrong": the stored text was right, or the replacement is not what the page shows or says;',
    '- "cant_tell": the scan is illegible there, or you cannot decide.',
    '',
    `Reply with ONLY a JSON array, one object per edit, in order E1..E${packet.items.length}, no prose outside it:`,
    '[{"edit":"E1","verdict":"correct|wrong|cant_tell","scan_shows":"what the scan (or, for a translation, the transcription) actually has at this spot","why":"one short sentence"}]',
  );
  return lines.join('\n');
}

function validReply(arr, packet) {
  if (!Array.isArray(arr)) return null;
  const by = new Map(arr.filter((x) => x && typeof x === 'object').map((x) => [String(x.edit ?? '').trim().toUpperCase(), x]));
  const out = [];
  for (const it of packet.items) {
    const r = by.get(it.label);
    const v = String(r?.verdict ?? '').trim().toLowerCase().replace(/[\s-]/g, '_');
    if (!r || !VERDICTS.has(v)) return null;
    out.push({ edit: it.label, verdict: v, scan_shows: String(r.scan_shows ?? '').slice(0, 600), why: String(r.why ?? '').slice(0, 600) });
  }
  return out;
}

// ── readers ───────────────────────────────────────────────────────────────────────────────────────────────────

// The readers run on the subscriptions, never a paid key. --env-file loads the production keys into this process, and
// `claude -p` prefers ANTHROPIC_API_KEY over the login (seen: "Invalid API key"), so the children never see them.
const KEY_VARS = /^(ANTHROPIC_|CLAUDE_CODE_USE_|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_|GOOGLE_APPLICATION_CREDENTIALS|OPENROUTER_|OPENAI_)/;
const READER_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEY_VARS.test(k)));

function run(cmd, argv, { cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    const ch = spawn(cmd, argv, { cwd, env: READER_ENV, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    if (input != null) { ch.stdin.write(input); ch.stdin.end(); }
    const t = setTimeout(() => ch.kill('SIGKILL'), timeoutMs);
    ch.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

const QUOTA = /RESOURCE_EXHAUSTED|quota|exhausted your|\b429\b|Too Many Requests|usage limit|rate limit/i;

async function readOpus(dir, prompt, packet) {
  const calls = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await run('claude', ['-p', '--model', OPUS_MODEL, '--allowedTools', 'Read', '--output-format', 'json'], { cwd: dir, input: prompt, timeoutMs: 900_000 });
    let j = null; try { j = JSON.parse(r.out.trim()); } catch { /* not json */ }
    const text = j?.result ?? r.out;
    calls.push({ attempt, code: r.code, model: j?.modelUsage ? Object.keys(j.modelUsage) : null, cost_usd_equiv: j?.total_cost_usd ?? null, err: r.err.slice(-400), response: String(text).slice(-6000) });
    const v = validReply(recoverArray(text), packet);
    if (v) return { verdicts: v, calls };
    if (QUOTA.test(r.err + String(text).slice(0, 400))) return { verdicts: null, quota: true, calls };
  }
  return { verdicts: null, calls };
}

async function readGemini(dir, prompt, packet) {
  const calls = [];
  const agy = async (p, conversation) => {
    const a = ['-p', p, '--model', GEMINI_MODEL, '--mode', 'plan', '--print-timeout', '540s', '--output-format', 'json'];
    if (conversation) a.push('--conversation', conversation);
    const r = await run('agy', a, { cwd: dir, timeoutMs: 600_000 });
    let j = null; try { j = JSON.parse(r.out.trim()); } catch { /* not json */ }
    calls.push({ nudge: !!conversation, code: r.code, status: j?.status, conversation_id: j?.conversation_id, usage: j?.usage, err: r.err.slice(-400), response: String(j?.response ?? r.out).slice(-6000) });
    return { j, r };
  };
  let { j, r } = await agy(prompt);
  let v = validReply(recoverArray(j?.response || ''), packet);
  if (!v && QUOTA.test(r.err + (j?.error ?? ''))) return { verdicts: null, quota: true, calls };
  if (!v && j?.conversation_id) {
    ({ j } = await agy(`Do not write a plan and do not run any command. The scan is attached above. Reply now with ONLY the JSON array the instructions ask for: one object per edit, E1..E${packet.items.length}.`, j.conversation_id));
    v = validReply(recoverArray(j?.response || ''), packet);
  }
  return { verdicts: v, calls };
}

// ── decision ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Per real edit: accept | reject | leave, from the readers whose decoy check passed. */
export function decide(packet, replies) {
  const readers = {};
  for (const name of READERS) {
    const v = replies[name]?.verdicts;
    const decoyVerdict = v ? v.find((x) => x.edit === packet.decoy.label)?.verdict : null;
    readers[name] = {
      model: name === 'opus' ? OPUS_MODEL : GEMINI_MODEL,
      answered: !!v,
      decoy_verdict: decoyVerdict ?? null,
      decoy_caught: decoyVerdict === 'wrong',
      discarded: !v || decoyVerdict === 'correct',
      discard_reason: !v ? 'no valid reply' : decoyVerdict === 'correct' ? 'accepted the planted decoy' : null,
      verdicts: v,
    };
  }
  const decisions = packet.items.filter((it) => it.src !== 'decoy').map((it) => {
    const vs = Object.fromEntries(READERS.map((name) => [name, readers[name].verdicts?.find((x) => x.edit === it.label) ?? null]));
    const kept = READERS.filter((name) => !readers[name].discarded);
    let decision = 'leave';
    let why;
    if (kept.length === 2 && kept.every((name) => vs[name].verdict === 'correct')) { decision = 'accept'; why = 'both readers: correct'; }
    else if (kept.length === 2 && kept.every((name) => vs[name].verdict === 'wrong')) { decision = 'reject'; why = 'both readers: wrong'; }
    else if (kept.length < 2) why = `reader(s) discarded: ${READERS.filter((n) => readers[n].discarded).map((n) => `${n} (${readers[n].discard_reason})`).join(', ')}`;
    else why = `readers split: opus ${vs.opus.verdict}, gemini ${vs.gemini.verdict}`;
    return {
      index: it.src, label: it.label, decision, why,
      opus: vs.opus && { verdict: vs.opus.verdict, scan_shows: vs.opus.scan_shows, why: vs.opus.why },
      gemini: vs.gemini && { verdict: vs.gemini.verdict, scan_shows: vs.gemini.scan_shows, why: vs.gemini.why },
    };
  });
  return { readers, decisions };
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function fetchScan(bookId, pageNumber, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) return;
  const run = await fetch(`https://sourcelibrary.org/api/review/book-run?book=${encodeURIComponent(bookId)}&after=${pageNumber - 1}`);
  if (!run.ok) throw new Error(`book-run ${run.status}`);
  const j = await run.json();
  if (j.page?.page_number !== pageNumber) throw new Error(`book-run returned p.${j.page?.page_number}, wanted p.${pageNumber}`);
  const url = j.page?.scan_urls?.[0];
  if (!url) throw new Error('book-run has no scan_urls');
  const img = await fetch(url);
  if (!img.ok) throw new Error(`scan ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  if (buf.length < 10_000) throw new Error(`scan only ${buf.length} bytes`);
  fs.writeFileSync(dest, buf);
}

async function judge(corr, page, book) {
  const dir = path.join(OUT, `${corr.id}-${corr.base_hash}`);
  fs.mkdirSync(dir, { recursive: true });
  const packetFile = path.join(dir, 'packet.json');
  let packet;
  if (fs.existsSync(packetFile) && !args.fresh) packet = JSON.parse(fs.readFileSync(packetFile, 'utf8'));
  else {
    const seed = parseInt(crypto.createHash('sha256').update(`${corr.id}:${corr.base_hash}`).digest('hex').slice(0, 8), 16);
    packet = buildPacket(corr, page, book, makeRng(seed));
    if (!packet) return { corr, error: 'no site for a decoy' };
    // The decoy must apply cleanly alongside the real edits, or a reader could tell it apart.
    const check = applySpanEdits(page[corr.field].data, packet.items.map((it) => ({ find: it.find, replace: it.replace })));
    if ('error' in check) return { corr, error: `packet does not apply: ${check.error}` };
    fs.writeFileSync(packetFile, JSON.stringify(packet, null, 1));
  }
  const scan = path.join(dir, 'scan.jpg');
  await fetchScan(page.book_id, page.page_number, scan);
  if (args['packets-only']) return { corr, error: `packets-only: decoy ${packet.decoy.label} ${JSON.stringify(packet.decoy.find)} → ${JSON.stringify(packet.decoy.replace)}` };
  const replies = {};
  await Promise.all(READERS.map(async (name) => {
    const f = path.join(dir, `${name}.json`);
    if (fs.existsSync(f) && !args.fresh) {
      const cached = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (cached.verdicts) { replies[name] = cached; return; }
    }
    const prompt = promptFor(packet, scan, name);
    fs.writeFileSync(path.join(dir, `prompt-${name}.md`), prompt);
    const r = name === 'opus' ? await readOpus(dir, prompt, packet) : await readGemini(dir, prompt, packet);
    replies[name] = { reader: name, model: name === 'opus' ? OPUS_MODEL : GEMINI_MODEL, at: new Date().toISOString(), ...r };
    fs.writeFileSync(f, JSON.stringify(replies[name], null, 1));
  }));
  const quota = READERS.filter((n) => replies[n]?.quota);
  return { corr, packet, replies, quota, ...decide(packet, replies) };
}

function applyScript(argv) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'apply-page-correction.mjs'), ...argv], { encoding: 'utf8', env: process.env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const corrections = db.collection('page_corrections');
  try {
    const q = { status: 'proposed' };
    if (typeof args.ids === 'string') q.id = { $in: args.ids.split(',') };
    // A proposal already judged on the same text was left on purpose (readers split); --rejudge asks again.
    const rows = (await corrections.find(q).sort({ created_at: 1 }).toArray())
      .filter((r) => args.rejudge || args.ids || r.adjudication?.base_hash !== r.base_hash);
    console.log(`${rows.length} proposed correction(s); readers opus=${OPUS_MODEL} gemini=${GEMINI_MODEL}; out ${OUT}${args.apply ? '; APPLY' : '; dry run'}`);

    const queue = [...rows];
    const results = [];
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (queue.length) {
        const corr = queue.shift();
        const page = await db.collection('pages').findOne({ id: corr.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1 } });
        if (!page?.[corr.field]?.data) { results.push({ corr, error: `page has no ${corr.field}` }); continue; }
        if (contentHash(page[corr.field].data) !== corr.base_hash) { results.push({ corr, error: 'stale: the page text changed since the proposal' }); continue; }
        const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { title: 1, display_title: 1, language: 1 } });
        try {
          const r = await judge(corr, page, book);
          results.push(r);
          console.log(`  judged ${corr.id} (${corr.field} p.${corr.page_number}): ${r.error ?? r.decisions.map((d) => `${d.index}:${d.decision}`).join(' ')}`);
        } catch (e) {
          results.push({ corr, error: e.message });
          console.log(`  ${corr.id}: ERROR ${e.message}`);
        }
      }
    }));

    // OCR before translation, so a translation fix from the same shift passes apply's stale check.
    results.sort((a, b) => (a.corr.field === b.corr.field ? +a.corr.created_at - +b.corr.created_at : a.corr.field === 'ocr' ? -1 : 1));
    const summary = { proposals: results.length, accept: 0, reject: 0, leave: 0, errors: 0, ocr_pages_changed: new Set(), decoy: Object.fromEntries(READERS.map((n) => [n, { caught: 0, accepted: 0, cant_tell: 0, no_reply: 0 }])) };
    for (const r of results) {
      console.log(`\n== ${r.corr.id}  ${r.corr.field} p.${r.corr.page_number}  ${r.corr.edits.length} edit(s)`);
      if (r.error) { summary.errors++; console.log(`   SKIP: ${r.error}`); continue; }
      for (const n of READERS) {
        const rd = r.readers[n];
        const d = summary.decoy[n];
        if (!rd.answered) d.no_reply++; else if (rd.decoy_verdict === 'wrong') d.caught++; else if (rd.decoy_verdict === 'correct') d.accepted++; else d.cant_tell++;
        console.log(`   ${n}: decoy ${r.packet.decoy.label} (${r.packet.decoy.word}→${r.packet.decoy.to}) → ${rd.decoy_verdict ?? 'no reply'}${rd.discarded ? `  DISCARDED (${rd.discard_reason})` : ''}`);
      }
      for (const d of r.decisions) {
        summary[d.decision]++;
        const e = r.corr.edits[d.index - 1];
        console.log(`   [${d.index}] ${d.decision.toUpperCase().padEnd(6)} opus=${d.opus?.verdict ?? '-'} gemini=${d.gemini?.verdict ?? '-'}  ${JSON.stringify(e.find.slice(0, 50))} → ${JSON.stringify(e.replace.slice(0, 50))}`);
      }
      if (!args.apply) continue;

      const accepted = r.decisions.filter((d) => d.decision === 'accept').map((d) => d.index);
      const decoyCaught = Object.fromEntries(READERS.map((n) => [n, r.readers[n].decoy_verdict]));
      const adjudication = {
        adjudicator: ADJUDICATOR, at: new Date(), base_hash: r.corr.base_hash,
        readers: Object.fromEntries(READERS.map((n) => [n, { model: r.readers[n].model, answered: r.readers[n].answered, decoy_verdict: r.readers[n].decoy_verdict, discarded: r.readers[n].discarded, discard_reason: r.readers[n].discard_reason }])),
        decoy: r.packet.decoy, decoy_caught: decoyCaught,
        decisions: r.decisions,
        outcome: accepted.length ? (accepted.length === r.decisions.length ? 'applied' : 'partially_applied') : r.decisions.every((d) => d.decision === 'reject') ? 'rejected' : 'left',
      };
      const set = await corrections.updateOne({ id: r.corr.id, status: 'proposed', base_hash: r.corr.base_hash }, { $set: { adjudication } });
      if (set.modifiedCount !== 1) { console.log('   adjudication NOT stored (proposal changed underneath); skipping apply'); summary.errors++; continue; }
      const reader = `${ADJUDICATOR} (${OPUS_MODEL} + ${GEMINI_MODEL})`;
      if (accepted.length) {
        const a = applyScript([`--apply=${r.corr.id}`, `--reader=${reader}`, `--accept-edits=${accepted.join(',')}`, '--confirm']);
        console.log(a.out.split('\n').filter((l) => /applied|ERROR|dropping|NOTE/.test(l)).map((l) => `   ${l}`).join('\n'));
        if (a.code === 0 && r.corr.field === 'ocr') summary.ocr_pages_changed.add(r.corr.page_id);
        if (a.code !== 0) summary.errors++;
      } else if (adjudication.outcome === 'rejected') {
        const a = applyScript([`--reject=${r.corr.id}`, `--reader=${reader}`, '--reason=every edit: both readers said wrong against the scan (#6679)', '--confirm']);
        console.log(`   ${a.out.trim().split('\n').pop()}`);
      } else console.log('   left proposed; verdicts recorded');
    }
    console.log(`\nedits: ${summary.accept} accept, ${summary.reject} reject, ${summary.leave} leave; ${summary.errors} error(s)`);
    for (const n of READERS) { const d = summary.decoy[n]; console.log(`decoy ${n}: caught ${d.caught}, accepted ${d.accepted}, cant_tell ${d.cant_tell}, no reply ${d.no_reply}`); }
    if (args.apply && summary.ocr_pages_changed.size) {
      // A page whose English was corrected after its OCR is not stale (and is human-edited, so the lane leaves it).
      const pages = await db.collection('pages').find({ id: { $in: [...summary.ocr_pages_changed] } }, { projection: { id: 1, page_number: 1, ocr: 1, translation: 1 } }).toArray();
      const stale = pages.filter((p) => p.translation?.data && translationStaleness(p).stale);
      console.log(`OCR pages changed: ${pages.length}; translation now stale on ${stale.length} (${stale.map((p) => `p.${p.page_number}`).join(', ') || 'none'}) — the stale lane re-translates those under the spend dial.`);
    }
    fs.writeFileSync(path.join(OUT, `summary-${args.apply ? 'apply' : 'dry'}.json`), JSON.stringify(results.map((r) => ({ id: r.corr.id, field: r.corr.field, page: r.corr.page_number, error: r.error, decoy: r.packet?.decoy, readers: r.readers, decisions: r.decisions })), null, 1));
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(`ERROR: ${e.stack || e.message}`); process.exitCode = 1; });
