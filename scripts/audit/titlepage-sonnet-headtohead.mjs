#!/usr/bin/env node
/**
 * HEAD-TO-HEAD: Claude Sonnet 5 vs gemini-3.1-flash-lite on the same 20 books,
 * scored against hand adjudication.
 *
 * The residual errors on the flash-lite run are not extraction failures — the
 * page is read correctly and the RELATIONSHIP is misjudged: an ownership
 * inscription, a preface writer, an entry in a banned-book list, a bound-with
 * title page. Those are judgement calls, which is where a stronger model should
 * show up if it is going to show up anywhere.
 *
 * The comparison is only meaningful because the ground truth already exists:
 * twenty proposals reviewed one at a time and archived at
 * .claude/docs/archive/titlepage-hand-adjudication-2026-08-17.md. Sonnet is
 * scored against those verdicts, not against flash-lite's output — otherwise
 * this measures agreement, not correctness.
 *
 * SAME prompt, SAME window, SAME guards. Only the model differs.
 *
 * Cost: 20 books, roughly $0.15 at Sonnet 5 rates ($3/M in, $15/M out).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/titlepage-sonnet-headtohead.mjs
 */
import { MongoClient } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { attributionWindowOf } from '../lib/title-page-ocr.mjs';

const MODEL = 'claude-sonnet-5';
const PROMPT = readFileSync(new URL('./titlepage-prompt-v3.txt', import.meta.url), 'utf8');
const OUT = 'scripts/output/titlepage-sonnet-headtohead.json';

/**
 * My hand verdicts, keyed by a distinctive title fragment. `expected` is the
 * name a correct reader should return; null means the correct answer is to
 * return nothing (no author on the page, or the only name is not a byline).
 */
const TRUTH = [
  { key: 'Biblia Veteris Testamenti', expected: 'Artopaeus', verdict: 'accept' },
  { key: 'Opera', expected: 'Ovid', verdict: 'accept', exactTitle: true },
  { key: 'Reg.lat.1228', expected: 'Stephanellus', verdict: 'accept' },
  { key: 'Hungariae Descriptio', expected: 'Lazius', verdict: 'accept' },
  { key: 'Verzeichniss der altdeutschen', expected: 'Schütz', verdict: 'accept' },
  { key: 'Verae Alchemiae', expected: 'Gratarol', verdict: 'accept' },
  { key: 'Viridarium illustrium', expected: 'Mirandula', verdict: 'accept' },
  { key: 'Aureum Vellus', expected: 'Trismosin', verdict: 'accept' },
  { key: 'Lehren der Rosenkreuzer', expected: 'Madathanus', verdict: 'medium' },
  { key: 'Bibliotheca A Philippo', expected: 'Wittwer', verdict: 'medium' },
  { key: 'Gebet-Buechlein', expected: null, verdict: 'reject', why: 'ownership inscription (Lydia Seidel)' },
  { key: 'korte verhandeling', expected: null, verdict: 'reject', why: 'anonymous self-designation; also the translator' },
  { key: 'Greek Symphonia', expected: null, verdict: 'reject', why: 'bound-with title page; Castellio is a translator' },
  { key: 'Signatstern', expected: null, verdict: 'reject', why: 'Stark is discussed in the preface, not the author' },
  { key: 'Theatrum Mundi', expected: null, verdict: 'reject', why: 'Albinus wrote the preface' },
  { key: 'Catalogus librorum', expected: null, verdict: 'reject', why: 'Voltaire is an ENTRY in the banned-book list' },
  { key: 'Alphabetische naamlyst', expected: null, verdict: 'reject', why: 'initials only, not a usable name' },
  { key: 'Tractatus de alchimia', expected: null, verdict: 'reject', why: 'one tract in a collection' },
  { key: 'Alchemical and Medical Illustrations', expected: null, verdict: 'hold' },
  { key: 'Duplex confessio', expected: null, verdict: 'hold' },
];

const PLACEHOLDER = /^(unknown|anonymous|anon|n\/?a|none|s\.?\s*n\.?|sine nomine|no author|not stated|unbekannt|onbekend|\[?unknown author\]?)$/i;
const NONLATIN = new Set(['Chinese', 'Literary Chinese', 'Classical Chinese', 'Japanese', 'Korean', 'Tibetan', 'Arabic', 'Persian', 'Hebrew', 'Sanskrit', 'Sumerian', 'Syriac', 'Armenian', 'Malay']);

const normQ = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const quoteIsOnPage = (q, prose) => { const n = normQ(q); return n.length >= 4 && normQ(prose).includes(n); };
const tpRender = (win) => win.map((w) => `--- PAGE ${w.page_number} [${w.page_type}${w.untyped_fallback ? ', UNTYPED GUESS' : ''}] ---\n${w.prose.slice(0, 2600)}`).join('\n\n');

// ── rebuild the same 20 books, same selection logic ───────────────────────────
const gem = readFileSync('scripts/output/titlepage-attribution-proposals.jsonl', 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.proposed)
  .filter((r) => !r.catalogued_author || PLACEHOLDER.test(String(r.catalogued_author).trim()));
const byBook = new Map();
for (const r of gem) {
  const cur = byBook.get(r.book_id);
  if (!cur || (r.page_type === 'title-page' && cur.page_type !== 'title-page')) byBook.set(r.book_id, r);
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const list = [...byBook.values()];
const meta = new Map();
const ids = list.map((r) => r.book_id);
for (let i = 0; i < ids.length; i += 400) {
  for (const b of await db.collection('books').find({ id: { $in: ids.slice(i, i + 400) } }, { projection: { id: 1, language: 1 } }).toArray()) meta.set(b.id, b);
}
const batch = list.filter((r) => !NONLATIN.has(meta.get(r.book_id)?.language)).slice(0, 20);

const prepared = [];
for (const r of batch) {
  const win = await attributionWindowOf(db.collection('pages'), { id: r.book_id });
  if (win.length) prepared.push({ gem: r, win });
}
await mc.close();
console.log(`prepared ${prepared.length} of ${batch.length} books\n`);

// ── run Sonnet ────────────────────────────────────────────────────────────────
const anthropic = new Anthropic();
let tokIn = 0, tokOut = 0;

async function askSonnet(prose) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: `${PROMPT}\n\n${prose}` }],
  });
  tokIn += res.usage.input_tokens ?? 0;
  tokOut += res.usage.output_tokens ?? 0;
  if (res.stop_reason === 'refusal') return { names: [], refused: true };
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const body = text.startsWith('```') ? text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '') : text;
  try { return { names: JSON.parse(body)?.names ?? [] }; }
  catch { return { names: [], parse_failed: true, raw: body.slice(0, 200) }; }
}

const truthFor = (title) => TRUTH.find((t) => (t.exactTitle ? String(title).trim() === t.key : String(title).includes(t.key)));
const scores = { sonnet: { right: 0, wrong: 0, unscored: 0 }, gemini: { right: 0, wrong: 0, unscored: 0 } };
const rows = [];

for (const { gem: g, win } of prepared) {
  const t = truthFor(g.title);
  const out = await askSonnet(tpRender(win));
  const proseByPage = new Map(win.map((w) => [String(w.page_number), w.prose]));
  const authors = (out.names ?? [])
    .filter((x) => String(x.role).toLowerCase() === 'author')
    .filter((x) => proseByPage.has(String(x.page)) && quoteIsOnPage(x.quoted_line, proseByPage.get(String(x.page))));
  const sName = authors[0]?.name_nominative ?? null;

  const score = (name) => {
    if (!t || t.verdict === 'hold') return 'unscored';
    if (t.expected === null) return name === null ? 'right' : 'wrong';
    if (name === null) return 'wrong';
    return name.toLowerCase().includes(t.expected.toLowerCase()) ? 'right' : 'wrong';
  };
  const sv = score(sName), gv = score(g.proposed);
  scores.sonnet[sv]++; scores.gemini[gv]++;

  rows.push({ title: String(g.title).slice(0, 58), truth: t?.expected ?? (t ? '(none — ' + (t.why ?? t.verdict) + ')' : '?'), verdict: t?.verdict, sonnet: sName, sonnet_score: sv, gemini: g.proposed, gemini_score: gv, sonnet_quote: authors[0]?.quoted_line ?? null });
  console.log(`${sv === 'right' ? '✓' : sv === 'wrong' ? '✗' : '·'} S:${String(sName ?? '(none)').slice(0, 26).padEnd(26)} ${gv === 'right' ? '✓' : gv === 'wrong' ? '✗' : '·'} G:${String(g.proposed).slice(0, 26).padEnd(26)} ${String(g.title).slice(0, 40)}`);
}

writeFileSync(OUT, JSON.stringify({ model: MODEL, scores, tokens: { in: tokIn, out: tokOut }, rows }, null, 1));
const pct = (s) => { const n = s.right + s.wrong; return n ? `${((100 * s.right) / n).toFixed(0)}% (${s.right}/${n})` : 'n/a'; };
console.log(`\n── scored against hand adjudication ──`);
console.log(`  claude-sonnet-5        : ${pct(scores.sonnet)}   unscored ${scores.sonnet.unscored}`);
console.log(`  gemini-3.1-flash-lite  : ${pct(scores.gemini)}   unscored ${scores.gemini.unscored}`);
console.log(`\n  Sonnet tokens: ${tokIn.toLocaleString()} in / ${tokOut.toLocaleString()} out`);
console.log(`  cost: $${((tokIn / 1e6) * 3 + (tokOut / 1e6) * 15).toFixed(2)} at $3/$15 per M`);
console.log(`\n  full rows: ${OUT}`);
