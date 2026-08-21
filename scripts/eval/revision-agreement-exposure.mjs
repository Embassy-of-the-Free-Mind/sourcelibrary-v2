#!/usr/bin/env node
/**
 * Does agreement rise with BIBLIOGRAPHIC EXPOSURE? (#3235)
 *
 * Applies the prior half of the /blog/did-the-ai-read-this method — "a work with
 * no English translation cannot have been encountered in English; a work with
 * Loeb/Penguin editions has been propagated widely" — to the 110K-pair revision
 * corpus, and asks whether the exposure gradient predicts OCR agreement.
 *
 * WHY IT IS A TEST OF RECITATION: if models recite memorized text, two runs over a
 * well-propagated work agree because they recall the SAME passage, not because they
 * read the page. Agreement should then rise with exposure — and the rise should
 * survive controls for the things exposure is confounded with (era, script,
 * language, model, prompt). If it vanishes under control, the corpus offers no
 * recitation signal and the anchor rows remain the only evidence.
 *
 * The blog post's OTHER half — behavioural probes — is deliberately NOT here: it
 * costs model calls. This half is free (Mongo reads + local compute).
 *
 * Exposure proxies, all derived from data we already hold:
 *   editions   — books sharing this book's work_id (propagation through print)
 *   translated — a sibling in the work cluster tagged modern-translation
 *   identified — the work resolved to a work_id at all (catalogued ⇒ visible)
 *   author     — how many books the library holds by the same author (fame proxy)
 *
 * Also reports MEDIANS, which the corpus report omits: the agreement distribution
 * is heavily left-tailed, so its mean (86.9%) badly understates the centre (98.1%).
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/revision-agreement-exposure.mjs [--jsonl=path] [--min-n=200]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DATE = new Date().toISOString().slice(0, 10);
const JSONL = args.jsonl || path.join(__dirname, 'results', `revision-agreement-corpus-2026-07-19.jsonl`);
const MIN_N = parseInt(args['min-n'] || '200');
const OUT = path.join(__dirname, 'results', `revision-agreement-exposure-${DATE}.md`);

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : NaN;
const stats = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: xs.length, mean: mean(xs), median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75) };
};
const pct = x => (x * 100).toFixed(1) + '%';

// ── 1. read the rows (streamed; the file is ~158MB) ──────────────
const rows = [];
const rl = readline.createInterface({ input: fs.createReadStream(JSONL), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (r.eligibility !== 'eligible' || r.direction !== 'both-transcription') continue;
  rows.push({
    book_id: r.book_id || null, agreement: r.agreement_primary, language: r.language,
    year_bucket: r.year_bucket, script_class: r.script_class,
    same_config: !!(r.prior_model && r.prior_model === r.current_model &&
      r.prior_prompt && r.prior_prompt === r.current_prompt),
    same_model: !!(r.prior_model && r.prior_model === r.current_model),
    prompt_changed: !!(r.prior_prompt && r.current_prompt && r.prior_prompt !== r.current_prompt),
    prompt_transition: r.prompt_transition,
  });
}
console.log(`rows: ${rows.length.toLocaleString()} eligible transcription pairs`);

// ── 2. exposure covariates from Mongo ────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const BOOKS = db.collection('books');

const bookIds = [...new Set(rows.map(r => r.book_id).filter(Boolean))];
console.log(`books: ${bookIds.length.toLocaleString()}`);
const meta = new Map();
for (let i = 0; i < bookIds.length; i += 500) {
  const chunk = bookIds.slice(i, i + 500);
  for (const b of await BOOKS.find(
    { $or: [{ _id: { $in: chunk } }, { id: { $in: chunk } }] },
    { projection: { id: 1, work_id: 1, author_id: 1, text_role: 1 } },
  ).toArray()) {
    for (const k of [String(b._id), b.id]) if (k) meta.set(k, b);
  }
}

// cluster sizes: editions per work_id, translations per work_id, books per author
const workIds = [...new Set([...meta.values()].map(b => b.work_id).filter(Boolean))];
const authorIds = [...new Set([...meta.values()].map(b => b.author_id).filter(Boolean))];
const editionCount = new Map(), translatedWork = new Set(), authorCount = new Map();
for (let i = 0; i < workIds.length; i += 300) {
  const chunk = workIds.slice(i, i + 300);
  for (const g of await BOOKS.aggregate([
    { $match: { work_id: { $in: chunk } } },
    { $group: { _id: '$work_id', n: { $sum: 1 }, roles: { $addToSet: '$text_role' } } },
  ]).toArray()) {
    editionCount.set(g._id, g.n);
    if ((g.roles || []).includes('modern-translation')) translatedWork.add(g._id);
  }
}
for (let i = 0; i < authorIds.length; i += 300) {
  const chunk = authorIds.slice(i, i + 300);
  for (const g of await BOOKS.aggregate([
    { $match: { author_id: { $in: chunk } } },
    { $group: { _id: '$author_id', n: { $sum: 1 } } },
  ]).toArray()) authorCount.set(g._id, g.n);
}
await client.close();

// ── 3. exposure tier per row ─────────────────────────────────────
// Ordinal, deliberately coarse — this is a gradient probe, not a calibrated score.
const tierOf = b => {
  if (!b) return null;
  if (!b.work_id) return '0 unidentified work';
  const ed = editionCount.get(b.work_id) || 1;
  const tr = translatedWork.has(b.work_id);
  if (ed >= 10 || (tr && ed >= 5)) return '4 heavily propagated (10+ editions)';
  if (ed >= 4 || tr) return '3 well propagated (4-9 editions / translated)';
  if (ed >= 2) return '2 some propagation (2-3 editions)';
  return '1 single edition';
};
for (const r of rows) {
  const b = r.book_id ? meta.get(r.book_id) : null;
  r.tier = tierOf(b);
  r.author_books = b?.author_id ? (authorCount.get(b.author_id) || 0) : null;
}

// ── 4. report ────────────────────────────────────────────────────
const lines = [];
const say = s => { lines.push(s); console.log(s); };

const table = (title, groups, note = '') => {
  const keys = [...groups.keys()].filter(k => groups.get(k).length >= MIN_N).sort();
  if (!keys.length) return;
  say(`\n### ${title}`);
  if (note) say(`\n${note}`);
  say('\n| stratum | n | mean | median | p25 | p75 |');
  say('|---|---:|---:|---:|---:|---:|');
  for (const k of keys) {
    const s = stats(groups.get(k));
    say(`| ${k} | ${s.n.toLocaleString()} | ${pct(s.mean)} | ${pct(s.median)} | ${pct(s.p25)} | ${pct(s.p75)} |`);
  }
};
const group = (sel, keyFn) => {
  const m = new Map();
  for (const r of sel) { const k = keyFn(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r.agreement); }
  return m;
};

const all = stats(rows.map(r => r.agreement));
say(`# Bibliographic exposure vs OCR agreement (${DATE})`);
say('');
say('Applies the prior half of the `/blog/did-the-ai-read-this` method (bibliographic');
say('propagation as a proxy for training-data exposure) to the revision-agreement');
say('corpus. Free: Mongo reads + local compute, no model calls. The behavioural-probe');
say('half of that method is NOT applied here — it costs model calls.');
say('');
say('**If models recite, agreement should RISE with exposure** — two runs over a widely');
say('propagated work agree by recalling the same passage rather than by reading the page.');
say('');
say('## Distribution (and why the corpus report\'s mean misleads)');
say('');
say(`n = ${all.n.toLocaleString()} eligible transcription pairs`);
say('');
say('| statistic | value |');
say('|---|---:|');
say(`| mean | ${pct(all.mean)} |`);
say(`| **median** | **${pct(all.median)}** |`);
say(`| p25 | ${pct(all.p25)} |`);
say(`| p75 | ${pct(all.p75)} |`);
say('');
say('The distribution is heavily left-tailed: the mean is dragged down by a minority of');
say('catastrophic pairs while the typical pair agrees almost perfectly. Quote the median.');

table('Agreement by exposure tier', group(rows, r => r.tier),
  'Uncontrolled — exposure is confounded with era, script and language, all of which\nindependently drive agreement. Read the controlled tables below, not this one.');

// Controls: hold the big confounds constant
const latin1600 = rows.filter(r => r.language === 'Latin' && r.year_bucket === '1600-1699');
table('Control: Latin, 1600-1699 only', group(latin1600, r => r.tier),
  'One language, one century, one script — the cleanest control the corpus affords.');

const sameCfg = rows.filter(r => r.same_config && r.script_class === 'spaced');
table('Control: same model AND same prompt, spaced scripts', group(sameCfg, r => r.tier),
  'Removes model and prompt-version transitions, so only the text differs.');

// Prompt change as a natural experiment: same page, same model, prompt version
// moved. The paper plans to BUY a prompt ablation; the corpus already contains one
// (of production prompts against each other, not bare-vs-annotated).
const sameModel = rows.filter(r => r.same_model && r.script_class === 'spaced');
table('Prompt held constant vs prompt changed (same model, spaced scripts)',
  group(sameModel, r => r.prompt_changed ? 'prompt CHANGED' : 'prompt held'),
  'How much of measured disagreement is the prompt rather than the page? Same model,\nsame page, spaced scripts — the only difference is which prompt version ran.');

table('By prompt transition (same model, spaced, n>=MIN)',
  group(sameModel.filter(r => r.prompt_changed), r => r.prompt_transition),
  'Which specific prompt moves cost agreement. Not an accuracy claim — a prompt that\nlegitimately changes annotation policy will disagree with its predecessor by design.');

table('Author prominence (books held by the same author)', group(rows, r =>
  r.author_books == null ? null
    : r.author_books >= 50 ? 'd 50+ books'
      : r.author_books >= 10 ? 'c 10-49 books'
        : r.author_books >= 3 ? 'b 3-9 books' : 'a 1-2 books'),
'A second, independent exposure proxy: prolific/heavily-collected authors are the ones\nwhose texts propagate.');

say('');
say('## Reading this');
say('');
say('A monotone rise across tiers that SURVIVES the controlled tables is evidence of');
say('recitation at corpus scale. A rise only in the uncontrolled table means exposure was');
say('standing in for era and language. A flat profile means the corpus carries no usable');
say('recitation signal and the anchor rows remain the only evidence — a negative result');
say('worth stating, since it bounds what reference-free agreement can ever show.');
say('');
say('Caveat: `work_id` coverage is partial, so `0 unidentified work` mixes genuinely');
say('obscure texts with merely unresolved ones. Treat it as "unknown", not "low exposure".');

fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`\nSaved → ${OUT}`);
