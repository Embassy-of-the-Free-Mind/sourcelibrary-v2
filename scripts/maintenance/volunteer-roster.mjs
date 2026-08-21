/**
 * Everything we already know about the people who offered to help, in one place.
 *
 * WHY THIS EXISTS. We ask volunteers about themselves in three places and store
 * the answers in three collections, then read none of them together:
 *
 *   volunteers          the /contribute form — name, email, languages, interests,
 *                       message. Measured 2026-08-05: 184 rows, of which ONE has
 *                       a message and ONE has interests. Nearly empty.
 *   users.profile       the /welcome form — aboutYou, preferredLanguage,
 *                       helpDescription. This is where the content actually is:
 *                       133 of the 184 wrote how they want to help.
 *   feedback            the "I'd like to help" tick box, with whatever they were
 *                       writing about at the time.
 *
 * The lesson is not "collect more". It is that the volunteer form asks for
 * languages nobody fills in, because those people already answered the same
 * question on /welcome. Before asking anyone anything again, read this.
 *
 * NEVER re-ask what someone already told us, and never show them a blank form
 * over the top of their answers — see memory lesson_welcome_blank_form_overwrites_answers.
 *
 *   node scripts/maintenance/volunteer-roster.mjs                 # summary
 *   node scripts/maintenance/volunteer-roster.mjs --language=es    # who reads Spanish
 *   node scripts/maintenance/volunteer-roster.mjs --language=es --emails
 *   node scripts/maintenance/volunteer-roster.mjs --full           # everything they wrote
 *
 * Emails are printed only with --emails, so a casual run does not spray
 * addresses into a terminal buffer or a paste.
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const EMAILS = args.includes('--emails');
const langArg = (args.find(a => a.startsWith('--language=')) || '').split('=')[1] || null;

const LANG_PATTERNS = {
  es: /espa|spanish|castellano/i,
  en: /english|ingl/i,
  de: /german|deutsch|alem/i,
  fr: /french|fran/i,
  it: /italian|italiano/i,
  nl: /dutch|nederlands|holand/i,
};

const norm = e => (e || '').trim().toLowerCase();

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const vols = await db.collection('volunteers')
  .find({}, { projection: { email: 1, name: 1, languages: 1, interests: 1, message: 1, created_at: 1, contacted: 1 } })
  .sort({ created_at: 1 }).toArray();

const emails = vols.map(v => norm(v.email)).filter(Boolean);
const users = await db.collection('users')
  .find({ email: { $in: emails } }, { projection: { email: 1, name: 1, profile: 1 } }).toArray();
const byEmail = new Map(users.map(u => [norm(u.email), u]));

const helpers = await db.collection('feedback')
  .find({ wants_to_help: true }, { projection: { email: 1, message: 1, created_at: 1 } }).toArray();
const helperByEmail = new Map();
for (const h of helpers) if (h.email) helperByEmail.set(norm(h.email), h);

const people = vols.map(v => {
  const u = byEmail.get(norm(v.email));
  const p = u?.profile || {};
  const h = helperByEmail.get(norm(v.email));
  const language = (p.preferredLanguage || '').trim() ||
    (Array.isArray(v.languages) && v.languages.length ? v.languages.join(', ') : '');
  return {
    name: (v.name || u?.name || '').trim() || '(no name)',
    email: norm(v.email),
    signedUp: v.created_at?.toISOString?.().slice(0, 10) || '?',
    contacted: v.contacted === true,
    hasAccount: !!u,
    language,
    about: (p.aboutYou || '').trim(),
    help: (p.helpDescription || '').trim() || (v.message || '').trim(),
    saidViaFeedback: (h?.message || '').trim(),
  };
});

const filtered = langArg
  ? people.filter(p => (LANG_PATTERNS[langArg] || new RegExp(langArg, 'i')).test(p.language))
  : people;

console.log(`volunteers: ${people.length}   |   with an account: ${people.filter(p => p.hasAccount).length}`);
console.log(`stated a language: ${people.filter(p => p.language).length}`);
console.log(`told us how they want to help: ${people.filter(p => p.help).length}`);
console.log(`we know NOTHING beyond an email: ${people.filter(p => !p.language && !p.about && !p.help).length}`);
console.log(`already contacted: ${people.filter(p => p.contacted).length}`);

if (langArg) console.log(`\n--- matching language "${langArg}": ${filtered.length} ---`);

const show = FULL || langArg ? filtered : filtered.slice(0, 10);
for (const p of show) {
  console.log(`\n${p.name}${EMAILS ? `  <${p.email}>` : ''}${p.contacted ? '  [contacted]' : ''}`);
  console.log(`  signed up ${p.signedUp}${p.language ? `  ·  reads: ${p.language}` : ''}`);
  if (p.about) console.log(`  about: ${p.about.replace(/\s+/g, ' ').slice(0, FULL ? 400 : 150)}`);
  if (p.help) console.log(`  wants to: ${p.help.replace(/\s+/g, ' ').slice(0, FULL ? 400 : 150)}`);
  if (p.saidViaFeedback) console.log(`  also wrote: ${p.saidViaFeedback.replace(/\s+/g, ' ').slice(0, 150)}`);
}
if (!FULL && !langArg && people.length > 10) console.log(`\n... and ${people.length - 10} more. --full for all, --language=es to filter.`);
if (!EMAILS) console.log('\n(emails hidden — pass --emails when you actually need to write to them)');

await client.close();
