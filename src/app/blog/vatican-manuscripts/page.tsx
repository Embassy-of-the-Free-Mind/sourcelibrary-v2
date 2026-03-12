import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Inside the Vatican Stacks: 11 Greek Manuscripts and What They Actually Contain - Blog - Source Library',
  description: 'Burning mirrors, dream divination, a palimpsest hiding Genesis beneath Inquisition confessions. We OCR\'d 3,600 pages of Vatican Greek manuscripts and found the working library of the Byzantine world.',
  openGraph: {
    title: 'Inside the Vatican Stacks',
    description: 'Burning mirrors, dream divination, a palimpsest hiding Genesis beneath Inquisition confessions. 11 Greek manuscripts from the Vatican Library.',
    images: [{ url: 'https://digi.vatlib.it/iiifimage/MSS_Vat.gr.191/Vat.gr.191_0257_fa_0117r.jp2/full/1200,/0/default.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/vatican-manuscripts',
  },
};

export default function VaticanManuscriptsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Inside the Vatican Stacks"
          subtitle="11 Greek manuscripts and what they actually contain"
        >
          <p className="text-stone-400 text-sm mt-4">12 March 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The Vatican Library holds roughly 80,000 manuscripts. The <a href="https://digi.vatlib.it/" className="text-accent-rust hover:underline">DigiVatLib</a> project has been digitizing them since 2013, producing high-resolution IIIF images of thousands of codices. We recently imported a batch of Greek manuscripts and ran OCR across 3,600 pages. What emerged wasn&rsquo;t what the catalog shelfmarks suggested.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          A bare shelfmark &mdash; &ldquo;Vat.gr.218&rdquo; or &ldquo;Barb.gr.147&rdquo; &mdash; tells you nothing about what&rsquo;s inside. Vatican manuscripts are identified by collection and number, not by title. Many are miscellanies: a single codex might bind together texts from different centuries, different authors, different disciplines. The only way to know what&rsquo;s in them is to read them. Here&rsquo;s what we found.
        </p>

        {/* --- Anthemius --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Architect of Hagia Sophia on Burning Mirrors
        </h2>

        <div className="my-8">
          <a href="https://sourcelibrary.org/book/anthemius-of-tralles-on-paradoxical-machines-vat-gr-218">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://digi.vatlib.it/iiifimage/MSS_Vat.gr.218/Vat.gr.218_0090_fa_0041v.jp2/full/800,/0/default.jpg"
              alt="Geometric diagram from Vat.gr.218 showing optical constructions"
              className="w-full max-w-lg mx-auto rounded-lg shadow-md"
            />
          </a>
          <p className="text-muted text-sm text-center mt-2">Vat.gr.218, f.41v &mdash; geometric diagram from Anthemius&rsquo;s treatise on burning mirrors</p>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/anthemius-of-tralles-on-paradoxical-machines-vat-gr-218" className="text-accent-rust hover:underline">Vat.gr.218</a></strong> contains a treatise by <strong>Anthemius of Tralles</strong> (c. 474&ndash;534), the architect Justinian chose to build Hagia Sophia. Before he designed one of the most ambitious structures in history, Anthemius wrote <em>On Paradoxical Machines</em> &mdash; a work on the construction of burning mirrors and parabolic reflectors.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The manuscript is dense with geometric diagrams: conic sections, ray-tracing, the mathematics of focusing sunlight into a point intense enough to ignite wood at a distance. Anthemius was working in the tradition of Archimedes&rsquo;s legendary burning mirrors at Syracuse &mdash; but his approach is practical engineering, not legend. He explains how to construct compound mirrors from flat segments arranged on a parabolic surface, with precise angle calculations.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The 432-page codex is one of the key witnesses to the Byzantine transmission of ancient optics. It sits in the Vatican because, like so many Greek manuscripts, it migrated westward after the fall of Constantinople in 1453.
        </p>

        {/* --- Synesius --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Hypatia&rsquo;s Student on Dream Divination
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/aristotle-organon-codex-ottobonianus-graecus-86-aristotle" className="text-accent-rust hover:underline">Ott.gr.86</a></strong> contains <strong>Synesius of Cyrene</strong>&rsquo;s <em>De Insomniis</em> (On Dreams), a 4th-century Neoplatonic treatise on the philosophical significance of dreams. Synesius was one of the last students of <strong>Hypatia of Alexandria</strong> &mdash; the philosopher and mathematician murdered by a Christian mob in 415 CE.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Before Synesius became bishop of Ptolemais (reluctantly, and on the condition that he could keep his wife and his Neoplatonic philosophy), he wrote this treatise arguing that dreams are a universal form of divination accessible to anyone &mdash; unlike oracles, which require temples and priests. Dreams, he argued, arise from the <em>phantastikon</em>, the faculty of imagination, which mediates between the soul and the sensible world.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          It&rsquo;s a remarkable text: a Christian bishop defending dream divination using Neoplatonic metaphysics, written by a student of the most famous pagan philosopher of late antiquity. The 478-page manuscript also contains catechetical homilies, placing pagan philosophy and Christian instruction side by side in the same codex.
        </p>

        {/* --- Palimpsest --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Genesis Hidden Under Inquisition Confessions
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/corpus-hermeticum-codex-vaticanus-graecus-2306-trismegistus" className="text-accent-rust hover:underline">Vat.gr.2306</a></strong> is a palimpsest &mdash; a manuscript where the original text has been scraped away and overwritten with something new. The undertext is Greek Septuagint: the books of Genesis and Exodus. The upper text, written over those erased biblical passages, consists of Latin Inquisition abjuration documents from the pontificate of Paul V (early 17th century).
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The juxtaposition is striking. Someone in papal Rome took a Greek biblical manuscript &mdash; centuries old, copied by hand &mdash; and recycled the parchment to record the formal confessions of people brought before the Holy Office. The words of Genesis literally lie beneath forced recantations of heresy. It&rsquo;s the kind of object that makes you understand why manuscript studies isn&rsquo;t just philology but material history.
        </p>

        {/* --- Math compendium --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          An 842-Page Encyclopedia of Ancient Mathematics
        </h2>

        <div className="my-8">
          <a href="https://sourcelibrary.org/book/strabo-geography-codex-vaticanus-graecus-191-strabo?page=257">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://digi.vatlib.it/iiifimage/MSS_Vat.gr.191/Vat.gr.191_0257_fa_0117r.jp2/full/800,/0/default.jpg"
              alt="Geometric diagrams from Vat.gr.191"
              className="w-full max-w-lg mx-auto rounded-lg shadow-md"
            />
          </a>
          <p className="text-muted text-sm text-center mt-2">Vat.gr.191, f.117r &mdash; geometric diagrams from the mathematical compendium</p>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/strabo-geography-codex-vaticanus-graecus-191-strabo" className="text-accent-rust hover:underline">Vat.gr.191</a></strong> is the largest manuscript in this batch at 842 pages. It&rsquo;s a comprehensive codex assembling the major works of ancient Greek mathematics and astronomy into a single volume: <strong>Euclid</strong>, <strong>Theodosius</strong>&rsquo;s <em>Spherics</em>, <strong>Hypsicles</strong>, <strong>Autolycus</strong>, <strong>Eutocius</strong>&rsquo;s commentaries on Archimedes, <strong>Ptolemy</strong>, <strong>Proclus</strong>&rsquo;s <em>Sphaera</em>, commentaries on <strong>Aratus</strong>&rsquo;s <em>Phaenomena</em>, and <strong>Hipparchus</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Most striking for Source Library&rsquo;s purposes: the codex includes <strong>Vettius Valens</strong>&rsquo;s astrological <em>Anthology</em>, a 2nd-century text that is one of the most important surviving works of Hellenistic astrology. Its presence here, bound between Euclid and Ptolemy, reflects the ancient understanding that astrology was a branch of mathematical science, not a separate domain.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          This manuscript is an important witness to the <strong>Byzantine transmission of ancient exact sciences</strong>. It shows how medieval Greek scholars organized knowledge &mdash; what they considered a coherent intellectual package. Mathematics, astronomy, and astrology were parts of the same curriculum.
        </p>

        {/* --- Medical codex --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Galen on Diagnosing Disease from Dreams
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/galen-on-the-natural-faculties-codex-vaticanus-graecus-283-galen" className="text-accent-rust hover:underline">Vat.gr.283</a></strong> is a Greek medical codex binding together works by <strong>Galen</strong> and <strong>Hippocrates</strong>, with commentary by <strong>Philo the Physician</strong>. The Hippocratic texts are standard medical works: the <em>Prognostics</em>, <em>Prorrhetics</em>, and <em>Aphorisms</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The Galenic text is more unusual: <em>On Diagnosis from Dreams</em>, a short treatise arguing that dreams provide clinical information about the patient&rsquo;s physical state. Galen didn&rsquo;t mean this mystically. He argued that during sleep, when external stimuli are reduced, the body&rsquo;s internal signals &mdash; inflammation, imbalances of the humors &mdash; manifest as dream imagery. Fire in a dream suggests fever; water suggests excess phlegm. It&rsquo;s an early theory of psychosomatic feedback, binding medicine and dream interpretation into a single diagnostic framework.
        </p>

        {/* --- The miscellanies --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Byzantine Miscellanies: What Medieval Libraries Looked Like
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The remaining manuscripts are miscellanies &mdash; codices that bundle together texts from different authors and periods. This was the norm in the Byzantine world. Parchment was expensive. A scribe or patron commissioning a manuscript would fill it with whatever texts they considered useful or interesting, creating bespoke anthologies.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/diogenes-laertius-lives-of-the-eminent-philosophers-codex-laertius" className="text-accent-rust hover:underline">Reg.gr.80</a></strong> pairs <strong>Aristotle</strong>&rsquo;s <em>Parva Naturalia</em> (short treatises on sense perception, memory, and dreams) with <strong>Maximus the Confessor</strong>&rsquo;s <em>Ambigua</em> &mdash; 7th-century theological interpretations of Gregory of Nazianzus. Aristotelian empirical psychology bound alongside Byzantine mystical theology.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/marcus-aurelius-meditations-codex-vaticanus-graecus-12-aurelius" className="text-accent-rust hover:underline">Vat.gr.12</a></strong> is a 14th-century educational codex: excerpts from <strong>Pythagoras</strong>, <strong>Isocrates</strong>, grammar lessons, rhetorical exercises, definitions, ethical maxims. A window into the Byzantine classroom &mdash; what a student in Constantinople was expected to read.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong><a href="https://sourcelibrary.org/book/porphyry-works-codex-vaticanus-graecus-2181-porphyry" className="text-accent-rust hover:underline">Vat.gr.2181</a></strong> juxtaposes mystical philosophical treatises on &ldquo;true philosophy&rdquo; as a spiritual path with fragments of <strong>Aristophanes</strong> and treatises on poetic metrics. Comedy and contemplation in the same binding.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Two manuscripts document the <strong>Hesychast controversy</strong>, one of the most intense theological crises in Byzantine history. <strong><a href="https://sourcelibrary.org/book/dionysius-areopagita-opera-codex-vaticanus-graecus-573-areopagite" className="text-accent-rust hover:underline">Vat.gr.573</a></strong> contains hagiographic texts alongside polemics related to Barlaam of Calabria and Gregory Akindynos. <strong><a href="https://sourcelibrary.org/book/magical-and-astrological-texts-reg-lat-1228-various" className="text-accent-rust hover:underline">Reg.lat.1228</a></strong> collects treatises debating divine essence versus divine energies, with texts connected to Gregory of Nyssa and St. Basil. These documents record the 14th-century fight over whether monks could directly experience God&rsquo;s uncreated light through contemplative prayer &mdash; a debate that permanently shaped Orthodox theology.
        </p>

        {/* --- What miscellanies tell us --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What These Codices Tell Us
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Modern libraries organize books by subject. Medieval libraries didn&rsquo;t work that way. A codex was assembled by a person with specific interests, and the combinations reveal intellectual worlds.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The person who compiled Vat.gr.191 saw no boundary between geometry and astrology. The scribe of Reg.gr.80 saw Aristotle&rsquo;s empirical treatises on sensation and Maximus the Confessor&rsquo;s mystical theology as belonging to the same conversation about human experience. The codex that holds Synesius&rsquo;s pagan dream theory alongside Christian catechism reflects a late antique world where those categories hadn&rsquo;t hardened into oppositions.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          These aren&rsquo;t famous classical texts. They&rsquo;re the working library of the Byzantine intellectual world: teaching anthologies, scientific compendia, theological dossiers, practical handbooks. They survive because someone in Constantinople or Rome thought they were worth copying, binding, and keeping. Twelve hundred years later, they&rsquo;re still worth reading.
        </p>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed mb-4">
          <strong>Browse the manuscripts:</strong> All 11 codices are available with full-page images and OCR transcription. Several have partial English translations in progress.
        </p>

        <ul className="text-muted text-sm leading-relaxed space-y-1 mb-4">
          <li><a href="https://sourcelibrary.org/book/anthemius-of-tralles-on-paradoxical-machines-vat-gr-218" className="text-accent-rust hover:underline">Vat.gr.218</a> &mdash; Anthemius of Tralles, <em>On Paradoxical Machines</em> (432 pages)</li>
          <li><a href="https://sourcelibrary.org/book/aristotle-organon-codex-ottobonianus-graecus-86-aristotle" className="text-accent-rust hover:underline">Ott.gr.86</a> &mdash; Synesius of Cyrene, <em>On Dreams</em> (478 pages)</li>
          <li><a href="https://sourcelibrary.org/book/strabo-geography-codex-vaticanus-graecus-191-strabo" className="text-accent-rust hover:underline">Vat.gr.191</a> &mdash; Mathematical and Astronomical Compendium (842 pages)</li>
          <li><a href="https://sourcelibrary.org/book/galen-on-the-natural-faculties-codex-vaticanus-graecus-283-galen" className="text-accent-rust hover:underline">Vat.gr.283</a> &mdash; Galen and Hippocrates, Medical Compendium (161 pages)</li>
          <li><a href="https://sourcelibrary.org/book/corpus-hermeticum-codex-vaticanus-graecus-2306-trismegistus" className="text-accent-rust hover:underline">Vat.gr.2306</a> &mdash; Biblical Palimpsest with Inquisition Documents (197 pages)</li>
          <li><a href="https://sourcelibrary.org/book/iamblichus-de-vita-pythagorica-codex-barberinianus-graecus-iamblichus" className="text-accent-rust hover:underline">Barb.gr.147</a> &mdash; Pseudo-Aristotle, <em>Problemata</em> (420 pages)</li>
          <li><a href="https://sourcelibrary.org/book/diogenes-laertius-lives-of-the-eminent-philosophers-codex-laertius" className="text-accent-rust hover:underline">Reg.gr.80</a> &mdash; Aristotle&rsquo;s Parva Naturalia + Maximus the Confessor (148 pages)</li>
          <li><a href="https://sourcelibrary.org/book/marcus-aurelius-meditations-codex-vaticanus-graecus-12-aurelius" className="text-accent-rust hover:underline">Vat.gr.12</a> &mdash; Byzantine Teaching Miscellany (262 pages)</li>
          <li><a href="https://sourcelibrary.org/book/porphyry-works-codex-vaticanus-graecus-2181-porphyry" className="text-accent-rust hover:underline">Vat.gr.2181</a> &mdash; Philosophical and Literary Miscellany (209 pages)</li>
          <li><a href="https://sourcelibrary.org/book/dionysius-areopagita-opera-codex-vaticanus-graecus-573-areopagite" className="text-accent-rust hover:underline">Vat.gr.573</a> &mdash; Hesychast Controversy Documents (392 pages)</li>
          <li><a href="https://sourcelibrary.org/book/magical-and-astrological-texts-reg-lat-1228-various" className="text-accent-rust hover:underline">Reg.lat.1228</a> &mdash; Hesychast Theological Treatises (110 pages)</li>
        </ul>

        <p className="text-muted text-sm leading-relaxed">
          All images from the <a href="https://digi.vatlib.it/" className="text-accent-rust hover:underline">Vatican Library Digital Repository</a> (DigiVatLib), made available under their open access policy.
        </p>

      </article>

      <BlogComments slug="vatican-manuscripts" />
    </ContentPageLayout>
  );
}
