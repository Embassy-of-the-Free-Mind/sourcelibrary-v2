/**
 * Thank-you (with an apology folded in) to the readers caught in the /welcome
 * redirect loop, 2026-07-29 → 2026-07-30. Fix: PR #3467.
 *
 * What happened to them: they filled in the welcome form, it saved correctly, and
 * the site sent them straight back to the same form — on every page — because the
 * session token was never re-minted. See src/components/welcome/WelcomeForm.tsx.
 *
 * WHO THIS EMAILS — a FROZEN list, read from a file, never re-derived.
 * `users.welcomedAt` is overwritten on every save, so anyone who came back and
 * re-saved after the fix silently drops out of any welcomedAt-window query: the
 * list shrank 42 → 40 between two runs an hour apart, losing two people who were
 * definitely affected. The file was captured before that drift. Default path is
 * in the private ops repo, because 42 reader email addresses do not belong in a
 * public AGPL repo.
 *
 * It deliberately does NOT include the ~35 gated readers who were bounced without
 * ever saving: an apology for something you may not have noticed is a confusing
 * email, and that population cannot be enumerated anyway (analytics_pageviews
 * stores no user_id, #3405).
 *
 * TWO COHORTS, because the letter must not thank someone for something they
 * didn't do:
 *   - CONTRIBUTORS (25): wrote prose, a help offer, or a reading language. They
 *     get the thank-you letter.
 *   - QUIET (15): pressed "Skip for now" (no `profile` subdocument at all) or
 *     saved with every field blank. They contributed nothing, so thanking them
 *     for contributing would be false. Off by default; --include-quiet sends them
 *     the shorter note.
 *
 * LANGUAGE: Spanish only where the reader TOLD us Spanish and did not also
 * mention English — never inferred from a name or a mail domain. ~20 of the 25
 * contributors named Spanish. Everyone else gets English.
 *
 * TRANSACTIONAL, not marketing: sent per-recipient via resend.emails.send rather
 * than through a Resend audience/broadcast. It answers a named incident, so it
 * does not belong in the newsletter audience and must not consume a marketing
 * cohort (see scripts/send-user-broadcast.mjs for that machinery).
 *
 * DOUBLE-SEND GUARD: each successful send stamps
 * `users.apologies.welcomeLoop2026_07`, and anyone stamped is skipped. Re-running
 * is safe; mailing someone twice needs that field cleared by hand.
 *
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs               # dry run (default)
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs --test me@x   # one real send to yourself
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs --test me@x --lang es
 *   node scripts/maintenance/apologize-welcome-loop-2026-07.mjs --send        # irreversible
 *
 * Env: MONGODB_URI, RESEND_API_KEY.
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/apologize-welcome-loop-2026-07.mjs
 */
import { MongoClient } from 'mongodb';
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_LIST = join(homedir(), 'sourcelibrary-ops/incidents/welcome-loop-2026-07-29-recipients.txt');

const SENT_FIELD = 'apologies.welcomeLoop2026_07';

const FROM = process.env.EMAIL_FROM || 'Derek at Source Library <derek@sourcelibrary.org>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'derek@sourcelibrary.org';

// ---------------------------------------------------------------------------
// Authored copy. Do not reword without Derek's say-so — see memory:
// feedback-dont-change-authored-copy.
// ---------------------------------------------------------------------------

const COPY = {
  contributor: {
    en: {
      subject: 'Thank you — and sorry about that form',
      greeting: (n) => (n ? `${n},` : 'Hello,'),
      paras: [
        "Thank you for telling us who you are and what you're looking for. We're a small team, we read every one of these, and they genuinely shape what we translate next.",
        'You may then have found the site sending you back to the same form again and again. That was a bug on our side, not anything you did, and your answers had already saved the first time. It is fixed now.',
        'You can change anything you told us, whenever you like, on your account page: https://sourcelibrary.org/account',
        'Thank you for being here this early.',
      ],
    },
    es: {
      subject: 'Gracias — y disculpa por el formulario',
      greeting: (n) => (n ? `${n}:` : 'Hola:'),
      paras: [
        'Gracias por contarnos quién eres y qué estás buscando. Somos un equipo pequeño, leemos todos estos mensajes y de verdad influyen en lo que traducimos a continuación.',
        'Puede que después el sitio te devolviera una y otra vez al mismo formulario. Fue un error nuestro, no algo que hicieras tú, y tus respuestas ya se habían guardado a la primera. Ya está arreglado.',
        'Puedes cambiar lo que nos contaste cuando quieras, en la página de tu cuenta: https://sourcelibrary.org/account',
        'Gracias por acompañarnos desde tan temprano.',
      ],
    },
  },
  quiet: {
    en: {
      subject: 'That form was broken — sorry',
      greeting: (n) => (n ? `${n},` : 'Hello,'),
      paras: [
        'When you joined Source Library the welcome form kept sending you back to itself. That was a bug on our side, not anything you did, and it is fixed now.',
        'Nothing is required of you — the library is yours to read. If you ever want to tell us what you are after, or change your name, it is all on your account page: https://sourcelibrary.org/account',
        'Thank you for being here this early.',
      ],
    },
    es: {
      subject: 'Ese formulario estaba roto — disculpa',
      greeting: (n) => (n ? `${n}:` : 'Hola:'),
      paras: [
        'Cuando te uniste a Source Library, el formulario de bienvenida te devolvía a sí mismo una y otra vez. Fue un error nuestro, no algo que hicieras tú, y ya está arreglado.',
        'No necesitas hacer nada: la biblioteca está ahí para leerla. Si algún día quieres contarnos qué buscas, o cambiar tu nombre, todo está en la página de tu cuenta: https://sourcelibrary.org/account',
        'Gracias por acompañarnos desde tan temprano.',
      ],
    },
  },
};

const SIGNOFF = { en: 'Derek', es: 'Derek' };

function buildText(cohort, lang, firstName) {
  const c = COPY[cohort][lang];
  return `${c.greeting(firstName)}\n\n${c.paras.join('\n\n')}\n\n${SIGNOFF[lang]}\nSource Library\n`;
}

function buildHtml(cohort, lang, firstName) {
  const c = COPY[cohort][lang];
  const linkify = (s) => s.replace(
    /https:\/\/sourcelibrary\.org\/account/g,
    '<a href="https://sourcelibrary.org/account" style="color:#9a3412">sourcelibrary.org/account</a>'
  );
  const p = (s) => `<p style="margin:0 0 16px">${s}</p>`;
  return `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#1c1917;max-width:34em">
${p(escapeHtml(c.greeting(firstName)))}
${c.paras.map(s => p(linkify(escapeHtml(s)))).join('\n')}
${p(`${SIGNOFF[lang]}<br><span style="color:#78716c">Source Library</span>`)}
</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * Spanish only when they said Spanish and did not also say English. Conservative
 * on purpose: a reader who wrote "English and Spanish" told us English works, and
 * guessing wrong in the other direction is the ruder error. Never inferred from a
 * name or a mail domain.
 */
function langFor(preferredLanguage) {
  const s = (preferredLanguage || '').toLowerCase();
  if (!s) return 'en';
  const saysSpanish = /espa|spanish/.test(s);
  const saysEnglish = /ingl|english/.test(s);
  return saysSpanish && !saysEnglish ? 'es' : 'en';
}

/** Did they actually give us anything? Drives cohort, and must not be guessed. */
function isContributor(user) {
  const p = user.profile;
  if (!p) return false; // pressed "Skip for now" — no profile subdocument is written
  return Boolean(
    (p.aboutYou || '').trim() || (p.helpDescription || '').trim() || (p.preferredLanguage || '').trim()
  );
}

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const listPath = flag('--list') || DEFAULT_LIST;
const testTo = flag('--test');
const testLang = flag('--lang') === 'es' ? 'es' : 'en';
const testCohort = flag('--cohort') === 'quiet' ? 'quiet' : 'contributor';
const includeQuiet = args.includes('--include-quiet');
const doSend = args.includes('--send');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  if ((doSend || testTo) && !process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');

  if (testTo) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const r = await resend.emails.send({
      from: FROM, replyTo: REPLY_TO, to: testTo,
      subject: `[TEST ${testCohort}/${testLang}] ${COPY[testCohort][testLang].subject}`,
      text: buildText(testCohort, testLang, 'Derek'),
      html: buildHtml(testCohort, testLang, 'Derek'),
    });
    console.log('test send:', r.error ? `FAILED ${JSON.stringify(r.error)}` : `ok id=${r.data?.id}`);
    return;
  }

  const emails = readFileSync(listPath, 'utf8')
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.toLowerCase());
  console.log(`frozen list   : ${listPath}`);
  console.log(`addresses     : ${emails.length}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const users = await db.collection('users')
    .find({ email: { $in: emails } })
    .project({ email: 1, name: 1, profile: 1, apologies: 1 }).toArray();

  const missing = emails.filter(e => !users.some(u => (u.email || '').toLowerCase() === e));
  if (missing.length) console.log(`NOT FOUND in users: ${missing.length} (${missing.join(', ')})`);

  const already = users.filter(u => u.apologies?.welcomeLoop2026_07);
  const pending = users.filter(u => !u.apologies?.welcomeLoop2026_07);
  const contributors = pending.filter(isContributor);
  const quiet = pending.filter(u => !isContributor(u));
  const recipients = includeQuiet ? [...contributors, ...quiet] : contributors;

  console.log(`already sent  : ${already.length}`);
  console.log(`contributors  : ${contributors.length}  (${contributors.filter(u => langFor(u.profile?.preferredLanguage) === 'es').length} Spanish)`);
  console.log(`quiet         : ${quiet.length}${includeQuiet ? ' (INCLUDED)' : ' (excluded — pass --include-quiet)'}`);
  console.log(`TO SEND       : ${recipients.length}\n`);

  if (!doSend) {
    console.log('DRY RUN — nobody emailed.');
    for (const u of recipients) {
      const cohort = isContributor(u) ? 'contributor' : 'quiet';
      const lang = cohort === 'contributor' ? langFor(u.profile?.preferredLanguage) : 'en';
      console.log(`  [${cohort}/${lang}] ${u.email}`);
    }
    for (const cohort of includeQuiet ? ['contributor', 'quiet'] : ['contributor']) {
      for (const lang of ['en', 'es']) {
        console.log(`\n===== ${cohort} / ${lang} =====`);
        console.log(`Subject: ${COPY[cohort][lang].subject}\n`);
        console.log(buildText(cohort, lang, 'Ada'));
      }
    }
    await client.close();
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0, failed = 0;
  for (const u of recipients) {
    const cohort = isContributor(u) ? 'contributor' : 'quiet';
    const lang = cohort === 'contributor' ? langFor(u.profile?.preferredLanguage) : 'en';
    const firstName = (u.name || '').trim().split(' ')[0] || '';
    const r = await resend.emails.send({
      from: FROM, replyTo: REPLY_TO, to: u.email,
      subject: COPY[cohort][lang].subject,
      text: buildText(cohort, lang, firstName),
      html: buildHtml(cohort, lang, firstName),
    });
    if (r.error) {
      failed++;
      console.error(`  FAIL ${u.email}: ${JSON.stringify(r.error)}`);
      continue;
    }
    // Stamp only after Resend accepts it, so a crash mid-run cannot mark someone
    // as emailed who wasn't.
    await db.collection('users').updateOne(
      { _id: u._id },
      { $set: { [SENT_FIELD]: new Date(), [`${SENT_FIELD}_emailId`]: r.data?.id || null, [`${SENT_FIELD}_variant`]: `${cohort}/${lang}` } }
    );
    sent++;
    console.log(`  sent [${cohort}/${lang}] ${u.email} (${r.data?.id})`);
    await new Promise(res => setTimeout(res, 600)); // stay under Resend's rate limit
  }
  console.log(`\ndone: ${sent} sent, ${failed} failed`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
