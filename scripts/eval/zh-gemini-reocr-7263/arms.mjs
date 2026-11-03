#!/usr/bin/env node
// PRIOR ART: scripts/workers/paddle-print-lane.mjs prep / apply and scripts/workers/paddle-zh-lane.mjs apply (the guards each
// lane runs before a write; their pure halves imported here, their Mongo halves not run: `plan` holds a book and `apply`
// writes), scripts/eval/flash-reread-5924/w-set.mjs (correct.mjs's manifest) and router-confirm/confirm.mjs runArm (a
// refused read serves the stored text). None of them takes a stored Gemini page into a Paddle arm with no write.
/**
 * The arms of #7263's Chinese re-read cell test, on a plan.json from draw.mjs (confirm.mjs drop has cut it to 30):
 *   S  the stored Gemini text
 *   P  PaddleOCR-VL-1.6: print stratum on the split-leaf print lane's task and guards, siku stratum on the whole-page lane's
 *   Pu print stratum only: P with the coverage guard off (added after the reads, before any judging: it refused 12 of 30)
 *   O  correct.mjs --model=opus --per-call=10 on S, as #7568 ran it; unchanged / contain / no-answer serves S
 *
 *   arms.mjs lane-plan --out=DIR --lane=LANEDIR   plan/<bid>.json for the lane's own prep and GPU task
 *   arms.mjs setup     --out=DIR                  plan.json's arms, texts/<key>.served.txt, set/manifest.jsonl for correct.mjs
 *   arms.mjs paddle    --out=DIR --lane=LANEDIR   texts/<key>.P.txt from the lane's reads, through the lane's guards
 *   arms.mjs opus      --out=DIR                  texts/<key>.O.txt from set/reads
 *
 * Cheaper correctors on the same prompt and image (zh-reocr-cheap-arms, correct.mjs --draft-dir, --cli=agy):
 *   PFL paddle>agy-flash-low   PFM paddle>agy-flash-medium   SFL stored>agy-flash-low   PSN paddle>sonnet   SSN stored>sonnet
 *   arms.mjs cheap-setup   --out=DIR             the arms in plan.json; set-<arm>/manifest.jsonl and drafts/<page_id>.txt.
 *                                                The Paddle draft is the read itself: Pu on print (guard off), P on Siku
 *   arms.mjs cheap-collect --out=DIR --arm=ARM   texts/<key>.ARM.txt: corrected, or UNCHANGED serves the draft;
 *                                                contain / no answer serves the stored text
 * Reads Mongo for book facts only. Writes nothing to it (readonly-mongo.mjs).
 */
import '../router-confirm/readonly-mongo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { assemblePage, envelope as printEnvelope, laneLanguage, kanaShare, MAX_KANA_SHARE, coversLite, bodyCharCount } from '../../lib/paddle-print-lane.mjs';
import { convertPaddle, envelope as zhEnvelope, bodyHanCount, longestCharRun, MAX_CHAR_RUN, MIN_HAN, workTitleOf } from '../../lib/paddle-zh-lane.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out')), LANE = arg('lane') && path.resolve(arg('lane'));
const planF = path.join(OUT, 'plan.json'), P = JSON.parse(fs.readFileSync(planF, 'utf8'));
const T = (k, a) => path.join(OUT, 'texts', `${k}.${a}.txt`);
const logRow = (r) => fs.appendFileSync(path.join(OUT, 'arms.jsonl'), JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const stage = process.argv[2];
const CHEAP = [['PFL', 'paddle>agy-flash-low', 'paddle'], ['PFM', 'paddle>agy-flash-medium', 'paddle'], ['SFL', 'gemini>agy-flash-low', 'stored'], ['PSN', 'paddle>sonnet', 'paddle'], ['SSN', 'gemini>sonnet', 'stored']];
const draftArm = (kind) => (kind === 'stored' ? 'lite' : P.stratum === 'siku' ? 'P' : 'Pu');

async function books() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const r = await c.db('bookstore').collection('books').find({ id: { $in: P.selected.map((s) => s.book_id) } }, { projection: { id: 1, title: 1, language: 1, needs_splitting: 1, split_completed: 1, 'image_source.provider': 1 } }).toArray();
  await c.close();
  return new Map(r.map((b) => [b.id, b]));
}

if (stage === 'lane-plan') {
  const bk = await books();
  fs.mkdirSync(path.join(LANE, 'plan'), { recursive: true }); fs.mkdirSync(path.join(LANE, 'code'), { recursive: true });
  for (const s of P.selected) fs.writeFileSync(path.join(LANE, 'plan', `${s.book_id}.json`), JSON.stringify({ bid: s.book_id, title: bk.get(s.book_id)?.title, language: bk.get(s.book_id)?.language, provider: bk.get(s.book_id)?.image_source?.provider ?? null, pages: [{ pid: s.page_id, pn: s.page_number, src: s.image, why: 'zh-gemini-reocr-7263' }] }));
  console.log(`${P.selected.length} plan files in ${LANE}/plan`);
} else if (stage === 'setup') {
  const paddle = P.stratum === 'siku' ? 'paddle-zh-read' : 'paddle-print-read';
  P.arms = [{ arm: 'served', route: 'gemini-stored', kind: 'stored', calls_per_page: 0 }, { arm: 'P', route: paddle, kind: 'read', calls_per_page: 0 }, { arm: 'O', route: 'gemini>opus', kind: 'correct', calls_per_page: 1 }];
  fs.writeFileSync(planF, JSON.stringify(P, null, 1));
  for (const s of P.selected) { fs.copyFileSync(T(s.key, 'lite'), T(s.key, 'served')); logRow({ key: s.key, arm: 'served', route: 'gemini-stored', written: false, why: 'stored text' }); }
  fs.mkdirSync(path.join(OUT, 'set'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'set/manifest.jsonl'), P.selected.map((s) => JSON.stringify({ page_id: s.page_id, book_id: s.book_id, slug: s.key, page_number: s.page_number, why: 'zh-gemini-reocr-7263', stored_model: s.stored_model })).join('\n') + '\n');
  console.log('setup done');
} else if (stage === 'paddle') {
  const bk = await books();
  const leaf = (bid, pn, side, ext, root = LANE) => read(path.join(root, 'out', bid, `${pn}-${side}.${ext}`));
  const tally = {};
  for (const s of P.selected) {
    const stored = read(T(s.key, 'lite')), b = bk.get(s.book_id), workTitle = workTitleOf(b?.title);
    let text = null, why;
    if (P.stratum === 'siku') {
      const raw = read(path.join(LANE, 'out', s.book_id, `${s.page_number}.txt`));
      if (raw == null) why = 'leaf_error';
      else {
        const { body } = convertPaddle(raw, { workTitle });
        const han = bodyHanCount(body), t = zhEnvelope(body), v = loopVerdict(t);
        if (han < MIN_HAN) why = 'textless';
        else if (v.refuse) why = `loop:${v.reason}`;
        else if (longestCharRun(body) > MAX_CHAR_RUN) why = 'char_run';
        else { text = t; why = 'written'; }
      }
    } else {
      const pr = JSON.parse(fs.readFileSync(path.join(LANE, 'prep', `${s.book_id}.json`), 'utf8')).pages.find((p) => p.pn === s.page_number);
      if (!pr || pr.error) why = 'prep_error';
      else {
        const leaves = pr.leaves.map((lf) => ({ side: lf.side, blank: lf.blank, ink: lf.ink, raw: lf.blank ? null : leaf(s.book_id, s.page_number, lf.side, 'txt'), err: lf.blank ? null : leaf(s.book_id, s.page_number, lf.side, 'err'), recheck: lf.blank ? null : leaf(s.book_id, s.page_number, lf.side, 'txt', path.join(LANE, 'recheck')) }));
        const a = assemblePage(leaves, { workTitle, med: null });   // med: one page a book, no book median; ditto likewise
        if (a.verdict === 'textless') why = 'textless';
        else if (a.verdict === 'reject') why = a.reason;
        else {
          // the lane runs coversLite on lite pages only (its policy never replaces a Flash read); this test replaces both
          const cov = coversLite(a.han, stored, a.body), lang = laneLanguage(b?.language);
          // Pu: the read with the coverage guard off, so the arm still says what Paddle read where the guard serves S
          fs.writeFileSync(T(s.key, 'Pu'), printEnvelope(a.body, lang));
          if (b?.needs_splitting && !b?.split_completed) why = 'needs_splitting';
          else if (!cov.ok) why = cov.why;
          else if (kanaShare([a.body]) >= MAX_KANA_SHARE || lang === 'Japanese') why = 'kana_share';
          else { text = printEnvelope(a.body, lang); why = 'written'; }
        }
      }
    }
    fs.writeFileSync(T(s.key, 'P'), text ?? stored);
    if (P.stratum !== 'siku' && !fs.existsSync(T(s.key, 'Pu'))) fs.writeFileSync(T(s.key, 'Pu'), stored);
    tally[why] = (tally[why] ?? 0) + 1;
    logRow({ key: s.key, arm: 'P', route: P.arms[1].route, written: !!text, why, han: text ? bodyCharCount(text) : null, han_stored: s.han });
  }
  console.log(JSON.stringify(tally));
} else if (stage === 'opus') {
  const tally = {};
  for (const s of P.selected) {
    const R = path.join(OUT, 'set/reads'), stored = read(T(s.key, 'lite'));
    const m = JSON.parse(read(path.join(R, `${s.page_id}.meta.json`)) ?? '{}'), t = read(path.join(R, `${s.page_id}.txt`));
    const out = m.outcome ?? 'not read', ok = out === 'corrected' && t;
    fs.writeFileSync(T(s.key, 'O'), ok ? t : stored);
    tally[out] = (tally[out] ?? 0) + 1;
    logRow({ key: s.key, arm: 'O', route: 'gemini>opus', written: !!ok, why: out, reason: m.reason ?? m.contain_reason ?? null });
  }
  console.log(JSON.stringify(tally));
} else if (stage === 'cheap-setup') {
  for (const [arm, route, kind] of CHEAP) {
    if (!P.arms.some((a) => a.arm === arm)) P.arms.push({ arm, route, kind: 'correct', calls_per_page: 1 });
    const dir = path.join(OUT, `set-${arm}`); fs.mkdirSync(path.join(dir, 'drafts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.jsonl'), P.selected.map((s) => JSON.stringify({ page_id: s.page_id, book_id: s.book_id, slug: s.key, page_number: s.page_number, why: 'zh-reocr-cheap-arms-7263', stored_model: s.stored_model })).join('\n') + '\n');
    for (const s of P.selected) fs.copyFileSync(T(s.key, draftArm(kind)), path.join(dir, 'drafts', `${s.page_id}.txt`));
  }
  fs.writeFileSync(planF, JSON.stringify(P, null, 1));
  console.log(`${CHEAP.length} arms set up`);
} else if (stage === 'cheap-collect') {
  const arm = arg('arm'), [, route, kind] = CHEAP.find((c) => c[0] === arm), tally = {};
  for (const s of P.selected) {
    const R = path.join(OUT, `set-${arm}`, 'reads'), m = JSON.parse(read(path.join(R, `${s.page_id}.meta.json`)) ?? '{}'), t = read(path.join(R, `${s.page_id}.txt`));
    const out = m.outcome ?? 'not read', text = out === 'corrected' && t ? t : out === 'unchanged' ? read(T(s.key, draftArm(kind))) : read(T(s.key, 'lite'));
    fs.writeFileSync(T(s.key, arm), text);
    tally[out] = (tally[out] ?? 0) + 1;
    logRow({ key: s.key, arm, route, written: out === 'corrected', why: out, reason: m.reason ?? null });
  }
  console.log(arm, JSON.stringify(tally));
} else { console.error('stages: lane-plan | setup | paddle | opus | cheap-setup | cheap-collect'); process.exit(2); }
