// PRIOR ART: scripts/batch/twopass-review.mjs (the sealed `claude -p` call with the page image opened by Read) and
// scripts/eval/results/florentine-compare-6865/claude-judge.py (the paired judge of #6865). Neither scores against a
// published reference; this one does, three arms blinded at once.
// Judge the Nahuatl column of three English arms against a published English translation (private answer key).
//   node judge.mjs PACKET.json OUT.jsonl
// PACKET: [{ key, image_url, ocr_nahuatl, reference, arms: { X: text, Y: text, Z: text } }], arm labels already shuffled
// per page by the packet builder (the key to the labels stays with the builder). Needs only the claude CLI and the
// network for the image: no database, no API key. Resumable: keys already in OUT are skipped.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawn } from 'node:child_process';

const [PACKET, OUT] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(PACKET, 'utf8'));
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
const INSTR = `You are checking three English translations (X, Y, Z) of the NAHUATL column of one leaf of the Florentine Codex (Sahagún, 1570s) against a published scholarly English translation of the same column (REFERENCE). The page image is page.jpg in this folder: open it with the Read tool. The OCR of the Nahuatl column is given too.

Use the reference as the answer key for MEANING, not wording: a different but correct rendering is not an error. Where the reference itself looks wrong against the image and the Nahuatl (or covers a different stretch of text), say so in reference_disputed and judge that stretch from the image and the Nahuatl instead. Ignore footnote markers like [^3] in the reference. Ignore glosses, <note>, <term> and similar tags in the arms unless the note itself states something false. Judge only text that is on this leaf.

For each arm count meaning errors against the reference:
- wrong: a word or clause translated with a wrong meaning
- omission: a clause or meaningful phrase of the Nahuatl left out
- addition: content that is not in the Nahuatl (a gloss in a tag does not count)
- summarised: true if the arm summarises or describes the column instead of translating it
and give fidelity 1-5 (5 = every clause rendered with the reference's meaning). For each arm list up to 3 of its worst errors as {type, arm_text, reference_text}, each quote at most 8 words.

Answer with ONE JSON object and nothing else:
{"reference_disputed": false, "dispute_note": "", "X": {"wrong": 0, "omission": 0, "addition": 0, "summarised": false, "fidelity": 5, "errors": []}, "Y": {...}, "Z": {...}, "error_types_seen": ["short phrase", ...]}`;

const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete env[k];
const call = (prompt, cwd) => new Promise((res) => {
  const t0 = Date.now();
  const ch = spawn('claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let o = '', e = ''; ch.stdout.on('data', (d) => (o += d)); ch.stderr.on('data', (d) => (e += d)); ch.stdin.end(prompt);
  const t = setTimeout(() => ch.kill('SIGKILL'), 20 * 60 * 1000);
  ch.on('close', () => { clearTimeout(t); let j = {}; try { j = JSON.parse(o); } catch {} res({ text: j.is_error ? '' : String(j.result ?? '').trim(), err: (o + e).slice(-300), secs: (Date.now() - t0) / 1000 }); });
});
const parse = (t) => { try { const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); return ['X', 'Y', 'Z'].every((a) => j[a] && Number.isFinite(j[a].fidelity)) ? j : null; } catch { return null; } };

for (const it of items) {
  if (done.has(it.key)) continue;
  for (let attempt = 0; attempt < 3; attempt++) {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fvp-'));
    const r0 = await fetch(it.image_url); fs.writeFileSync(path.join(dir, 'page.jpg'), Buffer.from(await r0.arrayBuffer()));
    const prompt = `${INSTR}\n\nOCR OF THE NAHUATL COLUMN:\n${it.ocr_nahuatl}\n\nREFERENCE (published English of the Nahuatl column):\n${it.reference}\n\n${['X', 'Y', 'Z'].map((a) => `TRANSLATION ${a}:\n${it.arms[a]}`).join('\n\n')}\n`;
    const r = await call(prompt, dir); fs.rmSync(dir, { recursive: true, force: true });
    const j = r.text ? parse(r.text) : null;
    console.log(`${it.key} ${j ? 'ok' : 'FAIL ' + r.err.slice(-120)} ${Math.round(r.secs)}s`);
    if (j) { fs.appendFileSync(OUT, JSON.stringify({ key: it.key, secs: Math.round(r.secs), ...j }) + '\n'); break; }
    if (/usage limit|limit reached|hit your limit|rate.?limit/i.test(r.err)) { console.log('usage limit: sleeping 10 min'); await new Promise((s) => setTimeout(s, 600000)); attempt--; }
  }
}
console.log('judged', fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').length : 0, 'of', items.length);
