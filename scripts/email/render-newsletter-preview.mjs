/**
 * Renders a newsletter body file inside the real Source Library email shell so
 * you can see exactly what recipients will see.
 *
 * The shell is not duplicated here — it is read out of
 * src/lib/email-templates.ts (`wrapInEmailShell`) at run time, so a preview can
 * never drift from what /admin/email actually sends. If that function's shape
 * changes enough to break the extraction, this script fails loudly rather than
 * rendering a shell nobody uses.
 *
 *   node scripts/email/render-newsletter-preview.mjs \
 *     scripts/email/feedback-newsletter-2026-08.body.html \
 *     "How to tell us we got it wrong" \
 *     /tmp/preview.html [campaign-id]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tagEmailLinks, campaignSlug } from '../../src/lib/email-utm.ts';

// Optional 4th argument: the campaign id for utm tags on sourcelibrary.org links.
// Defaults to the body file's name ("solve-et-coagula-2026-11.a"), so clicks from
// a letter are countable in analytics_pageviews.utm without anyone remembering to tag.
const [, , bodyPath, subject, outPath, campaignArg] = process.argv;
if (!bodyPath || !subject || !outPath) {
  console.error('Usage: render-newsletter-preview.mjs <body.html> <subject> <out.html>');
  process.exit(1);
}

const templates = readFileSync('src/lib/email-templates.ts', 'utf8');
const start = templates.indexOf('export function wrapInEmailShell');
if (start === -1) throw new Error('wrapInEmailShell not found in src/lib/email-templates.ts');
const open = templates.indexOf('`', start);
const close = templates.indexOf('`;', open + 1);
if (open === -1 || close === -1) throw new Error('Could not extract the shell template literal');

const shell = templates.slice(open + 1, close);
if (!shell.includes('${bodyHtml}') || !shell.includes('${subject}')) {
  throw new Error('Extracted shell is missing its ${subject} / ${bodyHtml} slots');
}

// Strip the HTML comment block the body files carry for their editors.
const campaign = campaignArg || path.basename(bodyPath).replace(/\.body\.html$|\.html$/, '');
const body = readFileSync(bodyPath, 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');

const html = shell
  .replaceAll('${subject}', subject)
  .replaceAll('${bodyHtml}', body)
  // The preview is read in a browser, not sent, so there is no Resend merge tag
  // to expand. Point it somewhere harmless instead of leaving raw handlebars.
  .replaceAll('{{{RESEND_UNSUBSCRIBE_URL}}}', '#unsubscribe');

const tagged = tagEmailLinks(html, campaign);
writeFileSync(outPath, tagged);
console.log(`Wrote ${outPath} (${tagged.length} bytes, body ${body.length}, links tagged utm_campaign=${campaignSlug(campaign)})`);
