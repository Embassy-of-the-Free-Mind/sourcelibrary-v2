// PRIOR ART: scripts/lib/cli-chatter.mjs (cliChatterReason: the guard cli-translate.mjs applies before a write). This
// only exposes it to the Python packet builder: stdin JSON {key: text}, stdout JSON {key: reason|null}.
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
const d = JSON.parse(await new Promise((res) => { let s = ''; process.stdin.on('data', (c) => { s += c; }); process.stdin.on('end', () => res(s)); }));
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, t]) => [k, cliChatterReason(t) || null]))));
