import Link from 'next/link';
import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Our Vision — A Letter from the Founder | Source Library',
  description:
    'A letter from Source Library founder Derek Lomas on bringing the ancient wisdom of every civilization into the age of AI — and a brief plan for the institution we are building.',
  alternates: { canonical: '/vision' },
};

const HERO_IMAGE = 'https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg';
const PICO_QUOTE_URL =
  '/book/ioannis-pici-mirandulae-omnia-opera-mirandola/page/695906974953388fe7ac6d15';
const CONTACT_EMAIL = 'derek@sourcelibrary.org';

// A brief plan — the work ahead and the resources it asks for.
const PLAN = [
  { work: 'Translate 250,000+ more ancient works', resource: '$1M' },
  { work: 'Scan 50,000+ works that have never been online', resource: '$3M' },
  { work: 'Partner with 1,000+ libraries and archives worldwide', resource: '$2M' },
  { work: 'Convene a braintrust of linguists and scholars', resource: '$2M' },
  { work: 'Build a technical foundation that will last', resource: '$1M' },
  { work: 'Gatherings, expeditions, a small full-time team, and support for partner libraries', resource: '$6M' },
];

export default function VisionPage() {
  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader
          maxWidth="wide"
          title="Bringing ancient wisdom into the future"
          subtitle="A letter from Derek Lomas, founder of Source Library"
          image={HERO_IMAGE}
          imageAlt="Historical illustration from the Bibliotheca Philosophica Hermetica"
        />
      }
      bg="bg-cream"
    >
      {/* ───────────── THE LETTER ───────────── */}
      <article className="font-body text-[1.0625rem] md:text-lg text-secondary leading-[1.8] max-w-[68ch]">

        <p className="font-serif italic text-muted mb-8">Amsterdam, June 2026</p>

        <p className="mb-6">Dear friend,</p>

        <p className="mb-6">
          The first Renaissance began with an act of translation. When a small circle in
          fifteenth-century Florence brought Plato and the Hermetic writings out of Greek into
          Latin, they set loose ideas that reshaped a civilization. Throughout history, the
          recovery of ancient works has consistently sparked humanity&rsquo;s most profound and
          enduring insights.
        </p>

        <p className="mb-6">
          And yet the Renaissance itself was mostly written in Latin, and{' '}
          <strong className="text-primary">less than 3% of it has ever been translated into
          English</strong>. The rest can be read only by specialists. Beyond it lie thousands
          upon thousands of texts in Chinese, Sanskrit, Arabic, Hebrew, Egyptian, and more &mdash;
          and most of this heritage is missing from the data that trains today&rsquo;s AI.
        </p>

        <p className="mb-6">
          I find that worth pausing on. As we enter an uncertain age, a strong foundation in
          wisdom &mdash; and the preservation of our full inheritance &mdash; has never felt more
          pressing. Maybe, just maybe, translating the world&rsquo;s ancient wisdom could make a
          global AI renaissance more likely than an AI apocalypse. Perhaps that is magical
          thinking. But what is magic, anyway? I went looking in our own library, and found a
          lovely answer from Pico della Mirandola.
        </p>

        {/* Pico pull-quote */}
        <figure className="my-12 pl-8 border-l-2 border-accent-rust">
          <blockquote className="font-serif italic text-2xl md:text-[1.625rem] text-primary leading-snug">
            &ldquo;Magic is the absolute consummation of natural philosophy.&rdquo;
          </blockquote>
          <figcaption className="mt-4 text-sm tracking-wide uppercase text-muted">
            <Link href={PICO_QUOTE_URL} className="hover:text-accent-rust underline">
              Giovanni Pico della Mirandola &mdash; read it at the source
            </Link>
          </figcaption>
        </figure>

        <p className="mb-6">
          That is the whole idea behind Source Library: to go back to the source, and to make
          it possible for anyone &mdash; any reader, any scholar, any AI &mdash; to do the same.
          Today it is the world&rsquo;s largest library of translated ancient texts. We have
          translated more than <strong className="text-primary">15,000 books</strong> from over
          fifty languages, more than half of them into English for the first time. Our word
          count has already passed English Wikipedia. Every translation sits beside the original
          scanned page, so any line can be verified, quoted, and trusted. It is almost entirely
          free, Creative Commons share-alike, and open by API and MCP &mdash; so that the AI you
          use can reach for the actual source.
        </p>

        <p className="mb-6">
          We are embedded within one of the world&rsquo;s great collections of ancient texts: the{' '}
          <a
            href="https://embassyofthefreemind.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-rust hover:underline"
          >
            Embassy of the Free Mind
          </a>{' '}
          in Amsterdam, home to the Bibliotheca Philosophica Hermetica, a UNESCO &ldquo;Memory of
          the World&rdquo; rare-book library. Source Library was created with the support of the
          Wisdom Frontiers Society of La Jolla, California, and is run as an open initiative of
          the Embassy, a Dutch nonprofit with 501(c)(3) status.
        </p>

        <p className="mb-6">
          Everything so far has been made possible by a handful of generous people who believed
          in the work early. Now I want to build something lasting &mdash; a world-class humanist
          institution devoted to the stewardship of ancient wisdom, from books to oral histories
          to expeditions in the field. The wisdom, after all, is more than the books. If any of
          this resonates with you, I would be glad to hear from you.
        </p>

        <p className="mb-4">With gratitude,</p>

        {/* Signature */}
        <div className="flex items-center gap-4">
          <img
            src="/founder-derek.jpg"
            alt="James Derek Lomas, PhD — Founder, Source Library"
            width={72}
            height={72}
            className="w-[72px] h-[72px] rounded-full object-cover border border-primary/15 shadow-sm shrink-0"
          />
          <div>
            <div className="text-primary font-serif text-lg font-semibold leading-tight">
              Derek Lomas, PhD
            </div>
            <div className="text-muted text-sm tracking-wide mt-1">
              Founder, Source Library &middot; Embassy of the Free Mind
            </div>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-accent-rust hover:underline text-sm"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </article>

      {/* ───────────── THE PLAN ───────────── */}
      <section className="mt-24 max-w-[68ch]">
        <h2 className="font-serif text-2xl md:text-3xl text-primary leading-snug mb-3">
          A brief plan
        </h2>
        <p className="text-secondary leading-relaxed mb-8">
          Over the next five years we aim to grow Source Library into a permanent institution.
          We are seeking roughly <strong className="text-primary">$15&nbsp;million</strong> in
          philanthropic support to make it possible. Here is the work, and what each part of it
          asks for.
        </p>

        <dl className="divide-y divide-primary/10 border-y border-primary/10">
          {PLAN.map((item) => (
            <div
              key={item.work}
              className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-1 sm:gap-8 py-4 items-baseline"
            >
              <dt className="text-secondary leading-relaxed">{item.work}</dt>
              <dd className="font-serif text-primary text-lg sm:text-right whitespace-nowrap">
                {item.resource}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-muted text-sm leading-relaxed mt-6">
          These figures are illustrative of the scale of the work, not a fixed budget. Beyond the
          translations and scanning, the resources sustain people: gatherings that bring the
          community together, expeditions to gather and preserve materials, a small full-time
          team, and direct support for partner libraries around the world.
        </p>
      </section>

      {/* ───────────── INVITATION / CTA ───────────── */}
      <section className="mt-20 max-w-[68ch] border-t border-primary/10 pt-12">
        <h2 className="font-serif text-2xl md:text-3xl text-primary leading-snug mb-4">
          Join us
        </h2>
        <p className="text-secondary leading-relaxed mb-8">
          Source Library is entirely supported by personal donors. We are convening a circle of
          founding donors to anchor the institution &mdash; and we welcome gifts of every size,
          tax-deductible in the US and the Netherlands.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/founding-donors"
            className="inline-block bg-accent-rust text-white py-3 px-8 rounded-full hover:bg-accent-rust/90 transition-colors text-base font-medium text-center"
          >
            Become a founding donor
          </Link>
          <Link
            href="/support"
            className="inline-block bg-white border border-primary/20 text-primary py-3 px-8 rounded-full hover:border-accent-rust hover:text-accent-rust transition-colors text-base font-medium text-center"
          >
            Make a gift
          </Link>
        </div>
        <p className="mt-6 text-sm text-muted">
          For major gifts or corporate sponsorship, write to me directly at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-rust hover:underline">
            {CONTACT_EMAIL}
          </a>
          . I read every message.
        </p>
      </section>
    </ContentPageLayout>
  );
}
