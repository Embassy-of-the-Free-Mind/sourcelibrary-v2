// Check each claude-translate read opens with exactly the warning its instruction gave (#7119); list the misses.
//   node check-translations.mjs <read-dir> <prefix>.instr.json
import fs from 'node:fs';
import path from 'node:path';
const [dir, instrF] = process.argv.slice(2);
const instr = JSON.parse(fs.readFileSync(instrF, 'utf8'));
let bad = 0;
for (const [id, line] of Object.entries(instr)) {
  const want = line.match(/<warning>[\s\S]*?<\/warning>/)[0];
  const f = path.join(dir, `${id}.txt`);
  const got = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
  const ok = got.startsWith(want);
  const lb = (got.match(/<leaf-break\/>/g) || []).length;
  if (!ok) { bad++; console.log(`${id}: ${got ? 'warning differs: ' + got.slice(0, 160) : 'no read'}`); }
  else console.log(`${id}: ok (${got.length} chars, ${lb} leaf-break)`);
}
process.exit(bad ? 1 : 0);
