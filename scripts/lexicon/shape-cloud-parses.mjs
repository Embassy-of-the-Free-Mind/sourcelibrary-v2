/**
 * Bake per-form morphological parses into the blog shape-cloud data.
 *
 * Re-runs the ~330 figure forms through Morpheus (with -n, keeping the tag
 * field this time), keeps analyses whose lemma matches the figure's target
 * headword, expands the tag abbreviations to full words, and rewrites
 * shape-data.json rows as [form, count, parse].
 *
 * Run: node scripts/lexicon/shape-cloud-parses.mjs
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { toBetacode, fromBetacode } from './morpheus-crunch.mjs';

const DATA = 'src/app/blog/greek-lemma-table/shape-data.json';

const EXPAND = {
  pres: 'present', imperf: 'imperfect', fut: 'future', aor: 'aorist',
  perf: 'perfect', plup: 'pluperfect', futperf: 'future perfect',
  ind: 'indicative', subj: 'subjunctive', opt: 'optative', imperat: 'imperative',
  inf: 'infinitive', part: 'participle', gerundive: 'gerundive',
  act: 'active', mid: 'middle', pass: 'passive', mp: 'middle/passive',
  '1st': '1st person', '2nd': '2nd person', '3rd': '3rd person',
  sg: 'singular', pl: 'plural', dual: 'dual',
  masc: 'masculine', fem: 'feminine', neut: 'neuter',
  nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', voc: 'vocative',
};
const expand = (tag) => tag.trim().split(/\s+/).map((w) => EXPAND[w] ?? w).join(' ');

function norm(raw) {
  return raw.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').toLowerCase().replace(/ς/g, 'σ');
}

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const allForms = [];
for (const [head, { forms }] of Object.entries(data)) {
  for (const row of forms) allForms.push({ head, form: row[0], count: row[1] });
}
const betas = allForms.map((f) => toBetacode(f.form)).filter(Boolean);
const res = spawnSync(
  'docker',
  ['run', '-i', '--rm', '--platform', 'linux/amd64', '-e', 'MORPHLIB=stemlib', 'perseidsproject/morpheus', 'bin/cruncher', '-S', '-n'],
  { input: betas.join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
if (res.status !== 0) throw new Error('cruncher failed: ' + res.stderr?.slice(0, 300));

// Pair echoed inputs with their analysis lines.
const parsesByBeta = new Map();
let current = null;
for (const line of res.stdout.split('\n')) {
  if (line.includes('<NL>')) {
    if (!current) continue;
    for (const block of line.split('</NL>')) {
      const m = block.match(/<NL>[A-Z]+\s+(\S+)\s+([a-z0-9/ ]*?)(?:\t|$)/);
      if (!m) continue;
      const pair = m[1].split(',');
      const lemmaBeta = pair[pair.length - 1];
      const lemma = fromBetacode(lemmaBeta.replace(/[0-9]+$/, ''));
      const tag = (m[2] || '').trim();
      if (!lemma || !tag) continue;
      const arr = parsesByBeta.get(current) ?? [];
      arr.push({ lemma: norm(lemma), tag });
      parsesByBeta.set(current, arr);
    }
  } else if (line.trim()) {
    current = line.trim();
  }
}

let withParse = 0;
for (const [head, entry] of Object.entries(data)) {
  const target = norm(head);
  entry.forms = entry.forms.map((row) => {
    const [form, count] = row;
    const beta = toBetacode(form);
    const analyses = (parsesByBeta.get(beta) ?? []).filter((a) => a.lemma === target);
    const tags = [...new Set(analyses.map((a) => a.tag))].slice(0, 2).map(expand);
    if (tags.length) withParse++;
    return [form, count, tags.join(' — or — ')];
  });
}
fs.writeFileSync(DATA, JSON.stringify(data));
console.log(`parses attached: ${withParse}/${allForms.length} forms`);
