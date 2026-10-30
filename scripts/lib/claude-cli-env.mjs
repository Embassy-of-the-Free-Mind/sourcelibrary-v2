// Environment for spawning `claude -p` on the SUBSCRIPTION.
// PRIOR ART: claudeEnv() in scripts/batch/ocr-convergence/driver.mjs and the strip in
// scripts/eval/stale-gate-6567 — the same three lines copied per script; this is the shared copy.
//
// A script run under `node --env-file=.env.production.local` (for Mongo) hands its child the
// ANTHROPIC_API_KEY in that file, and `claude -p` prefers an API key over the subscription login:
// every call then goes to the paid API, or fails "Invalid API key" with zero tokens when the key is
// dead. Hit 2026-10-12 (#6553) and again 2026-10-30 (#7761, 26/26 judge batches failed).
export function claudeSubscriptionEnv(env = process.env) {
  const e = { ...env };
  for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k];
  return e;
}
