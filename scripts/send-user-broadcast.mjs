/**
 * Welcome / outreach broadcast to Source Library account holders, sent in
 * staged ~200-person cohorts (a warm-up that protects domain reputation and
 * lets us read deliverability between sends).
 *
 * Recipients = the Mongo `users` collection (people who signed up on the
 * site), NOT `beta_subscribers` (the admin email UI's ~13-person Resend
 * audience). Each cohort goes to its own dedicated Resend audience.
 *
 * CURRENT WORKFLOW (cohort + suppression — supersedes the old hash-split
 * batch plan; the --batch/--all-batches/--reset flags still exist but the
 * cohort path below is what we actually use):
 *
 *   1. Build the next cohort OUTSIDE this script: pull `users` (newest first),
 *      EXCLUDE everyone already emailed (= the union of contacts in every
 *      already-sent cohort audience, see the ledger below), take the next
 *      ~200, write newline-separated to a file. This is the double-send guard.
 *      NEVER --reset/reshuffle once sending has begun.
 *
 *   2. Sync that file into a fresh named audience (no email sent):
 *        node scripts/send-user-broadcast.mjs --sync \
 *          --audience-name "Source Library Members — Cohort N" \
 *          --emails-file /tmp/cohortN.txt
 *
 *   3. Test to yourself first:
 *        node scripts/send-user-broadcast.mjs --test you@example.com --ia-url ... --youtube-url ...
 *
 *   4. Send the cohort (irreversible). Subject defaults to SUBJECTS[0]; pass
 *      --subject N to pick another from the approved palette. NEVER swap copy
 *      silently (see memory: feedback-dont-change-authored-copy):
 *        node scripts/send-user-broadcast.mjs --send \
 *          --audience-name "Source Library Members — Cohort N" \
 *          --ia-url ... --youtube-url ...
 *
 * READING RESULTS (no webhook needed): tracking subdomain
 * `ilove.sourcelibrary.org` (Resend, verified 2026-06-21) makes opens/clicks
 * show up in the Resend /emails API `last_event` field. Page GET
 * https://api.resend.com/emails (cursor `after=<id>`), filter by the cohort's
 * unique subject, tally last_event: delivered/bounced (deliverability) and
 * opened/clicked (engagement). Only sends AFTER the subdomain went live carry
 * click data.
 *
 * SENT LEDGER — the audiences below were DELETED from Resend on 2026-08-10
 * to free contact quota (their welcome-backlog job was done; Cohort 7 cleared
 * it). The IDs are dead. Full contact exports live in the private ops repo:
 * ~/sourcelibrary-ops/email-campaign/audience-exports/2026-08-10/. If a new
 * cohort is ever built, exclude the union of THOSE FILES, not these audiences.
 * (Historical record — tracking was OFF for the first three, no click data):
 *   - 725ada69-...  Batch 1            200  subj "A new Renaissance — by translating the first"
 *   - 33bc889e-...  Recent Week        200  subj "...has never been read"  (wrong word, shipped)
 *   - 7137b7fe-...  Cohort 2           200  subj "...has never been translated"
 *   - c8f7b2ac-...  Cohort 3                sent 2026-06-22
 *   - aa32ca61-...  Cohort 4                sent 2026-06-23
 *   - ddbd412f-...  Cohort 5                sent 2026-06-24
 *   - a730380e-...  Cohort 6          1154  sent 2026-06-28
 *   - 39acebdd-...  Cohort 7          1084  sent 2026-07-21  (broadcast bce47345)
 *   (3,638 distinct people emailed in total as of 2026-07-21; 4 unsubscribes.)
 *
 * NOTE: a standing "Source Library Newsletter" audience (5dd84247-...) is
 * refreshed daily by scripts/workers/refresh-newsletter-audience.mjs and is the
 * right target for recurring letters. The cohort machinery here is only for
 * giving the WELCOME letter to people who have never received it.
 *
 * Env: RESEND_API_KEY (--sync/--test/--send). Source via
 *   set -a; source .env.production.local; set +a
 */

import { getScriptClient } from './lib/mongo.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FROM = process.env.EMAIL_FROM || 'Derek at Source Library <derek@sourcelibrary.org>'; // people open emails from people; from derek@ so replies reach a real inbox
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'derek@sourcelibrary.org'; // email invites replies — must be a monitored inbox
const IG_URL = 'https://www.instagram.com/source.library/'; // primary call-to-action

// #5 — one subject per batch, so the staged send doubles as a subject test.
// (Directional only: batches differ in size + send-day, so treat as a lean,
// not a clean A/B.) Override a single send with EMAIL_SUBJECT or --subject N.
// Approved subject palette (Derek-confirmed 2026-06-21). SUBJECTS[0] is the
// STANDARD/default; the rest are used ONLY when explicitly chosen via
// --subject N. Never swap a subject into a send without telling Derek which
// line goes on which batch. See memory: feedback-dont-change-authored-copy.
const SUBJECTS = [
  'Most of the Renaissance has never been translated',           // 1 — STANDARD (default)
  'A new Renaissance — by translating the first',                // 2
  "You're one of the first readers of a 400-year-old library",   // 3
  '6,000 books, in English for the first time in history',       // 4
  'More Latin was written after 1500 than survives from all of Rome', // 5
];
const subjectFor = (n) => process.env.EMAIL_SUBJECT || SUBJECTS[(n || 1) - 1] || SUBJECTS[0];

// #1 — one real artifact at the top: turns "primary sources" from a concept
// into wonder. Arabic Ouroboros (18th-c. manuscript) — striking, full-colour,
// no nudity (safe for a cold send), and the tail-devouring serpent = renewal.
const HERO_IMG = 'https://images.sourcelibrary.org/artwork/art-ouroboros.jpg';
const HERO_LINK = 'https://sourcelibrary.org/book/ouroboros';
const heroCaption = () => `The Ouroboros — an 18th-century Arabic alchemical manuscript, one of ${en(STATS.illustrations)} illustrations in the library.`;
const preheader = () => `More than ${en(STATS.accounts)} of you have joined since our beta launch — a thank-you, and a small favor.`;
// Round, dark-mode-safe brand badge (brown circle + white mark on R2). Self-
// contained colour so it reads on both light and dark inboxes, and it's a
// circle (not a square that would show an ugly box in dark mode).
const BADGE_IMG = 'https://images.sourcelibrary.org/brand/email-badge-black.png';
// Hosted Spanish version of this email (static HTML on R2). ~25% of traffic is
// from Spanish-speaking countries (AR is the #2 country). We DON'T language-
// segment the send (no reliable per-user language flag → risk of sending
// Spanish to an English speaker); instead every English email carries a small
// "Leer en español" link to this page. Rebuild after copy changes: --build-es-page.
const SPANISH_PAGE_URL = 'https://images.sourcelibrary.org/email/bienvenida-es.html';
const REPLY_MAILTO = 'mailto:derek@sourcelibrary.org';
// CAN-SPAM §7704(a)(5) requires a valid physical postal address in every
// commercial email. Sends before 2026-07-20 carried none. This is the Embassy
// of the Free Mind (Huis met de Hoofden), Source Library's host institution.
const POSTAL_ADDRESS = 'Source Library &middot; c/o Embassy of the Free Mind &middot; Keizersgracht 123-4, 1015 CJ Amsterdam, Netherlands';

// ---- live stats -------------------------------------------------------
// Every number in this email used to be hardcoded, and every one of them went
// stale between sends (the signup count drifted 2,000 -> 2,400 -> 3,600, and
// each correction depended on a human noticing first). These are now read from
// the database at render time and rounded DOWN, so a claim can only ever
// understate. Defaults are the verified values on 2026-07-21 and are used only
// if the DB read fails, in which case we warn loudly rather than send silently.
const STATS = {
  accounts: 3600,          // users collection
  readersPerMonth: 20000,  // 30d distinct ip+ua in analytics_pageviews
  firstTranslations: 6000, // homepage_stats.firstTranslationCount
  translated: 17000,       // homepage_stats.translatedToEnglish
  illustrations: 206000,   // homepage_stats.illustrationCount
};
const floorTo = (n, step) => Math.floor(n / step) * step;
const roundTo = (n, step) => Math.round(n / step) * step;
const en = (n) => n.toLocaleString('en-US'); // 17,000
const es = (n) => n.toLocaleString('de-DE'); // 17.000

async function loadLiveStats() {
  const { db, cleanup } = await getScriptClient({ timeoutMs: 60000 });
  try {
    const accounts = await db.collection('users').countDocuments({});
    const cfg = await db.collection('system_config').findOne({ _id: 'homepage_stats' });
    const mau = (await db.collection('analytics_pageviews').aggregate([
      { $match: { timestamp: { $gt: new Date(Date.now() - 30 * 864e5) } } },
      { $group: { _id: { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } } } },
      { $count: 'n' },
    ]).toArray())[0]?.n || 0;
    if (!accounts || !cfg || !mau) throw new Error('incomplete stats read');
    STATS.accounts = floorTo(accounts, 100);
    STATS.readersPerMonth = floorTo(mau, 5000);
    STATS.firstTranslations = roundTo(cfg.firstTranslationCount, 1000);
    STATS.translated = floorTo(cfg.translatedToEnglish, 1000);
    STATS.illustrations = floorTo(cfg.illustrationCount, 1000);
    console.log(`Live stats: ${en(STATS.accounts)} accounts | ${en(STATS.readersPerMonth)} readers/mo | ${en(STATS.firstTranslations)} first translations | ${en(STATS.translated)} translated | ${en(STATS.illustrations)} illustrations`);
  } catch (e) {
    console.warn(`WARNING: live-stats read failed (${e.message}). Falling back to the 2026-07-21 defaults baked into STATS — verify them before sending.`);
  } finally {
    cleanup();
  }
}

// Fludd "most popular book" payoff image at the bottom. The Divine Monochord
// (a divine hand tuning the string of the universe), quality 1.0, from Fludd's
// History of the Two Worlds — gorgeous and no nudity (safe for a cold send).
const FLUDD_IMG = 'https://images.sourcelibrary.org/archived/6952dac677f38f6761bc683a/98.jpg';
const FLUDD_LINK = 'https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd';
// The monochord is on page 98 — the image should open straight to that page.
const FLUDD_PAGE_LINK = 'https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd/page/6952dac677f38f6761bc689c';
const FLUDD_CAPTION = 'The Divine Monochord — a divine hand tuning the string of the universe. Robert Fludd, History of the Two Worlds (1617).';

// ---- args -------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const doSync = has('--sync');
const doPreview = has('--preview');
const doSend = has('--send');
const testTo = val('--test'); // send the exact rendered email to ONE address
const iaUrl = val('--ia-url');
const ytUrl = val('--youtube-url');
const batchArg = val('--batch');           // '1' | '2' | '3'
const subjectArg = val('--subject');       // override which subject line (1|2|3) for a test/send
const doConcise = has('--concise');        // short, skim-friendly variant of the email
const audienceNameArg = val('--audience-name'); // target an arbitrary named audience (custom cohort)
const emailsFileArg = val('--emails-file');     // newline-separated emails to sync (instead of the batch split)
const allBatches = has('--all-batches');   // sync every batch audience in one run
const doReset = has('--reset');            // delete the 3 batch audiences (so --sync rebuilds them fresh)
const doBuildEsPage = has('--build-es-page'); // render the Spanish page + upload to R2

// Staged 3-day warm-up plan. Batch sizes (batch 3 = remainder).
const BATCH_SIZES = [200, 600]; // batch 1 = 200, batch 2 = 600, batch 3 = the rest (~930)
const batchAudienceName = (n) => `Source Library Members — Batch ${n}`;

// Random-but-reproducible split: order emails by a seeded hash (a stable
// pseudo-random permutation), then slice into the planned batches. This makes
// Batch 1 a representative sample across providers/ages, so its deliverability
// read honestly forecasts the full send — while staying deterministic so
// re-runs produce the SAME batches (idempotent sync).
const SHUFFLE_SEED = 'sl-broadcast-2026-06';
const shuffleKey = (e) => createHash('sha1').update(SHUFFLE_SEED + e).digest('hex');
function splitBatches(emails) {
  const shuffled = [...emails].sort((a, b) => shuffleKey(a).localeCompare(shuffleKey(b)));
  const out = [];
  let start = 0;
  for (const size of BATCH_SIZES) { out.push(shuffled.slice(start, start + size)); start += size; }
  out.push(shuffled.slice(start)); // remainder = final batch
  return out; // [batch1[], batch2[], batch3[]]
}

if (!doSync && !doPreview && !doSend && !testTo && !doReset && !doBuildEsPage) {
  console.log('Nothing to do. Pass --reset, --sync, --preview, --test <email>, --build-es-page, or --send.');
  process.exit(0);
}

// ---- email template ---------------------------------------------------
function renderHtml({ ia, yt, ig = IG_URL }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;">
    <!-- preheader: the gray preview line after the subject in the inbox -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f6f5f2;font-size:1px;line-height:1px;">${preheader()}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;padding:36px 32px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.6;font-size:16px;">
          <tr><td>
            <p style="margin:0 0 18px;text-align:center;font-family:Arial,sans-serif;font-size:13px;">
              <a href="${SPANISH_PAGE_URL}" style="color:#9e4a3a;text-decoration:none;">Leer en español &rarr;</a>
            </p>
            <a href="https://sourcelibrary.org" style="text-decoration:none;">
              <img src="${BADGE_IMG}" width="84" height="84" alt="Source Library" style="display:block;margin:0 auto 24px;width:84px;height:84px;border-radius:50%;">
            </a>

            <p style="margin:0 0 18px;">Hey friend,</p>

            <p style="margin:0 0 18px;">Since we launched, more than ${en(STATS.readersPerMonth)} people a month have come to read here &mdash; and you're one of the first ${en(STATS.accounts)} to make an account. Amazing&hellip; and welcome!</p>

            <p style="margin:0 0 18px;">One of our most-read books is by <a href="${FLUDD_LINK}" style="color:#9e4a3a;">Robert Fludd</a> &mdash; and it is gorgeous. It's one of about ${en(STATS.firstTranslations)} books we've translated for the first time in history. In total, we've translated over ${en(STATS.translated)} books in Latin, Chinese, Sanskrit, Tibetan, etc. I hope you'll find amazing discoveries in our library of lost knowledge. If you do, please share it with me and your friends!</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
              <tr><td style="background:#f5f0e8;border-left:4px solid #9e4a3a;border-radius:4px;padding:16px 20px;">
                <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#6b6560;">In the press</p>
                <p style="margin:0 0 10px;font-size:16px;color:#1a1612;">The <strong>Internet Archive</strong> came to our launch and wrote a lovely feature on what we're building.</p>
                <a href="${ia}" style="color:#9e4a3a;font-weight:bold;text-decoration:none;">Read the piece &rarr;</a>
              </td></tr>
            </table>

            <p style="margin:0 0 18px;">And if you write, podcast, or post anywhere, please mention us! Every link helps. Maybe you know a journalist &mdash; we'd love to spread the word. <a href="${REPLY_MAILTO}" style="color:#9e4a3a;">Reply here</a> and we'll send images, quotes, whatever you need.</p>

            <p style="margin:0 0 18px;">Thank you for being one of the first readers on Source Library. Really.</p>

            <p style="margin:0 0 16px;">&mdash; Derek</p>

            <p style="margin:0 0 24px;font-size:14px;color:#666;">Derek Lomas, PhD &middot; Founder, Source Library &middot; I read every reply, so feel free to just say hi.<br>
              Source Library is a non-profit initiative of the <a href="https://embassyofthefreemind.com" style="color:#9e4a3a;">Embassy of the Free Mind</a>.</p>

            <p style="margin:0 0 22px;font-size:15px;color:#555;">BTW &mdash; you can also watch the <a href="${yt || 'https://sourcelibrary.org'}" style="color:#9e4a3a;">talk from our launch here</a>.</p>

            <a href="${FLUDD_PAGE_LINK}" style="text-decoration:none;">
              <img src="${FLUDD_IMG}" width="360" alt="The Divine Monochord — Robert Fludd, 1617" style="display:block;margin:0 auto 8px;width:360px;max-width:100%;height:auto;border-radius:6px;">
            </a>
            <p style="margin:0 0 22px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#8a8780;">${FLUDD_CAPTION}</p>

            <hr style="border:none;border-top:1px solid #e6e3dd;margin:0 0 14px;">
            <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:13px;color:#8a8780;">
              <a href="https://sourcelibrary.org" style="color:#9e4a3a;">Browse the library</a> &nbsp;&middot;&nbsp;
              <a href="${ig}" style="color:#9e4a3a;">Instagram</a> &nbsp;&middot;&nbsp;
              <a href="${ia}" style="color:#9e4a3a;">The article</a> &nbsp;&middot;&nbsp;
              <a href="${yt || 'https://sourcelibrary.org'}" style="color:#9e4a3a;">Launch video</a></p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#8a8780;">You're receiving this because you created an account at sourcelibrary.org. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#8a8780;">Unsubscribe</a>.<br>${POSTAL_ADDRESS}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Standalone Spanish landing page (hosted on R2; linked from the English email
// via "Leer en español"). Full HTML doc, no unsubscribe token. Build/upload
// with --build-es-page after any copy change.
function renderEsPage({ ia, yt, ig = IG_URL }) {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Source Library — Bienvenido</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f5f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;padding:36px 32px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.6;font-size:16px;">
          <tr><td>
            <a href="https://sourcelibrary.org" style="text-decoration:none;">
              <img src="${BADGE_IMG}" width="84" height="84" alt="Source Library" style="display:block;margin:0 auto 24px;width:84px;height:84px;border-radius:50%;">
            </a>

            <p style="margin:0 0 18px;">Hola:</p>

            <p style="margin:0 0 18px;">Desde que lanzamos Source Library, m&aacute;s de ${es(STATS.readersPerMonth)} personas al mes vienen a leer aqu&iacute;, y t&uacute; eres una de las primeras ${es(STATS.accounts)} en crear una cuenta. Incre&iacute;ble&hellip; &iexcl;y bienvenido!</p>

            <p style="margin:0 0 18px;">Uno de nuestros libros m&aacute;s le&iacute;dos es de <a href="${FLUDD_PAGE_LINK}" style="color:#9e4a3a;">Robert Fludd</a>, y es una maravilla. Es uno de los cerca de ${es(STATS.firstTranslations)} libros que hemos traducido por primera vez en la historia. En total, hemos traducido m&aacute;s de ${es(STATS.translated)} libros en lat&iacute;n, chino, s&aacute;nscrito, tibetano, etc. Espero que encuentres descubrimientos asombrosos en nuestra biblioteca de conocimiento perdido. Si es as&iacute;, &iexcl;comp&aacute;rtela conmigo y con tus amigos!</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
              <tr><td style="background:#f5f0e8;border-left:4px solid #9e4a3a;border-radius:4px;padding:16px 20px;">
                <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#6b6560;">En la prensa</p>
                <p style="margin:0 0 10px;font-size:16px;color:#1a1612;">Internet Archive vino a nuestro lanzamiento y escribi&oacute; un art&iacute;culo precioso sobre lo que estamos construyendo.</p>
                <a href="${ia}" style="color:#9e4a3a;font-weight:bold;text-decoration:none;">Leer el art&iacute;culo &rarr;</a>
              </td></tr>
            </table>

            <p style="margin:0 0 14px;">Si quieres ayudar, s&iacute;guenos en Instagram <a href="${ig}" style="color:#9e4a3a;">@source.library</a></p>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="border-radius:8px;background:#1a1612;">
              <a href="${ig}" style="display:inline-block;padding:13px 26px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">S&iacute;guenos en Instagram &rarr;</a>
            </td></tr></table>

            <p style="margin:0 0 18px;">Y si escribes, haces podcast o publicas en cualquier lugar, &iexcl;menci&oacute;nanos! Cada enlace ayuda. Quiz&aacute;s conozcas a alg&uacute;n periodista; nos encantar&iacute;a correr la voz. <a href="${REPLY_MAILTO}" style="color:#9e4a3a;">Responde aqu&iacute;</a> y te enviaremos im&aacute;genes, citas, lo que necesites.</p>

            <p style="margin:0 0 18px;">Gracias por ser uno de los primeros lectores de Source Library. De verdad.</p>

            <p style="margin:0 0 16px;">&mdash; Derek</p>

            <p style="margin:0 0 24px;font-size:14px;color:#666;">Derek Lomas, PhD &middot; Fundador, Source Library &middot; Leo todas las respuestas, as&iacute; que no dudes en saludar.<br>
              Source Library es una iniciativa sin fines de lucro de la <a href="https://sourcelibrary.org" style="color:#9e4a3a;">Embassy of the Free Mind</a>.</p>

            <p style="margin:0 0 22px;font-size:15px;color:#555;">Por cierto, tambi&eacute;n puedes ver la <a href="${yt || 'https://sourcelibrary.org'}" style="color:#9e4a3a;">charla de nuestro lanzamiento aqu&iacute;</a>.</p>

            <a href="${FLUDD_PAGE_LINK}" style="text-decoration:none;">
              <img src="${FLUDD_IMG}" width="360" alt="El Monocordio Divino — Robert Fludd, 1617" style="display:block;margin:0 auto 8px;width:360px;max-width:100%;height:auto;border-radius:6px;">
            </a>
            <p style="margin:0 0 22px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#8a8780;">El Monocordio Divino: una mano divina afinando la cuerda del universo. Robert Fludd, Historia de Ambos Mundos (1617).</p>

            <hr style="border:none;border-top:1px solid #e6e3dd;margin:0 0 14px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#8a8780;">
              <a href="https://sourcelibrary.org" style="color:#9e4a3a;">Explorar la biblioteca</a> &nbsp;&middot;&nbsp;
              <a href="${ig}" style="color:#9e4a3a;">Instagram</a> &nbsp;&middot;&nbsp;
              <a href="${ia}" style="color:#9e4a3a;">El art&iacute;culo</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Concise variant — same hero + button, almost no prose. For skim/mobile.
function renderConcise({ ia, yt, ig = IG_URL }) {
  const more = [
    `<a href="${ia}" style="color:#9e4a3a;">read the write-up</a>`,
    yt ? `<a href="${yt}" style="color:#9e4a3a;">watch the launch</a>` : null,
  ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f6f5f2;font-size:1px;line-height:1px;">${preheader()}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;padding:36px 32px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.6;font-size:16px;">
          <tr><td>
            <a href="${HERO_LINK}" style="text-decoration:none;">
              <img src="${HERO_IMG}" width="320" alt="The Ouroboros, an 18th-century Arabic alchemical manuscript" style="display:block;margin:0 auto 20px;width:320px;max-width:100%;height:auto;border-radius:6px;">
            </a>

            <p style="margin:0 0 18px;">You're one of the first people inside <strong>Source Library</strong> &mdash; thank you. Most of the Renaissance has never been translated. We're opening it: centuries of primary sources, translated so you can actually read them.</p>

            <p style="margin:0 0 18px;">We post one discovery a day. Follow along:</p>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="border-radius:8px;background:#1a1612;">
              <a href="${ig}" style="display:inline-block;padding:13px 26px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Follow on Instagram &rarr;</a>
            </td></tr></table>

            <p style="margin:0 0 22px;font-size:15px;color:#555;">More: ${more}</p>

            <p style="margin:0 0 24px;">&mdash; Derek</p>

            <hr style="border:none;border-top:1px solid #e6e3dd;margin:0 0 14px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#8a8780;">You're receiving this because you created an account at sourcelibrary.org. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#8a8780;">Unsubscribe</a>.<br>${POSTAL_ADDRESS}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

const render = (opts) => (doConcise ? renderConcise(opts) : renderHtml(opts));

// ---- helpers ----------------------------------------------------------
async function getUserEmails() {
  // Use getScriptClient + cleanup() so the Mongo watchdog timer is cleared
  // BEFORE the long-running Resend sync starts (withMongo leaks the timer).
  const { db, cleanup } = await getScriptClient({ timeoutMs: 60000 });
  try {
    const docs = await db.collection('users')
      .find({ email: { $exists: true, $ne: null } }, { projection: { email: 1 } })
      .toArray();
    const set = new Set();
    for (const d of docs) {
      const e = (d.email || '').trim().toLowerCase();
      if (e && e.includes('@')) set.add(e);
    }
    return [...set];
  } finally {
    cleanup(); // closes client AND clears the force-exit timer
  }
}

async function ensureAudience(resend, name) {
  const list = await resend.audiences.list();
  const existing = (list.data?.data || []).find((a) => a.name === name);
  if (existing) return existing.id;
  const created = await resend.audiences.create({ name });
  if (!created.data?.id) throw new Error('Failed to create audience: ' + JSON.stringify(created.error));
  return created.data.id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncContacts(resend, audienceId, emails) {
  let added = 0, existed = 0, failed = 0;
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    try {
      const res = await resend.contacts.create({ audienceId, email, unsubscribed: false });
      if (res.error) {
        const msg = JSON.stringify(res.error);
        if (/exist/i.test(msg)) existed++; else { failed++; if (failed <= 5) console.error('  fail', email, msg); }
      } else added++;
    } catch (e) {
      const msg = String(e?.message || e);
      if (/429|rate/i.test(msg)) { await sleep(1200); i--; continue; }
      if (/exist/i.test(msg)) existed++; else { failed++; if (failed <= 5) console.error('  fail', email, msg); }
    }
    await sleep(550); // ~2 req/s, under Resend's default rate limit
    if ((i + 1) % 100 === 0) console.log(`  ...${i + 1}/${emails.length} (added ${added}, existed ${existed}, failed ${failed})`);
  }
  return { added, existed, failed };
}

// ---- main -------------------------------------------------------------
(async () => {
  // Read every number in the copy from the DB before anything renders. Must
  // run first: --preview, --test, --send and --build-es-page all render.
  await loadLiveStats();

  // Build + upload the Spanish landing page to R2 (no Mongo, no email).
  if (doBuildEsPage) {
    if (!iaUrl) { console.error('--build-es-page needs --ia-url (and ideally --youtube-url).'); process.exit(1); }
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    const html = renderEsPage({ ia: iaUrl, yt: ytUrl });
    const key = 'email/bienvenida-es.html';
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: html, ContentType: 'text/html; charset=utf-8', CacheControl: 'public, max-age=300' }));
    console.log(`Spanish page uploaded: ${process.env.R2_PUBLIC_URL}/${key}`);
    return;
  }

  const emails = await getUserEmails();
  console.log(`Found ${emails.length} unique user emails.`);

  if (doPreview) {
    const ia = iaUrl || '__ARTICLE_URL__';
    const out = '/tmp/source-library-broadcast-preview.html';
    writeFileSync(out, render({ ia, yt: ytUrl })); // yt null => video bullet omitted, exactly as it would send
    console.log(`Preview written: ${out}`);
    console.log(`  article: ${ia}`);
    console.log(`  youtube: ${ytUrl || '(none — video bullet omitted)'}`);
    if (!doSync && !doSend && !doReset) return;
  }

  if (!doSync && !doSend && !testTo && !doReset) return;

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set. Source .env.production.local first.');
    process.exit(1);
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Delete the batch audiences so a following --sync rebuilds them with the
  // current (random) membership instead of accumulating stale contacts.
  if (doReset) {
    const list = await resend.audiences.list();
    for (const n of [1, 2, 3]) {
      const a = (list.data?.data || []).find((x) => x.name === batchAudienceName(n));
      if (a) { await resend.audiences.remove({ id: a.id }); console.log(`Deleted "${batchAudienceName(n)}" (${a.id})`); }
      else console.log(`No existing "${batchAudienceName(n)}" to delete.`);
    }
  }

  // One-off test send to a single address (no audience, no broadcast).
  if (testTo) {
    if (!iaUrl) { console.error('Test needs --ia-url.'); process.exit(1); }
    const res = await resend.emails.send({
      from: FROM, replyTo: REPLY_TO, to: testTo, subject: `[TEST] ${subjectFor(Number(subjectArg) || 1)}`,
      html: render({ ia: iaUrl, yt: ytUrl }).replace('{{{RESEND_UNSUBSCRIBE_URL}}}', 'https://sourcelibrary.org'),
    });
    if (res.error) throw new Error('Test send failed: ' + JSON.stringify(res.error));
    console.log(`Test email sent to ${testTo} (id ${res.data?.id}). from=${FROM} reply-to=${REPLY_TO}`);
    console.log(`  article=${iaUrl}  youtube=${ytUrl || '(none — bullet omitted)'}`);
    return;
  }

  // ---- CUSTOM COHORT: sync/send to an arbitrary named audience from an
  // explicit email list (e.g. "recent-week signups, excluding already-sent").
  if (audienceNameArg) {
    const aud = await ensureAudience(resend, audienceNameArg);
    if (doSync) {
      if (!emailsFileArg) { console.error('Cohort sync needs --emails-file.'); process.exit(1); }
      const list = readFileSync(emailsFileArg, 'utf8').split('\n').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
      console.log(`\nSyncing cohort "${audienceNameArg}" (${aud}) — ${list.length} emails`);
      const r = await syncContacts(resend, aud, list);
      console.log(`Cohort sync done: added ${r.added}, already-present ${r.existed}, failed ${r.failed}`);
    }
    if (doSend) {
      if (!iaUrl) { console.error('REFUSING TO SEND: --ia-url is required.'); process.exit(1); }
      const subject = subjectFor(Number(subjectArg) || 1);
      const html = render({ ia: iaUrl, yt: ytUrl });
      console.log(`Creating broadcast for cohort "${audienceNameArg}" (${aud})...`);
      const bc = await resend.broadcasts.create({ audienceId: aud, from: FROM, replyTo: REPLY_TO, subject, html });
      console.log(`Subject: "${subject}"`);
      if (!bc.data?.id) throw new Error('Broadcast create failed: ' + JSON.stringify(bc.error));
      const sent = await resend.broadcasts.send(bc.data.id);
      if (sent.error) throw new Error('Send failed: ' + JSON.stringify(sent.error));
      console.log(`SENT cohort "${audienceNameArg}" to audience ${aud}. Broadcast ${bc.data.id}.`);
    }
    return;
  }

  const batches = splitBatches(emails);
  console.log(`Batch plan: B1=${batches[0].length}, B2=${batches[1].length}, B3=${batches[2].length} (total ${emails.length}).`);

  // ---- SYNC: populate batch audiences (no email sent) ----
  if (doSync) {
    const which = allBatches ? [1, 2, 3] : [Number(batchArg)];
    if (which.some((n) => ![1, 2, 3].includes(n))) {
      console.error('Sync needs --batch 1|2|3 or --all-batches.');
      process.exit(1);
    }
    for (const n of which) {
      const aud = await ensureAudience(resend, batchAudienceName(n));
      console.log(`\nSyncing Batch ${n} → "${batchAudienceName(n)}" (${aud})`);
      const r = await syncContacts(resend, aud, batches[n - 1]);
      console.log(`Batch ${n} sync done: added ${r.added}, already-present ${r.existed}, failed ${r.failed}`);
    }
  }

  // ---- SEND: broadcast to ONE batch audience (the irreversible step) ----
  if (doSend) {
    const n = Number(batchArg);
    if (![1, 2, 3].includes(n)) {
      console.error('REFUSING TO SEND: --batch 1|2|3 is required (we send one batch per day).');
      process.exit(1);
    }
    if (!iaUrl) {
      console.error('REFUSING TO SEND: --ia-url is required (--youtube-url is optional).');
      process.exit(1);
    }
    const aud = await ensureAudience(resend, batchAudienceName(n));
    const html = render({ ia: iaUrl, yt: ytUrl });
    console.log(`Creating broadcast for Batch ${n} (${batches[n - 1].length} recipients, audience ${aud})...`);
    const subject = subjectFor(Number(subjectArg) || n);
    const bc = await resend.broadcasts.create({ audienceId: aud, from: FROM, replyTo: REPLY_TO, subject, html });
    console.log(`Subject: "${subject}"`);
    if (!bc.data?.id) throw new Error('Broadcast create failed: ' + JSON.stringify(bc.error));
    console.log(`Broadcast created: ${bc.data.id}`);
    const sent = await resend.broadcasts.send(bc.data.id);
    if (sent.error) throw new Error('Send failed: ' + JSON.stringify(sent.error));
    console.log(`SENT Batch ${n} to audience ${aud}. Broadcast ${bc.data.id}.`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
