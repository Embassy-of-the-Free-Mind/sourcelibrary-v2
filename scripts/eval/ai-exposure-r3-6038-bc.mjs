/**
 * PRIOR ART: scripts/eval/ai-exposure-r3-6038.mjs — the run-3 driver this module extends (layer A lives there);
 * split out only to keep each file readable. Question-from-page quizzes: none found in scripts/eval/ (searched
 * "closed-book", "quiz", "guessab" in scripts/eval and EXPERIMENTS.md, 2026-10-06).
 *
 * #6038 run 3, layers B (content knowledge) and C (public e-text), and the report.
 * Preregistration: scripts/eval/PREREGISTRATION-ai-exposure-r3-6038.md
 */
import fs from 'fs';
import path from 'path';
import { ctx, readJsonl, writeJsonl, shuffle, rng, wilson, meanBoot, ratioBoot, kappa2, sha, ENDPOINT } from './ai-exposure-r3-6038.mjs';

const { args, OUT, PRIVATE } = ctx;
const appendJsonl = (f, row) => fs.appendFileSync(f, JSON.stringify(row) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (f) => path.join(PRIVATE, f);

// ---------------- spend ----------------
const SPEND = path.join(OUT, 'spend.jsonl');
const CAP_STOP = 9.5;
export const spent = () => readJsonl(SPEND).reduce((s, r) => s + (r.usd || 0), 0);
let gem = null, costOf = null;
async function gemini({ model, prompt, think, tag, maxOutputTokens = 8000 }) {
  if (!gem) { ({ callGemini: gem } = await import('../lib/gemini-script-client.mjs')); ({ costOf } = await import('../lib/model-pricing.mjs')); }
  if (spent() >= CAP_STOP) throw new Error(`SPEND CAP: $${spent().toFixed(2)} ≥ $${CAP_STOP}`);
  let lastErr;
  for (let t = 0; t < 3; t++) {
    try {
      const g = await gem({ model, prompt, endpoint: ENDPOINT, temperature: 0, maxOutputTokens, promptVersion: `r3-${tag}`, ...(typeof think === 'number' ? { thinkingBudget: think } : {}) });
      const usd = costOf(model, g.inputTokens, g.outputTokens);
      appendJsonl(SPEND, { at: new Date().toISOString(), tag, model, in: g.inputTokens, out: g.outputTokens, think: g.thinkingTokens, usd });
      return g;
    } catch (e) { lastErr = e; if (/SPEND CAP/.test(e.message)) throw e; await sleep(3000 * (t + 1)); }
  }
  throw lastErr;
}
function parseJson(text) {
  const s = String(text || '').replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
async function pool(items, conc, fn) {
  let i = 0; const errs = [];
  await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { errs.push(e); if (/SPEND CAP/.test(e.message)) { i = items.length; } else console.error('ERR', e.message.slice(0, 200)); } } }));
  if (errs.some((e) => /SPEND CAP/.test(e.message))) console.error('STOPPED AT SPEND CAP');
  return errs;
}

// ---------------- layer B ----------------
const FAMOUS = {
  '6952e4c677f38f6761bc882d': 'Vulgate', '69937767b0a84a57639639fe': 'Phaedo', '6993881574305116d72cef37': 'Euclid, Elements',
  '69e8b24d2ff2a8dc09e77295': 'Analects', '69e8b25c2ff2a8dc09e7773b': 'Daodejing', '69e8b2562ff2a8dc09e774b0': 'Mencius',
  '69e13a120dae29249d20b73f': 'Bhagavad Gita', '697e23cbcb3f7c9faa3f06a8': 'Iliad & Odyssey', '69ac9bb499d9a0170d090bb2': 'Augustine, Confessions',
  '6955943d7bd6d2cd1d61d196': 'Boethius', '69b2214608069e96e842f2a2': 'Ovid, Metamorphoses', '69924f3609c5da0cf50d73fb': 'Lucretius',
  '69b221c408069e96e84310d0': 'Caesar, Commentarii', '69aec50d3b6ebce5e0ee87d0': 'Cicero, ethical writings', '6953ce4d77f38f6761be36fb': 'Marcus Aurelius',
  '606a74d7-2ac1-420b-924d-de761439fb3f': 'Copernicus', '15c5d8e4-cea3-4b5b-9859-f3528660ecc8': 'Newton, Principia', '69f331a6876dd827cbc4927d': 'Imitatio Christi',
  '69aea59e57ed98c21d25a62a': 'Il Principe', '6953e51c77f38f6761befc93': 'Descartes, Discours',
};
const stripTr = (t) => String(t || '').replace(/<[^>]{0,200}>/g, ' ').replace(/[#*_>|`]/g, ' ').replace(/\[\^?\d+\]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const centuryOf = (y) => { const n = Number(String(y ?? '').match(/-?\d{3,4}/)?.[0]); if (!Number.isFinite(n) || y == null) return null; return n; };
export function neutralDescription(w) {
  const genreWord = { 'disputatio/oratio/dissertatio': 'academic dissertation or oration', 'scripture/commentary': 'commentary on Scripture', manuscript: 'manuscript text' }[w.genre] || 'work';
  const lang = w.lang && !/null|unknown/i.test(w.lang) ? `${w.lang} ` : '';
  const n = centuryOf(w.year);
  let when = 'historical';
  if (w.famous) when = 'classic'; // famous controls: no date — the edition year would mislead (e.g. a 1550 Iliad)
  else if (n != null) { const c = Math.floor(n / 100) + 1; when = n < 1400 ? 'medieval' : `${c}th-century`; } else if (w.century && w.century !== 'unknown') when = w.century.replace(' c.', '-century');
  const art = /^[aeiou]/i.test(when) ? 'an' : 'a';
  return `${art} ${when} ${lang}${genreWord}`.replace(/\s+/g, ' ');
}

async function stageBPages() {
  const works = ctx.loadWorks(); const r2 = new Map(ctx.loadR2().map((x) => [x.id, x]));
  const books = JSON.parse(fs.readFileSync(P('books500.json'), 'utf8'));
  const elig = new Set(books.filter((b) => (b.tr || 0) >= 10).map((b) => b.id));
  const { c, db } = await ctx.mongo();
  const famous = await db.collection('books').find({ id: { $in: Object.keys(FAMOUS) } }, { projection: { id: 1, title: 1, author: 1, published: 1, language: 1, pages_count: 1 }, maxTimeMS: 60000 }).toArray();
  const list = [
    ...works.filter((w) => elig.has(w.id)).map((w) => ({ id: w.id, set: 'main', title: w.title, author: w.author, year: w.year, lang: w.lang, century: w.century, genre: w.genre, visible: w.visible, pages_count: books.find((b) => b.id === w.id).pc, in_W: r2.get(w.id).in_W, R: r2.get(w.id).R })),
    ...famous.map((b) => ({ id: b.id, set: 'famous', famous: true, label: FAMOUS[b.id], title: b.title, author: b.author, year: b.published, lang: b.language, century: null, genre: 'other', pages_count: b.pages_count })),
  ];
  const out = P('b-pages.jsonl'); const done = new Set(readJsonl(out).map((x) => x.id));
  for (const w of list) {
    if (done.has(w.id)) continue;
    const ps = await db.collection('pages').find({ book_id: w.id, 'translation.data': { $exists: true } }, { projection: { page_number: 1, 'translation.data': 1 }, maxTimeMS: 60000 }).toArray();
    const maxN = Math.max(w.pages_count || 0, ...ps.map((p) => p.page_number || 0));
    const ok = ps.filter((p) => p.page_number > 3 && p.page_number < maxN - 1).map((p) => ({ page: p.page_number, text: stripTr(p.translation.data) })).filter((p) => p.text.length >= 600).sort((a, b) => a.page - b.page);
    const pick = shuffle(ok, `6038-B-${w.id}`).slice(0, 5).map((p) => ({ page: p.page, text: p.text.slice(0, 6000) }));
    appendJsonl(out, { ...w, neutral: neutralDescription(w), n_candidate_pages: ok.length, pages: pick });
  }
  await c.close();
  const all = readJsonl(out);
  console.log('B works', all.length, 'main', all.filter((x) => x.set === 'main').length, 'famous', all.filter((x) => x.set === 'famous').length, 'eligible (≥3 pages)', all.filter((x) => x.pages.length >= 3).length);
  writeJsonl(path.join(OUT, 'b-works.jsonl'), all.map((x) => ({ id: x.id, set: x.set, label: x.label || null, lang: x.lang, in_W: x.in_W ?? null, R: x.R ?? null, n_candidate_pages: x.n_candidate_pages, n_pages: x.pages.length, pages: x.pages.map((p) => p.page) })));
}

const GEN_PROMPT = (w) => `You are writing a closed-book quiz that tests whether someone actually knows the CONTENTS of a specific historical work.

The work: "${w.title}"${w.author ? ` by ${w.author}` : ''}${w.year ? ` (${w.year})` : ''}.
Below are ${w.pages.length} pages from an English translation of it, labelled P1…P${w.pages.length}.

For EACH page write exactly ONE question that:
- can be answered from that page alone;
- asks about a specific claim, example, name, number, case, or step of argument made ON THAT PAGE;
- is NOT about a general theme, and could NOT be answered from the title, the author's name, or general knowledge of the period;
- does not mention "the page", "the passage", "this text", "the translation" or the translator;
- does not name the work (the quiz-taker will be told which work it is), and does not give away the answer.
Give a short reference answer (at most 15 words) and copy, verbatim, the one sentence from the page that supports it.
If a page has nothing suitable (an index, a list of chapter titles, a table, a blank or garbled page), give "question": null for it.

Return only JSON: {"items":[{"page":"P1","question":"...","answer":"...","support":"..."}, ...]} with one item per page, in order.

${w.pages.map((p, i) => `=== P${i + 1} ===\n${p.text}`).join('\n\n')}`;

async function stageBGen() {
  const works = readJsonl(P('b-pages.jsonl')).filter((w) => w.pages.length >= 3);
  const out = P('b-questions.jsonl'); const done = new Set(readJsonl(out).map((x) => x.id));
  const todo = works.filter((w) => !done.has(w.id));
  const limit = args.limit ? Number(args.limit) : todo.length;
  await pool(todo.slice(0, limit), 6, async (w) => {
    const g = await gemini({ model: 'gemini-3-flash-preview', prompt: GEN_PROMPT(w), think: 0, tag: 'b-gen' });
    const j = parseJson(g.text); const items = (j?.items || []).slice(0, w.pages.length);
    const qs = w.pages.map((p, i) => { const it = items[i] || {}; return it.question ? { qid: `${w.id}#${i}`, page: p.page, pi: i, question: String(it.question), answer: String(it.answer || ''), support: String(it.support || '') } : null; }).filter(Boolean);
    appendJsonl(out, { id: w.id, parsed: !!j, questions: qs });
  });
  const all = readJsonl(out); console.log('gen works', all.length, 'questions', all.reduce((s, x) => s + x.questions.length, 0), 'spent $' + spent().toFixed(3));
}

const OPEN_PROMPT = (w, qs) => `Answer each question using ONLY the page it refers to. Be brief (at most 15 words). If the page does not answer it, write "not on page".

${qs.map((q, i) => `=== Q${i + 1} (page P${q.pi + 1}) ===\nPAGE:\n${w.pages[q.pi].text}\nQUESTION: ${q.question}`).join('\n\n')}

Return only JSON: {"answers":[{"q":"Q1","answer":"..."}, ...]}`;
const CLOSED_PROMPT = (desc, qs) => `${desc}

Answer each question from your own knowledge. If you genuinely have no idea, write "unknown"; otherwise give your best answer, briefly (at most 15 words). Do not explain.

${qs.map((q, i) => `Q${i + 1}. ${q.question}`).join('\n')}

Return only JSON: {"answers":[{"q":"Q1","answer":"..."}, ...]}`;
const closedDesc = (w) => `These questions are about the work "${w.title}"${w.author ? ` by ${w.author}` : ''}${w.year ? `, in an edition of ${w.year}` : ''}${w.lang ? ` (${w.lang})` : ''}.`;
const guessDesc = (w) => `These questions are about ${w.neutral}. You are not told which one.`;
const JUDGE_PROMPT = (rows) => `You are grading short answers against a reference answer. For each item decide:
- "correct": the candidate states the same specific fact as the reference (wording may differ; a more detailed answer that includes it is correct);
- "partial": it gets part of the specific fact right but misses or garbles an essential part;
- "incorrect": it states something different, or only something generic;
- "unknown": the candidate declined ("unknown", "not on page", no answer).

${rows.map((r, i) => `=== ${i + 1} ===\nQUESTION: ${r.question}\nREFERENCE: ${r.answer}\nSUPPORTING SENTENCE: ${r.support}\nCANDIDATE: ${r.candidate}`).join('\n\n')}

Return only JSON: {"grades":[{"i":1,"grade":"correct|partial|incorrect|unknown"}, ...]}`;

async function judge(rows, tag) {
  if (!rows.length) return [];
  const g = await gemini({ model: 'gemini-3-flash-preview', prompt: JUDGE_PROMPT(rows), think: 0, tag: `judge-${tag}` });
  const j = parseJson(g.text); const gr = j?.grades || [];
  return rows.map((r, i) => { const x = gr.find((y) => Number(y.i) === i + 1) || gr[i]; const v = String(x?.grade || '').toLowerCase(); return ['correct', 'partial', 'incorrect', 'unknown'].includes(v) ? v : 'unparsed'; });
}
const answersOf = (text, n) => { const j = parseJson(text); const a = j?.answers || []; return Array.from({ length: n }, (_, i) => { const x = a.find((y) => String(y.q).replace(/\D/g, '') === String(i + 1)) || a[i]; return x ? String(x.answer ?? '') : ''; }); };

async function stageBOpen() {
  const pages = new Map(readJsonl(P('b-pages.jsonl')).map((w) => [w.id, w]));
  const out = P('b-open.jsonl'); const done = new Set(readJsonl(out).map((x) => x.id));
  const todo = readJsonl(P('b-questions.jsonl')).filter((x) => !done.has(x.id) && x.questions.length);
  await pool(todo, 6, async (x) => {
    const w = pages.get(x.id);
    const g = await gemini({ model: 'gemini-3-flash-preview', prompt: OPEN_PROMPT(w, x.questions), think: 0, tag: 'b-open' });
    const ans = answersOf(g.text, x.questions.length);
    const grades = await judge(x.questions.map((q, i) => ({ ...q, candidate: ans[i] })), 'open');
    appendJsonl(out, { id: x.id, items: x.questions.map((q, i) => ({ qid: q.qid, answer: ans[i], grade: grades[i] })) });
  });
  const all = readJsonl(out); const it = all.flatMap((x) => x.items);
  console.log('open-book works', all.length, 'questions', it.length, 'valid (correct)', it.filter((q) => q.grade === 'correct').length, 'spent $' + spent().toFixed(3));
}
function validQuestions() {
  const open = new Map(readJsonl(P('b-open.jsonl')).flatMap((x) => x.items).map((q) => [q.qid, q.grade]));
  return readJsonl(P('b-questions.jsonl')).map((x) => ({ id: x.id, questions: x.questions.filter((q) => open.get(q.qid) === 'correct') })).filter((x) => x.questions.length);
}
async function stageBAsk(kind) { // kind: guess | closed
  const pages = new Map(readJsonl(P('b-pages.jsonl')).map((w) => [w.id, w]));
  const out = P(`b-${kind}.jsonl`); const done = new Set(readJsonl(out).map((x) => x.id));
  const think = Number(args.think ?? 256);
  const todo = validQuestions().filter((x) => !done.has(x.id)).slice(0, args.limit ? Number(args.limit) : undefined);
  await pool(todo, 6, async (x) => {
    const w = pages.get(x.id);
    const g = await gemini({ model: 'gemini-3.1-pro-preview', prompt: CLOSED_PROMPT(kind === 'guess' ? guessDesc(w) : closedDesc(w), x.questions), think, tag: `b-${kind}`, maxOutputTokens: 6000 });
    const ans = answersOf(g.text, x.questions.length);
    const grades = await judge(x.questions.map((q, i) => ({ ...q, candidate: ans[i] })), kind);
    appendJsonl(out, { id: x.id, model: 'gemini-3.1-pro-preview', think, thinking_tokens: g.thinkingTokens, items: x.questions.map((q, i) => ({ qid: q.qid, answer: ans[i], grade: grades[i] })) });
  });
  const it = readJsonl(out).flatMap((x) => x.items);
  console.log(kind, 'questions', it.length, 'correct', it.filter((q) => q.grade === 'correct').length, 'spent $' + spent().toFixed(3));
}

// Opus arm: packets for subscription subagents
async function stageBOpusPackets() {
  const pages = new Map(readJsonl(P('b-pages.jsonl')).map((w) => [w.id, w]));
  const guess = new Map(readJsonl(P('b-guess.jsonl')).flatMap((x) => x.items).map((q) => [q.qid, q.grade]));
  const vq = validQuestions().map((x) => ({ ...x, ng: x.questions.filter((q) => guess.get(q.qid) !== 'correct') })).filter((x) => pages.get(x.id).set === 'main' && pages.get(x.id).in_W && x.ng.length >= 3);
  const known = shuffle(vq.filter((x) => pages.get(x.id).R).map((x) => x.id).sort(), '6038-OPUS-K');
  const unk = shuffle(vq.filter((x) => !pages.get(x.id).R).map((x) => x.id).sort(), '6038-OPUS-U');
  let take = [...known.slice(0, 25), ...unk.slice(0, 25)];
  if (take.length < 50) take = [...take, ...known.slice(25), ...unk.slice(25)].slice(0, 50);
  const dir = P('opus-packets'); fs.mkdirSync(dir, { recursive: true });
  const nAgents = 8; const per = Math.ceil(take.length / nAgents);
  for (let a = 0; a < nAgents; a++) {
    const ids = take.slice(a * per, (a + 1) * per); if (!ids.length) continue;
    const works = ids.map((id) => { const w = pages.get(id); const x = vq.find((y) => y.id === id); return { id, header: closedDesc(w), questions: x.questions.map((q) => ({ qid: q.qid, question: q.question })) }; });
    fs.writeFileSync(path.join(dir, `agent-${a + 1}.json`), JSON.stringify({ instructions: 'For each work, answer each question from your own knowledge. If you genuinely have no idea, write "unknown"; otherwise give your best answer, briefly (at most 15 words). Do not explain.', works }, null, 1));
  }
  writeJsonl(path.join(OUT, 'b-opus-ids.jsonl'), take.map((id) => ({ id, R: pages.get(id).R })));
  console.log('opus works', take.length, 'known', take.filter((id) => pages.get(id).R).length, 'packets', Math.ceil(take.length / per));
}
async function stageBOpusIngest() {
  const dir = P('opus-packets'); const qs = new Map(readJsonl(P('b-questions.jsonl')).flatMap((x) => x.questions).map((q) => [q.qid, q]));
  const out = P('b-opus.jsonl'); const done = new Set(readJsonl(out).map((x) => x.id));
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => /\.out\.json$/.test(f))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const w of j.works || []) if (!done.has(w.id)) rows.push(w);
  }
  await pool(rows, 6, async (w) => {
    const items = (w.answers || []).filter((a) => qs.has(a.qid));
    const grades = await judge(items.map((a) => ({ ...qs.get(a.qid), candidate: String(a.answer ?? '') })), 'opus');
    appendJsonl(out, { id: w.id, model: 'claude-opus-5.5 (subagent)', items: items.map((a, i) => ({ qid: a.qid, answer: String(a.answer ?? ''), grade: grades[i] })) });
  });
  console.log('opus ingested', readJsonl(out).length, 'spent $' + spent().toFixed(3));
}
// by-eye packet: 50 seeded Pro closed-book gradings (25 judged correct, 25 not), judge label hidden
async function stageBEyePacket() {
  const qs = new Map(readJsonl(P('b-questions.jsonl')).flatMap((x) => x.questions).map((q) => [q.qid, q]));
  const it = readJsonl(P('b-closed.jsonl')).flatMap((x) => x.items).filter((q) => q.grade !== 'unparsed');
  const cor = shuffle(it.filter((q) => q.grade === 'correct').map((q) => q.qid).sort(), '6038-EYE-C').slice(0, 25);
  const not = shuffle(it.filter((q) => q.grade !== 'correct').map((q) => q.qid).sort(), '6038-EYE-N').slice(0, 50 - cor.length);
  const pick = shuffle([...cor, ...not], '6038-EYE');
  const m = new Map(it.map((q) => [q.qid, q]));
  writeJsonl(P('b-eye-packet.jsonl'), pick.map((qid, i) => ({ n: i + 1, qid, question: qs.get(qid).question, reference: qs.get(qid).answer, support: qs.get(qid).support, candidate: m.get(qid).answer })));
  writeJsonl(P('b-eye-key.jsonl'), pick.map((qid, i) => ({ n: i + 1, qid, judge: m.get(qid).grade })));
  console.log('eye packet', pick.length);
}

// ---------------- layer C ----------------
const WIKI = { Latin: 'la', German: 'de', English: 'en', French: 'fr', Italian: 'it', Dutch: 'nl', Greek: 'el', Hebrew: 'he', Chinese: 'zh', 'Classical Chinese / Japanese': 'zh', Sanskrit: 'sa', Russian: 'ru', Spanish: 'es', Portuguese: 'pt', Danish: 'da', Japanese: 'ja', Korean: 'ko', Arabic: 'ar', Persian: 'fa', Syriac: 'mul', 'Latin-German': 'la', Hindi: 'hi', Pali: 'sa', Javanese: 'mul', Tibetan: 'mul', Sumerian: 'mul', Parthian: 'mul' };
const STOP = new Set('libri liber libro libros tractatus tractatu disputatio dissertatio oratio quaestio quaestiones theses positiones exercitatio inauguralis academica physica medica theologica philosophica eiusdem ejusdem secundum contra super inter circa sive aliis atque denique quibus quorum omnium omnibus omnia opera operum volumen tomus pars partes editio nova novae noviter cum gratia privilegio praeside respondente autore auctore oder unnd und eine einer eines einem von vnd vber ueber über durch wider sampt samt etliche allen aller alles the of and with from their which other being their history treatise discourse account une des les avec dans pour della delle degli nella sopra intorno'.split(' '));
const fold = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function titleWords(title) { return [...new Set(fold(title).split(' ').filter((w) => w.length >= 5 && !STOP.has(w) && !/^\d+$/.test(w)))].sort((a, b) => b.length - a.length).slice(0, 3); }
const surnameOf = (author) => { const a = String(author || '').split(/[;|]/)[0]; const s = a.includes(',') ? a.split(',')[0] : a.trim().split(/\s+/).slice(-1)[0]; const f = fold(s); return f.length >= 4 && !/^(unknown|anonymous|anonym|various|unbekannt)/.test(f) ? f : null; };
async function iaRawOcr(ia) {
  const m = await ctx.fetchText(`https://archive.org/metadata/${encodeURIComponent(ia)}`, true);
  if (!m) return { status: 'unknown', how: 'IA metadata unreachable' };
  const f = (m.files || []).find((x) => /_djvu\.txt$/.test(x.name));
  return f && Number(f.size || 0) > 1000 ? { status: 'yes', how: `IA ${f.name} (${f.size} B)` } : { status: 'no', how: 'IA item has no _djvu.txt' };
}
async function mdzRawOcr(url) {
  const id = String(url || '').match(/bsb\d{8}/)?.[0]; if (!id) return { status: 'unknown', how: 'no BSB id' };
  const m = await ctx.fetchText(`https://api.digitale-sammlungen.de/iiif/presentation/v2/${id}/manifest`, true);
  const cv = m?.sequences?.[0]?.canvases; if (!cv?.length) return { status: 'unknown', how: 'MDZ manifest unreachable' };
  const mid = cv[Math.floor(cv.length / 2)]; const sa = [].concat(mid.seeAlso || []).find((x) => /ocr/i.test(x['@id'] || '') || /hocr/i.test(x.format || ''));
  if (!sa) return { status: 'no', how: 'MDZ canvas has no OCR seeAlso' };
  const h = await ctx.fetchText(sa['@id']); const txt = ctx.htmlToText(h || '').replace(/\s+/g, ' ').trim();
  return txt.replace(/bsb\d+_\d+/g, '').length >= 200 ? { status: 'yes', how: `MDZ hOCR (${id}, canvas ${Math.floor(cv.length / 2) + 1}: ${txt.length} chars)` } : { status: 'no', how: `MDZ hOCR empty/short (${txt.length} chars)` };
}
async function metsFulltext(metsUrl, label) {
  const x = await ctx.fetchText(metsUrl); if (!x) return { status: 'unknown', how: `${label} METS unreachable` };
  const g = x.match(/<mets:fileGrp[^>]*USE="FULLTEXT"[\s\S]*?<\/mets:fileGrp>/); const n = g ? (g[0].match(/<mets:file\b/g) || []).length : 0;
  return n ? { status: 'yes', how: `${label} METS FULLTEXT (${n} files)` } : { status: 'no', how: `${label} METS has no FULLTEXT` };
}
async function providerOcr(b, w) {
  const p = w.provider; const url = b.url || '';
  const iaId = b.ia || url.match(/archive\.org\/details\/([^/?#]+)/)?.[1] || url.match(/iiif\.archive\.org\/iiif\/([^/]+)\/manifest/)?.[1];
  if (iaId) return iaRawOcr(iaId);
  if (p === 'mdz' || p === 'bsb') return mdzRawOcr(url);
  if (p === 'e-rara') { const id = url.match(/\/(\d+)\/manifest/)?.[1]; return id ? metsFulltext(`https://www.e-rara.ch/oai?verb=GetRecord&metadataPrefix=mets&identifier=${id}`, 'e-rara') : { status: 'unknown', how: 'no e-rara id' }; }
  if (p === 'goettingen') { const id = url.match(/PPN[0-9X]+/)?.[0]; return id ? metsFulltext(`https://gdz.sub.uni-goettingen.de/mets/${id}.mets.xml`, 'Göttingen') : { status: 'unknown', how: 'no PPN' }; }
  if (p === 'sbb') { const id = url.match(/dc\/([0-9X]+)/)?.[1]; return id ? metsFulltext(`https://content.staatsbibliothek-berlin.de/dc/PPN${id}.mets.xml`, 'SBB') : { status: 'unknown', how: 'no PPN' }; }
  if (p === 'slub_dresden') { const id = url.match(/id(\d+)/)?.[1]; return id ? metsFulltext(`https://digital.slub-dresden.de/oai/?verb=GetRecord&metadataPrefix=mets&identifier=oai:de:slub-dresden:db:id-${id}`, 'SLUB') : { status: 'unknown', how: 'no SLUB id' }; }
  if (p === 'etcsl') return { status: 'yes', how: 'ETCSL is itself an e-text corpus (curated transliteration)', curated: true };
  return { status: 'unknown', how: `provider ${p}: no public OCR endpoint checked` };
}
async function wikisourceCandidates(w) {
  const wiki = WIKI[w.lang] || 'mul'; const words = titleWords(w.title); const sur = surnameOf(w.author);
  const q = [sur, ...words].filter(Boolean).join(' '); if (!q) return { queried: false, wiki, candidates: [] };
  const host = wiki === "mul" ? "wikisource.org" : `${wiki}.wikisource.org`;
  const j = await ctx.fetchText(`https://${host}/w/api.php?action=query&list=search&format=json&srlimit=10&srsearch=${encodeURIComponent(q)}`, true);
  if (!j?.query) return { queried: false, wiki, q, candidates: [] };
  const stems = words.map((x) => x.slice(0, 5));
  const cands = j.query.search.filter((r) => { const t = fold(r.title); const nw = stems.filter((s) => t.includes(s)).length; return (sur && t.includes(sur.slice(0, 5)) && nw >= 1) || nw >= 2; }).map((r) => ({ title: r.title, snippet: ctx.htmlToText(r.snippet).replace(/\s+/g, ' ').slice(0, 200) }));
  return { queried: true, wiki, q, candidates: cands };
}
async function stageCCheck() {
  const works = ctx.loadWorks(); const books = new Map(JSON.parse(fs.readFileSync(P('books500.json'), 'utf8')).map((b) => [b.id, b]));
  const out = P('c-raw.jsonl'); const done = new Set(readJsonl(out).map((x) => x.id));
  const gretil = /Sanskrit|Pali|Hindi/.test(works.map((w) => w.lang).join(' ')) ? fold(ctx.htmlToText(await ctx.fetchText('https://gretil.sub.uni-goettingen.de/gretil.html') || '')) : '';
  let n = 0;
  for (const w of works) {
    if (done.has(w.id)) continue;
    const b = books.get(w.id) || {};
    const prov = await providerOcr(b, w).catch((e) => ({ status: 'unknown', how: 'error ' + e.message }));
    const ws = await wikisourceCandidates(w).catch(() => ({ queried: false, candidates: [] }));
    let kanripo = null;
    const kr = String(w.work_key || '').match(/^w:kr:(KR[0-9a-z]+)/)?.[1];
    if (kr) { const r = await ctx.fetchText(`https://api.github.com/repos/kanripo/${kr}`, true); kanripo = r?.full_name ? { status: 'yes', how: `github.com/kanripo/${kr} (${r.size} KB)` } : { status: 'no', how: `no kanripo/${kr} repo` }; }
    let sefaria = null;
    if (/Hebrew|Aramaic/.test(w.lang || '')) { const j = await ctx.fetchText(`https://www.sefaria.org/api/name/${encodeURIComponent(String(w.title).slice(0, 60))}?limit=5`, true); sefaria = j ? { queried: true, is_ref: !!j.is_ref, completions: (j.completions || []).slice(0, 5) } : { queried: false }; }
    let gret = null;
    if (/Sanskrit|Pali|Hindi/.test(w.lang || '')) { const tw = titleWords(w.title); gret = { queried: !!gretil, candidates: tw.filter((x) => gretil.includes(x)) }; }
    appendJsonl(out, { id: w.id, lang: w.lang, provider: w.provider, prov, ws, kanripo, sefaria, gretil: gret });
    if (++n % 50 === 0) console.log('c', n);
    await sleep(250);
  }
  const all = readJsonl(out);
  console.log('C rows', all.length, 'prov yes', all.filter((x) => x.prov.status === 'yes').length, 'prov unknown', all.filter((x) => x.prov.status === 'unknown').length, 'ws candidates', all.filter((x) => x.ws.candidates?.length).length, 'ws not queried', all.filter((x) => !x.ws.queried).length);
}

// ---------------- report ----------------
const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
const wil = (k, n) => { const w = wilson(k, n); return { ...w, s: n ? `${pct(w.p)} [${(100 * w.lo).toFixed(1)}–${(100 * w.hi).toFixed(1)}] (${k}/${n})` : '—' }; };
const lastBy = (rows, key = 'id') => [...new Map(rows.map((r) => [r[key], r])).values()];
const langGroup = (l) => { l = String(l || ''); if (/^Latin/.test(l)) return 'Latin'; if (l === 'German') return 'German'; if (l === 'English') return 'English'; if (/French|Italian|Dutch|Spanish|Portuguese|Danish|Russian/.test(l)) return 'other European'; if (/Chinese|Japanese|Korean/.test(l)) return 'CJK'; if (/Tibetan|Sanskrit|Pali|Hindi/.test(l)) return 'Tibetan/Sanskrit/Pali'; return 'other'; };
const provGroup = (p) => (['mdz', 'internet_archive', 'e-rara'].includes(p) ? p : 'other');

function layerA() {
  const { MINI, IG } = ctx; const ALL = [...MINI, ...IG];
  const counts = new Map(readJsonl(path.join(OUT, 'counts-long.jsonl')).filter((r) => r.count >= 0).map((r) => [`${r.h}|${r.index}`, r.count]));
  const q = ctx.allQueries();
  // index completeness per set
  const complete = {}; for (const s of ['pweb', 'pours', 'neg', 'main', 'pia']) { complete[s] = {}; const qs = q.filter((x) => x.set === s); for (const ix of ALL) complete[s][ix] = qs.length ? qs.filter((x) => counts.has(`${x.h}|${ix}`)).length / qs.length : 0; }
  const doneIx = (s) => ALL.filter((ix) => complete[s][ix] >= 0.999);
  // a passage (k) hits if either of its forms (sp / nl) has count ≥ 1 in an index of the family
  const passHit = (s, ixs) => { const m = new Map(); for (const x of q.filter((y) => y.set === s)) { const key = `${x.id}|${x.k}`; const hit = ixs.some((ix) => (counts.get(`${x.h}|${ix}`) || 0) > 0); m.set(key, (m.get(key) || false) || hit); } return m; };
  const workHits = (s, ixs) => { const ph = passHit(s, ixs); const w = new Map(); for (const [key, h] of ph) { const id = key.split('|')[0]; const v = w.get(id) || { n: 0, hits: 0 }; v.n++; if (h) v.hits++; w.set(id, v); } return w; };
  const fam = { 'any (completed indexes)': null, 'CC 2025-30': ['v2_cc-2025-30'], 'CC 2025-05': ['v2_cc-2025-05'], 'OLMo-2 mix (incl. DCLM-baseline)': ['v4_olmo-mix-1124_llama'], 'Dolma 1.7': ['v4_dolma-v1_7_llama'], 'RedPajama': ['v4_rpj_llama_s4'], 'Pile': ['v4_piletrain_llama'] };
  const sens = {};
  for (const s of ['pweb', 'pours', 'pia', 'neg', 'main']) {
    sens[s] = {};
    for (const [name, ixs0] of Object.entries(fam)) {
      const ixs = (ixs0 || doneIx(s)).filter((ix) => complete[s][ix] >= 0.999); if (!ixs.length) { sens[s][name] = null; continue; }
      const wh = workHits(s, ixs); const ws = [...wh.values()].filter((v) => v.n);
      const ph = [...passHit(s, ixs).values()];
      sens[s][name] = { works: wil(ws.filter((v) => v.hits >= 1).length, ws.length), works2: wil(ws.filter((v) => v.hits >= 2).length, ws.length), passages: wil(ph.filter(Boolean).length, ph.length), indexes: ixs };
    }
  }
  const mainAny = workHits('main', doneIx('main'));
  return { complete, doneIx: Object.fromEntries(['pweb', 'pours', 'neg', 'main', 'pia'].map((s) => [s, doneIx(s)])), sens, mainAny, passHitMain: passHit('main', doneIx('main')) };
}

function layerBControls() {
  const L = (f) => readJsonl(P(f));
  const pg = new Map(L('b-pages.jsonl').map((w) => [w.id, w]));
  const g = new Map(L('b-guess.jsonl').flatMap((x) => x.items).map((q) => [q.qid, q.grade]));
  const c = new Map(L('b-closed.jsonl').flatMap((x) => x.items).map((q) => [q.qid, q.grade]));
  const o = L('b-open.jsonl').flatMap((x) => x.items);
  const famQ = [...c.keys()].filter((q) => pg.get(q.split('#')[0]).set === 'famous');
  const ng = famQ.filter((q) => g.get(q) !== 'correct');
  const res = {
    famous_works: [...pg.values()].filter((w) => w.set === 'famous').length,
    questions_generated: L('b-questions.jsonl').reduce((s, x) => s + x.questions.length, 0), open_book_valid: wil(o.filter((x) => x.grade === 'correct').length, o.length),
    famous_valid: famQ.length, famous_guessable: wil(famQ.filter((q) => g.get(q) === 'correct').length, famQ.length),
    famous_closed_all: wil(famQ.filter((q) => c.get(q) === 'correct').length, famQ.length),
    famous_closed_nonguessable: wil(ng.filter((q) => c.get(q) === 'correct').length, ng.length),
  };
  res.gate = { nonguess_ge_60: res.famous_closed_nonguessable.p >= 0.6, guessable_le_40: res.famous_guessable.p <= 0.4, margin_ge_25: (res.famous_closed_all.p - res.famous_guessable.p) >= 0.25 };
  res.broken = !(res.gate.nonguess_ge_60 && res.gate.guessable_le_40 && res.gate.margin_ge_25);
  const eye = readJsonl(P('b-eye-labels.jsonl'));
  if (eye.length) { const k = kappa2(eye.map((r) => [r.judge === 'correct', r.eye === 'correct'])); res.judge_eye = { n: eye.length, agree: k.agree, kappa: k.kappa }; }
  res.spend_usd = spent();
  // committed: per-question grades (no text)
  writeJsonl(path.join(OUT, 'b-grades.jsonl'), [...c.keys()].map((qid) => ({ qid, set: pg.get(qid.split('#')[0]).set, guess: g.get(qid), closed: c.get(qid) })));
  return res;
}

function layerC() {
  const raw = lastBy(readJsonl(P('c-raw.jsonl')));
  // public copies: per-work statuses and the by-eye verdicts (ids, statuses, notes; no query strings)
  writeJsonl(path.join(OUT, 'c-per-work.jsonl'), raw.map((r) => ({ id: r.id, provider_ocr: r.prov.status, how: r.prov.how, wikisource_queried: !!r.ws?.queried, wikisource_candidates: r.ws?.candidates?.length || 0, kanripo: r.kanripo?.status || null, sefaria_queried: r.sefaria?.queried ?? null, gretil_candidates: r.gretil?.candidates?.length ?? null })));
  for (const f of ['c-eye.jsonl', 'c-eye40.jsonl', 'b-eye-labels.jsonl']) if (fs.existsSync(P(f))) fs.copyFileSync(P(f), path.join(OUT, f.replace('b-eye-labels', 'b-eye-judge')));
  const eye = new Map(readJsonl(P('c-eye.jsonl')).map((r) => [r.id, r])); // by-eye verdicts on candidates
  return new Map(raw.map((r) => {
    const e = eye.get(r.id);
    const curated = (r.prov.curated && r.prov.status === 'yes') || r.kanripo?.status === 'yes' || !!e?.curated_confirmed;
    const rawOcr = r.prov.status === 'yes' && !r.prov.curated;
    const provUnknown = r.prov.status === 'unknown';
    return [r.id, { curated, raw: rawOcr, any: curated || rawOcr, provUnknown, provHow: r.prov.how, wsQueried: !!r.ws?.queried, wsCandidates: r.ws?.candidates?.length || 0, eye: e || null }];
  }));
}

async function stageReport() {
  const r2 = ctx.loadR2(); const A = layerA(); const B = layerBControls(); const C = layerC();
  const passages = new Map(readJsonl(P('passages-main.jsonl')).map((x) => [x.id, x]));
  const gates = {
    A_pweb_sensitivity: A.sens.pweb['any (completed indexes)']?.works, A_neg_rate: A.sens.neg['any (completed indexes)']?.passages,
  };
  const A_broken = !gates.A_pweb_sensitivity || gates.A_pweb_sensitivity.p < 0.5 || (gates.A_neg_rate && gates.A_neg_rate.p > 0.05);
  const A_strict = !A_broken && gates.A_neg_rate && gates.A_neg_rate.p > 0.02;
  const rows = r2.map((w) => {
    const ah = A.mainAny.get(w.id); const c = C.get(w.id) || {};
    return { ...w, lg: langGroup(w.lang), pg: provGroup(w.provider), A_n: ah?.n || 0, A_hits: ah?.hits || 0, A_plus: (ah?.hits || 0) >= 1, A_pp: (ah?.hits || 0) >= 2, has_passages: !!(passages.get(w.id)?.passages?.length), C_any: !!c.any, C_curated: !!c.curated, C_raw: !!c.raw, C_prov_unknown: !!c.provUnknown };
  });
  const Aflag = (x) => (A_strict ? x.A_pp : x.A_plus);
  const W = rows.filter((x) => x.in_W);
  const offer = (x) => !x.R && !(A_broken ? false : Aflag(x)) && !x.C_any;
  const offerNoA = (x) => !x.R && !x.C_any;
  const offerCons = (x) => offer(x) && !x.C_prov_unknown;
  const share = (set, f) => wil(set.filter(f).length, set.length);
  const by = (set, keyf, f) => { const g = {}; for (const x of set) (g[keyf(x)] ||= []).push(x); return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, share(v, f)])); };
  const units = (set, f) => ({ works: share(set, f), volumes: ratioBoot(set, f, (x) => x.volumes || 1, 4000, '6038-r3-vol'), pages: ratioBoot(set, f, (x) => x.pages || 0, 4000, '6038-r3-pg') });
  const presence = {
    of_500_with_passages: share(rows.filter((x) => x.has_passages), (x) => x.A_plus), strict_500: share(rows.filter((x) => x.has_passages), (x) => x.A_pp),
    of_W: share(W.filter((x) => x.has_passages), (x) => x.A_plus),
    by_lang: by(rows.filter((x) => x.has_passages), (x) => x.lg, (x) => x.A_plus), by_provider: by(rows.filter((x) => x.has_passages), (x) => x.pg, (x) => x.A_plus),
    by_visible: by(rows.filter((x) => x.has_passages), (x) => (x.visible ? 'visible' : 'held'), (x) => x.A_plus),
    by_century: by(rows.filter((x) => x.has_passages), (x) => x.century, (x) => x.A_plus), by_genre: by(rows.filter((x) => x.has_passages), (x) => x.genre, (x) => x.A_plus),
    by_R_in_W: by(W.filter((x) => x.has_passages), (x) => (x.R ? 'recalled' : 'not recalled'), (x) => x.A_plus),
    per_index_family: Object.fromEntries(Object.entries(A.sens.main).map(([k, v]) => [k, v?.works?.s || '—'])),
  };
  const prov = readJsonl(P('a-prov-labels.jsonl')); if (prov.length) fs.copyFileSync(P('a-prov-labels.jsonl'), path.join(OUT, 'a-prov-labels.jsonl'));
  const provL = prov.filter((r) => r.label !== 'doc not retrieved'); const provCounts = {}; for (const r of prov) provCounts[r.label] = (provCounts[r.label] || 0) + 1;
  presence.provenance = { counts: provCounts, same_work_share: wil(provL.filter((r) => r.label === 'same work').length, provL.length) };
  presence.same_work_adjusted = presence.provenance.same_work_share.p != null ? presence.of_500_with_passages.p * presence.provenance.same_work_share.p : null;
  const ps = A.sens.pours['any (completed indexes)']?.works;
  presence.adjusted_upper = ps?.p ? Math.min(1, presence.of_500_with_passages.p / ps.p) : null;
  const eC = { manuscripts_with_raw_ocr: rows.filter((x) => x.genre === 'manuscript' && x.C_raw).length, any: share(rows, (x) => x.C_any), curated: share(rows, (x) => x.C_curated), raw_only: share(rows, (x) => x.C_raw && !x.C_curated), prov_unknown: share(rows, (x) => x.C_prov_unknown), of_W: share(W, (x) => x.C_any), by_provider: by(rows, (x) => x.pg, (x) => x.C_any), by_lang: by(rows, (x) => x.lg, (x) => x.C_any) };
  const agree = { R_vs_Aplus_W: kappa2(W.filter((x) => x.has_passages).map((x) => [!!x.R, x.A_plus])), R_vs_C_W: kappa2(W.map((x) => [!!x.R, x.C_any])), Aplus_vs_C_500: kappa2(rows.filter((x) => x.has_passages).map((x) => [x.A_plus, x.C_any])) };
  const fused = {
    primary_W: units(W, offer), conservative_W: units(W, offerCons), without_A_W: units(W, offerNoA), posthoc_notR_notA_W: units(W, (x) => !x.R && !Aflag(x)), posthoc_notR_notA_noCurated_W: units(W, (x) => !x.R && !Aflag(x) && !x.C_curated), unrestricted_500: units(rows, (x) => !x.R_any && !(A_broken ? false : Aflag(x)) && !x.C_any),
    by_lang: by(W, (x) => x.lg, offer), by_visible: by(W, (x) => (x.visible ? 'visible' : 'held'), offer), by_provider: by(W, (x) => x.pg, offer), by_genre: by(W, (x) => x.genre, offer),
  };
  const report = { generated: new Date().toISOString(), gates: { A: { pweb: gates.A_pweb_sensitivity, neg: gates.A_neg_rate, broken: A_broken, strict_headline: A_strict }, B: { broken: B.broken, gate: B.gate } }, A: { complete: A.complete, sens: A.sens, presence }, B, C: eC, agree, fused };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  writeJsonl(path.join(OUT, 'per-work.jsonl'), rows.map((x) => ({ id: x.id, in_W: x.in_W, R: x.R, lang: x.lang, century: x.century, genre: x.genre, visible: x.visible, provider: x.provider, volumes: x.volumes, pages: x.pages, A_passages: x.A_n, A_hits: x.A_hits, A_plus: x.A_plus, C_any: x.C_any, C_curated: x.C_curated, C_raw: x.C_raw, C_provider_unknown: x.C_prov_unknown, offer: x.in_W ? offer(x) : null })));
  // markdown
  const fmtB = (b) => (b ? `${pct(b.p)} [${pct(b.lo)}–${pct(b.hi)}]` : '—');
  const md = [];
  md.push(`# #6038 run 3 report (generated ${report.generated})`, '');
  md.push('## Layer A gates', '', `| control | works ≥1 hit | works ≥2 hits | passages |`, '|---|---|---|---|');
  for (const s of ['pweb', 'pours', 'pia', 'neg']) { const v = A.sens[s]['any (completed indexes)']; md.push(`| ${s} | ${v?.works?.s || '—'} | ${v?.works2?.s || '—'} | ${v?.passages?.s || '—'} |`); }
  md.push('', `A broken: **${A_broken}**; strict headline (A++): ${A_strict}. Indexes complete for main: ${A.doneIx.main.join(', ')}`, '');
  md.push('| index family | P-web works | P-ours works | P-IA works | negatives (passages) | the 500 (works) |', '|---|---|---|---|---|---|');
  for (const k of Object.keys(A.sens.main)) md.push(`| ${k} | ${A.sens.pweb[k]?.works?.s || '—'} | ${A.sens.pours[k]?.works?.s || '—'} | ${A.sens.pia[k]?.works?.s || '—'} | ${A.sens.neg[k]?.passages?.s || '—'} | ${A.sens.main[k]?.works?.s || '—'} |`);
  md.push('', '## Layer A presence (the 500)', '', `- A+ (≥1 passage): ${presence.of_500_with_passages.s}; A++: ${presence.strict_500.s}; of W: ${presence.of_W.s}; sensitivity-adjusted upper bound ${pct(presence.adjusted_upper)}`);
  md.push(`- provenance (by eye, seeded hits on CC 2025-30): ${JSON.stringify(presence.provenance?.counts || {})}; same-work share ${presence.provenance?.same_work_share?.s || '—'}; A+ discounted to same-work ${pct(presence.same_work_adjusted)}`);
  for (const [k, v] of Object.entries({ language: presence.by_lang, provider: presence.by_provider, 'visible/held': presence.by_visible, century: presence.by_century, genre: presence.by_genre, 'run-2 recall (W)': presence.by_R_in_W })) md.push(`- by ${k}: ` + Object.entries(v).map(([a, b]) => `${a} ${b.s}`).join('; '));
  md.push('', '## Layer B (content knowledge)', '', `Broken: **${B.broken}**. Famous controls: valid ${B.famous_valid}; guessable ${B.famous_guessable.s}; closed-book all ${B.famous_closed_all.s}; closed-book non-guessable ${B.famous_closed_nonguessable.s}. Gate ${JSON.stringify(B.gate)}. Judge vs eye: ${B.judge_eye ? `${(100 * B.judge_eye.agree).toFixed(0)}% κ ${B.judge_eye.kappa.toFixed(2)} (n ${B.judge_eye.n})` : '—'}. Open-book valid ${B.open_book_valid.s}.`, '');
  md.push('## Layer C (public e-text)', '', `- any ${eC.any.s}; curated ${eC.curated.s}; raw OCR only ${eC.raw_only.s}; provider OCR unknown ${eC.prov_unknown.s}; of W ${eC.of_W.s}`);
  md.push('- by provider: ' + Object.entries(eC.by_provider).map(([a, b]) => `${a} ${b.s}`).join('; '));
  md.push('- by language: ' + Object.entries(eC.by_lang).map(([a, b]) => `${a} ${b.s}`).join('; '), '');
  md.push('## Agreement', '');
  for (const [k, v] of Object.entries(agree)) md.push(`- ${k}: n ${v.n}, both ${v.both}, only first ${v.onlyA}, only second ${v.onlyB}, neither ${v.neither}, agree ${pct(v.agree)}, κ ${v.kappa?.toFixed(2)}`);
  md.push('', '## Fused: strongest offer', '');
  for (const [k, v] of Object.entries({ 'primary (W)': fused.primary_W, 'conservative (W, provider OCR unknown excluded)': fused.conservative_W, 'without A (W)': fused.without_A_W, 'unrestricted (500)': fused.unrestricted_500, 'POST HOC: not recalled and not in crawl (W)': fused.posthoc_notR_notA_W, 'POST HOC: not recalled, not in crawl, no curated e-text (W)': fused.posthoc_notR_notA_noCurated_W })) md.push(`- ${k}: works ${v.works.s}; volumes ${fmtB(v.volumes)}; pages ${fmtB(v.pages)}`);
  for (const [k, v] of Object.entries({ language: fused.by_lang, 'visible/held': fused.by_visible, provider: fused.by_provider, genre: fused.by_genre })) md.push(`- by ${k}: ` + Object.entries(v).map(([a, b]) => `${a} ${b.s}`).join('; '));
  md.push('', `Gemini spend: $${spent().toFixed(2)} (endpoint ${ENDPOINT}).`);
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}

export const STAGES = {
  report: stageReport,
  'c-check': stageCCheck,
  'b-pages': stageBPages, 'b-gen': stageBGen, 'b-open': stageBOpen, 'b-guess': () => stageBAsk('guess'), 'b-closed': () => stageBAsk('closed'),
  'b-opus-packets': stageBOpusPackets, 'b-opus-ingest': stageBOpusIngest, 'b-eye-packet': stageBEyePacket,
  spend: async () => console.log('spent $' + spent().toFixed(4), readJsonl(SPEND).length, 'calls'),
};
export { gemini, parseJson, pool, P, stripTr, FAMOUS, appendJsonl, sleep, validQuestions };
void rng; void wilson; void meanBoot; void ratioBoot; void kappa2; void sha;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const stage = args.stage;
  if (!STAGES[stage]) { console.error('--stage=' + Object.keys(STAGES).join('|')); process.exit(1); }
  await STAGES[stage]();
}
