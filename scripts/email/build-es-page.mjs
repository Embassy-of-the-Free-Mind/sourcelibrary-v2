/**
 * Render the Spanish letter as a standalone page under public/, so the English
 * email can carry one "Leer en español" link instead of us splitting the send.
 *
 * The welcome letter does this too, but uploads to R2. This writes into
 * public/email/ instead: the screenshots already live there, it ships with the
 * normal deploy, and it needs no R2 credentials — one fewer way for the page to
 * be missing when the link goes out.
 *
 *   node scripts/email/build-es-page.mjs
 *
 * Run it after ANY change to either letter. The two are a translation pair and
 * drift silently — nothing errors if the Spanish still describes last week's copy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BODY = path.join(HERE, 'feedback-newsletter-2026-08.es.body.html');
const OUT = path.join(process.cwd(), 'public/email/feedback-2026-08/es.html');
const SUBJECT = '¿Me puedes dar tu opinión?';

const tmp = path.join(process.env.TMPDIR || '/tmp', `sl-es-${Date.now()}.html`);
execFileSync('node', [path.join(HERE, 'render-newsletter-preview.mjs'), BODY, SUBJECT, tmp], { stdio: 'pipe' });

let html = readFileSync(tmp, 'utf8');
// It is a web page, not an email: no unsubscribe, and say so in the <html> tag
// so screen readers and translators do not treat it as English.
html = html
  .replace('<html>', '<html lang="es">')
  .replace(/<a href="#unsubscribe"[^>]*>Unsubscribe<\/a>/, '<a href="https://sourcelibrary.org/es" style="color:#8a8480;font-size:11px;">sourcelibrary.org/es</a>')
  .replace('<head>', '<head><meta name="robots" content="noindex">');

writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${html.length} bytes)`);
console.log('Live after deploy at https://sourcelibrary.org/email/feedback-2026-08/es.html');
