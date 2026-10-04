// Clef (Cloudflare's multimodal decision model) as a cheap page-image screen, scored against labels made by eye.
// PRIOR ART: scripts/eval/jev/clef-leaf-match.mjs — same client, a different question (text↔image match).
//   Labels reused, none new: scripts/eval/benchmark/script-class/ (#5122), scripts/eval/dataset/ocr-v19-labels.jsonl,
//   scripts/audit/results/ia-date-check-2026-10-01/validation-labels.jsonl. No existing script asks a vision model these.
// Tasks (TASK=script|blank|date|all):
//   script — script class (typeset / manuscript / woodblock / illustration / textless), leaf language, spread;
//            the catalogue language is the baseline Clef has to beat on language.
//   blank  — white / show-through / real ink (does this page carry text an OCR engine should transcribe?).
//   date   — produced before 1900 or after, from the leaf the labeller read; the rule (`predicted_v3`) is the baseline.
// Run: node --env-file=<.env.production.local> scripts/eval/jev/clef-image-screens.mjs  (MONGODB_URI, CF_ANALYTICS_TOKEN)
//   TASK=all OUT=<dir> IMG_PX=1024 MODELS=clef-flash,clef
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CF_ACCOUNT = 'eb0562555fd5ce2a4ec0f29b6df10e7b';
const PRICE = { clef: 0.24, 'clef-flash': 0.09 };
const MODELS = (process.env.MODELS || 'clef-flash,clef').split(',');
const TASKS = (process.env.TASK || 'all') === 'all' ? ['script', 'blank', 'date'] : [process.env.TASK];
const OUT = process.env.OUT || '.';
const IMG_PX = process.env.IMG_PX || '1024';
const CAP_USD = 3.0;
const EV = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LANG = { la: 'Latin', zh: 'Chinese', el: 'Greek', grc: 'Greek', de: 'German', ja: 'Japanese', en: 'English', fr: 'French', it: 'Italian', syr: 'Syriac', hy: 'Armenian', ar: 'Arabic', he: 'Hebrew', es: 'Spanish', nl: 'Dutch', sa: 'Sanskrit', bo: 'Tibetan', fa: 'Persian' };

// ---------- items ----------
function scriptItems() {
  const reg = {};
  for (const f of fs.readdirSync(path.join(EV, 'benchmark')).filter((f) => f.endsWith('.json'))) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(EV, 'benchmark', f)));
      for (const p of [...(j.pages || []), ...(j.spares || [])]) if (p?.slug && p.image_url) reg[p.slug] = p;
    } catch {}
  }
  const collapse = (c) => (c?.startsWith('manuscript') ? 'manuscript' : c?.startsWith('typeset') ? 'typeset' : c);
  const items = [];
  // Most files hold one label; a few cohort files are JSON-lines.
  const labels = fs.readdirSync(path.join(EV, 'benchmark/script-class')).flatMap((f) => {
    const txt = fs.readFileSync(path.join(EV, 'benchmark/script-class', f), 'utf8');
    try { return [JSON.parse(txt)]; } catch { return txt.trim().split('\n').map((l) => JSON.parse(l)); }
  });
  for (const l of labels) {
    const r = reg[l.slug];
    if (!r || l.script_class === 'rubbing') continue;
    items.push({ id: l.slug, url: r.image_url, label: { script: collapse(l.script_class), lang: l.leaf_language, spread: !!l.spread }, catalogue_lang: r.language });
  }
  return items;
}
async function blankItems() {
  const rows = fs.readFileSync(path.join(EV, 'dataset/ocr-v19-labels.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const pages = client.db('bookstore').collection('pages');
  const items = [];
  for (const r of rows) {
    const p = await pages.findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { display_photo: 1, archived_photo: 1 } });
    const url = p?.display_photo || p?.archived_photo;
    if (url) items.push({ id: r.uid, url, label: { blank: r.label } });
  }
  await client.close();
  return items;
}
function dateItems() {
  const rows = fs.readFileSync(path.resolve(EV, '../audit/results/ia-date-check-2026-10-01/validation-labels.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return rows.flatMap((r) => {
    const leaf = (r.evidence || '').match(/\bn(\d+)\b/)?.[1];
    if (!leaf) return [];
    return [{ id: r.ia_identifier, url: `https://archive.org/download/${r.ia_identifier}/page/n${leaf}_w1024.jpg`, label: { date: r.label_from_image }, rule: r.predicted_v3, language: r.language }];
  });
}

// ---------- questions ----------
function questions(task, langs) {
  if (task === 'script') return {
    script: { type: 'choice', instructions: 'How was the text on this page produced?', criteria: {
      typeset: 'printed with movable type (Western or other typeset print)', manuscript: 'handwritten', woodblock: 'woodblock print: carved block, typically East Asian, framed columns',
      illustration: 'mainly a picture, plate or diagram with little text', textless: 'blank or no legible text' } },
    lang: { type: 'choice', instructions: 'What is the main language of the text on this page?', criteria: Object.fromEntries(langs.map((c) => [c, LANG[c] || c])) },
    spread: { type: 'noul', instructions: 'The image shows two facing pages of an open book (a spread), not a single page.' },
  };
  if (task === 'blank') return {
    blank: { type: 'choice', instructions: 'What is on this side of the leaf?', criteria: {
      white: 'nothing: a blank page', 'show-through': 'only faint mirror-reversed text bleeding through from the other side of the leaf',
      'real-ink': 'real text, numbers, stamps or marks written or printed on this side' } },
    ocr: { type: 'noul', instructions: 'This side of the leaf carries text that an OCR engine should transcribe (not bleed-through from the reverse).' },
  };
  return {
    date: { type: 'choice', instructions: 'When was this item produced?', criteria: {
      old: 'before 1900: hand-press or 19th-century printing, or a manuscript of that age', modern: 'after 1900: modern typesetting, a modern reprint, photocopy, or modern handwriting',
      unknown: 'cannot tell from this page' } },
    pre1900: { type: 'noul', instructions: 'This item was produced before 1900.' },
  };
}

// ---------- client ----------
const tmp = fs.mkdtempSync(path.join(OUT, 'img-'));
let n = 0, spent = 0;
async function loadImage(url) {
  const i = n++, raw = path.join(tmp, `${i}.src`), jpg = path.join(tmp, `${i}.jpg`);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) { if (r.status === 404) return null; throw new Error(String(r.status)); }
      fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', IMG_PX, raw, '--out', jpg], { stdio: 'ignore' });
      return 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64');
    } catch { await new Promise((s) => setTimeout(s, 2000 * (a + 1))); }
  }
  return null;
}
async function ask(model, image, state, qs) {
  if (spent >= CAP_USD) throw new Error('cap reached');
  for (let a = 0; a < 3; a++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/cloudflare/${model}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, images: [image], state, questions: qs }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('auth ' + r.status);
    if (!r.ok) { console.error(model, r.status, (await r.text()).slice(0, 160)); await new Promise((s) => setTimeout(s, 2000 * (a + 1))); continue; }
    const j = (await r.json()).result;
    spent += (j.usage.input_tokens * PRICE[model]) / 1e6;
    return Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.type === 'noul' ? v.noul : { choice: v.choice, p: v.probabilities }]));
  }
  return null;
}
async function pool(items, k, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: k }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}
const auc = (pos, neg) => pos.length && neg.length ? +(pos.reduce((a, p) => a + neg.reduce((b, q) => b + (p > q) + 0.5 * (p === q), 0), 0) / (pos.length * neg.length)).toFixed(3) : null;
const frac = (a, b) => `${a}/${b}${b ? ` (${Math.round((100 * a) / b)}%)` : ''}`;

// ---------- run ----------
const summary = {};
for (const task of TASKS) {
  const items = task === 'script' ? scriptItems() : task === 'blank' ? await blankItems() : dateItems();
  const langs = [...new Set(items.map((x) => x.label.lang).filter(Boolean))];
  const qs = questions(task, langs);
  console.log(task, items.length, 'items', flush());
  await pool(items, 6, async (it) => {
    const image = await loadImage(it.url);
    if (!image) { it.skip = 'image'; return; }
    const state = task === 'date' ? `Scanned item from the Internet Archive. Catalogue language: ${it.language}.` : 'A scanned page from a historical library.';
    for (const m of MODELS) it[m] = await ask(m, image, state, qs);
  });
  fs.writeFileSync(path.join(OUT, `clef-${task}-rows.jsonl`), items.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const S = (summary[task] = { n: items.length, image_fail: items.filter((x) => x.skip).length });
  for (const m of MODELS) {
    const R = items.filter((x) => x[m]);
    const s = (S[m] = {});
    if (task === 'script') {
      s.script_acc = frac(R.filter((x) => x[m].script.choice === x.label.script).length, R.length);
      s.lang_acc = frac(R.filter((x) => x[m].lang.choice === x.label.lang).length, R.length);
      s.spread_auc = auc(R.filter((x) => x.label.spread).map((x) => x[m].spread), R.filter((x) => !x.label.spread).map((x) => x[m].spread));
      const catWrong = R.filter((x) => (LANG[x.label.lang] || x.label.lang) !== x.catalogue_lang);
      s.catalogue_lang_wrong = frac(catWrong.length, R.length);
      s.clef_right_where_catalogue_wrong = frac(catWrong.filter((x) => x[m].lang.choice === x.label.lang).length, catWrong.length);
      const conf = {};
      for (const x of R) conf[`${x.label.script}→${x[m].script.choice}`] = (conf[`${x.label.script}→${x[m].script.choice}`] || 0) + 1;
      s.script_confusion = conf;
    } else if (task === 'blank') {
      s.acc_3way = frac(R.filter((x) => x[m].blank.choice === x.label.blank).length, R.length);
      s.auc_ocr_realink_vs_rest = auc(R.filter((x) => x.label.blank === 'real-ink').map((x) => x[m].ocr), R.filter((x) => x.label.blank !== 'real-ink').map((x) => x[m].ocr));
      const conf = {};
      for (const x of R) conf[`${x.label.blank}→${x[m].blank.choice}`] = (conf[`${x.label.blank}→${x[m].blank.choice}`] || 0) + 1;
      s.confusion = conf;
    } else {
      const D = R.filter((x) => x.label.date !== 'unknown');
      s.auc_pre1900 = auc(D.filter((x) => x.label.date === 'old').map((x) => x[m].pre1900), D.filter((x) => x.label.date === 'modern').map((x) => x[m].pre1900));
      const call = (x) => (x[m].pre1900 >= 0.5 ? 'old' : 'modern');
      s.acc_decided = frac(D.filter((x) => call(x) === x.label.date).length, D.length);
      const ruleDecided = D.filter((x) => x.rule !== 'unknown');
      s.rule_acc_where_rule_decides = frac(ruleDecided.filter((x) => x.rule === x.label.date).length, ruleDecided.length);
      const ruleUnknown = D.filter((x) => x.rule === 'unknown');
      s.clef_acc_where_rule_unknown = frac(ruleUnknown.filter((x) => call(x) === x.label.date).length, ruleUnknown.length);
      s.clef_acc_where_rule_decides = frac(ruleDecided.filter((x) => call(x) === x.label.date).length, ruleDecided.length);
    }
  }
  console.log(task, JSON.stringify(S));
}
summary.cost_usd = +spent.toFixed(4);
fs.writeFileSync(path.join(OUT, 'clef-image-screens-summary.json'), JSON.stringify(summary, null, 1));
console.log('cost $', summary.cost_usd);
function flush() { return ''; }
