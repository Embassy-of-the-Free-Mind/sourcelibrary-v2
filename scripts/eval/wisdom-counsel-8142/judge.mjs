#!/usr/bin/env node
// Blind judging for the counsel test (#8142): rubric packets, forced choice, known-outcome hits.
// PRIOR ART: the key.json / verdicts-<judge>.jsonl file shapes are the paired-arm-judge skill's; that skill reads a page
// image, and there is no page here (PREREGISTRATION-wisdom-counsel.md). Packets of 8, at most one answer per dilemma in
// a packet, so a judge never sees two answers to the same person in the rubric pass.
//   node judge.mjs rubric --stage pilot|instrument|noise|full --judge opus|gemini
//   node judge.mjs forced --judge opus|gemini        node judge.mjs hits --judge opus|gemini
import fs from 'node:fs';
import path from 'node:path';
import { agyCall, claudeCall, readJson, here, OUT, appendJsonl, readJsonl, shuffled, seedOf, parseJsonReply, JUDGE2_MODEL, LimitHit, sha256 } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const RUBRIC = fs.readFileSync(here('rubric.md'), 'utf8').split('\n').slice(4).join('\n').trim();
const FACETS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
const GUESSES = ['none', 'instruction', 'random', 'retrieved', 'wisdom', 'other'];
const PACKET = 8;
const d = readJson(here('dilemmas.json'));
const known = readJson(here('known-selected.json')).selected;
const dilemmaById = new Map([...d.pilots, ...d.dilemmas, ...known].map((x) => [x.id, x]));
const CONCURRENCY = { opus: 3, gemini: 1 };

export function collectAnswers(stage) {
  const test = readJsonl(path.join(OUT, 'answers-test.jsonl'));
  if (stage === 'instrument') {
    const plants = readJson(here('plants.json')); const rows = [];
    for (const k of known) for (const [kind, text] of Object.entries(plants[k.id])) rows.push({ dilemma: k.id, arm: `plant:${kind}`, text });
    // Fillers: the pilots' model answers, so plants sit among others. Their scores are never used.
    for (const r of readJsonl(path.join(OUT, 'answers-pilots.jsonl'))) if (r.arm === 'A' || r.arm === 'A2') rows.push({ dilemma: r.dilemma, arm: `filler:${r.arm}`, text: r.text });
    return rows;
  }
  // `pilot`: harness debugging only, on the discarded pilots; nothing reads its verdicts.
  if (stage === 'pilot') return readJsonl(path.join(OUT, 'answers-pilots.jsonl')).filter((r) => ['B', 'C', 'D', 'M'].includes(r.arm)).map((r) => ({ dilemma: r.dilemma, arm: r.arm, text: r.text }));
  const arms = stage === 'noise' ? ['A', 'A2'] : ['B', 'C', 'D', 'M'];
  return test.filter((r) => arms.includes(r.arm)).map((r) => ({ dilemma: r.dilemma, arm: r.arm, text: r.text }));
}

/** Seeded packets, at most one answer per dilemma in each. The key maps blind ids to arm and dilemma. */
export function buildPackets(stage) {
  const rng = makeRng(seedOf(`packets:${stage}`));
  const rows = shuffled(collectAnswers(stage), rng).map((r, i) => ({ ...r, blind: `x${sha256(`${stage}:${r.dilemma}:${r.arm}`).slice(0, 6)}` }));
  const packets = [];
  for (const r of rows) {
    let p = packets.find((x) => x.length < PACKET && !x.some((y) => y.dilemma === r.dilemma));
    if (!p) { p = []; packets.push(p); }
    p.push(r);
  }
  return packets;
}

function rubricPrompt(packet) {
  const body = packet.map((r) => `=== Answer ${r.blind} ===\nThe person wrote:\n"""${dilemmaById.get(r.dilemma).text}"""\n\nThe advice given:\n"""${r.text}"""`).join('\n\n');
  return `${RUBRIC}\n\nScore each of the ${packet.length} answers below on its own. They concern different people and were written independently; do not compare them.\n\n${body}\n\nReply with JSON only, an array with one object per answer:\n[{"id":"<answer id>","f1":n,"f2":n,"f3":n,"f4":n,"f5":n,"f6":n,"means":"yes|no","harm":"yes|no","harm_why":"","condition_guess":"none|instruction|random|retrieved|wisdom|other"}]\nEach f is a whole number from 1 to 5.`;
}

function valid(row) {
  return row && FACETS.every((f) => Number.isInteger(row[f]) && row[f] >= 1 && row[f] <= 5) && /^(yes|no)$/.test(row.means) && /^(yes|no)$/.test(row.harm) && GUESSES.includes(row.condition_guess);
}

async function callJudge(judge, prompt) {
  return judge === 'opus' ? claudeCall(prompt) : agyCall(prompt, { model: JUDGE2_MODEL, timeoutS: 280 });
}

async function pool(items, n, fn) {
  let i = 0, stop = null;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length && !stop) {
      const at = i++;
      try { await fn(items[at], at); } catch (e) { if (e instanceof LimitHit) stop = e; else console.error(e.message.slice(0, 300)); }
    }
  }));
  if (stop) { console.error(stop.message); process.exit(3); }
}

async function runPacketed({ tag, judge, packets, promptOf, check, toRows }) {
  const dir = path.join(OUT, 'packets', tag); fs.mkdirSync(dir, { recursive: true });
  const verdicts = path.join(OUT, `verdicts-${tag}-${judge}.jsonl`);
  const haveIds = () => new Set(readJsonl(verdicts).map((r) => r.id));
  const seen = haveIds();
  const todo = packets.map((p, i) => ({ p, i })).filter(({ p }) => p.some((r) => !seen.has(r.blind)));
  console.log(`${tag} ${judge}: ${todo.length} packets to run of ${packets.length}`);
  await pool(todo, CONCURRENCY[judge], async ({ p, i }) => {
    const prompt = promptOf(p);
    fs.writeFileSync(path.join(dir, `p${i}-${judge}.prompt.txt`), prompt);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await callJudge(judge, prompt).catch((e) => { if (e instanceof LimitHit) throw e; console.error(`p${i} ${judge} attempt ${attempt}: ${e.message.slice(0, 200)}`); return null; });
      if (!r) continue;
      fs.writeFileSync(path.join(dir, `p${i}-${judge}.reply${attempt}.txt`), r.text);
      let rows = null;
      try { rows = parseJsonReply(r.text); } catch { /* retried */ }
      const ok = Array.isArray(rows) ? toRows(rows, p).filter(check) : [];
      const ids = new Set(p.map((x) => x.blind));
      if (ok.length === ids.size && ok.every((x) => ids.has(x.id))) {
        for (const row of ok) appendJsonl(verdicts, { ...row, judge, model: r.model, packet: i });
        console.log(`p${i} ${judge} ok`);
        return;
      }
      console.error(`p${i} ${judge} attempt ${attempt}: ${ok.length}/${ids.size} valid rows`);
    }
    console.error(`p${i} ${judge} gave no valid reply; re-run to resume`);
  });
  const missing = packets.flat().filter((r) => !haveIds().has(r.blind)).length;
  console.log(`${tag} ${judge}: ${missing} answers still unscored`);
}

async function main() {
  const [cmd] = process.argv.slice(2);
  const argOf = (k) => process.argv[process.argv.indexOf(k) + 1];
  const judge = argOf('--judge');
  if (cmd === 'rubric') {
    const stage = argOf('--stage');
    const packets = buildPackets(stage);
    const keyFile = path.join(OUT, `key-${stage}.json`);
    fs.writeFileSync(keyFile, JSON.stringify(packets.flat().map(({ blind, dilemma, arm }) => ({ blind, dilemma, arm })), null, 0));
    await runPacketed({ tag: `rubric-${stage}`, judge, packets, promptOf: rubricPrompt, check: valid, toRows: (rows) => rows });
  } else if (cmd === 'forced') {
    const test = readJsonl(path.join(OUT, 'answers-test.jsonl'));
    const rng = makeRng(seedOf('forced'));
    const pairs = [...d.dilemmas, ...known].map((dil) => {
      const c = test.find((r) => r.dilemma === dil.id && r.arm === 'C'), b = test.find((r) => r.dilemma === dil.id && r.arm === 'B');
      const flip = rng() < 0.5;
      return { blind: `f${sha256(`forced:${dil.id}`).slice(0, 6)}`, dilemma: dil.id, one: flip ? 'B' : 'C', first: flip ? b.text : c.text, second: flip ? c.text : b.text };
    });
    const shuffledPairs = shuffled(pairs, rng);
    const packets = []; for (let i = 0; i < shuffledPairs.length; i += 5) packets.push(shuffledPairs.slice(i, i + 5));
    fs.writeFileSync(path.join(OUT, 'key-forced.json'), JSON.stringify(pairs.map(({ blind, dilemma, one }) => ({ blind, dilemma, one }))));
    const promptOf = (p) => `For each case below, a person asked for advice and two advisers answered. Decide which answer shows better judgment about this person's situation: the answer you would rather this person had received. Answers were written independently. You must choose.\n\n${p.map((r) => `=== Case ${r.blind} ===\nThe person wrote:\n"""${dilemmaById.get(r.dilemma).text}"""\n\nAnswer 1:\n"""${r.first}"""\n\nAnswer 2:\n"""${r.second}"""`).join('\n\n')}\n\nReply with JSON only: [{"id":"<case id>","choice":1,"why":"one line"}]`;
    await runPacketed({ tag: 'forced', judge, packets, promptOf, check: (r) => r.choice === 1 || r.choice === 2, toRows: (rows) => rows });
  } else if (cmd === 'hits') {
    const test = readJsonl(path.join(OUT, 'answers-test.jsonl'));
    const rng = makeRng(seedOf('hits'));
    const rows = [];
    for (const k of known) for (const arm of ['A', 'A2', 'B', 'C', 'D', 'M']) {
      const a = test.find((r) => r.dilemma === k.id && r.arm === arm);
      rows.push({ blind: `h${sha256(`hits:${k.id}:${arm}`).slice(0, 6)}`, dilemma: k.id, arm, text: a.text, risks: k.risks });
    }
    const packets = [];
    for (const r of shuffled(rows, rng)) {
      let p = packets.find((x) => x.length < 6 && !x.some((y) => y.dilemma === r.dilemma));
      if (!p) { p = []; packets.push(p); }
      p.push(r);
    }
    fs.writeFileSync(path.join(OUT, 'key-hits.json'), JSON.stringify(rows.map(({ blind, dilemma, arm }) => ({ blind, dilemma, arm }))));
    const promptOf = (p) => `Each case below has a piece of advice and a numbered list of specific risks. For each risk, say whether the advice names that risk or an unmistakable equivalent of it, as something that could happen. A vague general warning does not count. Answer strictly from the text.\n\n${p.map((r) => `=== Case ${r.blind} ===\nThe advice:\n"""${r.text}"""\n\nRisks:\n${r.risks.map((x, i) => `${i + 1}. ${x}`).join('\n')}`).join('\n\n')}\n\nReply with JSON only: [{"id":"<case id>","named":[1,3]}] where named lists the numbers of the risks the advice names; use an empty list if none.`;
    await runPacketed({ tag: 'hits', judge, packets, promptOf, check: (r) => Array.isArray(r.named), toRows: (rs) => rs });
  } else {
    throw new Error('rubric | forced | hits');
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
