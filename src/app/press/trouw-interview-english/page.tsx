import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const TROUW_URL =
  'https://www.trouw.nl/religie-filosofie/derek-lomas-ik-hoop-dat-we-met-positieve-ai-een-nieuwe-renaissance-kunnen-bewerkstelligen~b4dbb20f/';

export const metadata: Metadata = {
  title: "Trouw interview: 'A new renaissance' — Source Library",
  description:
    'An English guide to the Dutch interview with Derek Lomas in Trouw, 14 August 2026, on Positive AI, Ficino, and the Source Library.',
  // Unlisted: reachable by link, kept out of search and out of the sitemap.
  robots: { index: false, follow: true },
  // The article itself belongs to Trouw — point search engines at their page.
  alternates: { canonical: TROUW_URL },
};

export default function TrouwInterviewPage() {
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={
        <ContentHeader
          maxWidth="narrow"
          title="&lsquo;I hope that with positive AI we can bring about a new renaissance&rsquo;"
          subtitle="Derek Lomas interviewed in Trouw — an English guide to the Dutch original"
        />
      }
    >
      <div className="prose prose-slate max-w-none">
        <p className="lead">
          <a href={TROUW_URL} rel="noopener">
            Read the original article at trouw.nl &rarr;
          </a>
          <br />
          <span className="text-sm text-muted">
            In Dutch. Interview by Anniek van den Brand, published 14 August 2026 in the series
            &lsquo;Vrije geesten&rsquo; (Free spirits). Photographs by Sander Troelstra.
          </span>
        </p>

        <h2>What the interview covers</h2>
        <p>
          Derek Lomas is an assistant professor of Positive AI at{' '}
          <a href="https://www.tudelft.nl" rel="noopener">TU Delft</a> and program director of{' '}
          <Link href="/">Source Library</Link>. The interview was recorded in the attic of the{' '}
          <a href="https://embassyofthefreemind.com" rel="noopener">Embassy of the Free Mind</a> in
          Amsterdam, home of the Bibliotheca Philosophica Hermetica.
        </p>
        <p>
          It moves between three subjects. The first is Positive AI itself — the question of how
          psychology and design can be applied to AI systems so that they serve human well-being,
          learning, and the sense of beauty — illustrated by Smart Paper, a handwriting-assessment
          project used three times a year to evaluate the math and language skills of five million
          students in India.
        </p>
        <p>
          The second is Renaissance philosophy.{' '}
          <Link href="/author/giovanni-pico-della-mirandola">Pico della Mirandola</Link> supplies the
          argument that human beings alone are given the ability to shape themselves, and with it a
          responsibility that extends to what we build.{' '}
          <Link href="/author/marsilio-ficino">Marsilio Ficino</Link>, who translated the complete
          works of <Link href="/author/plato">Plato</Link> in the fifteenth century, supplies the
          model for what Source Library is attempting: an estimated 90 percent of Latin texts from
          the Renaissance have never been translated into a modern language, and Ficino&rsquo;s own
          philosophical writing was among them.
        </p>
        <p>
          The third is harmony. Lomas discusses the{' '}
          <Link href="/author/pythagoras">Pythagorean</Link> conviction that the universe is built
          on mathematical ratios — the same ratios that govern musical intervals — and his current
          research into how harmony and resonance might inform the design of better AI systems. The
          article closes with a response from Wouter Hanegraaff, professor of the history of
          Hermetic philosophy at the University of Amsterdam, who shares the hope but presses the
          point that every translation is an interpretation, and that reading these texts well
          requires historical knowledge that is now rarely taught.
        </p>

        <h2>In his words</h2>
        <blockquote>
          <p>
            &ldquo;To make AI work for you, you have to have a good idea first. If you don&rsquo;t
            know what you want, AI is really hard to use.&rdquo;
          </p>
        </blockquote>
        <blockquote>
          <p>
            &ldquo;I wanted to use AI to unlock mysteries, to see connections that language barriers
            had kept hidden.&rdquo;
          </p>
        </blockquote>
        <blockquote>
          <p>
            &ldquo;I hope for a new renaissance. The printing press made it possible for
            philosophers and writers to communicate with all of Europe. That&rsquo;s exactly what we
            can do now with AI.&rdquo;
          </p>
        </blockquote>

        <h2>What the interview points to</h2>
        <ul>
          <li>
            <Link href="/">Source Library</Link> — more than 15,000 books in over 55 languages,
            six thousand of them never previously translated into English, shown with the original
            text alongside the translation.
          </li>
          <li>
            <a href="https://embassyofthefreemind.com" rel="noopener">Embassy of the Free Mind</a> —
            the Bibliotheca Philosophica Hermetica in Amsterdam: over 25,000 books on alchemy,
            Hermetica, Kabbalah, Rosicrucians, astrology, natural philosophy and the pre-modern
            roots of science, inscribed in the UNESCO Memory of the World register.
          </li>
          <li>
            Authors discussed: <Link href="/author/marsilio-ficino">Marsilio Ficino</Link>,{' '}
            <Link href="/author/giovanni-pico-della-mirandola">Pico della Mirandola</Link>,{' '}
            <Link href="/author/plato">Plato</Link>,{' '}
            <Link href="/author/pythagoras">Pythagoras</Link>.
          </li>
        </ul>

        <hr />

        <p className="text-sm text-muted">
          The interview is the work of Anniek van den Brand and is © Trouw; the photographs are ©
          Sander Troelstra. This page summarizes and quotes briefly, with the full article at{' '}
          <a href={TROUW_URL} rel="noopener">trouw.nl</a>. A complete English translation exists and
          can be published here once Trouw and the photographer have given permission.
        </p>
      </div>
    </ContentPageLayout>
  );
}
