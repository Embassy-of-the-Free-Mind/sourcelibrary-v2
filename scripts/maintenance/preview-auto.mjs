#!/usr/bin/env node
/**
 * Does this PR get a Vercel preview without anyone asking? Yes when every file it changes is article
 * content: the article pages, their components, their images, and the generated article data.
 *
 * PRIOR ART: scripts/vercel-ignore-build.mjs `previewWanted()` decides whether a PUSHED commit builds
 * (a `preview/` branch or `[preview]` in the message); it never sees a PR's file list, and it runs on
 * Vercel after the branch exists. scripts/maintenance/pr-tier.mjs classifies a PR's files for RISK
 * (auto-merge or hold), not for "would a reader want to see it first". This file answers only the
 * second question, for .github/workflows/preview-label.yml, which then applies the `preview` label.
 *
 * WHY: an article is judged by looking at it (layout, figures, captions), and its PR otherwise merges
 * and waits for the next release window (07:00, 13:00, 19:00 UTC) before anyone sees it rendered. A
 * preview costs ~7 build minutes in the one-slot Vercel queue, so it stays opt-in for everything else.
 *
 * USAGE
 *   gh pr view <n> --json files --jq '.files[].path' | node scripts/maintenance/preview-auto.mjs
 * Prints `yes` or `no`; exit 0 either way, 1 on no input.
 */

export const ARTICLE_PATTERNS = [
  /^src\/app\/articles\//,
  /^src\/components\/articles\//,
  /^public\/articles\//,
  /^src\/generated\/article-[^/]*\.json$/,
];

/** True when there is at least one file and every one of them is article content. */
export function isArticleOnly(files) {
  const list = (files || []).map((f) => String(f).trim()).filter(Boolean);
  return list.length > 0 && list.every((f) => ARTICLE_PATTERNS.some((re) => re.test(f)));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const files = input.split('\n').filter(Boolean);
  if (!files.length) {
    console.error('preview-auto: no file list on stdin');
    process.exit(1);
  }
  console.log(isArticleOnly(files) ? 'yes' : 'no');
}
