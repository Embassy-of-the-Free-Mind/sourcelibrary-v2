import { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import GiveForm from '@/components/donate/GiveForm';
import { defaultRouteForCountry } from '@/lib/give-routes';

/**
 * The short path to giving: the ask and the case for it on one page, no database.
 *
 * This is the header's "Donate" destination and the target for any printed QR
 * code, which is why the URL is one word. `/support` still exists and still
 * makes the longer case — it mounts the same <GiveForm> so the two can't drift.
 *
 * Layout: on a wide screen the form sits beside the case and stays in view; on a
 * phone the headline and form come first and the case follows, so nobody has to
 * scroll past an argument to reach the button.
 *
 * The case is the vision letter's (src/app/articles/vision/content.ts) in short:
 * the Renaissance began with a translation, most of it is still untranslated, and
 * a gift joins the project of reading all of it. The corpus figures (STATS, the
 * metadata, storage, words) are measured 2026-10-29 and match /ai-partners: books
 * held with page scans, excluding duplicates, takedowns and the catalogue-only
 * records of the October import wave (#7343). The vision letter's budget still
 * rests on its 6 October counts (93,000 / 73,000); re-cost it before changing
 * the letter.
 * The per-book figure is the BUDGET rate, $5 a book (the vision letter's `ways`
 * intro), never the model cost of one pass (under a dollar a book, priced at the
 * subscription), which would tell a donor the work is nearly free. Derek, 2026-10-29.
 *
 * NO DATA FETCHING, deliberately. Every other surface can degrade; the page that
 * takes money cannot.
 * The only server work is reading the request country to pick a default route,
 * which cannot fail: an unknown country is a valid answer (defaultRouteForCountry).
 *
 * No `openGraph` block here on purpose. Defining one would REPLACE the root
 * layout's entire openGraph object including its images, shipping a card with no
 * image at all — the failure that hit three surfaces in one day (PRs #3149/
 * #3151/#3152). Inheriting the root block is correct until this page earns a
 * bespoke card, which would then also need its own `twitter.images`.
 */

export const metadata: Metadata = {
  title: 'Donate | Source Library',
  description:
    'Join the largest historical translation project in history: 110,000 scanned books waiting to be read, free for everyone. Give in two taps, US tax-deductible or international.',
  alternates: { canonical: '/give' },
};

// Apian's eclipse dial, the Astronomicum Caesareum (1540), whose first English
// translation is on the site. Checked by eye 2026-10-29.
const FEATURE_IMAGE =
  'https://images.sourcelibrary.org/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg';
const FEATURE_BOOK = '/book/6990688d249ce014347d6e76';

const STATS = [
  { value: '131,000', label: 'books in over fifty languages' },
  { value: '20,000', label: 'already readable in translation' },
  { value: '110,000', label: 'scanned and waiting to be read' },
];

const BUILDS = [
  {
    title: 'Every book we hold, readable',
    text: 'Latin, Greek, Arabic, Hebrew, Chinese, Sanskrit, Tibetan: 110,000 books are scanned and catalogued, and no one can read them yet. Your gift moves them into English.',
  },
  {
    title: 'A living archive',
    text: 'Translations are re-read as the models improve, checked by scholars language by language, and corrected by a community of readers. It gets better every year instead of going stale.',
  },
  {
    title: 'Open to everyone, for good',
    text: 'Free to read and quote, every line beside the page it came from, and open to the AI assistants people already use, so they cite the source instead of guessing.',
  },
  {
    title: 'Toward a million books',
    text: 'Then the wider record: the millions of volumes scanned by libraries worldwide that nobody can read, and the Embassy’s own books that exist in no other collection.',
  },
];

// Fields a paid scholar would take on first. Each links to the shelf they would
// review, so a donor can see the books behind the ask.
const SCHOLAR_FIELDS = [
  {
    title: 'Hermetica and Renaissance Latin',
    href: '/collections/hermetica',
    text: 'Ficino’s Latin Hermes, Pico, the Neoplatonists: the texts the Renaissance was built on.',
  },
  {
    title: 'Alchemy',
    href: '/collections/alchemy',
    text: 'Technical Latin and German, where one wrong word turns a recipe into nonsense.',
  },
  {
    title: 'Kabbalah',
    href: '/collections/kabbalah',
    text: 'Hebrew and Christian Kabbalah, where a translation has to keep the letters as well as the sense.',
  },
  {
    title: 'Maya writing',
    href: '/collections/maya',
    text: 'Codices and inscriptions read glyph by glyph, in a script deciphered only in living memory.',
  },
];

const link = 'text-accent-rust hover:text-accent-gold-dark underline underline-offset-2';

export default async function GivePage() {
  // Vercel resolves the visitor's country at the edge. Absent locally and on any
  // non-Vercel host, which the default handles.
  const country = (await headers()).get('x-vercel-ip-country');

  return (
    <div className="min-h-screen bg-[#f6f3ee] flex flex-col">
      <SiteHeader variant="light" />

      <main className="flex-1 px-6 py-10 md:py-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_26rem] gap-10 lg:gap-14 items-start">
          {/* Headline: first on every screen */}
          <div className="lg:col-start-1 lg:row-start-1">
            <h1 className="text-3xl md:text-4xl font-display text-stone-900 mb-4 leading-tight">
              The last time the world translated its ancient wisdom, it sparked
              the Renaissance
            </h1>
            <p className="text-lg text-stone-700 leading-relaxed mb-4">
              When Marsilio Ficino put ancient wisdom texts into Latin, the ideas
              lit up Europe. Yet most of the Renaissance itself has never been
              translated. Of a random sample of 1,000 Latin works printed between
              1480 and 1620, searched with AI help, 93 percent have no English
              translation, and the share is higher still in Arabic, Chinese, Sanskrit
              and Tibetan. At the pace
              of human translation, it would take ten thousand years.
            </p>
            <p className="text-lg text-stone-700 leading-relaxed">
              Source Library is doing it now, in the open, free for everyone. Your
              gift makes you part of the largest translation project in history.
            </p>
          </div>

          {/* The form: second on a phone, a sticky right column on a wide screen */}
          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6">
            <GiveForm defaultRoute={defaultRouteForCountry(country)} surface="give" />
            <p className="mt-4 text-xs text-stone-500 leading-relaxed">
              Source Library is a project of the{' '}
              <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>
                Embassy of the Free Mind
              </a>{' '}
              in Amsterdam, home of the Bibliotheca Philosophica Hermetica.
            </p>
          </div>

          {/* The case */}
          <div className="lg:col-start-1 lg:row-start-2 space-y-10">
            <dl className="grid grid-cols-3 gap-4 border-y border-stone-300 py-5">
              {STATS.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="font-display text-2xl md:text-3xl text-stone-900">{s.value}</dd>
                  <dd className="text-xs md:text-sm text-stone-600 leading-snug mt-1">{s.label}</dd>
                </div>
              ))}
            </dl>

            <figure className="grid grid-cols-[7rem_1fr] sm:grid-cols-[10rem_1fr] gap-5 items-start">
              <Link href={FEATURE_BOOK} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={FEATURE_IMAGE}
                  alt="A hand-coloured paper dial with a green dragon coiled around its centre, from Apian's Astronomicum Caesareum"
                  width={1983}
                  height={2803}
                  className="w-full h-auto shadow-md"
                />
              </Link>
              <figcaption className="text-stone-700 leading-relaxed">
                <p className="font-display text-xl text-stone-900 mb-1">The Emperor&rsquo;s Astronomy</p>
                <p className="text-sm text-stone-500 mb-3">Peter Apian, Ingolstadt, 1540</p>
                <p className="text-sm mb-3">
                  Apian printed paper dials that turn on silk threads, so a reader
                  could work out eclipses and the planets&rsquo; positions without
                  tables. The dragon marks where the Moon&rsquo;s path crosses the
                  Sun&rsquo;s. Written in Latin for Charles V, it had no English
                  translation until this one.
                </p>
                <Link href={FEATURE_BOOK} className={`text-sm ${link}`}>
                  Read it free
                </Link>
              </figcaption>
            </figure>

            <section>
              <h2 className="text-xl font-display text-stone-900 mb-4">What your gift builds</h2>
              <ul className="space-y-4">
                {BUILDS.map((u) => (
                  <li key={u.title} className="border-l-2 border-accent-rust pl-4">
                    <p className="font-semibold text-stone-900">{u.title}</p>
                    <p className="text-stone-600 leading-relaxed">{u.text}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* Where the money goes: three things a gift pays for, each with a cost
                someone measured, plus the $5-a-book budget rate (see the file comment).
                - Running cost: billed amounts, not meter estimates (ops
                  costs/infrastructure-costs.md): hosting, database, CDN and storage
                  ran $3,600–5,200 a month June–September 2026, before any OCR or
                  translation; R2 held 22.3 TB at the end of August. Words are from
                  scripts/analytics/corpus-size.mjs (2026-10-29 log row: 7.65B, median
                  floor 5.23B, against ~5B for English Wikipedia), so the comparison
                  holds even on the floor; re-run it before changing them.
                - Scholars and scanning: the vision letter's budget
                  (src/app/articles/vision/content.ts, `plan` and `ways`): $150K over
                  five years for scholars, €70 / €400 per scan, adoption from $275.
                  Change them THERE first. */}
            {/* The scholars' fund gets its own block because it is the ask with the
                most leverage: the one cost the machines cannot lower. No scholar is
                named here until they have agreed to the role; a name on a donation
                page reads as their endorsement. */}
            <section className="rounded-lg border border-stone-300 bg-white/60 p-6 md:p-8">
              <p className="text-xs uppercase tracking-widest text-accent-rust mb-2">The scholars’ fund</p>
              <h2 className="text-2xl font-display text-stone-900 leading-snug mb-3">
                Put the experts on the page
              </h2>
              <p className="text-stone-700 leading-relaxed mb-3">
                A machine translation is a draft until someone who reads the original has
                checked it. The people who can do that are few: historians of esotericism who
                read Ficino’s Latin, specialists in alchemical German, epigraphers who read
                Maya glyphs. So far every check has been done by volunteers.
              </p>
              <p className="text-stone-700 leading-relaxed mb-6">
                We want to pay them. A scholar takes responsibility for a field, reads the
                translations against the originals, and corrects them; their corrections go
                straight back into the text, and the core works become editions with a DOI
                that anyone can cite.
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {SCHOLAR_FIELDS.map((f) => (
                  <li key={f.title} className="border-l-2 border-accent-gold/40 pl-4">
                    <Link href={f.href} className="font-semibold text-stone-900 hover:text-accent-rust">
                      {f.title}
                    </Link>
                    <p className="text-sm text-stone-600 leading-relaxed">{f.text}</p>
                  </li>
                ))}
              </ul>
              <p className="text-stone-800 leading-relaxed">
                <strong>$30,000 a year</strong> starts the first fields. To fund a scholar
                in a field you care about,{' '}
                <a
                  href="mailto:derek@sourcelibrary.org?subject=The%20scholars%E2%80%99%20fund"
                  className={link}
                >
                  write to Derek
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-display text-stone-900 mb-4">Where the rest goes</h2>
              <ul className="space-y-5">
                <li>
                  <p className="font-semibold text-stone-900">Translating a book: about $5</p>
                  <p className="text-stone-600 leading-relaxed">
                    A single machine pass now costs under a dollar a book. We budget $5 so
                    that every book is re-read as better models arrive, the hard scripts get
                    special handling, and scholars can check the results.
                  </p>
                </li>
                <li>
                  <p className="font-semibold text-stone-900">Scanning the Embassy’s last books</p>
                  <p className="text-stone-600 leading-relaxed">
                    The Embassy of the Free Mind still has about 3,000 books to scan. Scanning
                    one costs about €70; a fragile volume on the slow scanner, about €400. From
                    $275 you can{' '}
                    <a
                      href="mailto:derek@sourcelibrary.org?subject=Adopt%20a%20book"
                      className={link}
                    >
                      adopt one
                    </a>
                    : it is scanned, translated and named for you.
                  </p>
                </li>
                <li>
                  <p className="font-semibold text-stone-900">Keeping it open</p>
                  <p className="text-stone-600 leading-relaxed">
                    About $50,000 a year, before a single page is translated: the servers, the
                    database, and storage for 32 terabytes of scans, nearly 30 million pages.
                    The library already holds more text than English Wikipedia: 7.7 billion
                    words, half in the original languages and half in English. Wikipedia and the
                    Internet Archive stay free because their readers pay for them. This library
                    can too.
                  </p>
                </li>
              </ul>
            </section>

            <div className="text-sm text-stone-500 leading-relaxed space-y-2">
              <p>
                The whole plan, costs and all, is in{' '}
                <Link href="/articles/vision" className={link}>the five-year vision</Link>.
              </p>
              <p>
                Giving through a business, or becoming a sponsor?{' '}
                <Link href="/support" className={link}>More ways to support the library</Link>.
              </p>
              <p>
                Not everyone gives money; some give time.{' '}
                <Link href="/contribute" className={link}>Help as a translator, reviewer or volunteer</Link>.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
