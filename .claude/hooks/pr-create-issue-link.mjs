#!/usr/bin/env node
/**
 * PreToolUse (matcher: Bash) — refuse a `gh pr create` whose title names an issue
 * `#N` without the body saying `Closes #N` or `Part of #N`.
 *
 * PRIOR ART: scripts/maintenance/pr-issue-link.mjs — the CI check (pr-issue-link.yml)
 * with the same rule; this hook imports its parser so the two cannot disagree. The CI
 * check stays; it just fires after the PR exists, and nobody reads it there: on
 * 2026-10-23, 5 of 7 red open PRs were red ONLY on issue-link (#7286 #7278 #7273
 * #7272 #7044). Catching it at create time costs nothing: no network call (a `gh api`
 * lookup took 33 s on 2026-10-23 and timed out), so every undeclared title `#N` is
 * flagged, including the rare PR or closed-issue ref, where `Part of #N` is harmless.
 *
 * Exit 2 (block, message to the session) when a declaration is missing. Exit 0 on
 * anything else, including every parse failure — a guard must never wedge
 * a session. Only commands containing `gh pr create` are examined.
 */
import { readFileSync } from 'node:fs';
import { titleRefs, declared } from '../../scripts/maintenance/pr-issue-link.mjs';

function main() {
  let cmd;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    cmd = input.tool_input?.command || '';
  } catch {
    return 0;
  }
  const at = cmd.search(/\bgh\s+pr\s+create\b/);
  if (at < 0) return 0;
  // Only flags after `gh pr create` belong to it (not a chained `git commit -F file`).
  cmd = cmd.slice(at);

  const t = cmd.match(/(?:--title|-t)\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
  if (!t) return 0; // --fill or an unparseable title: leave it to CI
  const title = t[1] ?? t[2];

  // The body is the --body-file contents if given, else the rest of the command
  // (covers --body "...", -b, and the $(cat <<'EOF' ... EOF) heredoc form).
  let body = cmd.replace(t[0], '');
  const bf = cmd.match(/(?:--body-file|-F)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (bf) {
    try { body = readFileSync(bf[1] ?? bf[2] ?? bf[3], 'utf8'); } catch { return 0; }
  }

  const undeclared = titleRefs(title).filter((n) => !declared(body, n));
  if (!undeclared.length) return 0;

  const refs = undeclared.map((n) => `#${n}`).join(', ');
  process.stderr.write(
    `pr-create-issue-link: the title names ${refs} but the body never says what this PR does to it.\n` +
    `Add a line to the body: \`Closes ${refs}\` if this PR finishes it, or \`Part of ${refs}\` if not.\n` +
    `A title reference closes nothing (#6284); the CI issue-link check fails without it. (If ${refs} is a PR or a closed issue, \`Part of\` is still fine.)\n`);
  return 2;
}

process.exit(main());
