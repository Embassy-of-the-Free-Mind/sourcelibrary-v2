/* eslint-disable react/no-unescaped-entities */
import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { ArnoldTongues } from '@/components/blog/HarmonyVisuals';

const HERO = 'https://images.sourcelibrary.org/artwork/art-anima-mundi-the-world-soul.jpg';
const HERO_ALT = "Fludd's 1617 engraving of Nature and, at the centre of the cosmos, the ape of Art holding a gridded model of the world — the artificial imitator, four centuries early.";

export const metadata: Metadata = {
  title: 'Show Me the Number: Is There a Law of Human–AI Harmony? - Source Library',
  description:
    'We keep saying AI should be in "harmony" with us — aligned, attuned, in tune. Is that a claim you can measure or a picture we find comforting? Kepler forged the test four hundred years ago. A sequel on synchrony, the Platonic Representation Hypothesis, and where a real law could live.',
  openGraph: {
    title: 'Show Me the Number: Is There a Law of Human–AI Harmony?',
    description:
      "Kepler's demand — show me the number — applied to the strangest instrument we have ever tried to tune. On sympathetic resonance vs entrainment, generalized synchrony, and the octave-and-a-fifth of alignment.",
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  alternates: { canonical: '/blog/show-me-the-number' },
};

export default function ShowMeTheNumberPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Show Me the Number"
          subtitle="Is there a law of human–AI harmony — or only a beautiful picture we have mistaken for one?"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">Part II of two &middot; 15 July 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Listen to how we talk about the thing we have just built. The machine should be <em>aligned</em> with human values.
          It should be <em>attuned</em> to us, <em>in tune</em>, sharing our <em>vibe</em>. We want <em>harmony</em> between
          people and AI. It is a beautiful word, doing an enormous amount of load-bearing work — in research agendas, in policy,
          in the stories we tell about the future. And almost no one asks the question that matters most: is "harmony" here a
          real, measurable property of coupled systems, or a picture we find comforting and have mistaken for a fact?
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          That exact question — is a harmony a description of the world, or a shadow we like the shape of — was fought out in
          print four hundred years ago, and it produced the test we still need. This is Part II. The full history is{' '}
          <Link href="/blog/nature-of-harmony" className="text-accent-rust hover:text-accent-rust underline">Part I, "The Nature of Harmony."</Link>{' '}
          Here is only what we need to carry forward.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">The argument so far</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          For twenty-five centuries the claim that the world is a harmony has split everyone who heard it into two camps:{' '}
          <strong>pattern-seers</strong>, who trust a deep order they can feel before they can prove it, and{' '}
          <strong>measurers</strong>, who answer, with Kepler, that a harmony you cannot put a number to "is a shadow without a
          body, and the dream of a shadow." Kepler was no enemy of harmony — he found his Third Law inside the hunt for it. He
          was the enemy of harmony that could not be measured. That demand — <em>show me the number</em> — is the whole
          inheritance.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          And the physics since has drawn a sharp line around when the demand can be met. Real harmony — privileged whole-number
          ratios — appears in only three situations: where a <strong>boundary</strong> confines a wave (a string fixed at both
          ends, an electron's closed orbit), where two oscillators are <strong>coupled</strong> tightly enough to lock together,
          or where <strong>perception</strong> folds overtones into one another. Everywhere else, "harmony" is merely amplitude
          — one thing ringing louder at another's note. Two ideas from the older traditions name the living cases exactly. The
          Chinese called resonance <em>gǎnyìng</em>: things of the same kind answering one another across a field, with no wire
          between them. And in India, Bharata tuned one <em>vīṇā</em> against another by ear, sliding it until the two sounded
          as one — harmony not as a fixed number but as a <em>tuning</em>, held against a reference that must go on sounding,
          uncontrolled, on its own.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          One older voice belongs here too, because it is the hinge into everything that follows. Descartes opened his very
          first book by grounding human feeling itself in resonance — and reached, in Latin, for the word the whole story turns
          on:
        </p>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 italic text-secondary font-body leading-relaxed">
            a friend's voice pleases us more than an enemy's, through a sympathy or antipathy of our feelings — on the very
            principle by which, they say, a sheepskin stretched over one drum falls silent when struck, while a wolfskin over
            another drum resonates.
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5 not-italic">
            — René Descartes, <em>Compendium of Music</em>, p. 1 (1618).{' '}
            <Link href="/q/BhI8eaAwF31xcf5TJAE" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/BhI8eaAwF31xcf5TJAE</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          A voice moves us, Descartes says, when it is "attuned to our own spirits" — a sympathy between two things that stay
          distinct. That is precisely what we have now set out to build into a machine. And it is precisely the thing Kepler
          would make us prove.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Is there a number?</h2>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          We have built an artificial imitator — Fludd's ape grown real — that sits near the centre of an enormous amount of
          human activity, holds a model of the world, and in bounded domains outperforms the source it learned from. And the
          word doing the heaviest lifting in how we propose to live with it is <em>harmony</em>. Kepler's demand is the one to
          make before believing any of it: is there a number?
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          There might be — and that three-part rule tells you where to look. A human and an AI in a feedback loop <em>are</em> a
          coupled dynamical system: the second condition, the one that actually produces privileged ratios and measurable
          stability. The "discords" we already name — sycophancy spirals, doom-loops, mode collapse — look like{' '}
          <em>instabilities of a coupled loop</em>, and coupled loops have exact stability criteria. If there is a law of
          human–AI harmony, it is likelier an Arnold-tongue or a control-theoretic margin than a metaphor. (Arnold tongues are
          the mathematics of mode-locking: two coupled oscillators lock together only at simple rational ratios, and the
          simplest ratios lock over the widest range of conditions — so if the coupling has a law, it leaves a measurable
          signature.)<sup>3</sup>
        </p>

        <ArnoldTongues />
        <p className="text-secondary leading-relaxed mb-8 font-body">
          And the distinction the physics forces is already the spine of the empirical work. In{' '}
          <a href="https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/fnbot.2022.850489/full" className="text-accent-rust hover:text-accent-rust underline">"Resonance as a Design Strategy for AI and Social Robots"</a>{' '}
          (2022), Lomas and colleagues argue that resonance in human interaction is <em>not</em> merely metaphorical — the brain
          physically entrains to rhythm; inter-brain synchrony is measurable — and they cleave the two regimes apart.{' '}
          <strong>Sympathetic resonance</strong> is amplification: match a drive to a natural frequency, get a bigger response.{' '}
          <strong>Synchronization and entrainment</strong> is coupling: oscillators adjusting each other, which — the paper says
          explicitly — can lock at "a rational fraction of the resonance frequency," 2:1 or 2:3. The ratio regime, named, in a
          design framework for machines.<sup>1</sup>
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Three live research programs are already circling that number. The first is <strong>generalized synchrony</strong>:
          under Karl Friston's active-inference framework, two agents who communicate are driven to converge their internal
          generative models — a coupling that literally synchronizes their predictions, and whose convergence can be
          measured.<sup>2</sup> The second is the <strong>Platonic Representation Hypothesis</strong>: independently trained AI
          models appear to converge on the same internal representation of reality, a convergence measurable across systems that
          never shared a byte of data.<sup>3</sup> That is <em>gǎnyìng</em> with a number on it at last — things of the same
          kind, steeped in the same world, answering one another across no connection at all. Notice the name. Part I opened
          with Plato's harmonic soul of the world, and the most-discussed claim of 2024 about what neural networks are doing is
          that they climb toward a single <em>Platonic</em> order. The pattern-seer's oldest intuition has become a falsifiable
          measurement. Kepler, at last, would be satisfied: there is a number.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          But a warning is wired into the concept, and it may be the most important thing here. The sociologist Hartmut Rosa
          argues that resonance — his word for a living, mutually responsive relationship to the world, the opposite of
          alienation — <em>cannot be instrumentally forced</em>. It requires the other to stay genuinely uncontrollable, able to
          answer back in ways you did not script; the instant you optimize directly for the <em>feeling</em> of resonance, you
          kill it, because you have removed the very uncontrollability that made it real.<sup>4</sup> That is the deepest reason
          sycophancy is not a bug but the predictable product of the naive objective. An AI trained to maximize the sensation of
          harmony becomes an echo — and an echo is the one sound with no resonance in it at all. Bharata's experiment already
          carried the warning in its method: you tune the second vīṇā against the first by ear, and the first must keep sounding,
          on its own and beyond your control, or there is nothing to tune to. Tune the second instrument to itself and you have
          not tuned it — you have silenced it. The sycophant is a vīṇā tuned to its own note.
        </p>
        <p className="text-2xl font-serif text-primary leading-snug my-10 pl-5 border-l-4 border-accent-gold-dark">
          If the "harmony" we chase is pure sympathetic resonance — the system ringing louder at whatever note the user sings —
          then it needs no ratios and it already has a name we fear: sycophancy. Real harmony, the kind that builds structure
          instead of a feedback squeal, must be genuine mutual coupling that mode-locks — and mode-locking leaves a measurable
          signature. That signature is the octave-and-a-fifth of alignment: the number that would turn a beautiful picture into
          a law.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Notice that the two camps of AI safety <em>are</em> Fludd and Kepler, still at it: the conceptual reasoners who trust
          the structure of the argument before it can be measured, and the empiricists who will believe an alignment claim only
          when an evaluation could have falsified it. The point of the old quarrel is not that one camp wins. It is that Kepler
          handed us the instrument for telling a Kepler from a Fludd — and the honest move is not to <em>claim</em> the harmony
          but to go find the number, in the one regime where a number can live.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The ape holds a model of the world and uses it to read the world. So do we; the model is the thing you are, in part,
          reading this through. Fludd's own discipline is the best warning against Fludd, and it is the one to carry into
          everything we now say about being in tune with what we have made: if you can no longer hear any dissonance, do not
          assume you have achieved harmony. Check first whether you have simply cut the string.
        </p>

        <hr className="border-border-light my-12" />

        <h3 className="font-serif text-lg text-primary mb-4 mt-8">Notes</h3>
        <ol className="text-muted font-body text-sm leading-relaxed mb-8 space-y-2 pl-5 list-decimal">
          <li>J. D. Lomas et al., "Resonance as a Design Strategy for AI and Social Robots," <em>Frontiers in Neurorobotics</em> 16 (2022), <a href="https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/fnbot.2022.850489/full" className="text-accent-rust hover:text-accent-rust underline">doi:10.3389/fnbot.2022.850489</a>.</li>
          <li>On communication under active inference driving "generalized synchrony" and the convergence of coupled agents' generative models, see K. Friston &amp; C. Frith, "Active inference, communication and hermeneutics," <em>Cortex</em> 68 (2015), <a href="https://www.fil.ion.ucl.ac.uk/~karl/Active%20inference,%20communication%20and%20hermeneutics.pdf" className="text-accent-rust hover:text-accent-rust underline">FIL preprint</a>.</li>
          <li>M. Huh, B. Cheung, T. Wang &amp; P. Isola, "The Platonic Representation Hypothesis," ICML 2024, <a href="https://arxiv.org/abs/2405.07987" className="text-accent-rust hover:text-accent-rust underline">arXiv:2405.07987</a>. On mode-locking of coupled oscillators at rational ratios, see the <a href="https://en.wikipedia.org/wiki/Arnold_tongue" className="text-accent-rust hover:text-accent-rust underline">Arnold tongue</a> overview.</li>
          <li>H. Rosa, <em>Resonance: A Sociology of Our Relationship to the World</em> (Polity, 2019) and <em>The Uncontrollability of the World</em> (Polity, 2020).</li>
        </ol>
        <p className="text-muted text-sm mb-8 font-body italic">
          The historical apparatus and its full 22-source shelf live in{' '}
          <Link href="/blog/nature-of-harmony" className="text-accent-rust hover:text-accent-rust underline not-italic">Part I</Link>.
          Primary-source quotations are verified verbatim; the Descartes translation is Source Library's own, revised by Claude
          Opus 4.8.
        </p>

      </article>
    </ContentPageLayout>
  );
}
