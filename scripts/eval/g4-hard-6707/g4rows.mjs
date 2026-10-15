// PRIOR ART: build-ocr-pareto.mjs toRow() — reproduced line for line for one engine over one scored dir (the builder reads every dir).
// G4L rows for panels 3-5 exactly as build-ocr-pareto.mjs toRow(): readBenchmarkRows over the G4L scored dir; the CLI
// reply = the text import-cli-arm.py wrote to outputs-<engine>.jsonl; finishReason/error from its meter.
import fs from 'fs';
const W = '/mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707/scripts';
const { readBenchmarkRows } = await import(`${W}/eval/lib/benchmark-rows.mjs`);
const { readFailure } = await import(`${W}/lib/read-failure.mjs`);
const { extractTranscription } = await import(`${W}/lib/cli-chatter.mjs`);
const [P] = process.argv.slice(2), S = '/mnt/HC_Volume_105839809/jobs/g4-hard2-6707', E = 'gemini-4-argon-low+antigravity-cli';
const jl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const reply = new Map();
for (const o of jl(`${S}/results-g4/${P}/outputs-${E}.jsonl`)) reply.set(`${o.stratum}|${o.slug}`, { text: o.text });
for (const o of jl(`${S}/results-g4/${P}/meter-${E}.jsonl`)) Object.assign(reply.get(`${o.stratum}|${o.slug}`), { finishReason: o.finishReason, error: o.error });
const { rows } = readBenchmarkRows(`${S}/scored-g4/${P}`);
const out = {};
for (const r of rows.filter(r => r.engine === E && r.referenced)) {
  const page = `${r.stratum}|${r.slug}`, cli = reply.get(page);
  const fail = readFailure({ text: cli?.text ?? null, extracted: cli?.text != null ? extractTranscription(cli.text).text : null,
    finishReason: cli?.finishReason ?? r.finish_reason, cli: !!cli, error: cli?.error ?? null,
    refused: r.refused, refusalSource: r.refusal_inferred ? 'inferred' : null, contentChars: r.content_chars });
  const unplaced = !fail && (!r.aligned || r.cer == null);
  out[page] = { cer: fail ? null : unplaced ? 1 : Math.min(1, r.cer), failure: fail?.kind ?? null, why: fail?.why ?? null, unplaced };
}
fs.writeFileSync(`${S}/an/g4-${P}.json`, JSON.stringify(out));
const v = Object.values(out);
console.log(P, v.length, 'referenced pages;', v.filter(x => x.failure).length, 'failed', JSON.stringify(v.filter(x => x.failure).reduce((a, x) => (a[x.failure] = (a[x.failure] || 0) + 1, a), {})), ';', v.filter(x => x.unplaced).length, 'unplaced');
