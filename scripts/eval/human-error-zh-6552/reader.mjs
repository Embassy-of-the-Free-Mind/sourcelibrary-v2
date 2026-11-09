// PRIOR ART: judge.mjs (this directory; these moved out of it so referee.mjs asks the same question the same way).
// #6552: the blind question, the answer parser, the lean claude -p call.
import { spawn } from 'node:child_process';
export const RULES = `Each numbered entry has a context with [?] at one position, and usually two candidate readings for that position. A reading of "(nothing)" means no character there. Readings can be right or wrong; neither has any authority, and the context can hold slips of its own (□ marks an unsettled character).
For each entry answer from the leaf, not from what the text ought to say:
- choice: "A" or "B" if that reading is what the leaf writes at [?]; "neither" if the leaf clearly writes something else; "cannot_tell" if the panel does not show this passage, or the character is damaged or illegible. If the passage is not in the panel, say cannot_tell: do not guess from sense.
- seen: the character(s) you see on the leaf at [?], as written, "" if you cannot see it. For an entry with no candidate readings, seen is the whole answer and choice is "read" or "cannot_tell".
- variant: true if A and B are two written forms of one character (異體字, 俗字, 古今字), false if they are different characters, null if no readings.
- slip: true only if the leaf itself evidently has a mistake at [?] and the other reading is what the text must mean. Otherwise false.
Reply with JSON only: {"items":[{"n":1,"choice":"A","seen":"…","variant":false,"slip":false}, …]}`;
export const parse = (t, n) => { const m = String(t || '').match(/\{[\s\S]*\}/); try { const v = JSON.parse(m[0]); return Array.isArray(v.items) && v.items.length === n ? v.items : null; } catch { return null; } };
export function claudeCall(prompt, withRead, cwd) {
  const args = ['-p', '--model', 'opus', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--system-prompt', 'You read Chinese manuscripts and prints against their images and reply with JSON only.', ...(withRead ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''])];
  return new Promise((res) => {
    const c = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }); let o = '', e = '';
    const timer = setTimeout(() => c.kill('SIGKILL'), 420_000);
    c.stdout.on('data', (d) => o += d); c.stderr.on('data', (d) => e += d); c.stdin.end(prompt);
    c.on('close', () => { clearTimeout(timer); try { const j = JSON.parse(o); res({ text: j.result, usage: j.usage, cost: j.total_cost_usd, err: j.is_error ? String(j.result).slice(0, 200) : null }); } catch { res({ text: '', err: (e || o).slice(0, 300) }); } });
  });
}
