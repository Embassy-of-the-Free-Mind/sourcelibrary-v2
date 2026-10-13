#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/units.mjs (arm C38's request builder: pinned v13 prompt document from
// /root/tref/arms/state.json + buildTranslationPrompt + PAGE_BREAK_SCOPED, one page, no context) — the same
// call, here over every in-scope page of the 37 held Tengyur volumes instead of an eval sample (#6361 stage 1).
//
// READ-ONLY on Mongo. Writes, under /root/tengyur-cli-6361/:
//   scope.json            volumes, counts, exclusions by reason, prompt version + sha256 of the builder inputs
//   prompts/<page_id>.txt one production v13 one-page prompt per in-scope page
//   pages.jsonl           {page_id, book_id, vol, section, page_number, src_chars, ocr_sha256, prompt_sha256}
//   excluded.jsonl        {page_id, book_id, vol, page_number, reason}
//
//   cd /root/sourcelibrary && node --env-file=.env.production.local /root/tengyur-cli-6361/build-prompts.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const REPO = '/root/sourcelibrary';
const { MongoClient } = createRequire(`${REPO}/package.json`)('mongodb');
const { PAGE_BREAK_SCOPED, buildTranslationPrompt, isTranslatablePage, loadTranslationPrompts, findHumanEditedPageIds } = await import(`${REPO}/scripts/lib/translate-core.mjs`);
const W = '/root/tengyur-cli-6361';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const live = await loadTranslationPrompts(db);

// Scope: books held by #5497's import hold whose title names the Madhyamaka (དབུ་མ) or Pramāṇa (ཚད་མ) section.
// #6145 excluded exactly these 37 ids from layer 2 (/root/tengyur-enrich-6145/l2-excluded-ids.txt).
const proj = { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, pages_count: 1, 'pipeline_auto.hold': 1 };
const held = await db.collection('books').find({ 'pipeline_auto.hold.reason': 'tengyur-import-5497' }, { projection: proj }).toArray();
const sectionOf = (t) => (/སྡེ་དགེ། དབུ་མ།/.test(t) ? 'Madhyamaka' : /སྡེ་དགེ། ཚད་མ།/.test(t) ? 'Pramana' : null);
const books = held.filter((b) => sectionOf(b.title)).sort((a, b) => a.pipeline_auto.hold.detail.volume - b.pipeline_auto.hold.detail.volume);
const ex6145 = fs.readFileSync('/root/tengyur-enrich-6145/l2-excluded-ids.txt', 'utf8').split(/\s+/).filter(Boolean).sort();
if (JSON.stringify(books.map((b) => b.id).sort()) !== JSON.stringify(ex6145)) throw new Error('scope differs from #6145 exclusion list');

fs.mkdirSync(path.join(W, 'prompts'), { recursive: true });
const pagesOut = fs.createWriteStream(path.join(W, 'pages.jsonl'));
const exOut = fs.createWriteStream(path.join(W, 'excluded.jsonl'));
const vols = [];
const reasons = {};
let inScope = 0, total = 0, withEnglish = 0;
const bookFor = (b) => ({ id: b.id, title: b.title, display_title: b.display_title, author: b.author, year: b.year, published: b.published, language: b.language });
for (const b of books) {
  const vol = b.pipeline_auto.hold.detail.volume, section = sectionOf(b.title);
  const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, 'translation.data': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1 } }).sort({ page_number: 1 }).toArray();
  let n = 0;
  for (const p of pages) {
    total++;
    const t = isTranslatablePage(p);
    if (!t.ok) {
      reasons[t.reason] = (reasons[t.reason] || 0) + 1;
      exOut.write(JSON.stringify({ page_id: p.id, book_id: b.id, vol, page_number: p.page_number, reason: t.reason }) + '\n');
      continue;
    }
    const prompt = buildTranslationPrompt({ prompts: state.prompts, book: bookFor(b), ocrText: p.ocr.data, pageBreak: PAGE_BREAK_SCOPED }).prompt;
    fs.writeFileSync(path.join(W, 'prompts', `${p.id}.txt`), prompt);
    if (p.translation?.data) withEnglish++;
    pagesOut.write(JSON.stringify({ page_id: p.id, book_id: b.id, vol, section, page_number: p.page_number, src_chars: p.ocr.data.length, ocr_sha256: sha(p.ocr.data), prompt_sha256: sha(prompt) }) + '\n');
    n++; inScope++;
  }
  vols.push({ vol, section, book_id: b.id, title: b.title, pages_count: b.pages_count, pages_in_db: pages.length, in_scope: n });
  process.stdout.write(`vol ${vol} ${section} ${n}/${pages.length}\n`);
}
pagesOut.end(); exOut.end();
const ids = fs.readFileSync(path.join(W, 'pages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id);
const human = await findHumanEditedPageIds(db, ids).catch((e) => `error: ${e.message}`);
await c.close();

const builder = fs.readFileSync(`${REPO}/scripts/lib/translate-core.mjs`, 'utf8');
const scope = {
  issue: 6361, built_at: new Date().toISOString(), repo_commit: fs.readFileSync(`${REPO}/.git/HEAD`, 'utf8').trim(),
  prompt: { pinned: state.prompt_ref, pinned_translation_sha256: sha(state.prompts.translation.text), live_default: live.translation.ref, live_translation_sha256: sha(live.translation.text), live_equals_pinned: live.translation.text === state.prompts.translation.text },
  builder: { fn: 'buildTranslationPrompt', pageBreak: 'PAGE_BREAK_SCOPED', context: 'one page, no previous translation, no neighbours (as C38)', translate_core_sha256: sha(builder), state_json_sha256: sha(fs.readFileSync('/root/tref/arms/state.json')) },
  sections: 'books held tengyur-import-5497 whose title carries སྡེ་དགེ། དབུ་མ། (Madhyamaka) or སྡེ་དགེ། ཚད་མ། (Pramāṇa); equals #6145 l2-excluded-ids.txt',
  volumes: vols, pages_total: total, in_scope: inScope, in_scope_with_stored_english: withEnglish, excluded_by_reason: reasons,
  human_edited_in_scope: Array.isArray(human) ? human.length : human,
};
scope.builder_inputs_sha256 = sha(JSON.stringify({ t: scope.builder.translate_core_sha256, s: scope.builder.state_json_sha256, p: fs.readFileSync(path.join(W, 'pages.jsonl'), 'utf8') }));
fs.writeFileSync(path.join(W, 'scope.json'), JSON.stringify(scope, null, 1));
console.log(JSON.stringify({ ...scope, volumes: undefined }, null, 1));
