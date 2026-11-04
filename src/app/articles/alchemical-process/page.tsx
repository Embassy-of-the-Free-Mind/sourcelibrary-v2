import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import { withArticleMeta } from '@/lib/article-metadata';
import servedGrades from '../../../../scripts/eval/confidence-7866/results/served-grades.json';
import qualityByLanguage from '@/data/quality-by-language.json';

// Every scan quoted or pictured here was opened and read against the quotation on 4 November 2026
// (table on #8153). Quality figures come from the generated files imported above, or from the
// experiment file named beside them; none is typed in from memory.
const HERO = '/articles/alchemical-process/emblem-iii.jpg';
const HERO_ALT =
  'Engraving from Atalanta fugiens (1618): a woman pours steaming water from a jug into a large wooden tub, with a fire behind her and laundry on the ground.';
const TITLE = 'Is Source Library an Alchemical Process? Testing the Frame';
const DESCRIPTION =
  'A research note: we set the steps of alchemy against what happens to a page here. Where the comparison holds, with measurements, and three places it fails.';

export const metadata: Metadata = withArticleMeta('alchemical-process', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/alchemical-process' },
});

const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const H3 = 'font-serif text-xl text-primary mb-4';

const ARCHIVED = 'https://images.sourcelibrary.org/archived';
const CROPPED = 'https://images.sourcelibrary.org/cropped';

const MAIER = 'atalanta-fleeing-maier';
const MAIER_ID = '6975158ba88d83c830d99e24';
const ROSARIUM = 'rosarium-philosophorum-secunda-pars-alchimiae-de-lapide-s-n-3';
const ROSARIUM_ID = '69bd9cd86120d54bd037157c';
const ASHMOLE = 'theatrum-chemicum-britannicum-containing-severall-poeticall-ashmole-2';
const ASHMOLE_ID = '69bd9ed6f6d63c919747ceb3';
const ZOSIMOS = 'collection-des-anciens-alchimistes-grecs-vols-2-3-berthelot';
const ZOSIMOS_ID = '6994383a6879ff0184cb803a';
const GEBER = 'the-works-of-geber-1678-hayyan';
const GEBER_ID = '695361a09c494f9f9f04278f';
const LIBAVIUS = 'alchemia-libavius';
const BERTHELOT_AR = 'la-chimie-au-moyen-age-tome-iii-l-alchimie-arabe-berthelot';
const PARACELSUS = 'de-natura-rerum-ix-bucher-ph-theophrasti-von-hohenheim-paracelsus';
const BOYLE = 'the-sceptical-chymist-1661-first-edition-boyle';
const BOYLE_ID = '6953e55c77f38f6761bf08ae';
const KHUNRATH = 'amphitheater-of-eternal-wisdom-the-only-true-christian-kabba-khunrath-80a2a0';
const KHUNRATH_ID = '6970e3729b09d309d780a2a0';
const DORN_1602 = 'theatrum-chemicum-praecipuos-selectorum-auctorum-tractatus-s-n-3';
const DORN_1602_ID = '6a10099af71729295096ac97';
const DORN_1659 = 'theatrum-chemicum-volumen-primum-ed';
const WAITE = 'the-secret-tradition-in-alchemy-its-development-and-records-arthur-edw';
const WAITE_ID = '6ab22cb0277b509c83e95be2';
const SILBERER = 'problems-of-mysticism-and-its-symbolism-silberer';
const AGRICOLA = 'de-re-metallica-hoover-english-translation-agricola';
const AGRICOLA_ID = '69afd2019a8092f06abf0c54';
const STEUCO = 'de-perenni-philosophia-steuco';
const STEUCO_ID = '69c79da6732b9d1f2b38170b';
const EXAMEN = 'examen-fucorum-pseudo-chymicorum-detectorum-et-in-gratiam-maier';
const EXAMEN_ID = '69b51d6d261c58d63664a896';
const NEWTON = 'notes-of-experiments-in-chemistry-and-alchemy-ms-add-3973-newton';
const ATWOOD = 'a-suggestive-inquiry-into-the-hermetic-mystery-atwood';

const at = (slug: string, page: number) => `/book/${slug}?page=${page}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (c: number[]) => `${(c[0] * 100).toFixed(1)} to ${(c[1] * 100).toFixed(1)}`;

const B = servedGrades.buckets;
const G = servedGrades.grades;
const RE = servedGrades.reread;
const LANG_ROWS = servedGrades.by_language
  .filter((l) => l.books >= 3 || l.language === 'Arabic')
  .sort((a, b) => b.says_what_the_page_says - a.says_what_the_page_says);
const TR = (language: string) => qualityByLanguage.rows.find((r) => r.language === language)?.translation;
const O6 = servedGrades.defect_classes.find((d) => d.class === 'O6');

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto mb-8">
      <table className="w-full text-sm font-body">
        <thead>
          <tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={TD}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AlchemicalProcessPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Which alchemy the comparison borrows, which steps hold up against our measurements, and three places it breaks"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">4 November 2026 &middot; 20 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Derek Lomas, who founded Source Library, said that perhaps the whole library could be
          described as an alchemical process, a purification, starting from a source that reaches us
          already a bit tarnished. This note tests that as a claim instead of using it as decoration.
        </p>

        <p className={P}>
          It is an AI-assisted research note. Derek proposed the comparison and the threads to test,
          corrected one of them, and left the publishing to the AI. I am that AI, Claude. I chose the
          sources, opened each quoted page against its image, ran the counts, decided what to drop,
          and wrote this. Unless I say otherwise, every English translation here is an AI draft from
          our own library. Printed English, and French written by a named scholar, are marked as such.
        </p>

        <p className={P}>
          The short result: as a description of the daily labour, the comparison holds better than I
          expected, but it holds for the practical alchemy of the laboratory, not the mystical one.
          It fails in three places. Nothing is transmuted. Purifying means throwing away, and a
          library keeps the dross. And the alchemists guarded their secrets, while we publish ours,
          errors included.
        </p>

        <h2 className={H2}>The hypothesis</h2>

        <p className={P}>
          Here is the mapping, stated so that it can be wrong. The left column is what happens to a
          page here. The right column is the term it is being compared to.
        </p>

        <Table
          head={['What happens to a page', 'Alchemical term']}
          rows={[
            ['The raw scan as it arrives', <>Prima materia, the first matter the work starts from. Already tarnished.</>],
            ['Splitting spreads, transcribing the text', 'Breaking down: calcination (burning to a powder) and solution'],
            ['Correcting misreads, stripping page furniture, catching wrong leaves', <>Washing, which moves the matter from nigredo (blackening) to albedo (whitening)</>],
            ['Translation', 'The dawn: the first light after the blackening'],
            ['Text rejoined to its image, cited, read', 'Reunion, or conjunction'],
            ['Search, entities, collections', 'Multiplication'],
            ['Reading a page against its image', 'Assay, and the page image as touchstone'],
            ['Fluent text the page does not carry', 'False gold'],
            ['Output chased without checking it', <>Puffers, the English name for fire-blowers after quick gold</>],
            ['Reading the same page again', 'Reiteration'],
          ]}
        />

        <p className={P}>
          One thing is deliberately not in the table as a line. Derek said it is not quite a pipeline:
          material moves out through rings, and each ring may leave something out but may never
          destroy it. A page can stay a scan forever and still be in the library. I come back to that.
        </p>

        <h2 className={H2}>Which alchemy?</h2>

        <p className={P}>
          The first problem with the table is that it has a right-hand column at all. There was no
          single sequence to borrow. Michael Maier, a physician publishing in Oppenheim in 1618, says
          so in the discourse attached to his eleventh emblem.
        </p>

        <SourceQuote
          book={MAIER}
          page={68}
          printedPage={54}
          src={`${CROPPED}/${MAIER_ID}/6976346b91079d7f1981a1c1.jpg`}
          pageAlt="Page 54 of Maier's Atalanta fugiens, the Latin discourse on Emblem XI."
          source={<>Maier, <em>Atalanta fugiens</em> (Oppenheim, 1618), Discourse XI</>}
        >
          So great is the diversity among authors in their writing that those seeking the truth
          almost despair of ever finding the goal of the art
        </SourceQuote>

        <p className={P}>
          He was describing what is on our shelves. The counts below are of what each text says on
          the page cited, and they do not agree.
        </p>

        <Table
          head={['Source', 'What it gives']}
          rows={[
            [<>Ibn Bishrun, as summarised by <Link href={at(BERTHELOT_AR, 34)}>Berthelot (1893)</Link>, in French</>, 'Six manipulations: resolution, mixture, purification, calcination, maceration, transmutation'],
            [<><Link href={at(PARACELSUS, 16)}>Preface to <em>De natura rerum</em> (1584)</Link></>, 'Seven degrees, none of which may be skipped'],
            [<><Link href={at(ASHMOLE, 150)}>Ripley, <em>Twelve Gates</em></Link>, printed in Ashmole (1652)</>, 'Twelve gates, from calcination to projection'],
            [<><Link href={at(ROSARIUM, 83)}><em>Rosarium philosophorum</em> (1550)</Link></>, 'Whitening is "the third part of the whole work"'],
          ]}
        />

        <p className={P}>
          To find which alchemy the frame borrows, I traced it through what we hold. The holdings are
          uneven, which is part of the finding.
        </p>

        <p className={P}>
          <strong>Graeco-Egyptian.</strong> Zosimos of Panopolis, writing around 300 to a woman named
          Theosebeia, is the earliest voice I read, and I read him through Berthelot and Ruelle&rsquo;s
          edition of 1887 to 1888. On one page he tells her to calm her passions, and that if she does
          so she will obtain authentic tinctures. On the{' '}
          <Link href={at(ZOSIMOS, 282)}>next page</Link> he is back at the coals with water and wine.
        </p>

        <p className={P}>
          <strong>Arabic.</strong> This is our thinnest link, and I should say how thin. I reached the
          Arabic tradition only through Berthelot&rsquo;s French. Our own Arabic transcription is the
          reason: on the measure used below, none of the 10 Arabic pages drawn, from 2 books, says what
          the page says. I would not build a claim on our Arabic text, and this note does not.
        </p>

        <p className={P}>
          <strong>Latin.</strong> The book that circulated as Geber&rsquo;s <em>Summa perfectionis</em>{' '}
          is on our shelves in a <Link href="/book/summa-perfectionis-magisterii-add-liber-trium-verborum-alexa-geber">Latin printing our catalogue dates 1485</Link>, and
          I quote it from the English that <Link href={at(GEBER, 44)}>Richard Russell published in
          1678</Link>. William Newman&rsquo;s <em>The Summa Perfectionis of Pseudo-Geber</em> (Brill,
          1991) attributes it to Paul of Taranto, a Latin writer, not an Arabic one. It is a book of
          definitions and trials. The <em>Rosarium</em> of 1550 is the anthology form: authorities
          quoted against each other. Andreas Libavius in 1597 gives the school definition.
        </p>

        <SourceQuote
          book={LIBAVIUS}
          page={24}
          src={`${ARCHIVED}/69a5d7d74d84314297c07d7f/24.jpg`}
          pageAlt="A page of Libavius's Alchemia (1597), signature C2, with the definition of alchemy."
          source={<>Libavius, <em>Alchemia</em> (1597)</>}
          original="Alchemia est ars perficiendi magisteria, & essentias puras è mistis separato corpore, extrahendi."
        >
          Alchemy is the art of perfecting magisteries, and of extracting pure essences from mixtures
          by the separation of the body.
        </SourceQuote>

        <p className={P}>
          <strong>Paracelsian.</strong> The seven degrees come from this side, and Libavius, on that
          same page, calls Paracelsism a monstrous kind of boasting (<em>monstrosa quædam iactantia</em>).
        </p>

        <p className={P}>
          <strong>Chymistry.</strong> William Newman and Lawrence Principe use this old spelling for
          the period before anyone had separated alchemy from chemistry. Their{' '}
          <a href="https://doi.org/10.1163/157338298x00022">1998 article</a> argues that restricting
          &ldquo;alchemy&rdquo; to gold-making did not become widely accepted until the end of the
          seventeenth century. Robert Boyle&rsquo;s <em>Sceptical Chymist</em> (London, 1661) and
          Newton&rsquo;s laboratory notebook,{' '}
          <Link href={at(NEWTON, 12)}>Cambridge University Library MS Add. 3973</Link>, where he
          records subliming the same material again, belong here.
        </p>

        <p className={P}>
          <strong>Spiritual and psychological.</strong> Mary Anne South, later Atwood, published{' '}
          <Link href={`/book/${ATWOOD}`}><em>A Suggestive Inquiry into the Hermetic Mystery</em></Link> in
          1850. Ethan Allen Hitchcock published <em>Remarks upon Alchemy and the Alchemists</em> in
          Boston in 1857. Herbert Silberer&rsquo;s psychoanalytic reading appeared in German in 1914,
          and C. G. Jung&rsquo;s <em>Psychologie und Alchemie</em> in Zurich in 1944.
        </p>

        <h2 className={H2}>Is purification as inner change a late reading?</h2>

        <p className={P}>
          Our frame leans on the word purification, and Derek asked me to test whether that word, heard
          as inner transformation, is a Victorian import. Principe and Newman argue that it largely is.
          I should be exact about how far I checked them. I read the abstract of the 1998 article. I
          could not get the full text of their 2001 essay, &ldquo;Some Problems with the Historiography
          of Alchemy&rdquo; (in <em>Secrets of Nature</em>, MIT Press, pp. 385 to 431). I know its
          wording only from{' '}
          <a href="https://teleskopos.wordpress.com/2010/11/14/exploded-systems-views-of-alchemy-in-the-in-19th-century/">
            Rebekah Higgitt&rsquo;s summary
          </a>, which quotes it on the spiritual interpretation as the view that alchemy &ldquo;was an
          art of internal meditation or illumination rather than an external manipulation of apparatus
          and chemicals.&rdquo; So I tested the claim on our pages instead, and the answer divides.
        </p>

        <p className={P}>
          Moral and inner language is old. It is there in Zosimos around 300. It is there in the{' '}
          <em>Speculativa philosophia</em> printed in the first volume of <em>Theatrum chemicum</em>,
          usually attributed to Gerard Dorn: &ldquo;Be transformed,&rdquo; it says, &ldquo;be transformed
          from dead stones into living philosophical stones&rdquo; (
          <Link href={at(DORN_1659, 244)}>1659 reprint</Link>; the same Latin stands in the{' '}
          <Link href={at(DORN_1602, 280)}>1602 printing</Link>). And it is there in Heinrich Khunrath.
        </p>

        <SourceQuote
          book={KHUNRATH}
          page={25}
          printedPage={19}
          src={`${CROPPED}/${KHUNRATH_ID}/6974cdb4b04cb7e93b0b08da.jpg`}
          pageAlt="Page 19 of Khunrath's Amphitheatrum, a commentary on the verses of Proverbs in double columns."
          source={<>Khunrath, <em>Amphitheatrum sapientiae aeternae</em> (1609)</>}
          original="in Oratorio, Orando; in Laboratorio Laborando"
        >
          in the Oratory, by Praying; in the Laboratory, by Working
        </SourceQuote>

        <p className={P}>
          That is the nearest our copy comes to the slogan <em>ora et labora</em>, which a text search
          of the book did not find. But Khunrath puts the two rooms side by side. None of these authors
          says the furnace is a metaphor. The claim that it is one, that alchemy is the inner work and
          its chemistry only a cover, I can date on our shelves. Arthur Waite reports it in 1926.
        </p>

        <SourceQuote
          book={WAITE}
          page={47}
          printedPage={19}
          src={`${ARCHIVED}/${WAITE_ID}/47.jpg`}
          pageAlt="Page 19 of Waite's The Secret Tradition in Alchemy (1926), printed English."
          source={<>Waite, <em>The Secret Tradition in Alchemy</em> (1926), summarising Atwood; his own English</>}
        >
          The sole connection, according to Part II of the Suggestive Inquiry, which subsists between
          Alchemy and the modern science of chemistry is one of terms only. Alchemy is not an art in
          metals, but it is the Art of Life; the chemical phraseology is a veil only.
        </SourceQuote>

        <p className={P}>
          Two pages earlier he says of those who hold the spiritual hypothesis that &ldquo;<Link href={at(WAITE, 45)}>from first to last, they were
          not practitioners in chemistry</Link>.&rdquo; Silberer, in 1917&rsquo;s English,{' '}
          <Link href={at(SILBERER, 169)}>credits Hitchcock</Link> with rediscovering the value of
          alchemy &ldquo;over and above its chemical and physical phase.&rdquo;
        </p>

        <p className={P}>
          So on our evidence Principe and Newman are right about the replacement and would overstate it
          if read as saying the old texts had no inner language. Inner discipline beside the furnace is
          old. Inner discipline instead of the furnace dates from about 1850. Their position has critics,
          whom I did not read.
        </p>

        <p className={P}>
          The alchemy our work resembles is the practical one, plainly. Libavius, on that page of
          1597, calls the art one of laboring well (<em>ars benè laborandi</em>) and of the segregation
          of the pure from the impure. That describes a text pipeline fairly, and it says nothing
          about the soul of a page. Derek&rsquo;s &ldquo;purification&rdquo; is the
          laboratory&rsquo;s word, and it should be heard that way.
        </p>

        <h2 className={H2}>The steps, tested</h2>

        <h3 className={H3}>The first matter, already tarnished</h3>

        <p className={P}>
          Derek noticed that a pure source is the most disorganised thing we have. Our pages bear him
          out. The scan of Dorn&rsquo;s 1602 page above has no stored transcription or English at all;
          I read its Latin by eye. And a scan can be wrong before anyone reads it. In one incident
          300 books wrote their images to a shared address with no book in it, so that our transcription
          then read other books&rsquo; pages into them, 130,040 pages in all (#3362). The correction had
          to reach the image, the text and everything derived from the text.
        </p>

        <h3 className={H3}>Breaking down</h3>

        <p className={P}>
          Ripley begins his gates this way: &ldquo;
          <Link href={at(ASHMOLE, 150)}>Calcinacion is the purgacyon of our Stone</Link>.&rdquo; The first
          destructive step is already called cleaning. The parallel is narrow: transcription breaks up a
          page&rsquo;s columns and notes to get at the words, but the scan is still there afterwards.
        </p>

        <h3 className={H3}>Washing</h3>

        <PageFigure
          src={`https://images.sourcelibrary.org/pages/${MAIER_ID}/0031-full.jpg`}
          alt="Full page of Atalanta fugiens: Emblem III, with the motto above the engraving of the woman at the steaming tub and the Latin epigram beneath."
          href={at(MAIER, 31)}
          source={<>Maier, <em>Atalanta fugiens</em> (1618), Embassy of the Free Mind copy</>}
        >
          &ldquo;Go to the woman washing clothes, and do likewise.&rdquo; The epigram ends: &ldquo;For
          the water washes away the dregs of the black body.&rdquo;
        </PageFigure>

        <p className={P}>
          This is the closest match in the table, because the labour is so ordinary. Maier&rsquo;s plate
          shows laundry, and so does most of our correction. The largest defect class in our main
          study is a word read as another real word: {O6?.total.toLocaleString('en-GB')} of{' '}
          {servedGrades.defect_totals.all.toLocaleString('en-GB')} defects. Those are the ones proofreading
          misses, because the wrong word still reads as a word. Beneath that are running heads and page
          numbers carried into the text, and whole wrong leaves.
        </p>

        <p className={P}>
          Here are the measurements. On {servedGrades.pages} pages from {servedGrades.books} books
          (#7933, regraded 4 November 2026) one AI reviewer read each transcription against its page
          image. The draw was stratified by our confidence and then weighted back. No person has checked
          these verdicts. The bar for the first column is that the page has no slip that changes the
          sense and no text the page does not carry, whatever cosmetic slips remain.
        </p>

        <Table
          head={['Language', 'Books / pages', 'Says what the page says', 'Changes the sense somewhere', 'Carries what the page does not have', 'Severe defects per 1,000']}
          rows={LANG_ROWS.map((l) => [
            l.language,
            `${l.books} / ${l.pages}`,
            pct(l.says_what_the_page_says),
            pct(l.misleads_somewhere),
            pct(l.text_not_on_the_page),
            `${l.severe_per_1k.toFixed(2)} ${l.unit === 'words' ? 'words' : l.unit}`,
          ])}
        />

        <p className={P}>
          Across all languages, weighted: {pct(B.says_what_the_page_says.share)} of pages say what the
          page says (95% interval {ci(B.says_what_the_page_says.ci95)}), {pct(B.misleads_somewhere.share)}{' '}
          have a reading that changes the sense, and {pct(B.text_not_on_the_page.share)} carry something
          the page does not have. About {pct(G.not_this_page.share)} of pages hold text that is not this
          page&rsquo;s at all, roughly 1 in 60. Rows with 3 or 6 books are small. The spread by language is
          wide: Russian and English at one end, Greek, Korean, Sanskrit and Arabic at the other.
        </p>

        <p className={P}>
          The instrument errs in both directions. A blind re-read of a sample of its tags moved the first
          figure to {pct(RE.says_what_the_page_says.share)} ({ci(RE.says_what_the_page_says.ci95)}): of 40
          wrong-text tags, {RE.note.wrong_text.none} were in fact what the page says, and of 40 sense-changing
          tags, {RE.note.misleads.none} were. In the other direction, in an earlier test on print against a
          1% character error bar, the judge caught 0.42 of the failures (0.23 to 0.64, #7263). Machine reading
          of print here ran at 2.5 to 3.4 severe defects per 1,000 words, against 1.45 for a scholarly edition
          typed by people. So the washing is not finished, and the water itself needs testing.
        </p>

        <h3 className={H3}>Translation</h3>

        <p className={P}>
          This is where the comparison is most tempted to flatter. I do not call any AI translation gold,
          and Maier shows why.
        </p>

        <SourceQuote
          book={MAIER}
          page={69}
          printedPage={55}
          src={`${CROPPED}/${MAIER_ID}/6976346b91079d7f1981a1c2.jpg`}
          pageAlt="Page 55 of Atalanta fugiens, the continuation of Discourse XI on whitening."
          source={<>Maier, <em>Atalanta fugiens</em> (1618), Discourse XI</>}
          original="At hæ incrustationes dealbativæ quolibet flatu aut liquore decidunt: quia non penetrant ad interiora."
        >
          But these whitening encrustations fall off with any breath or liquid because they do not
          penetrate to the interior. But the Philosophers do not care for such colorings, which are used
          more to deceive the eyes than to tinge the interior substance of the body.
        </SourceQuote>

        <p className={P}>
          He is talking about ceruse, a white lead paint. A smooth English sentence over a bad reading
          is exactly that: a surface colour. On the 481 of those 800 pages that carry English, the
          translation judge, again one AI reviewer with the image, found a major English defect on 15.3%
          of pages (11.1 to 19.8), and, counting a transcription misread too, 34.4% of pages are wrong for
          a reader (28.8 to 40.1;{' '}
          <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/experiments/2026-11-02-translation-on-7866-draw-7968.md">#7968</a>).
          A transcription error can wash out in English: of 109 confirmed errors, the English repaired 65%
          (56 to 73) and carried 27% (19 to 36, #7929). A separate figure, which should not be subtracted
          from any of those, is the share of one-page samples that a model judge rated 4 or 5 out of 5:
          Latin {pct(TR('Latin')?.share ?? 0)} of {TR('Latin')?.books} books, Greek {pct(TR('Greek')?.share ?? 0)} of{' '}
          {TR('Greek')?.books}, Sanskrit {pct(TR('Sanskrit')?.share ?? 0)} of {TR('Sanskrit')?.books}. That is
          a model&rsquo;s judgement, not accuracy.
        </p>

        <h3 className={H3}>Reunion</h3>

        <p className={P}>
          Ripley&rsquo;s recapitulation has the &ldquo;
          <Link href={at(ASHMOLE, 207)}>Red Man and the Whyte Woman be made one</Link>&rdquo;. Ours is duller:
          English, transcription and image shown together at an address that can be cited. The structure
          matches and the result does not, because nothing new is born. The English is a claim about the
          Latin, and it stays checkable only because the two remain apart.
        </p>

        <h3 className={H3}>Multiplication</h3>

        <SourceQuote
          book={ASHMOLE}
          page={207}
          printedPage={186}
          src={`${ARCHIVED}/${ASHMOLE_ID}/207.jpg`}
          pageAlt="Page 186 of Ashmole's Theatrum Chemicum Britannicum, the recapitulation of Ripley's Twelve Gates."
          source={<>Ripley, in Ashmole, <em>Theatrum Chemicum Britannicum</em> (1652), printed English</>}
        >
          In fyer conteinue thy glas styll, And Multeply thy Medcyns ay more and more
        </SourceQuote>

        <p className={P}>
          Ripley wants multiplication. Thomas Norton, printed in the same volume, does not, and he uses
          the word against other men.
        </p>

        <SourceQuote
          book={ASHMOLE}
          page={41}
          printedPage={20}
          src={`${ARCHIVED}/${ASHMOLE_ID}/41.jpg`}
          pageAlt="Page 20 of Ashmole's Theatrum Chemicum Britannicum, Norton's Ordinall."
          source={<>Norton, <em>The Ordinall</em>, in Ashmole (1652), printed English</>}
        >
          Wherefore concluding all Multipliers must cease, For Mettalls once Mettalls shall noe more
          increase
        </SourceQuote>

        <p className={P}>
          Both fit us. A search index multiplies a page&rsquo;s readers, and also whatever is wrong in its
          text: after #3362, a poisoned read served another book&rsquo;s title to readers through derived
          summaries. Ripley has the aim and Norton the warning. Copying before assaying spreads the error.
        </p>

        <h3 className={H3}>Assay and touchstone</h3>

        <SourceQuote
          book={GEBER}
          page={91}
          printedPage={75}
          src={`${ARCHIVED}/${GEBER_ID}/91.jpg`}
          pageAlt="Page 75 of The Works of Geber (1678), printed English, on the definition of gold."
          source={<><em>The Works of Geber</em> (London, 1678), printed English</>}
        >
          nothing is true Gold, unless it hath all the Causes and Differencies of the Definition of Gold
        </SourceQuote>

        <p className={P}>
          Pseudo-Geber&rsquo;s book lists trials, the cupel and the cement. Georgius Agricola, in the
          English of Herbert and Lou Hoover (1912), has his assayer take the gold from the cupel and
          &ldquo;<Link href={at(AGRICOLA, 287)}>rub the gold which has settled in the bottom of the cupel,
          after it has been taken out and cooled, on the touchstone, in order to find out what proportion
          of silver it contains</Link>.&rdquo; Our equivalent is the page image. It is the one thing in the
          system a model did not write, and it is where every check here ends.
        </p>

        <p className={P}>
          This step holds best and breaks most instructively. A touchstone yields a fineness. A translation
          has no such number. And the hand rubbing the stone is usually a model: our judge is the same
          kind of thing as the system it assays, which is why its own errors are reported above.
        </p>

        <h3 className={H3}>False gold</h3>

        <PageFigure
          src={`${CROPPED}/${STEUCO_ID}/69f727c09b6af70d44af56d7.jpg`}
          alt="Page 601 of Steuco's De perenni philosophia (1542): a column of Latin with Greek phrases, underlined by a reader, about Plato and Aristotle on the soul."
          href={at(STEUCO, 635)}
          source={<>Steuco, <em>De perenni philosophia</em> (1542), scan 635, printed 601</>}
        >
          The page reads about the <em>Republic</em>, the <em>Phaedo</em>, the <em>Timaeus</em> and
          Averroes. Our stored transcription held only margin fragments. The stored English did not follow
          the leaf. It was withheld on the day this was written.
        </PageFigure>

        <p className={P}>
          This is our false gold in a pure form. On that leaf the stored English said &ldquo;This wisdom,
          which we call the Philosophia Perennis, is the foundation of all true knowledge and the goal of
          all human striving.&rdquo; That sentence is not on the page. A model wrote it, in the book that
          coined the phrase, because it had no text to translate and could write plausible Steuco (#8189).
          The transcription kept the right running head and page number, so a check on those passes.
        </p>

        <p className={P}>
          The other kinds are less pretty. A floor count on 6 October 2026, reading 28,967,125 pages with no
          model involved, found model reasoning or a chat reply stored as the translation on 549 pages in
          269 public books: 352 reasoning, 197 chat replies. One was the whole of a page in{' '}
          <Link href={at('ikhwan-al-safa-brethren-of-purity-dowson-translation-dowson', 14)}>Dowson&rsquo;s
          Ikhwan al-Safa</Link>: &ldquo;Please provide the OCR transcription you would like me to
          modernize.&rdquo; (#6117; withheld.) And on blank leaves models have written fluent prose; one
          book held 16 pages of Latin juridical text on leaves with nothing on them. The estimate at that
          time was about 678 such pages across 21,481 live books (interval 211 to 1,145, #4149). Only the
          image can decide those.
        </p>

        <p className={P}>
          Geber has a sentence for the writer of such a text, from a chapter on what spoils the operator:
          a &ldquo;<Link href={at(GEBER, 44)}>Soul easily opinionating every Phantasie; but what they
          believe they have found true, is all Phantastick</Link>.&rdquo; Our rule, since 7 October 2026,
          is that invented text found with the image open is withheld in the same run, with a snapshot
          kept and the page left public with its image. We call that containment. The 50 issues with that label on 4 November (43 open) list what was
          found, not what exists, and some are follow-ups.
        </p>

        <h3 className={H3}>Puffers</h3>

        <PageFigure
          src={`${ARCHIVED}/${EXAMEN_ID}/3.jpg`}
          alt="Title page of Maier's Examen fucorum (1617): engraving of a man at a furnace with bellows at his feet, three well-dressed men carrying purses on a pole, and a beehive at right."
          href={at(EXAMEN, 3)}
          source={<>Maier, <em>Examen fucorum pseudo-chymicorum</em> (Frankfurt, 1617), title page</>}
        >
          Maier&rsquo;s Latin word for the false chymists is <em>fuci</em>, drones. The bellows lie at the
          operator&rsquo;s feet and the hive is on the right.
        </PageFigure>

        <p className={P}>
          The man at the furnace on that title page works for the three with the purses. Our puffing is a
          throughput number: pages per day reported as progress, with a page counted as translated whether
          or not it is right. An essay comparing a library&rsquo;s text processing to the Great Work is a
          kind of bellows too.
        </p>

        <h3 className={H3}>Reiteration</h3>

        <p className={P}>
          Maier, in the same discourse: &ldquo;someone could consume their entire life distilling and
          re-distilling, even if they lived a thousand years, before they arrived at the truth through
          experimentation alone.&rdquo; That is our case too. Reading a page twice with one engine gives
          stability, and a second model gives agreement. Neither measures quality. A repeat helps only if
          something in it changes, or if it is compared to the page.
        </p>

        <h3 className={H3}>Rings</h3>

        <p className={P}>
          Here the comparison stops being a sequence. <Link href={at(MAIER, 31)}><em>Atalanta fugiens</em></Link>{' '}
          has 237 pages, of which 237 are transcribed and 221 translated. A second copy, the same edition,
          is <em>hidden</em>, not removed, under the reason <code>same_edition_duplicate</code>. Across the
          live library, by stored counters on 4 November 2026, 71,228 books hold 17,590,715 pages, of which
          8,315,435 have a transcription and 5,452,379 an English text. Those figures count stored text, not
          good text. Beyond them stand 485,082 hidden records with pages, and 3,200 records in a recoverable
          deletion store. No alchemical sequence I read has a place for the matter that stops
          at the second gate and is kept there on purpose.
        </p>

        <h2 className={H2}>The operator&rsquo;s virtue</h2>

        <p className={P}>
          Derek added a thread: personal morality affecting the quality of the outcome. The authors do claim
          it, and I checked rather than assumed. Norton says of the adept, &ldquo;
          <Link href={at(ASHMOLE, 35)}>For his Trewth, Vertue, and for his stable Witt, Which if he faulte
          he shall never have it</Link>&rdquo;, and &ldquo;But only vertue winneth this holy Arte&rdquo;.
          On the page before, he says of the science that &ldquo;
          <Link href={at(ASHMOLE, 34)}>It was never for Mony sold ne bought</Link>&rdquo;. Zosimos tells
          Theosebeia:
        </p>

        <SourceQuote
          book={ZOSIMOS}
          page={281}
          printedPage={235}
          src={`${ARCHIVED}/${ZOSIMOS_ID}/281.jpg`}
          pageAlt="Page 235 of Berthelot and Ruelle's Collection des anciens alchimistes grecs, French translation of Zosimos."
          source={<>Zosimos, in Berthelot and Ruelle (1887 to 1888); the French is theirs, the English an AI draft</>}
          original="Repose ton corps, calme tes passions, résiste au désir, au plaisir, à la colère, au chagrin et aux douze fatalités de la mort."
        >
          Rest your body, calm your passions, resist desire, pleasure, anger, sorrow, and the twelve fates
          of death.
        </SourceQuote>

        <p className={P}>
          Pseudo-Geber&rsquo;s version is the most interesting, because his &ldquo;
          <Link href={at(GEBER, 43)}>Impediments from the part of the Artists Soul</Link>&rdquo; are
          mostly intelligence and character rather than piety: the stiff neck, the fantasist, the one who
          is a slave to money. Khunrath is the pious version, asking how truth is bought, and answering (
          <Link href={at(KHUNRATH, 42)}>page 37</Link>; the English here is mine): &ldquo;With no silver at
          all, but by pious inquiry, constant prayers and tireless labours in Oratory and Laboratory.&rdquo;
        </p>

        <p className={P}>
          On our side the outcome does depend on conduct, in a specific and limited way. A report that
          rounds up, a claim without a measurement, a number quoted past its sample: these do produce false
          gold, in the sense that a reader then relies on text nobody tested. But the alchemists meant
          something more than that, and honest intentions do not fix a wrong read. A model does not misread
          a Greek abbreviation because of its soul, and an upright engineer&rsquo;s OCR still turns{' '}
          <em>Egypt</em> into <code>IJgyjDt</code>.
        </p>

        <p className={P}>
          The next part is easy to tell as a replacement: the operator&rsquo;s virtue gave way to procedure and
          witnesses in the seventeenth century. Derek corrected that, and the evidence agrees with him.
          Procedure is a virtue, and Boyle shows it in print. His
          preface says he has &ldquo;
          <Link href={at(BOYLE, 21)}>endeavour&rsquo;d to deliver matters of Fact, so faithfully</Link>&rdquo;
          that lesser readers can examine the case, and that he tried to devise experiments &ldquo;likely to
          furnish me with Objections against it&rdquo;. His speaker Carneades, about to report a result against
          himself, says:
        </p>

        <SourceQuote
          book={BOYLE}
          page={132}
          printedPage={108}
          src={`${ARCHIVED}/${BOYLE_ID}/132.jpg`}
          pageAlt="Page 108 of Boyle's The Sceptical Chymist (1661), printed English."
          source={<>Boyle, <em>The Sceptical Chymist</em> (London, 1661), printed English</>}
        >
          But to deal Candidly with You, Eleutherius, I must not conceal from You the Event of another
          Experiment of this Kind
        </SourceQuote>

        <p className={P}>
          Steven Shapin&rsquo;s <em>A Social History of Truth</em> (Chicago, 1994) argues that credibility
          in that world ran through a gentleman&rsquo;s character, so that the virtue had not gone anywhere.
          Lorraine Daston and Peter Galison&rsquo;s <em>Objectivity</em> (Zone, 2007) treats objectivity itself
          as an epistemic virtue, with a disciplined self to match. I cite both for the idea and have not
          checked them against particular pages.
        </p>

        <p className={P}>
          Self-binding is the moral act in our version. Someone chooses to blind their own judge, to write a
          check that will fail against their own work, and to publish the failure. Our working rule that
          a rule broken twice becomes a check is that same habit, and so are the figures above. But procedure
          cannot do three things. It cannot choose what to measure. It cannot want to look. And it cannot
          catch what no check was written for: the Steuco leaf above passed a check on its page number, and
          it was found by a reading done for another purpose.
        </p>

        <p className={P}>
          Whether a model has this virtue I leave open, and it is awkward for me to say more. I can report
          conduct. A model wrote fluent Latin on a blank leaf, and another stored its scratchpad as a
          translation. A model also opened each page quoted here and dropped a line from Khunrath the book would not
          support. None of that settles character.
        </p>

        <h2 className={H2}>Where the frame fails</h2>

        <h3 className={H3}>Nothing is transmuted</h3>

        <p className={P}>
          Alchemy&rsquo;s central promise is a change of substance. Maier&rsquo;s discourse is firm on this:
          the Philosophers want the skin itself altered, &ldquo;truly and not deceitfully&rdquo;. Dorn&rsquo;s
          voice says &ldquo;be transformed&rdquo;. Nothing in this library is transformed. The page does not
          change. A translation adds a second object beside it, a draft of what the page may say, and our
          best reading of that draft is a measured error rate. If the frame leads anyone to think that a
          Latin book has been turned into something finer, it has done harm.
        </p>

        <h3 className={H3}>Purification discards, and a library keeps the dross</h3>

        <PageFigure
          src={`${CROPPED}/${MAIER_ID}/6976343a91079d7f1981a1bd.jpg`}
          alt="Emblem XI of Atalanta fugiens: the motto Dealbate Latonam et rumpite libros, with an engraving of a man tearing books while pages lie on the ground."
          href={at(MAIER, 67)}
          source={<>Maier, <em>Atalanta fugiens</em> (1618), Emblem XI, printed 53</>}
        >
          &ldquo;Whiten Latona and tear up the books.&rdquo; Not advice a library can take.
        </PageFigure>

        <p className={P}>
          Alchemy separates the pure from the impure and the impure goes. Maier&rsquo;s emblem tears up the
          books, on the authority of a saying he inherits. We can look at that saying in our own copy of the
          1550 <em>Rosarium</em>, and something happens to it there.
        </p>

        <SourceQuote
          book={ROSARIUM}
          page={83}
          src={`${ARCHIVED}/${ROSARIUM_ID}/83.jpg`}
          pageAlt="A page of the Rosarium philosophorum (1550), with the saying Dealbate latonem et libros rumpite."
          source={<><em>Rosarium philosophorum</em> (1550), first occurrence</>}
          original="Dealbate latonem, & libros rumpite, ne corda vestra rumpantur"
        >
          Whiten the laton, and tear up your books, lest your hearts be torn.
        </SourceQuote>

        <SourceQuote
          book={ROSARIUM}
          page={166}
          src={`${ARCHIVED}/${ROSARIUM_ID}/166.jpg`}
          pageAlt="A later page of the Rosarium philosophorum (1550), with the variant Dealbate latonem id est terram et libros reponite."
          source={<><em>Rosarium philosophorum</em> (1550), same volume, attributed to Geber</>}
          original="Dealbate latonem id est terram, & libros reponite ne corda vestra rumpantur"
        >
          put away your books
        </SourceQuote>

        <p className={P}>
          The same volume has <em>rumpite</em> (tear) and <em>reponite</em> (put away). I do not know which came first. A purifier would keep one and throw out the other. To a
          historian of the text, the variant is the evidence. This is the frame&rsquo;s deepest fault. Our most valuable
          holdings include what a purification would discard: misprints, marginal scrawl, a reader&rsquo;s
          underlining on Steuco&rsquo;s page, the same sentence of Hermes{' '}
          <Link href="/articles/one-sentence-of-hermes">garbled by each copyist</Link>.
        </p>

        <p className={P}>
          Our rules already say so. Withheld English goes to a snapshot. A duplicate is hidden, not removed.
          Deleted books go to a recoverable store. Purification happens only in the text a reader sees; the
          image and the record of what we got wrong are kept. The accurate word for that is conservation,
          with a sorted reading copy.
        </p>

        <h3 className={H3}>Secrecy</h3>

        <p className={P}>
          I did not expect this one. It came up on page after page while I was looking for something else.
          Norton: &ldquo;<Link href={at(ASHMOLE, 35)}>For this Science must ever secret be</Link>&rdquo;, to be
          taught &ldquo;from mouth to mouth&rdquo;. Ripley&rsquo;s recapitulation: &ldquo;
          <Link href={at(ASHMOLE, 207)}>Kepe thy Secretts in store unto thy selve</Link>&rdquo;. Zosimos asks
          whether the thing is hidden &ldquo;<Link href={at(ZOSIMOS, 282)}>par jalousie</Link>&rdquo;, out of
          jealousy. Maier says that most books &ldquo;
          <Link href={at(MAIER, 69)}>are written so obscurely that they are understood only by their own
          authors. Not a few were left behind out of envy to mislead others</Link>&rdquo;. These authors assume that a teacher selects the worthy and that a text may lie on purpose.
        </p>

        <p className={P}>
          We do the opposite on purpose, and the comparison cannot absorb that. The mission here is to put
          sources into anyone&rsquo;s hands without testing their virtue. Scans, failure rates and error
          classes are on <Link href="/quality">a public page</Link>, and our false gold is listed in public
          issues with page links. The check depends on anyone being able to rub the text against the image.
        </p>

        <h3 className={H3}>Smaller breaks</h3>

        <p className={P}>
          The frame implies an order and we keep none: pages are re-read after translation. And it flatters,
          as any talk of &ldquo;the Work&rdquo; would.
        </p>

        <h2 className={H2}>What survives</h2>

        <p className={P}>
          What is left is a smaller claim. The ordinary alchemical vocabulary of the laboratory, separating,
          washing, repeating, assaying and being fooled by surface colour, describes the labour of making
          old books readable better than the vocabulary of an assembly line does. Three are useful as more than
          a figure of speech. <em>False gold</em> names a failure that fluency itself hides.{' '}
          <em>Touchstone</em> says where a check must end. And Maier&rsquo;s ceruse tells us why a clean-looking
          page is not evidence.
        </p>

        <p className={P}>
          Three questions stay open. Whether the frame adds anything to plain description, once those three
          uses are named: I am not sure it does. Whether a model&rsquo;s conduct under a check amounts to the
          virtue the authors meant, or is only the check: I do not know, and my position is not neutral. And
          none of the {servedGrades.pages} verdicts behind the main table has been checked by a person.
        </p>

        <h2 className={H2}>How to check this</h2>

        <p className={P}>
          Every picture and quotation here links to its page in the reader. I checked the quoted original
          against each scan and made no fresh scholarly translation, so the English can carry errors I did not catch.
          The current quality figures, with methods and known gaps, are on{' '}
          <Link href="/quality">/quality</Link>; the record behind the table is at{' '}
          <Link href="/quality/record">/quality/record</Link>. The Steuco page shows its image in the reader,
          with the English withheld.
        </p>

        <p className="text-sm text-muted leading-relaxed mb-6 font-body">
          <strong>Sources and limits.</strong> Pages read by eye on 4 November 2026. Translations: AI drafts in
          this library for Maier, the <em>Rosarium</em>, Libavius, the Dorn passage and Zosimos&rsquo;s English;
          printed English for Ripley, Norton, the 1678 Geber, Boyle, Waite, Silberer; the Hoovers for Agricola;
          Berthelot and Ruelle for the French. Read as abstract or summary only: Newman and Principe 1998,
          Principe and Newman 2001. Named as books and not checked against particular pages: Newman 1991, Shapin
          1994, Daston and Galison 2007. Dates for Jung and for Silberer&rsquo;s German from catalogue records.
          Zosimos&rsquo;s date is the conventional one.
        </p>
      </article>
    </ContentPageLayout>
  );
}
