// Body of the AI-partners page (everything between the site header and footer).
// Plain HTML, no scripts: edit it here. Styles: ./ai-partners.css. Images: public/ai-partners/img/.
export const PARTNERS_HTML = `
<section class="hero">
  <div class="wrap">
    <div>
      <h1>The world's largest library of <em>translated</em> historical sources</h1>
      <p>22,700 books in English, translated from more than fifty languages, most of them printed between 1450 and 1800. Each translation is set opposite the page it came from, so any line can be checked against the original. About half had never been in English before. Behind them stand 131,000 books with their page scans, and 235,000 illustrations cropped from the pages.</p>
      <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20AI%20partnership">Talk to us</a></p>
    </div>
    <figure>
      <img src="/ai-partners/img/fludd-empyrean.jpg" alt="Engraved circle of the heavens: a dark starry core, a ring of stars, and an outer band of flames">
      <figcaption><a href="https://sourcelibrary.org/book/69904dd67d19f3f2aac1d49d?page=140">Robert Fludd, <i>Utriusque cosmi historia</i>, 1617: the Empyrean heaven · Source Library</a></figcaption>
    </figure>
  </div>
</section>

<section class="hook">
  <div class="wrap">
    <p class="hook-lead">The last time old books were translated on this scale, it started the Renaissance.</p>
    <p>Language models learned from what was typed and put online. Most of what people wrote before 1800 never was: it sits in Latin, Sanskrit and classical Chinese, on pages that neither readers nor models have seen.</p>
  </div>
</section>

<!--island:shelf-->

<nav class="pillars" aria-label="What the corpus is">
  <div class="wrap">
    <ol>
      <li><a href="#v2-collected"><strong>Collected</strong><span>131,000 books from 30+ libraries</span></a></li>
      <li><a href="#v2-transcribed"><strong>Transcribed</strong><span>9.6M pages in the original script</span></a></li>
      <li><a href="#v2-translated"><strong>Translated</strong><span>5.7M pages into English</span></a></li>
      <li><a href="#v2-illustrated"><strong>Illustrated</strong><span>235,000 pictures cropped from the page</span></a></li>
      <li><a href="#v2-reviewed"><strong>Checked</strong><span>Language by language, with scholars</span></a></li>
      <li><a href="#v2-rights"><strong>Rights</strong><span>Stated book by book</span></a></li>
      <li><a href="#v2-available"><strong>Available now</strong><span>Streaming API and MCP</span></a></li>
      <li><a href="#v2-card"><strong>Dataset card</strong><span>Size, embeddings, quality and format</span></a></li>
    </ol>
  </div>
</nav>

<!--island:demo-->

<section class="band dark">
  <div class="wrap why">
    <div>
      <p class="eyebrow">The untranslated record</p>
      <h2>Most Renaissance Latin has never been translated into English</h2>
      <p>Some nine in ten Latin works written in the Renaissance have never been translated into English. Of the books we have made readable in English, 11,357 are the first English translation of their work, and not only from Latin: 1,946 are from Chinese and 1,447 from German.</p>
      <p class="cap" style="color:var(--night-muted)">Of Latin works composed and printed 1480–1620 in the Universal Short Title Catalogue, 93% (91–95%) have no English translation on record, from a random sample of 1,000 searched by AI agents. A book here is marked a first translation only after a search for an earlier one finds none. <a href="https://sourcelibrary.org/research/translation-gap" style="color:inherit">How we measured it</a></p>
    </div>
    <figure style="margin:0">
      <div class="frame"><img src="/ai-partners/img/hero.jpg" alt="An early printed Latin page naming Marsilio Ficino and Pico della Mirandola"></div>
      <figcaption class="cap" style="color:var(--night-muted)">An early printed page naming Marsilio Ficino and Giovanni Pico della Mirandola.</figcaption>
    </figure>
  </div>
</section>

<!--island:chart-->

<section class="band dark">
  <div class="wrap">
    <p class="eyebrow">The remaining work</p>
    <h2>20.2 million pages remain to be read</h2>
    <p class="narrow">They are scanned, catalogued and ready for transcription and translation. Behind them are 409,000 more books, some 87 million pages, catalogued from partner libraries and waiting to be copied in.</p>
    <div class="progress" role="img" aria-label="Of 29.8 million scanned pages: 5.7 million translated, 3.9 million transcribed, 20.2 million waiting">
      <i class="seg tr" style="flex:5.7"></i><i class="seg tc" style="flex:3.9"></i><i class="seg wt dk" style="flex:20.2"></i>
    </div>
    <div class="legend dk">
      <span><i class="sw tr"></i><b>5.7M</b> translated into English</span>
      <span><i class="sw tc"></i><b>3.9M</b> transcribed, awaiting translation</span>
      <span><i class="sw wt dk"></i><b>20.2M</b> scanned, waiting to be read</span>
    </div>
    <div class="offer dk">
      <div><h3>An open release</h3><p>The tools that read these pages work today. A partner's support would fund the remaining pages and their release to the public, as Microsoft and OpenAI did for Harvard's Institutional Books.</p></div>
      <div><h3>Early access</h3><p>The partner receives each release in advance, together with held-back test sets and scholarly review in the languages of its choosing.</p></div>
      <div><h3>Acknowledgement</h3><p>The partner is credited on each release, alongside the Embassy of the Free Mind and the contributing libraries.</p></div>
    </div>
  </div>
</section>

<section class="proof" id="v2-collected">
  <div class="wrap pf">
    <h2 class="pword">Collected</h2>
    <div>
      <p class="lede">From more than thirty libraries, catalogued by work, edition and author.</p>
      <table class="ledger">
        <tr><td>Books held, with their page scans</td><td class="n">131,547</td></tr>
        <tr><td>Public on the site</td><td class="n">71,212</td></tr>
        <tr><td>Public and readable in English</td><td class="n">22,731</td></tr>
        <tr><td>Ritman Library books, found only here</td><td class="n">2,347</td></tr>
      </table>
      <p class="note">Counted 29 October 2026, public figures 10 November. Duplicates and catalogue-only records are excluded.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-transcribed">
  <div class="wrap pf">
    <h2 class="pword">Transcribed</h2>
    <div>
      <p class="lede">9.6 million pages in their original language and script, mostly Latin and classical Chinese, but also Greek, Hebrew, Arabic, Syriac, Sanskrit, Tibetan and Yucatec Maya. Each page is indexed by the people, places and ideas it names.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-translated">
  <div class="wrap pf">
    <h2 class="pword">Translated</h2>
    <div>
      <p class="lede">5.7 million pages in English, each aligned with its original.</p>
      <figure style="margin:8px 0 0">
        <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta/page/20"><img src="/ai-partners/img/reader-sanskrit.jpg" alt="A page of Kamalākara’s Siddhānta-tattva-viveka in the reader: the scan, the Sanskrit transcription and the English translation side by side, with notes on technical terms" style="width:100%;height:auto;display:block;border:1px solid rgba(0,0,0,.08)" loading="lazy" width="1440" height="808"></a>
        <figcaption class="cap">Kamalākara’s <em>Discernment of the Principles of Astronomy</em> (1658): scan, Sanskrit and English side by side, with notes that give the original term.</figcaption>
      </figure>
    </div>
  </div>
</section>

\g<1>235,714 illustrations cropped from about 18,700 books, each with its position on the page, a type, a description, and a link to its page.\g<2>
      <div class="crops">
        <figure><a href="https://sourcelibrary.org/book/instruments-of-the-restored-astronomy-brahe/page/6952d0fa77f38f6761bc5b5a"><img src="/ai-partners/img/crop-tycho-hven.jpg" alt="Woodcut map of the island of Hven with a compass rose" width="720" height="642" loading="lazy"></a><figcaption>Map of Hven. Tycho Brahe, <i>Instruments of the Restored Astronomy</i>, 1602</figcaption></figure>
        <figure><a href="https://sourcelibrary.org/book/codex-borgia/page/69dfdfbcfc46416d01ddf48e"><img src="/ai-partners/img/crop-codex-borgia.jpg" alt="Painted manuscript page in nine panels of figures, divided by bands of day signs" width="712" height="720" loading="lazy"></a><figcaption>Nine panels and day signs. <i>Codex Borgia</i>, pre-Columbian Mexico</figcaption></figure>
        <figure><a href="https://sourcelibrary.org/book/architettura-con-il-suo-commento-et-figure-vetruvio-in-vitruvius/page/69b63cec1c1c21a3738576f1"><img src="/ai-partners/img/crop-vitruvius.jpg" alt="Woodcut of a standing man with outstretched arms in a square and circle over a measuring grid" width="633" height="720" loading="lazy"></a><figcaption>Human proportions. Vitruvius, <i>Architettura</i>, 1536</figcaption></figure>
        <figure><a href="https://sourcelibrary.org/book/medical-letters-volume-one-massa/page/6959068395a91542b28bd5cf"><img src="/ai-partners/img/crop-massa-star.jpg" alt="Ornamental woodcut of an eight-pointed star and serpents in a carved frame with four figures" width="540" height="720" loading="lazy"></a><figcaption>Star and serpents. Niccolò Massa, <i>Medical Letters</i>, 1558</figcaption></figure>
        <figure><a href="https://sourcelibrary.org/book/cardano-de-subtilitate-1550-cardano/page/6959067195a91542b28bcc37"><img src="/ai-partners/img/crop-cardano.jpg" alt="Oval woodcut portrait in profile of a bearded man in a scholar's cap, with a Greek inscription" width="537" height="720" loading="lazy"></a><figcaption>Portrait of the author. Girolamo Cardano, <i>On Subtlety</i>, 1550</figcaption></figure>
        <figure><a href="https://sourcelibrary.org/book/mundus-subterraneus-kircher/page/69527367ab34727b1f048fbc"><img src="/ai-partners/img/crop-kircher-caspian.jpg" alt="Engraved map joining the Caspian Sea, the Black Sea and the Persian Gulf by underground channels" width="701" height="720" loading="lazy"></a><figcaption>Channels under the Caspian. Athanasius Kircher, <i>Mundus Subterraneus</i>, 1678</figcaption></figure>
      </div>
      <table class="ledger">
        <tr><td>Cropped illustrations</td><td class="n">235,714</td></tr>
        <tr><td>On the public site</td><td class="n">208,422</td></tr>
        <tr><td>Offered for licence</td><td class="n">~146,000</td></tr>
      </table>
      <p class="note" style="margin-top:14px">Offered: illustrations from books whose library permits commercial use of its scans, and from books dated before 1900 whose library states no terms. Counted 4 November 2026. On a graded sample of 48 pages, the current detector drew a tight box around 82% of pictures and found 95% of them; on 10 pages it also boxed something that was not an illustration.</p>
      \1 in the <a href="https://sourcelibrary.org/gallery">gallery</a> and searched through the <code>search_images</code> tool on our <a href="https://sourcelibrary.org/developers">MCP server</a>.</p>
    </div>
  </div>
</section>

\g<1>      <p>What they find changes how that language is read: which model, which instructions, and when a page needs a second reading. Every reading and correction is kept beside the text, with how it was judged against the image. Error rates by language are on the <a href="https://sourcelibrary.org/quality">quality page</a>.</p>\g<2>
        <img src="/ai-partners/img/embassy.jpg" alt="The Embassy of the Free Mind, Amsterdam">
        <img src="/ai-partners/img/bibliotheca.jpg" alt="Guests in the Bibliotheca Philosophica Hermetica">
      </div>
      <p class="cap">The Embassy of the Free Mind, Amsterdam, home of the Ritman Library.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-rights">
  <div class="wrap pf">
    <h2 class="pword">Rights</h2>
    <div>
      <p class="lede">The original texts are in the public domain. A book whose status is uncertain is withheld from the public site; about 300 have been withheld so far.</p>
      <p>For a training licence: text from 28,700 books, 4.9 million pages, and images from 11,929 of them, where the holding library permits commercial use of its scans. The tiers are set out under What a licence covers, below.</p>
      <p>Translations, notes and indexes are ours, under a Creative Commons share-alike licence. Search and use for a reader are free; training at scale is licensed. Terms and rates are on the <a href="https://sourcelibrary.org/licensing">licensing page</a>.</p>
    </div>
  </div>
</section>

\g<1><p>Each book links to the holding library’s scan and rights statement. Each transcription and translation names the model that made it, and since 28 September 2026 also the prompt, settings and input, with a hash of the output. Corrections keep the earlier version.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-available">
  <div class="wrap pf">
    <h2 class="pword">Available now</h2>
    <div>
      <p class="lede">The public library is open through our streaming API and <a href="https://sourcelibrary.org/developers">MCP server</a>, with a stable citation link for every passage. The whole corpus is about 21 billion tokens, three times English Wikipedia: 15 billion in the original languages and 6 billion in English.</p>
      <p class="note">o200k tokenizer, sample of 12,000 pages, 29 October 2026.</p>
      <table class="ledger">
        <tr><td>Page views by readers, last 7 days</td><td class="n">103K</td></tr>
        <tr><td>Pages fetched by ChatGPT and Claude for their users, last 7 days</td><td class="n">28K</td></tr>
        <tr><td>Library tool calls by Claude through our MCP server, last 7 days</td><td class="n">35K</td></tr>
      </table>
      <p class="note">Counted 28 October 2026 from the site's and Cloudflare's logs. Assistants acting for a user read freely; training crawlers get the licence terms.</p>
    </div>
  </div>
</section>

<section class="dsband" id="v2-card">
  <div class="wrap">
    <article class="ds" aria-labelledby="ds-title">
      <header class="ds-head">
        <p class="ds-kicker">Dataset card</p>
        <h2 id="ds-title">Source Library historical corpus</h2>
        <p class="ds-sum">Page scans, transcriptions in the original script and aligned English translations of historical books and manuscripts. Figures describe the whole corpus; a licence covers the part cleared book by book, listed under What a licence covers.</p>
      </header>
      <dl class="ds-specs">
        <div><dt>Books</dt><dd>131,547, from 30+ libraries</dd></div>
        <div><dt>Page images</dt><dd>29.8M</dd></div>
        <div><dt>Transcribed</dt><dd>9.6M pages, original script, February to November 2026</dd></div>
        <div><dt>Translated</dt><dd>5.7M pages, aligned to the original, February to November 2026</dd></div>
        <div><dt>Tokens</dt><dd>~21B: 15B original, 6B English</dd></div>
        <div><dt>Illustrations</dt><dd>235,714 crops, with boxes, types and descriptions</dd></div>
        <div><dt>First English translations</dt><dd>11,357 works</dd></div>
        <div><dt>Storage</dt><dd>32 TB of images</dd></div>
        <div><dt>Languages</dt><dd>50+, led by Latin and classical Chinese</dd></div>
        <div><dt>Period</dt><dd>Mostly the 1400s to the 1800s</dd></div>
      </dl>
      <div class="ds-block">
        <h3>Embeddings</h3>
        <table class="ds-mini">
          <tr><td>Translated pages</td><td>768-d vectors</td></tr>
          <tr><td>Books</td><td>67,916 vectors, 768-d</td></tr>
          <tr><td>Illustration descriptions</td><td>246,497 vectors, 768-d</td></tr>
          <tr><td>Images</td><td>509,062 vectors, 512-d</td></tr>
          <tr><td>Page concepts</td><td>325,308 vectors, 768-d, experimental</td></tr>
        </table>
      </div>
      <div class="ds-block">
        <h3>Quality</h3>
        <div class="ds-bands" role="img" aria-label="800 pages: 43% clean, 8% small slips, 24% a word that changes the sense, 18% a word, number or line differs, 7% mostly wrong or another page's text">
          <i class="q1" style="flex:43"></i><i class="q2" style="flex:8"></i><i class="q3" style="flex:24"></i><i class="q4" style="flex:18"></i><i class="q5" style="flex:7"></i>
        </div>
        <p class="ds-bandkey"><span><i class="q1"></i>Clean 43%</span><span><i class="q2"></i>Small slips 8%</span><span><i class="q3"></i>A word changes the sense 24%</span><span><i class="q4"></i>A word, number or line differs 18%</span><span><i class="q5"></i>Mostly wrong or another page 7%</span></p>
        <p class="ds-note">Transcriptions, strictest reading: one misread word moves a page down a band. 800 pages from 160 random books, AI reviewer against each photograph, 31 October 2026.</p>
        <table class="ds-mini">
          <tr><td>Beside the Internet Archive's OCR</td><td>1.1 meaning-changing errors per 1,000 words, against 10.9 (60 random English pages, 1800–1930)</td></tr>
          <tr><td>Beside typed editions</td><td>2.2 errors per 1,000 words, against 3.6 (65 printed pages)</td></tr>
          <tr><td>By language, per 1,000 words</td><td>English 0.9, German 4.0, French 4.5, Latin 6.2, Greek 19.3, Sanskrit 30.9</td></tr>
          <tr><td>Translation</td><td>15% of translated pages carry a major error in the English; about a third are wrong somewhere once a misread transcription is counted</td></tr>
        </table>
        <p class="ds-note">Reviewed by AI, not by people; samples for some languages are small. Methods and intervals are on the <a href="https://sourcelibrary.org/quality">quality page</a>.</p>
      </div>
      <div class="ds-block">
        <h3>Review records</h3>
        <table class="ds-mini">
          <tr><td>First-translation searches</td><td>90,769 records of whether a work is already in English, with written reasoning</td></tr>
          <tr><td>Page judgements</td><td>8,017 judgements against the page photograph, with defects quoted and explained</td></tr>
          <tr><td>Book checks</td><td>1,350 checks, with notes and page findings</td></tr>
        </table>
        <p class="ds-note">The findings are on the quality page. The records behind them come with a licence, separately from the text, and what a licensee may do with a record depends on the model that wrote it. Counted 4 November 2026.</p>
      </div>
      <div class="ds-block ds-tagblock">
        <dl class="ds-tags">
          <div><dt>Modalities</dt><dd><span>Text</span><span>Image</span></dd></div>
          <div><dt>Tasks</dt><dd><span>Image-to-text</span><span>Translation</span><span>Text-image retrieval</span><span>Object detection</span></dd></div>
          <div><dt>Formats</dt><dd><span>JSONL (gzip)</span><span>JPEG</span></dd></div>
          <div><dt>Access</dt><dd><span>Streaming API</span><span>MCP</span><span>Licence for training</span></dd></div>
        </dl>
      </div>
      <div class="ds-main">
        <details class="ds-more"><summary>What a licence covers</summary>
          <div class="ds-scroll">
            <table class="ds-t ds-num">
              <thead><tr><th>Tier</th><th>Books</th><th>Text pages</th><th>English pages</th><th>Original words</th><th>English words</th><th>Page images</th><th>Illustrations</th></tr></thead>
              <tbody>
                <tr><td><b>A</b></td><td>11,929</td><td>2,594,799</td><td>2,169,624</td><td>976M</td><td>1.09B</td><td>Licensable</td><td>107,017</td></tr>
                <tr><td><b>B</b></td><td>8,428</td><td>849,762</td><td>679,357</td><td>263M</td><td>297M</td><td>Library terms</td><td>Library terms</td></tr>
                <tr><td><b>U</b></td><td>8,343</td><td>1,417,881</td><td>1,045,615</td><td>426M</td><td>451M</td><td>No terms stated</td><td>~39,000</td></tr>
                <tr class="ds-total"><td>All</td><td>28,700</td><td>4,862,442</td><td>3,894,596</td><td>1.67B</td><td>1.84B</td><td></td><td>~146,000</td></tr>
              </tbody>
            </table>
          </div>
          <p class="ds-note"><b>A</b>: the holding library states public domain, CC0, CC BY or CC BY-SA, or the scans are the Ritman Library's own. <b>B</b>: the library attaches non-commercial, no-derivatives or its own terms to its scans, or marks them in copyright; these are under legal review. <b>U</b>: the library's manifest or record states no terms for its scans; most of these books come from the Internet Archive. Illustrations from U books dated before 1900 are offered. Tiers record what the library says about its scans, not the age of the work: about 20,600 illustrations held back in B also come from books dated before 1900.</p>
        </details>
        <details class="ds-more"><summary>Record format</summary>
          <h3>Page record</h3>
          <div class="ds-scroll">
            <table class="ds-t ds-schema">
              <thead><tr><th>Field</th><th>Type</th><th>Contents</th></tr></thead>
              <tbody>
                <tr><td><code>original</code></td><td>string</td><td>Transcription in the original language and script, with structural tags such as <code>&lt;header&gt;</code>, <code>&lt;page-num&gt;</code>, <code>&lt;sig&gt;</code></td></tr>
                <tr><td><code>english</code></td><td>string</td><td>English translation of the same page, with translator's notes</td></tr>
                <tr><td><code>image_url</code>, <code>image_crop</code></td><td>string, object</td><td>Page scan; crop fractions where the page shares an image</td></tr>
                <tr><td><code>title</code>, <code>author</code>, <code>year</code>, <code>language</code></td><td>string, number</td><td>Catalogue metadata. <code>language</code> is the edition's language</td></tr>
                <tr><td><code>tier</code>, <code>rights_class</code>, <code>rights_status</code>, <code>rights_statement_uri</code></td><td>string</td><td>Rights tier and what the holding library stated</td></tr>
                <tr><td><code>image_provider</code>, <code>image_source_url</code></td><td>string</td><td>Holding library and link to its scan</td></tr>
                <tr><td><code>ocr_engine</code>, <code>ocr_prompt_version</code></td><td>string</td><td>Model and prompt that wrote the transcription</td></tr>
                <tr><td><code>translation_engine</code>, <code>translation_prompt_version</code></td><td>string</td><td>Model and prompt that wrote the translation</td></tr>
                <tr><td><code>content_hash</code>, <code>original_sha256</code>, <code>english_sha256</code></td><td>string</td><td>SHA-256 of the text</td></tr>
                <tr><td><code>quality_flags</code></td><td>string[]</td><td>For example <code>marginalia</code>, <code>scan_quality:*</code>, <code>book_rung:*</code></td></tr>
                <tr><td><code>sample_id</code>, <code>book_id</code>, <code>page_id</code>, <code>page_number</code>, <code>url</code></td><td>string, number</td><td>Identifiers and a link to the page in the reader</td></tr>
              </tbody>
            </table>
          </div>
          <h3>Illustration record</h3>
          <div class="ds-scroll">
            <table class="ds-t ds-schema">
              <thead><tr><th>Field</th><th>Type</th><th>Contents</th></tr></thead>
              <tbody>
                <tr><td><code>extracted_url</code>, <code>thumbnail_url</code></td><td>string</td><td>The cropped image and its thumbnail</td></tr>
                <tr><td><code>bbox</code></td><td>object</td><td><code>x</code>, <code>y</code>, <code>width</code>, <code>height</code> as fractions of the page image</td></tr>
                <tr><td><code>type</code></td><td>string</td><td>Woodcut, engraving, diagram, emblem, map, portrait and others</td></tr>
                <tr><td><code>description</code>, <code>museum_description</code></td><td>string</td><td>What the picture shows, and a longer label</td></tr>
                <tr><td><code>metadata</code></td><td>object</td><td>Subjects, figures, symbols and technique</td></tr>
                <tr><td><code>gallery_quality</code>, <code>confidence</code></td><td>number</td><td>Scores from 0 to 1 set by the extraction model</td></tr>
                <tr><td><code>dhash</code></td><td>string</td><td>Perceptual hash for finding repeats</td></tr>
                <tr><td><code>model</code>, <code>detection_source</code></td><td>string</td><td>What found the picture; the model is missing on about two in five</td></tr>
                <tr><td><code>book_id</code>, <code>page_id</code>, <code>page_number</code></td><td>string, number</td><td>Join to the page record</td></tr>
              </tbody>
            </table>
          </div>
          <h3>Example row</h3>
          <div class="ds-row">
            <a href="https://sourcelibrary.org/book/de-rege-et-regis-institutione-with-de-ponderibus-et-mensuris-mariana/page/6991e1a2339ebc850994a63e"><img src="/ai-partners/img/row-mariana.jpg" alt="Printed Latin page numbered 109, headed Liber Secundus" width="360" height="655" loading="lazy"></a>
            <div>
              <p class="ds-lab"><code>original</code></p>
              <p class="ds-text">&lt;page-num&gt;109&lt;/page-num&gt;<br>&lt;header&gt;LIBER SECVNDVS.&lt;/header&gt;<br>&lt;sig&gt;Q&lt;/sig&gt;<br><br>ges à Ioue prognatos cecinit. Heroes Homerus, quos immortali laude ornare volebat, certis Dijs caros esse finxit …</p>
            </div>
            <div>
              <p class="ds-lab"><code>english</code></p>
              <p class="ds-text">&lt;page-num&gt;109&lt;/page-num&gt;<br>&lt;header&gt;BOOK SECOND.&lt;/header&gt;<br>&lt;sig&gt;Q&lt;/sig&gt;<br><br>sang that kings were born of Jove. Homer imagined that the heroes whom he wished to adorn with immortal praise were dear to certain gods …</p>
            </div>
          </div>
          <p class="ds-note">Juan de Mariana, <i>De rege</i>, 1599. Tier A, public domain, scan from the Internet Archive; transcribed in February 2026 and translated in March 2026. Text shortened here.</p>
        </details>
        <details class="ds-more"><summary>Known limits</summary>
          <ul class="ds-limits">
            <li>Words are whitespace-separated, so they undercount Chinese, Japanese, Tibetan and Thai; the manifest also gives characters (10.7B original, 11.1B English).</li>
            <li>The text is machine-written. Scholars check hard cases by language; most pages have had no human reader. Error rates are on the <a href="https://sourcelibrary.org/quality">quality page</a>.</li>
            <li>A page's text and image can be a leaf apart. A screen of 1,497 random books found text one page off its images in about 1% of books (<a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5803">open issue</a>). We have not measured how often the stored image is the wrong side.</li>
            <li>Catalogue years are often the date of composition, a series or a reprint. 11,930 books have none.</li>
            <li>The 208 languages are catalogue labels, including mixed ones such as Greek-Latin. Latin is 41% of the pages.</li>
            <li>Illustration types and scores are model output. One graded sample is on this page under <a href="#v2-illustrated">Illustrated</a>.</li>
          </ul>
        </details>
        <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request the datasheet and a sample</a></p>
      </div>
    </article>
  </div>
</section>

<section class="summary">
  <div class="wrap">
    <div class="letter">
      <p class="eyebrow">Summary</p>
      <p>Source Library is a digital library of translated historical sources: 131,000 books in more than fifty languages, over 22,000 of them readable in English, each translation set beside its original page. Among them are 11,357 works translated into English for the first time, and 2,347 from the Ritman Library in Amsterdam, available nowhere else online.</p>
      <p>Source Library is a non-profit project of Wisdom Frontiers and the Embassy of the Free Mind. We welcome conversations with partners who wish to see the remaining 20.2 million pages read and released.</p>
      <p class="sig">Derek Lomas<span>Founder, Source Library</span></p>
      <p class="addr"><a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20AI%20partnership">derek@sourcelibrary.org</a></p>
      <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="https://sourcelibrary.org/licensing">Licensing terms</a><a href="https://sourcelibrary.org/developers">API and MCP</a></p>
    </div>
  </div>
</section>
`;
