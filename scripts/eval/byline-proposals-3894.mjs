#!/usr/bin/env node
/**
 * #3894 — printer-as-author and wrong-role bylines: a DRY RUN that writes
 * proposals, never bylines.
 *
 * PRIOR ART: scripts/maintenance/apply-aldine-byline-correction-3894.mjs and
 * apply-titlepage-bylines-3982.mjs — each is the APPLY half of one run whose
 * reader and refuter were in-session subagents, so the reading step was never
 * a script. This is that step as a script (reader + refuter via `claude -p`,
 * batched), over the population both left out: every remaining printer-dynasty
 * byline (the 346 NO_NAME books, the 18 hidden Aldine-imprint books, the other
 * dynasty strings) plus two single records from #4392. Reuses
 * `attributionWindowOf` (the page window), the v4 role grammar from
 * `scripts/audit/titlepage-prompt-v4.txt`, `sameNameForm`, and the PRINTER_DYNASTY
 * scope of `scripts/audit/title-page-attribution.mjs`.
 *
 * WRITES NOTHING TO MONGO. Every stage is a read; output is
 * `scripts/eval/results/byline-proposals-3894.json`. A byline is read by the
 * catalog sync, the author pages and the work resolvers, so writing one is
 * actuation (CLAUDE.md); the apply step is a separate script a human runs.
 *
 * STAGES (each resumable; intermediate JSONL under $JOB_SCRATCH or scripts/output):
 *   select   books in scope + their OCR attribution window (up to 6 pages, p1–24)
 *   read     reader: names the author and the catalogued person's role, quoting the page
 *   screen   deterministic gates: quote on cited page, not self-named, no role
 *            conflict, single-author book, confidence
 *   wikidata name → QID (wbsearchentities, human-only), thesaurus doc by QID
 *   refute   adversarial refuter on every screened proposal; defaults to refuted
 *   assemble the proposals JSON + counts
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/eval/byline-proposals-3894.mjs --stage=select
 *   ... --stage=read [--batch=8] [--model=sonnet]
 *   ... --stage=screen | --stage=wikidata | --stage=refute [--model=opus] | --stage=assemble
 */
import { MongoClient } from 'mongodb';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { attributionWindowOf } from '../lib/title-page-ocr.mjs';
import { namesOnTitlePage } from '../lib/title-page-attribution.mjs';
import { sameNameForm } from '../lib/name-equivalence.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const STAGE = arg('stage', 'select');
const WORK = arg('work', join(process.env.JOB_SCRATCH || 'scripts/output', 'byline-3894'));
const OUT = arg('out', 'scripts/eval/results/byline-proposals-3894.json');
const BATCH = Number(arg('batch', 8));
/** `--shard=k/n` runs every n-th batch starting at k, so n processes can share a stage. */
const [SHARD, NSHARD] = arg('shard', '0/1').split('/').map(Number);
const mine = (i) => (i / BATCH) % NSHARD === SHARD;
mkdirSync(WORK, { recursive: true });
const F = {
  books: join(WORK, 'books.jsonl'), reads: join(WORK, 'reads.jsonl'), screened: join(WORK, 'screened.jsonl'),
  wikidata: join(WORK, 'wikidata.jsonl'), refute: join(WORK, 'refute.jsonl'),
};
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

/** Same scope as `scripts/audit/title-page-attribution.mjs`. */
const PRINTER_DYNASTY = /\b(manuzio|manutius|manucci|mannucci|aldina|aldine|torresan|estienne|stephanus|plantin|elzevir|elsevier|froben|giunt|gryphius|wechel|oporinus|blaeu|bodoni|didot|zetzner|birckmann|vascosan|morel|cramoisy|janssonius|hackius|luchtmans|zanetti|salicato|ruffinelli|marchetti|giolito|sessa|valgrisi|tramezzino)\b/i;
/** #4392: two wrong bylines found while linking work ids, outside the dynasty regex. */
const EXTRA_IDS = ['6a0857d049638a50931c5a32', '69b51e4b768235dc6598f5aa'];

const normQ = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const quoteOnPage = (q, prose) => { const n = normQ(q); return n.length >= 4 && normQ(prose).includes(n); };

// ── select ───────────────────────────────────────────────────────────────────
async function select() {
  const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await mc.connect();
  const db = mc.db('bookstore');
  const q = { $or: [{ author: PRINTER_DYNASTY }, { id: { $in: EXTRA_IDS } }], resource_type: { $exists: false } };
  const rows = await db.collection('books').find(q, {
    projection: { id: 1, title: 1, author: 1, author_id: 1, translator: 1, editor: 1, publisher: 1, visible: 1, year: 1, published: 1, language: 1, pages_ocr: 1, 'ai_metadata.author': 1 },
  }).toArray();
  const out = [];
  let noOcr = 0;
  for (const b of rows) {
    const id = b.id || String(b._id);
    const names = namesOnTitlePage(b.title);
    const bucket = names.some((n) => sameNameForm(n.name, b.author)) || sameNameForm(String(b.title ?? '').slice(0, 240), b.author)
      ? 'SELF_NAMED' : !names.length ? 'NO_NAME' : names.some((n) => n.role === 'author') ? 'AUTHOR_ON_PAGE' : 'EDITOR_ONLY';
    const win = b.pages_ocr > 0 ? await attributionWindowOf(db.collection('pages'), { id }, 24, 6) : [];
    if (!win.length) noOcr++;
    out.push({
      book_id: id, title: b.title, author: b.author, author_id: b.author_id ?? null, translator: b.translator ?? null,
      publisher: b.publisher ?? null, visible: b.visible === true, year: b.year ?? b.published ?? null, language: b.language ?? null,
      ai_author: b.ai_metadata?.author ?? null, title_bucket: bucket, extra: EXTRA_IDS.includes(id),
      window: win.map((w) => ({ page_number: w.page_number, page_type: w.page_type, untyped: !!w.untyped_fallback, prose: w.prose.slice(0, 2600) })),
    });
  }
  writeFileSync(F.books, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const c = (f) => out.filter(f).length;
  console.log(`in scope ${out.length} · visible ${c((r) => r.visible)} · no OCR window ${noOcr}`);
  for (const k of ['NO_NAME', 'AUTHOR_ON_PAGE', 'EDITOR_ONLY', 'SELF_NAMED']) console.log(`  ${k.padEnd(15)} ${c((r) => r.title_bucket === k)}`);
  await mc.close();
}

// ── claude -p, batched ──────────────────────────────────────────────────────
// The env file carries an ANTHROPIC_API_KEY that would override the subscription
// login (and 401s); `claude -p` must run on the login, so the key is dropped.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.ANTHROPIC_API_KEY;
let failedBatches = 0;
function claude(prompt, model) {
  if (failedBatches >= 3) { console.error('3 batches failed in a row — stopping'); process.exit(3); }
  for (let i = 0; i < 3; i++) {
    const r = spawnSync(process.env.CLAUDE_BIN || 'claude', ['-p', '--model', model, '--output-format', 'text'], { input: prompt, encoding: 'utf8', env: CHILD_ENV, maxBuffer: 64 << 20, timeout: 900000 });
    const t = String(r.stdout ?? '');
    const m = t.match(/\[[\s\S]*\]/);
    if (m) { try { const j = JSON.parse(m[0]); failedBatches = 0; return j; } catch { /* retry */ } }
    console.error(`  claude attempt ${i + 1} unparsed: ${t.slice(0, 200)} ${String(r.stderr ?? '').slice(0, 200)}`);
  }
  failedBatches++;
  return null;
}
const renderBook = (b) => `##### BOOK ${b.book_id}\nCATALOGUED AUTHOR: ${b.author}\nCATALOGUE TITLE: ${String(b.title ?? '').slice(0, 300)}\nYEAR: ${b.year ?? '?'}\n`
  + b.window.map((w) => `--- PAGE ${w.page_number} [${w.page_type}${w.untyped ? ', UNTYPED GUESS' : ''}] ---\n${w.prose}`).join('\n\n');

const ROLE_GRAMMAR = readFileSync(new URL('../audit/titlepage-prompt-v4.txt', import.meta.url), 'utf8')
  .split('CRITICAL RULES')[0].split('For each PERSON named')[1] ?? '';

const READER = `You are a rare-books cataloguer checking bylines. Each book below is catalogued under an author string that is (usually) a PRINTER or PUBLISHER, not a writer. You are given the OCR of the book's front matter (title page, dedication, preface, colophon), each page labelled with its number.

For each book decide, from these pages only:
1. Who WROTE the book, if the pages say so.
2. What the CATALOGUED person/firm did for this book: "printer", "publisher", "editor", "translator", "author" (they really wrote it — e.g. Aldus's grammars, Paulus Manutius's own commentaries), or "not_named".
3. Any TRANSLATOR named.

Role grammar (apply it strictly):
For each PERSON named${ROLE_GRAMMAR}
Rules:
- A genitive in the title names the author ("M. Tullii Ciceronis Epistolae"). An ablative + participle names an editor ("a Paulo Manutio emendatus" = he corrected it). "apud", "in aedibus", "appresso", "excudebat" name the printer.
- A dedication SIGNED by the printer does not make him the author.
- If the volume collects works by SEVERAL authors (Sammelband, anthology, "with the orations of X and Y"), say composite=true and give no single author.
- If the pages name no author, return author=null. That is a correct and common answer; never supply an author from your own knowledge of the work.
- Names inside citations, epigraphs, or privileges are not the author.
- Give author_nominative in the standard modern form (e.g. "Marcus Tullius Cicero", "Pietro Bembo"), author_as_printed exactly as on the page.
- quoted_line MUST be copied verbatim from the page you cite.

Return ONLY a JSON array, one object per book, in the order given:
[{"book_id":"...","author_nominative":null|"...","author_as_printed":null|"...","page":<int|null>,"quoted_line":null|"...","catalogued_role":"printer|publisher|editor|translator|author|not_named","translator":null|"...","translator_quoted_line":null|"...","composite":false,"other_names":[{"name":"...","role":"..."}],"confidence":"high|medium|low","reasoning":"one sentence"}]

BOOKS:
`;

async function read() {
  const model = arg('model', 'sonnet');
  const books = readJsonl(F.books).filter((b) => b.title_bucket !== 'SELF_NAMED' || b.extra).filter((b) => b.window.length);
  const done = new Set(readJsonl(F.reads).map((r) => r.book_id));
  const todo = books.filter((b) => !done.has(b.book_id));
  console.log(`reader: ${todo.length} to read (${done.size} done), batch ${BATCH}, model ${model}`);
  for (let i = 0; i < todo.length; i += BATCH) {
    if (!mine(i)) continue;
    const chunk = todo.slice(i, i + BATCH);
    const res = claude(READER + chunk.map(renderBook).join('\n\n'), model);
    if (!res) { console.error(`  batch ${i} failed; will retry on resume`); continue; }
    const by = new Map(res.map((r) => [r.book_id, r]));
    for (const b of chunk) {
      const r = by.get(b.book_id);
      if (r) appendFileSync(F.reads, JSON.stringify({ ...r, book_id: b.book_id, reader_model: model }) + '\n');
    }
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
}

// ── screen ──────────────────────────────────────────────────────────────────
const PLACEHOLDER = /^(unknown|anonymous|anon\.?|various|n\/?a|none|s\.?\s?n\.?)$/i;
function screen() {
  const books = new Map(readJsonl(F.books).map((b) => [b.book_id, b]));
  const out = [];
  for (const r of readJsonl(F.reads)) {
    const b = books.get(r.book_id);
    const reasons = [];
    let verdict = 'PROPOSE';
    const name = r.author_nominative?.replace(/\s*\([^)]*\)/g, '').trim() || null;
    const cited = b.window.find((w) => w.page_number === r.page);
    if (!name) verdict = r.composite ? 'COMPOSITE' : 'NO_AUTHOR_ON_PAGE';
    else if (PLACEHOLDER.test(name)) verdict = 'NO_AUTHOR_ON_PAGE';
    else if (sameNameForm(name, b.author) || r.catalogued_role === 'author') verdict = 'SELF_NAMED';
    else {
      if (r.composite) reasons.push('composite');
      if (!cited) reasons.push('cited-page-not-in-window');
      else if (!quoteOnPage(r.quoted_line, cited.prose)) reasons.push('quote-not-on-page');
      const conflict = (r.other_names ?? []).filter((o) => o.role && !/author/i.test(o.role) && sameNameForm(o.name, name));
      if (conflict.length) reasons.push(`role-conflict:${conflict.map((o) => o.role).join('/')}`);
      if (r.confidence === 'low') reasons.push('low-confidence');
      if (/^[A-Z]\.\s?[A-Z]\./.test(name)) reasons.push('initials-only');
      if (reasons.length) verdict = 'HELD';
    }
    const translator = r.translator?.trim() || null;
    const tPage = translator ? b.window.find((w) => quoteOnPage(r.translator_quoted_line, w.prose)) : null;
    out.push({ book_id: r.book_id, verdict, reasons, name, translator: tPage ? translator : null, translator_page: tPage?.page_number ?? null });
  }
  writeFileSync(F.screened, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const c = {}; for (const r of out) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  console.log(c);
}

// ── wikidata ────────────────────────────────────────────────────────────────
const UA = { 'User-Agent': 'SourceLibrary/byline-3894 (derek@sourcelibrary.org)' };
async function getJson(u) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r?.ok) { try { return await r.json(); } catch { /* retry */ } }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`wikidata unreachable: ${u.slice(0, 120)}`);
}
/** Humans (P31=Q5) the search returns for a name, with every label/alias form. */
async function wd(name) {
  const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=7&search=${encodeURIComponent(name)}`);
  const ids = (j.search ?? []).map((x) => x.id);
  if (!ids.length) return [];
  const e = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels|aliases|descriptions&languages=en|la|it|fr|de&ids=${ids.join('|')}`);
  const year = (c) => { const t = c?.[0]?.mainsnak?.datavalue?.value?.time; return t ? Number(t.slice(0, t.indexOf('-', 1))) : null; };
  return ids.map((id) => e.entities?.[id]).filter((x) => x && (x.claims?.P31 ?? []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5'))
    .map((x) => ({
      qid: x.id, label: x.labels?.en?.value ?? Object.values(x.labels ?? {})[0]?.value ?? null, description: x.descriptions?.en?.value ?? null,
      born: year(x.claims?.P569), died: year(x.claims?.P570), viaf: x.claims?.P214?.[0]?.mainsnak?.datavalue?.value ?? null,
      forms: [...new Set([...Object.values(x.labels ?? {}).map((l) => l.value), ...Object.values(x.aliases ?? {}).flat().map((a) => a.value)])],
    }));
}
async function wikidata() {
  const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await mc.connect();
  const authors = mc.db('bookstore').collection('authors');
  const books = new Map(readJsonl(F.books).map((b) => [b.book_id, b]));
  const done = new Set(readJsonl(F.wikidata).map((r) => r.book_id));
  for (const s of readJsonl(F.screened).filter((r) => r.verdict === 'PROPOSE' || r.verdict === 'HELD')) {
    if (done.has(s.book_id)) continue;
    const b = books.get(s.book_id);
    let cands = [];
    cands = await wd(s.name);
    // Date gate. A candidate with NO life date cannot be placed in time and is
    // refused: on the first run that let through Longinus the soldier-saint for
    // the rhetorician and a modern ORCID researcher for "Francisco Vargas". With
    // dates: born before the printing, and not dead more than 90 years after it.
    const y = Number(b.year) || null;
    const fit = cands.filter((c) => (c.born != null || c.died != null)
      && (!y || ((c.born == null || c.born < y) && (c.died == null || c.died <= y + 90))));
    // A hit counts only when one of its own label/alias forms is the proposed name.
    const top = fit.find((c) => c.forms.some((f) => sameNameForm(f, s.name))) ?? null;
    let doc = null;
    if (top) doc = await authors.findOne({ wikidata_id: top.qid, merged_into: { $exists: false } }, { projection: { _id: 1, canonical_name: 1 } });
    const strip = ({ forms, ...c }) => c;
    appendFileSync(F.wikidata, JSON.stringify({ book_id: s.book_id, candidates: cands.slice(0, 4).map(strip), match: top && strip(top), author_doc: doc ? { author_id: doc._id, canonical_name: doc.canonical_name } : null }) + '\n');
    await new Promise((r) => setTimeout(r, 400));
  }
  await mc.close();
  console.log(`wikidata rows: ${readJsonl(F.wikidata).length}`);
}

// ── refute ──────────────────────────────────────────────────────────────────
const REFUTER = `You are an ADVERSARIAL reviewer. For each book below, a reader has proposed replacing the catalogued byline (usually a printer or publisher) with a new author. Your job is to REFUTE the proposal if you can. Read the front-matter OCR yourself.

Refute (refuted=true) if ANY of these hold:
- the pages do not actually say this person wrote the book (they edited, translated, commented, compiled someone else's text, dedicated, or printed it);
- the quoted line's grammar governs something other than the book (a preface, a letter, one piece in a collection);
- the volume is a composite of several authors' works, so no single author owns it;
- the proposed name is a place, office, title of a work, or a case-declined form mistaken for a different person;
- the catalogued person really did write it.
When you are UNCERTAIN, refute. A wrong public byline is worse than a missing correction.

Return ONLY a JSON array, one object per book, in order:
[{"book_id":"...","refuted":true|false,"confidence":"high|medium|low","reasoning":"one or two sentences, citing the page"}]

PROPOSALS:
`;
async function refute() {
  const model = arg('model', 'opus');
  const books = new Map(readJsonl(F.books).map((b) => [b.book_id, b]));
  const reads = new Map(readJsonl(F.reads).map((r) => [r.book_id, r]));
  const done = new Set(readJsonl(F.refute).map((r) => r.book_id));
  const todo = readJsonl(F.screened).filter((s) => s.verdict === 'PROPOSE' && !done.has(s.book_id));
  console.log(`refuter: ${todo.length} to check, model ${model}`);
  for (let i = 0; i < todo.length; i += BATCH) {
    if (!mine(i)) continue;
    const chunk = todo.slice(i, i + BATCH);
    const body = chunk.map((s) => {
      const r = reads.get(s.book_id);
      return `${renderBook(books.get(s.book_id))}\nPROPOSED AUTHOR: ${s.name} (as printed: ${r.author_as_printed}; page ${r.page}; quoted: "${r.quoted_line}")\nREADER SAYS CATALOGUED PERSON WAS: ${r.catalogued_role}${s.translator ? `\nPROPOSED TRANSLATOR: ${s.translator}` : ''}`;
    }).join('\n\n');
    const res = claude(REFUTER + body, model);
    if (!res) { console.error(`  batch ${i} failed; will retry on resume`); continue; }
    const by = new Map(res.map((r) => [r.book_id, r]));
    for (const s of chunk) { const r = by.get(s.book_id); if (r) appendFileSync(F.refute, JSON.stringify({ ...r, book_id: s.book_id, refuter_model: model }) + '\n'); }
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
}

// ── assemble ────────────────────────────────────────────────────────────────
const CLASS_OF_ROLE = { printer: 'printer', publisher: 'publisher', editor: 'editor', translator: 'translator' };
/** Held by a person on #3894 (2026-08-11) as editorial calls the page underdetermines. */
const HUMAN_HOLDS = {
  '6a06cc9fc749b698e5b294bc': '"Bernardi Georgii" latinises both Giorgi and Zorzi (#3894, held 2026-08-11)',
  '6a06d5da9a48d51399965fb9': 'Trogus vs Justinus epitome (#3894, held 2026-08-11)',
};
function assemble() {
  const books = new Map(readJsonl(F.books).map((b) => [b.book_id, b]));
  const reads = new Map(readJsonl(F.reads).map((r) => [r.book_id, r]));
  const wdBy = new Map(readJsonl(F.wikidata).map((r) => [r.book_id, r]));
  const refBy = new Map(readJsonl(F.refute).map((r) => [r.book_id, r]));
  const proposals = [];
  for (const s of readJsonl(F.screened)) {
    const b = books.get(s.book_id); const r = reads.get(s.book_id); const w = wdBy.get(s.book_id); const f = refBy.get(s.book_id);
    let status = s.verdict !== 'PROPOSE' ? s.verdict : !f ? 'UNREFUTED_PENDING' : f.refuted ? 'REFUTED' : 'READY';
    if (HUMAN_HOLDS[s.book_id] && status === 'READY') { status = 'HELD'; s.reasons = [...s.reasons, `human-hold: ${HUMAN_HOLDS[s.book_id]}`]; }
    const cited = b.window.find((x) => x.page_number === r.page);
    proposals.push({
      book_id: s.book_id, url: `https://sourcelibrary.org/book/${s.book_id}`, title: String(b.title ?? '').slice(0, 200), year: b.year, language: b.language, visible: b.visible,
      title_bucket: b.title_bucket, status, held_reasons: s.reasons,
      // The class is what the catalogued person did for THIS book. NO_NAME: the
      // front matter names no single author. A dynasty name the pages never
      // mention (`not_named`) is counted as printer — the scope is printer dynasties.
      class: s.verdict === 'SELF_NAMED' ? 'self_named' : s.verdict === 'NO_AUTHOR_ON_PAGE' || s.verdict === 'COMPOSITE' ? 'NO_NAME' : (CLASS_OF_ROLE[r.catalogued_role] ?? 'printer'),
      catalogued_role_on_page: r.catalogued_role,
      current: { author: b.author, author_id: b.author_id, translator: b.translator },
      proposed: status === 'READY' ? {
        author: s.name, author_id: w?.author_doc?.author_id ?? null, author_id_basis: w?.author_doc ? `authors doc carries wikidata_id ${w.match.qid}` : 'none — no thesaurus doc with this QID; stays unlinked (T2)',
        translator: !b.translator && s.translator ? s.translator : null, catalogued_role: r.catalogued_role,
      } : null,
      evidence: {
        page: r.page, page_type: cited?.page_type ?? null, quoted_line: r.quoted_line, as_printed: r.author_as_printed,
        translator_page: s.translator_page, reader_confidence: r.confidence, reader_reasoning: r.reasoning, other_names: r.other_names,
        ai_metadata_author: b.ai_author, ai_metadata_agrees: b.ai_author && s.name ? sameNameForm(b.ai_author, s.name) : null,
        // A QID is evidence only when a thesaurus doc already carries it. Otherwise
        // it is a search hit, kept for a human: "Longinus" matched the soldier-saint.
        wikidata: w?.author_doc ? w.match : null, wikidata_unverified: !w?.author_doc ? (w?.match ?? null) : null,
        wikidata_candidates: w?.candidates ?? [],
      },
      refuter: f ? { refuted: f.refuted, confidence: f.confidence, reasoning: f.reasoning, model: f.refuter_model } : null,
      reader_model: r.reader_model,
    });
  }
  // ONE string per person: readers wrote "Annibal Caro" and "Annibale Caro",
  // "Jerome" and "Jerome of Stridon". Two strings for one man fragment exactly the
  // collocation this repair restores (the Machiavelli lesson in
  // apply-aldine-byline-correction-3894.mjs). Within a QID, the most common form wins.
  const byQid = new Map();
  for (const p of proposals) if (p.proposed && (p.evidence.wikidata ?? p.evidence.wikidata_unverified)?.qid) {
    const k = (p.evidence.wikidata ?? p.evidence.wikidata_unverified).qid; if (!byQid.has(k)) byQid.set(k, []); byQid.get(k).push(p);
  }
  for (const group of byQid.values()) {
    const n = {}; for (const p of group) n[p.proposed.author] = (n[p.proposed.author] ?? 0) + 1;
    const best = Object.keys(n).sort((a, b) => n[b] - n[a] || b.length - a.length)[0];
    for (const p of group) if (p.proposed.author !== best) { p.proposed.author_as_read = p.proposed.author; p.proposed.author = best; }
  }
  const tally = (key) => { const t = {}; for (const p of proposals) { const k = key(p); t[k] = (t[k] ?? 0) + 1; } return t; };
  const out = {
    issue: 3894, measured: new Date().toISOString().slice(0, 10),
    method: 'claude -p reader (batched) over the OCR attribution window → deterministic screens → Wikidata (Q5, date-gated) → adversarial claude -p refuter. No Mongo writes.',
    scope: { in_scope: books.size, self_named_by_title_skipped: [...books.values()].filter((b) => b.title_bucket === 'SELF_NAMED' && !b.extra).length, no_ocr_window: [...books.values()].filter((b) => !b.window.length).length, read: reads.size },
    counts: {
      by_status: tally((p) => p.status), by_class: tally((p) => p.class),
      ready_by_class: tally((p) => (p.status === 'READY' ? p.class : '_not_ready')),
      refuter: { checked: refBy.size, refuted: [...refBy.values()].filter((x) => x.refuted).length },
      ready_with_author_id: proposals.filter((p) => p.proposed?.author_id).length,
      ready_with_translator: proposals.filter((p) => p.proposed?.translator).length,
      ready_ai_metadata_agrees: proposals.filter((p) => p.status === 'READY' && p.evidence.ai_metadata_agrees === true).length,
      ready_ai_metadata_disagrees: proposals.filter((p) => p.status === 'READY' && p.evidence.ai_metadata_agrees === false).length,
    },
    by_eye_check: existsSync(join(WORK, 'eyecheck.json')) ? JSON.parse(readFileSync(join(WORK, 'eyecheck.json'), 'utf8')) : null,
    proposals,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out.scope), '\n', JSON.stringify(out.counts, null, 1));
}

const STAGES = { select, read, screen, wikidata, refute, assemble };
if (!STAGES[STAGE]) { console.error(`unknown stage ${STAGE}`); process.exit(2); }
await STAGES[STAGE]();
