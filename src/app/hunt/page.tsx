import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import HuntForm from './HuntForm';

export const metadata: Metadata = {
  title: 'The hunt - Source Library',
  description:
    'Some of the hidden marks in text copied from Source Library carry a riddle. Each answer is on a page of another book in the library.',
  alternates: { canonical: '/hunt' },
};

export default function HuntPage() {
  return (
    <ContentPageLayout
      header={<ContentHeader title="The hunt" subtitle="Seven riddles, seven pages, eight old books" />}
      bg="bg-cream"
    >
      <div className="prose-content max-w-none space-y-8">
        <section className="space-y-3 text-lg text-secondary leading-relaxed">
          <p>
            Text copied from Source Library carries a small{' '}
            <Link href="/decode" className="text-accent-rust hover:underline">hidden mark</Link>. In a few books, the
            mark carries a riddle instead of the usual note. The answer to each riddle is written on a page of another
            book in the library, and that book carries the next riddle.
          </p>
          <p>
            To start, copy passages from the library&rsquo;s books on secret writing and paste them into the{' '}
            <Link href="/decode" className="text-accent-rust hover:underline">decoder</Link>. Not every passage carries
            a note, so try several.
          </p>
        </section>

        <section className="bg-white rounded-xl p-5 sm:p-8 border border-border-light">
          <HuntForm />
        </section>

        <section className="space-y-3 text-secondary leading-relaxed">
          <h2 className="text-2xl text-primary">How it works</h2>
          <p>
            You need no account. Your progress stays in this browser. Answers are a word or a number; capitals, accents
            and spaces do not matter. Every answer is printed on the page the riddle points to, so read the page itself:
            the scan or the transcription, in its own language or in translation.
          </p>
          <p>
            When you have solved all seven you can sign the{' '}
            <Link href="/hunt/solvers" className="text-accent-rust hover:underline">list of solvers</Link>.
          </p>
        </section>
      </div>
    </ContentPageLayout>
  );
}
