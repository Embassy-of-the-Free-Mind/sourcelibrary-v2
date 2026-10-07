#!/usr/bin/env node
// PRIOR ART: .claude/docs/ocr-engine-routing.md — the per-language table this replaces was written by
// hand on 2026-10-04 and was wrong the same day (Persian's hidden backlog moved to flash in #5812; the
// table still said lite). scripts/eval/build-index.mjs and build-experiments.mjs — the same shape
// (sources → one committed, generated text with --check), different sources. scripts/eval/
// benchmark-dashboard-data.mjs builds the evidence JSON this READS; it does not know what production
// routes, what was decided, or what a routing eval concluded.
/**
 * build-routing-table.mjs — render the per-language OCR routing table in .claude/docs/ocr-engine-routing.md
 * from the things that are already the truth, so the doc cannot drift from them:
 *
 *   production now      the live constants: getOcrModelForBook() in scripts/lib/ocr-routing.mjs, probed with a
 *                       visible book, a hidden book created before the decision, and a hidden book created today
 *   OCR accuracy        src/data/ocr-benchmark-evidence.json (language cells, lite and flash vs a reference)
 *   translation fidelity   the same file's `translation_fidelity` cells (#5695, #5700 A5)
 *   routing evals       scripts/eval/results/<run>/routing-eval.json (routing-eval.mjs decide)
 *   ledger              scripts/eval/DECISIONS.md, "OCR engine per stratum": rows that name the language
 *   pages, lanes        scripts/eval/routing-eval/languages.json — a dated page-count snapshot
 *                       (--refresh-pages re-measures it, READ-ONLY on Mongo) and the specialist lanes,
 *                       which no routing constant records
 *
 *   node scripts/eval/build-routing-table.mjs            # rewrite the section between the markers
 *   node scripts/eval/build-routing-table.mjs --check    # exit 1 if the committed section is stale
 *   node --env-file=… scripts/eval/build-routing-table.mjs --refresh-pages   # re-measure the snapshot, then rewrite
 *
 * tests/unit/routing-table-fresh.test.ts runs the same comparison, so a PR that changes a routing
 * constant, a ledger row or the evidence JSON without re-running this fails CI. No model call. Nothing is
 * written outside the doc and (with --refresh-pages) languages.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOcrModelForBook, OCR_MODEL_FLASH, OCR_MODEL_LITE, FLASH_OCR_FROM } from '../lib/ocr-routing.mjs';
import { toLanguageCodes, codeFamily, languageName } from '../lib/language-normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOC = '.claude/docs/ocr-engine-routing.md';
export const BEGIN = '<!-- BEGIN GENERATED routing-table: scripts/eval/build-routing-table.mjs writes this section. Do not edit it by hand. -->';
export const END = '<!-- END GENERATED routing-table -->';
const LANGUAGES = 'scripts/eval/routing-eval/languages.json';
const EVIDENCE = 'src/data/ocr-benchmark-evidence.json';
const DECISIONS = 'scripts/eval/DECISIONS.md';
const RESULTS = 'scripts/eval/results';
const MIN_PAGES = 15000;
const MIN_LIFT_N = 5; // a re-read lift from fewer books than this is not shown
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(x < 0.0995 ? 1 : 0)}%`);
const signed = (x) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}`);
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const short = (m) => (m === OCR_MODEL_LITE ? 'lite' : m === OCR_MODEL_FLASH ? 'flash' : m);

/** What the live router does for a book of this family, under OCR_LITE_ONLY (the default). */
function production(family, name) {
  const language = family === 'und' ? null : name;
  const from = FLASH_OCR_FROM[family];
  const before = new Date((from ? from.getTime() : Date.UTC(2026, 0, 1)) - 86400000);
  const probe = (book) => short(getOcrModelForBook({ language, ...book }, { liteOnly: true }));
  const visible = probe({ visible: true, created_at: before });
  const fresh = probe({ visible: false, created_at: new Date(Date.UTC(2099, 0, 1)) });
  const backlog = probe({ visible: false, created_at: before });
  if (visible === fresh && fresh === backlog) return visible === 'lite' ? 'lite' : `${visible} (visible, new, hidden backlog)`;
  const by = {}; for (const [k, v] of [['visible', visible], ['new', fresh], ['hidden backlog', backlog]]) (by[v] ||= []).push(k);
  return Object.entries(by).sort(([a], [b]) => (a === 'lite') - (b === 'lite')).map(([m, ks]) => `${m} (${ks.join(', ')})`).join('; ');
}

function accuracy(evidence, name) {
  const cell = (engine) => evidence.cells.find((c) => c.factor === 'language' && c.level === name && c.engine === engine);
  const lite = cell(OCR_MODEL_LITE), flash = cell(OCR_MODEL_FLASH);
  if (!lite?.cer_vs_reference) return '—';
  const p = flash?.paired_vs_production;
  const vs = flash?.cer_vs_reference ? `; flash ${pct(flash.cer_vs_reference.median)}${p?.n ? `, ${p.wins}W ${p.losses}L ${p.ties}T` : ''}` : '';
  return `lite ${pct(lite.cer_vs_reference.median)} (${lite.cer_vs_reference.n} refs, ${lite.grade.replace('-grade', '')})${vs}`;
}

function fidelity(evidence, name, aliases) {
  const cells = evidence.translation_fidelity || []; const names = [name, ...aliases];
  const served = cells.find((c) => c.kind === 'served' && c.language === name);
  const lift = cells.find((c) => c.kind === 'reocr_lift' && names.includes(c.language) && c.served_ocr_engine === 'lite');
  const out = [];
  if (served) out.push(`served ${served.fidelity_mean.toFixed(2)} (${served.n})${served.flash_minus_lite ? `; flash − lite ${signed(served.flash_minus_lite.delta)}${served.flash_minus_lite.ci95 ? ` [${signed(served.flash_minus_lite.ci95[0])}, ${signed(served.flash_minus_lite.ci95[1])}]` : ''}` : ''}`);
  if (lift?.reread_lift && lift.n >= MIN_LIFT_N) out.push(`flash re-read of a lite read ${signed(lift.reread_lift.mean)}${lift.reread_lift.ci95 ? ` [${signed(lift.reread_lift.ci95[0])}, ${signed(lift.reread_lift.ci95[1])}]` : ''} (${lift.n})`);
  return out.length ? out.join('; ') : '—';
}

function routingEvals(family) {
  const out = [];
  for (const dir of fs.readdirSync(path.join(ROOT, RESULTS)).sort()) {
    const f = path.join(ROOT, RESULTS, dir, 'routing-eval.json');
    if (!fs.existsSync(f)) continue;
    const d = JSON.parse(fs.readFileSync(f, 'utf8')); const g = d.groups?.[family];
    if (!g) continue;
    const verdicts = Object.entries(g).map(([rule, v]) => [rule, v.verdict]);
    const same = verdicts.every(([, v]) => v === verdicts[0][1]);
    out.push(`${d.issue ? `#${d.issue}` : d.run_id}: ${same ? `${verdicts[0][1]}${verdicts.length > 1 ? ' (every rule)' : ''}` : verdicts.map(([rule, v]) => `${v} (${rule})`).join('; ')}`);
  }
  return out.length ? out.join(' · ') : '—';
}

/** Rows of the ledger's OCR table whose Stratum cell names the language. */
function ledger(decisions, name, aliases) {
  const section = decisions.split(/^## /m).find((s) => s.startsWith('OCR engine per stratum')) || '';
  const rows = section.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Stratum') && !l.startsWith('|---')).map((l) => l.split(' | ').map((c) => c.replace(/^\|\s*|\s*\|$/g, '').trim()));
  const re = new RegExp(`(^|[^\\p{L}])(${[name, ...aliases].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^\\p{L}]|$)`, 'u');
  const mine = rows.filter((r) => re.test(r[0]));
  if (!mine.length) return '—';
  // The Decision cell; a row nobody judged says so in the Rule output cell and leaves Decision empty.
  const status = (r) => { const d = r[4] || ''; return /^DECIDED|^Derek \d/.test(d) ? 'decided' : /^PENDING/.test(d) ? 'pending' : /^UNJUDGED/.test(d) || /^UNJUDGED/.test(r[3] || '') ? 'unjudged' : 'no decision recorded'; };
  const counts = {}; const issues = new Set();
  for (const r of mine) { counts[status(r)] = (counts[status(r)] || 0) + 1; const m = (r[2] || '').match(/#\d+/); if (m) issues.add(m[0]); }
  return `${['decided', 'pending', 'unjudged', 'no decision recorded'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(', ')}${issues.size ? ` (${[...issues].join(', ')})` : ''}`;
}

/** The generated section, markers included. Deterministic: no clock, no Mongo. */
export function renderRoutingTable() {
  const L = JSON.parse(read(LANGUAGES)); const evidence = JSON.parse(read(EVIDENCE)); const decisions = read(DECISIONS);
  const lines = [BEGIN, '',
    `Production is read from \`getOcrModelForBook\` with \`OCR_LITE_ONLY\` on, the default (lite = \`${OCR_MODEL_LITE}\`, flash = \`${OCR_MODEL_FLASH}\`): "visible" is a visible book, "new" a hidden book created on or after the family's date in \`FLASH_OCR_FROM\`, "hidden backlog" a hidden book created before it. A specialist lane, where one exists, reads the script instead of Gemini. Pages are \`pages_count\` by the family of the first \`language\` (snapshot of ${L.snapshot_at}, all books; "owed" = hidden books' pages not yet read). OCR accuracy is median CER against a reference, graded by referenced books (exploratory < 30, directional 30–49, decision ≥ 50); W/L/T is flash against lite on the same pages. Translation fidelity is a judge's 1–5 rating against a published translation (books in brackets), not CER. A routing-eval verdict is a rule's output, not a decision; the ledger column counts the rows of \`scripts/eval/DECISIONS.md\` that name the language.`,
    '',
    '| language | pages (hidden, owed) | Gemini router now | specialist lane | OCR accuracy | translation fidelity | routing evals | ledger |',
    '|---|---:|---|---|---|---|---|---|'];
  for (const r of L.languages) {
    const name = r.name; const aliases = L.aliases?.[r.family] || [];
    lines.push(`| ${name} (\`${r.family}\`) | ${compact(r.pages)} (${compact(r.hidden_ocr_owed)}) | ${production(r.family, name)} | ${L.specialist_lanes?.[r.family] || '—'} | ${accuracy(evidence, name)} | ${fidelity(evidence, name, aliases)} | ${routingEvals(r.family)} | ${ledger(decisions, name, aliases)} |`);
  }
  lines.push('', END);
  return lines.join('\n');
}

/** The doc with its generated section replaced. Throws if the markers are missing or doubled. */
export function withSection(doc, section) {
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a < 0 || b < a || doc.indexOf(BEGIN, a + 1) >= 0) throw new Error(`${DOC}: expected exactly one "${BEGIN}" … "${END}" pair`);
  return doc.slice(0, a) + section + doc.slice(b + END.length);
}
export const currentSection = (doc) => { const a = doc.indexOf(BEGIN), b = doc.indexOf(END); return a < 0 || b < a ? null : doc.slice(a, b + END.length); };

async function refreshPages() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const m = new Map();
  for await (const b of client.db('bookstore').collection('books').find({ pages_count: { $gt: 0 } }, { projection: { language: 1, pages_count: 1, pages_ocr: 1, visible: 1, _id: 0 } })) {
    const first = toLanguageCodes(b.language).codes[0]; const family = first ? codeFamily(first) : 'und';
    const r = m.get(family) || { family, name: family === 'und' ? 'und / unknown' : languageName(family), books: 0, pages: 0, hidden_ocr_owed: 0 };
    r.books++; r.pages += b.pages_count; if (b.visible !== true) r.hidden_ocr_owed += Math.max(0, b.pages_count - (b.pages_ocr || 0));
    m.set(family, r);
  }
  await client.close();
  const was = JSON.parse(read(LANGUAGES));
  const languages = [...m.values()].filter((r) => r.pages >= MIN_PAGES).sort((a, b) => b.pages - a.pages);
  fs.writeFileSync(path.join(ROOT, LANGUAGES), JSON.stringify({ ...was, snapshot_at: new Date().toISOString().slice(0, 10), min_pages: MIN_PAGES, languages }, null, 1) + '\n');
  console.log(`languages.json: ${languages.length} families with ≥ ${MIN_PAGES} pages`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--refresh-pages')) await refreshPages();
  const doc = read(DOC); const section = renderRoutingTable();
  if (process.argv.includes('--check')) {
    if (currentSection(doc) !== section) { console.error(`${DOC}: the generated routing table is stale — run \`node scripts/eval/build-routing-table.mjs\``); process.exit(1); }
    console.log(`${DOC}: generated routing table is current`);
  } else {
    fs.writeFileSync(path.join(ROOT, DOC), withSection(doc, section));
    console.log(`${DOC}: wrote the generated routing table (${section.split('\n').filter((l) => /^\| .*\(`[a-z]{3}`\)/.test(l)).length} languages)`);
  }
}
