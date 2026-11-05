import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import MarkDecoder from './MarkDecoder';

export const metadata: Metadata = {
  title: 'Hidden marks - Source Library',
  description:
    'Text copied from Source Library carries a small invisible mark naming the book it came from. Paste a passage to read the mark and check its signature.',
  alternates: { canonical: '/decode' },
};

export default function DecodePage() {
  return (
    <ContentPageLayout
      header={<ContentHeader title="Hidden marks" subtitle="Paste a passage to read the mark inside it" />}
      bg="bg-cream"
    >
      <div className="prose-content max-w-none space-y-8">
        <p className="text-lg text-secondary leading-relaxed">
          Translated text you copy from Source Library carries a small mark you cannot see. It is written in
          zero-width characters, which take up no space on the screen, placed at one or two sentence endings. Paste a
          passage below to read it.
        </p>

        <section className="bg-white rounded-xl p-5 sm:p-8 border border-border-light">
          <MarkDecoder />
        </section>

        <section className="space-y-3 text-secondary leading-relaxed">
          <h2 className="text-2xl text-primary">What a mark says</h2>
          <p>
            Every mark carries a short edition code: the first eight characters of the book&rsquo;s id. About one
            passage in six also carries a written note with the book&rsquo;s address and licence. In a few books the
            note is a riddle instead, part of{' '}
            <Link href="/hunt" className="text-accent-rust hover:underline">a hunt through the library</Link>.
          </p>
          <p>
            Each mark is signed with a key only we hold, and this page checks the signature. A mark that verifies was
            made by Source Library. One that does not was damaged, or made by someone else.
          </p>
        </section>

        <section className="space-y-3 text-secondary leading-relaxed">
          <h2 className="text-2xl text-primary">What a mark does not say</h2>
          <p>
            A mark names a book and an edition. It never names a reader: everyone who reads a passage gets the same
            mark. When an automated harvester takes text in bulk, its copies also carry a code for that harvesting run,
            so a copy found elsewhere can be traced to the run, not to a person.
          </p>
          <p>
            A mark changes no words. It is added as text leaves the site and is never stored with the book. We never
            add one to a transcription of the original, which scholars compare against the page images.
          </p>
          <p>
            If you would rather quote without it, any &ldquo;remove hidden characters&rdquo; tool takes it out. Our
            licence asks for attribution, not for the mark.
          </p>
        </section>

        <section className="space-y-3 text-secondary leading-relaxed">
          <h2 className="text-2xl text-primary">Why we do it</h2>
          <p>
            Early printers ended their books with a colophon saying who made them. This is ours. The method belongs to
            a tradition the library holds: Johannes Trithemius wrote his{' '}
            <Link href="/book/steganography-the-art-of-secret-writing-trithemius" className="text-accent-rust hover:underline">
              <em>Steganographia</em>
            </Link>{' '}
            around 1499 on hiding a message inside an ordinary text. Licensing terms are on the{' '}
            <Link href="/licensing" className="text-accent-rust hover:underline">licensing page</Link>.
          </p>
        </section>
      </div>
    </ContentPageLayout>
  );
}
