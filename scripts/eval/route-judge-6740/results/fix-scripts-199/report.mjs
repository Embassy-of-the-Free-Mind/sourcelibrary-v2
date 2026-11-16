// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs and paired-arm.mjs — the judge prompt, call and parse are imported from judge.mjs unchanged; this is the job's thin driver (judge model choice, per-wave audit draw/record, wave report), kept here as the record of how v3#199 ran, not as a reusable tool.
// v3#199 fix-scripts: per-wave report body. node report.mjs <waveDir> <N> <writer> <judge>  -> waveDir/report.md
// also writes waveDir/refused.json and waveDir/ms.json
import fs from 'node:fs';
const [W, N, writer, judge] = process.argv.slice(2);
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const man = new Map(jl(W + '/manifest.jsonl').map((m) => [m.page_id, m]));
const wr = jl(W + '/written.jsonl').filter((w) => w.apply);
const ws = new Set(wr.map((w) => w.page_id));
const out = {}; const contain = [];
for (const f of fs.readdirSync(W + '/reads')) { if (!f.endsWith('.meta.json')) continue; const m = JSON.parse(fs.readFileSync(W + '/reads/' + f)); out[m.outcome] = (out[m.outcome] || 0) + 1; if (m.outcome === 'contain') contain.push(m); }
const only = JSON.parse(fs.readFileSync(W + '/only.json'));
const reasons = {}; const log = fs.readFileSync(W + '/apply.log', 'utf8');
for (const l of log.split('\n')) { const m = l.match(/^\s*skip p\.\d+: (.*)$/); if (m) { const k = m[1].replace(/only \d+% of/, 'under 40% of').replace(/of \d+ characters/, ''); reasons[k] = (reasons[k] || 0) + 1; } }
const ref = only.filter((id) => !ws.has(id)).map((id) => { const m = man.get(id); return { page_id: id, book_id: m.book_id, page: m.page_number, language: m.language }; });
fs.writeFileSync(W + '/refused.json', JSON.stringify(ref, null, 1));
const isMs = (w) => { const m = man.get(w.page_id); return /manuscript|ms/i.test(`${m.form} ${m.book_form}`) || /<script>handwritten/.test(w.text); };
const ms = wr.filter(isMs).map((w) => ({ page_id: w.page_id, book_id: w.book_id, page: w.page_number, language: man.get(w.page_id).language }));
fs.writeFileSync(W + '/ms.json', JSON.stringify(ms, null, 1));
const group = (rows) => { const by = {}; for (const r of rows) (by[`\`${r.book_id}\` ${r.language}`] ??= []).push(r.page ?? r.page_number); return Object.entries(by).map(([k, v]) => `- ${k} pp. ${v.sort((a, b) => a - b).join(', ')}`).join('\n'); };
const langs = {}; for (const w of wr) { const l = man.get(w.page_id).language; langs[l] = (langs[l] || 0) + 1; }
const a = JSON.parse(fs.readFileSync(W + '/audit/audit-result.json'));
const run = `fix-scripts-w${N}-ocr`;
let o = `## fix-scripts wave ${N} (${writer} corrector), run id \`${run}\`

| | pages |
|---|---|
| attempted | ${man.size} |
| written | ${wr.length} |
| unchanged (nothing to correct) | ${out.unchanged || 0} |
| CONTAIN (not written) | ${out.contain || 0} |
${Object.entries(reasons).map(([k, v]) => `| refused by the writer: ${k} | ${v} |`).join('\n')}
| other answers (${Object.entries(out).filter(([k]) => !['corrected', 'unchanged', 'contain'].includes(k)).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}) | ${Object.entries(out).filter(([k]) => !['corrected', 'unchanged', 'contain'].includes(k)).reduce((s, [, v]) => s + v, 0)} |

Written by language: ${Object.entries(langs).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}. All carry \`--mark-stale=fix-scripts-199\`: the English waits for the agy lane.

**Audit (${a.judged} random writes, one per language first, judged blind against the image by ${judge}, which did not write them):** ${a.better} better, ${a.same} same, ${a.worse} worse than the text they replaced. Wrong-page control: ${a.control.join('; ')}. Recorded as \`lane-spot-check\` book checks (run \`${run}-audit\`).

\`\`\`
${a.lines.map((l) => l.split(' ').slice(2).join(' ') + '  ' + l.split(' ')[1]).join('\n')}
\`\`\`
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (${contain.length}):**
${contain.map((c) => `- \`${c.book_id}\` p.${c.page_number}: ${c.reason}`).join('\n') || '- none'}

**Refused by the writer's guards, not forced (${ref.length}):**
${group(ref) || '- none'}
${writer === 'Opus' ? `\n**Manuscript pages corrected by Opus, awaiting cross-family re-check (${ms.length}):**\n${group(ms)}\n` : `\nManuscript or handwritten pages among the writes: ${ms.length} (Fable-written, audited by Opus; list in the final page-id file).\n`}
Revert: \`node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id ${run} --apply\`
`;
fs.writeFileSync(W + '/report.md', o);
console.log(o.length, 'chars', JSON.stringify(out), JSON.stringify(reasons), 'ms', ms.length);
