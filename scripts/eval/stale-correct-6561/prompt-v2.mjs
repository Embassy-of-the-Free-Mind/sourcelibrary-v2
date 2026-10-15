#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/batch/prompt.mjs + prep.mjs (the experiment's correct prompt, written to
// prompt.json and hash-checked). This adds ONE rule to it; it does not fit as an edit there because the table run's
// prompt must stay byte-identical to what was measured and served.
//
// #6561 item 1, arm v2 (2026-10-15): the v1 pilot failed the over-correction gate (9 of 60 Kanripo-scored pages worse
// by > 0.5 pt). Read beside the gate: 5 of the 9 were Opus normalising a printed variant form (髙→高, 䖏→處, 㑹→會,
// 内→內, 巳→已) and one was Opus's own <note> commentary scored as body text. v2 = v1 + the rule below, placed just
// before the reply format. Usage (cwd = a dir holding v1's prompt.json): node prompt-v2.mjs  → prompt-v2.json
import fs from 'node:fs';
import { sha } from '../paddle-correct-6561/batch/prompt.mjs';

export const RULE_V2 = `
**Keep the page's own character forms.** Transcribe every character in the form the page prints: variant, archaic, vulgar and taboo-avoidance forms stay as printed (e.g. 髙 is not changed to 高, 㑹 not to 會, 䖏 not to 處, 内 not to 內, and 巳 stays 巳 where the page writes 巳), even where the draft or a dictionary uses another form. Correct a character only where the image shows a DIFFERENT character, not a different form of the same one. Add no notes, explanations or commentary of your own inside the transcription: a <note> holds only text the page prints (e.g. small interlinear notes).
`;

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const P = JSON.parse(fs.readFileSync('prompt.json', 'utf8'));
  const fmt = RULE_V2 + P.fmt;
  const v2 = { ...P, fmt, arm: 'v2', rule_v2: RULE_V2, rule_v2_sha: sha(RULE_V2), redo_opus_v2_sha: sha(P.head + fmt + P.suffix), v1_fmt_sha: sha(P.fmt) };
  fs.writeFileSync('prompt-v2.json', JSON.stringify(v2, null, 1));
  console.log(`prompt-v2.json: rule ${v2.rule_v2_sha}, prompt ${v2.redo_opus_v2_sha} (v1 head ${P.head_sha})`);
}
