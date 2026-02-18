import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import VolunteerForm from '@/components/contribute/VolunteerForm';

export const metadata: Metadata = {
  title: 'Participate - Source Library',
  description: 'Join the Embassy of the Free Mind. Help digitize, translate, and study rare texts from the Western esoteric tradition.',
  alternates: {
    canonical: '/contribute',
  },
};

export default function ParticipatePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Participate"
          subtitle="This is a living project. There are many ways to be part of it."
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library is an open project of the Embassy of the Free Mind. We&apos;re building a worldwide community around these texts &mdash; scholars, seekers, developers, and anyone drawn to the Western esoteric tradition. If you want to help, reach out. I&apos;m happy to work with you to find the right way in.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Ways to contribute
        </h2>

        <div className="space-y-8 mb-16">
          <div>
            <h3 className="font-semibold text-primary mb-2">Read and correct translations</h3>
            <p className="text-secondary">
              Every book has an AI translation alongside the original text. These translations are first drafts &mdash; useful but imperfect. If you read Latin, German, Arabic, Hebrew, or another source language, your corrections are enormously valuable. Just open a book and edit any page.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-primary mb-2">Annotate and add context</h3>
            <p className="text-secondary">
              You can highlight passages, leave notes, and add references on any page. Scholarly context, cross-references to other texts, or even personal reflections &mdash; all of it enriches the collection for future readers.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-primary mb-2">Suggest books</h3>
            <p className="text-secondary">
              We import from 13 digital archives including the Internet Archive, Gallica, the Bodleian, and the Vatican Library. If you know of a text that belongs here &mdash; an alchemical treatise, a Hermetic manuscript, an early Kabbalistic work &mdash; let me know and I&apos;ll add it.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-primary mb-2">Publish your research</h3>
            <p className="text-secondary">
              Our <Link href="/blog" className="underline text-amber-700 hover:text-amber-600">blog</Link> features essays on the texts in our collection. If you&apos;ve written something &mdash; a paper, a close reading, a thematic exploration &mdash; we&apos;d love to feature it. It doesn&apos;t need to be formal; it just needs to be thoughtful.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-primary mb-2">Form a research group</h3>
            <p className="text-secondary">
              If you lead a seminar, a study group, or a research project that works with texts in our collection, we want to support you. We&apos;re developing tools for groups to work together inside the library &mdash; shared annotations, curated reading paths, collective translation review.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-primary mb-2">Process pages</h3>
            <p className="text-secondary">
              If you&apos;re technical, you can use your own Gemini API key to OCR or translate pages directly.
              Every page you process becomes permanently free for the world.{' '}
              <Link href="/contribute/process" className="underline text-amber-700 hover:text-amber-600">
                Start here
              </Link>.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-primary mb-2">Build with the API</h3>
            <p className="text-secondary">
              Source Library has a REST API and an MCP server for AI assistants.
              Search the collection, fetch translations, and build tools on top of 2,500 years of primary sources.{' '}
              <Link href="/developers" className="underline text-amber-700 hover:text-amber-600">
                Developer docs
              </Link>.
            </p>
          </div>
        </div>

        {/* Volunteer Form */}
        <div className="mb-16">
          <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-3">
            Volunteer
          </h2>
          <p className="text-secondary mb-6">
            We&apos;re especially looking for readers of Latin, Greek, Arabic, Hebrew, and other classical languages to help evaluate and improve our AI translations. But all skills are welcome. Tell us about yourself and we&apos;ll find the right fit.
          </p>
          <VolunteerForm />
        </div>

        {/* Contact */}
        <div className="bg-stone-800 text-white rounded-xl p-8 md:p-10 mb-12">
          <h2 className="text-2xl md:text-3xl mb-4">
            Or just email
          </h2>
          <p className="text-stone-300 leading-relaxed mb-6">
            Prefer to write directly? Tell me what you&apos;re interested in, what you&apos;re working on, or what you&apos;d like to see in the collection. I respond to everything.
          </p>
          <a href="mailto:derek@ancientwisdomtrust.org" className="text-lg text-white font-medium hover:text-amber-300 transition-colors">
            derek@ancientwisdomtrust.org
          </a>
        </div>

        {/* Principles - brief */}
        <div className="border-t border-border-light pt-8">
          <p className="text-secondary text-sm leading-relaxed">
            Everything in Source Library is CC0 public domain. No paywalls, no login walls. AI translations are first drafts, and the originals are always preserved alongside them. Published editions carry DOIs via Zenodo, so your contributions are citable scholarship.
          </p>
        </div>
      </div>
    </ContentPageLayout>
  );
}
