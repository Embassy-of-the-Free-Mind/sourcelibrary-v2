// Body of the AI-partners page (everything between the site header and footer).
// Plain HTML, no scripts: edit it here. Styles: ./ai-partners.css. Images: public/ai-partners/img/.
export const PARTNERS_HTML = `
<section class="hero">
  <div class="wrap">
    <div>
      <h1>The world's largest library of <em>translated</em> historical sources</h1>
      <p>22,500 books in English, translated from more than fifty languages, most of them printed between 1450 and 1800. Each translation is set opposite the page it came from, so any line can be checked against the original. About half had never been in English before. Behind them stand 131,000 books with their page scans, and 235,000 illustrations cropped from the pages.</p>
      <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20AI%20partnership">Talk to us</a></p>
    </div>
    <figure>
      <img src="/ai-partners/img/fludd-empyrean.jpg" alt="Engraved circle of the heavens: a dark starry core, a ring of stars, and an outer band of flames">
      <figcaption><a href="https://sourcelibrary.org/book/69904dd67d19f3f2aac1d49d?page=140">Robert Fludd, <i>Utriusque cosmi historia</i>, 1617: the Empyrean heaven · Source Library</a></figcaption>
    </figure>
  </div>
</section>

<nav class="pillars" aria-label="What the corpus is">
  <div class="wrap">
    <ol>
      <li><a href="#v2-collected"><strong>Collected</strong><span>131,000 books from 30+ libraries</span></a></li>
      <li><a href="#v2-transcribed"><strong>Transcribed</strong><span>9.6M pages in the original script</span></a></li>
      <li><a href="#v2-translated"><strong>Translated</strong><span>5.7M pages into English</span></a></li>
      <li><a href="#v2-illustrated"><strong>Illustrated</strong><span>235,000 pictures cropped from the page</span></a></li>
      <li><a href="#v2-reviewed"><strong>Checked</strong><span>Language by language, with scholars</span></a></li>
      <li><a href="#v2-rights"><strong>Rights</strong><span>Stated book by book</span></a></li>
      <li><a href="#v2-card"><strong>Dataset card</strong><span>Size, schema, files and limits</span></a></li>
      <li><a href="#v2-available"><strong>Available now</strong><span>Streaming API and MCP</span></a></li>
    </ol>
  </div>
</nav>

<section class="dsband" id="v2-card">
  <div class="wrap">
    <article class="ds" aria-labelledby="ds-title">
      <header class="ds-head">
        <p class="ds-kicker">Dataset card</p>
        <h2 id="ds-title">Source Library historical corpus</h2>
        <p class="ds-ver"><code>v0</code> · snapshot 30 October 2026</p>
        <p class="ds-sum">Page images, transcriptions in the original language and aligned English translations of historical books and manuscripts, with rights and provenance on every record. This card describes the part of the public library offered for licence.</p>
        <dl class="ds-tags">
          <div><dt>Modalities</dt><dd><span>Text</span><span>Image</span></dd></div>
          <div><dt>Tasks</dt><dd><span>Image-to-text</span><span>Translation</span><span>Text-image retrieval</span><span>Object detection</span><span>Image classification</span></dd></div>
          <div><dt>Formats</dt><dd><span>JSONL (gzip)</span><span>JPEG</span></dd></div>
          <div><dt>Size</dt><dd><span>1M–10M pages</span><span>100K–1M illustrations</span></dd></div>
          <div><dt>Languages</dt><dd><span>Latin</span><span>German</span><span>Greek</span><span>French</span><span>Chinese</span><span>+ 203 labels</span></dd></div>
          <div><dt>Licence</dt><dd><span>By rights tier</span><span>Translations: CC share-alike</span></dd></div>
        </dl>
      </header>

      <div class="ds-body">
        <div class="ds-main">
          <h3>Subsets</h3>
          <div class="ds-scroll">
            <table class="ds-t ds-num">
              <thead><tr><th>Tier</th><th>Books</th><th>Text pages</th><th>English pages</th><th>Original words</th><th>English words</th><th>Page images</th><th>Illustrations</th></tr></thead>
              <tbody>
                <tr><td><b>A</b></td><td>11,929</td><td>2,594,799</td><td>2,169,624</td><td>976M</td><td>1.09B</td><td>Licensable</td><td>107,017</td></tr>
                <tr><td><b>B</b></td><td>8,428</td><td>849,762</td><td>679,357</td><td>263M</td><td>297M</td><td>Excluded</td><td>Excluded</td></tr>
                <tr><td><b>U</b></td><td>8,343</td><td>1,417,881</td><td>1,045,615</td><td>426M</td><td>451M</td><td>Unstated</td><td>Unstated</td></tr>
                <tr class="ds-total"><td>All</td><td>28,700</td><td>4,862,442</td><td>3,894,596</td><td>1.67B</td><td>1.84B</td><td></td><td>107,017</td></tr>
              </tbody>
            </table>
          </div>
          <p class="ds-note"><b>A</b>: the holding library states public domain, CC0, CC BY or CC BY-SA, or the scans are the Ritman Library's own. <b>B</b>: the library states non-commercial, no-derivatives or its own terms; the text is under legal review. <b>U</b>: the library has not stated its terms. Tiers count books by what the library says about its images, not by our importer's default. Words are whitespace-separated, so they undercount Chinese, Japanese, Tibetan and Thai; the manifest also gives characters (10.7B original, 11.1B English).</p>

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
          <p class="ds-note">Juan de Mariana, <i>De rege</i>, 1599. Tier A, public domain, scan from the Internet Archive; transcription and translation by <code>gemini-3-flash-preview</code>. Text shortened here.</p>

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

          <h3>Files</h3>
          <div class="ds-scroll">
            <table class="ds-t ds-schema">
              <thead><tr><th>File</th><th>Rows</th><th>Contents</th></tr></thead>
              <tbody>
                <tr><td><code>manifest.jsonl.gz</code></td><td>28,700</td><td>One row per book: rights, engines, page and word counts</td></tr>
                <tr><td><code>excluded.jsonl.gz</code></td><td>187,555</td><td>Every excluded book and page, with the reason</td></tr>
                <tr><td><code>sample-5000.jsonl.gz</code></td><td>5,000</td><td>Tier A page records from 2,256 books in 111 languages</td></tr>
                <tr><td><code>DATASHEET.md</code>, <code>release.json</code></td><td></td><td>How the set was built; counts, commit and SHA-256 of every file</td></tr>
              </tbody>
            </table>
          </div>
          <p class="ds-note">The full page text ships under a licence. The illustrations are not yet in the v0 files; we export them as a separate table on request. A second sample of ten complete books with notes is also available.</p>

          <h3>Known limits</h3>
          <ul class="ds-limits">
            <li>The text is machine-written. Scholars check hard cases by language; most pages have had no human reader. Error rates are on the <a href="https://sourcelibrary.org/quality">quality page</a>.</li>
            <li>A page's text and image can be a leaf apart. A screen of 1,497 random books found text one page off its images in about 1% of books (<a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5803">open issue</a>). We have not measured how often the stored image is the wrong side.</li>
            <li>Catalogue years are often the date of composition, a series or a reprint. 11,930 books have none.</li>
            <li>The 208 languages are catalogue labels, including mixed ones such as Greek-Latin. Latin is 41% of the pages.</li>
            <li>Illustration types and scores are model output. One graded sample is on this page under <a href="#v2-illustrated">Illustrated</a>.</li>
          </ul>
        </div>

        <aside class="ds-side" aria-label="Specifications">
          <dl>
            <div><dt>Books</dt><dd>28,700</dd></div>
            <div><dt>Pages with text</dt><dd>4.86M</dd></div>
            <div><dt>Pages with English</dt><dd>3.89M</dd></div>
            <div><dt>Licensable illustrations</dt><dd>107,017</dd></div>
            <div><dt>Sources</dt><dd>59 libraries and aggregators</dd></div>
            <div><dt>Period</dt><dd>79% of pages dated 1400–1899; 9% undated</dd></div>
            <div><dt>Tokens</dt><dd>Not measured for this subset. Whole corpus: about 21B</dd></div>
            <div><dt>Transcription</dt><dd>Gemini 3 Flash 60%, 3.1 Flash-Lite 35%, PaddleOCR-VL 2%, other 3%</dd></div>
            <div><dt>Translation</dt><dd>Gemini 3.1 Flash-Lite 63%, 3 Flash 36%, other under 1%</dd></div>
            <div><dt>Excluded</dt><dd>41,256 held books; editions from 1930 on; 98,354 withheld pages; 46,933 pages written by Claude</dd></div>
            <div><dt>Refresh</dt><dd>Planned quarterly</dd></div>
          </dl>
          <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="https://sourcelibrary.org/licensing">Licensing terms</a></p>
        </aside>
      </div>
    </article>
  </div>
</section>

<section class="band dark">
  <div class="wrap why">
    <div>
      <p class="eyebrow">The untranslated record</p>
      <h2>Most Renaissance Latin has never been translated into English</h2>
      <p>The translation of ancient texts in fifteenth-century Florence helped give rise to the Renaissance. Yet some nine in ten Latin works written in the Renaissance have never been translated into English. In our own library, 11,357 books are the first English translation of their work, about half of all we have made readable in English. Half of them are Latin; the rest are from Chinese (1,946), German (1,447), Dutch, French, Greek, Tibetan and dozens of other languages.</p>
      <p class="cap" style="color:var(--night-muted)">Measured against the Universal Short Title Catalogue: of Latin works composed and printed 1480–1620, 93% (91–95%) have no English translation on record, from a seeded random sample of 1,000 catalogue works, each searched for an English translation by AI search agents and not yet checked by a human panel. A second search of the same sample with a different model found 97% (95–98%); it missed some well-known translations, so we quote the lower figure. Debora Shuger’s estimate was roughly 90%. In our library: every translated book is searched for an earlier English translation, one at a time, by an AI search agent that links any translation it finds; 25,007 books had been searched by 2 November 2026. A book is marked a first translation only when no earlier one is found, and 11,357 works carry that mark. Spot checks of 55 marked books by a second model: 50 held, none was refuted, 5 unclear.</p>
    </div>
    <figure style="margin:0">
      <div class="frame"><img src="/ai-partners/img/hero.jpg" alt="An early printed Latin page naming Marsilio Ficino and Pico della Mirandola"></div>
      <figcaption class="cap" style="color:var(--night-muted)">An early printed page naming Marsilio Ficino and Giovanni Pico della Mirandola.</figcaption>
    </figure>
  </div>
</section>

<section class="proof" id="v2-collected">
  <div class="wrap pf">
    <h2 class="pword">Collected</h2>
    <div>
      <p class="lede">Assembled from more than thirty libraries and catalogued by work, edition and author.</p>
      <table class="ledger">
        <tr><td>Books held, with their page scans</td><td class="n">131,547</td></tr>
        <tr><td>Public on the site</td><td class="n">70,968</td></tr>
        <tr><td>Public and readable in English</td><td class="n">20,278</td></tr>
        <tr><td>Page images held</td><td class="n">29.8M</td></tr>
        <tr><td>Images held: page scans, artworks and illustrations</td><td class="n">32 TB</td></tr>
        <tr><td>Ritman Library books, found only here</td><td class="n">2,347</td></tr>
      </table>
      <p class="note">Counted 29 October 2026; duplicates, takedowns and catalogue-only records are excluded. A further 409,000 books printed before 1850 are catalogued from partner libraries, linked to their scans, and queued to be read; they are not counted above. Storage measured 28 October.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-transcribed">
  <div class="wrap pf">
    <h2 class="pword">Transcribed</h2>
    <div>
      <p class="lede">9.6 million pages transcribed in their original language and script. Latin and classical Chinese predominate, alongside German, French, Italian, Greek, Hebrew, Arabic, Syriac, Sanskrit, Tibetan and Yucatec Maya.</p>
      <p>Each page is indexed by the people, places and ideas it names, so an idea can be followed from book to book.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-translated">
  <div class="wrap pf">
    <h2 class="pword">Translated</h2>
    <div>
      <p class="lede">5.7 million pages in English, each aligned with its original. Of these, 11,357 works appear in English for the first time.</p>
      <figure style="margin:8px 0 28px">
        <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta/page/20"><img src="/ai-partners/img/reader-sanskrit.jpg" alt="A page of Kamalākara’s Siddhānta-tattva-viveka in the reader: the scan, the Sanskrit transcription and the English translation side by side, with notes on technical terms" style="width:100%;height:auto;display:block;border:1px solid rgba(0,0,0,.08)" loading="lazy" width="1440" height="808"></a>
        <figcaption class="cap">Scan, transcription and translation side by side: Kamalākara’s <em>Discernment of the Principles of Astronomy</em> (1658), on the lengths of the cosmic cycle. Notes explain technical terms and give the original word.</figcaption>
      </figure>
      <h3 style="margin-top:8px">Books readable in English, by date</h3>
      <p class="note" style="margin-bottom:18px">By the year the edition was printed, or the manuscript written, which is often later than the work was composed. The darker part of each bar is the books marked as first English translations. 4,168 books with no recorded date are not shown. Counted 2 November 2026.</p>
      <div class="bar"><span>before 1400</span><i class="st"><b style="width:5.0%"></b><s style="width:6.0%"></s></i><span>507</span></div>
      <div class="bar"><span>1400s</span><i class="st"><b style="width:12.8%"></b><s style="width:17.8%"></s></i><span>1,404</span></div>
      <div class="bar"><span>1500s</span><i class="st"><b style="width:39.7%"></b><s style="width:35.0%"></s></i><span>3,422</span></div>
      <div class="bar"><span>1600s</span><i class="st"><b style="width:72.0%"></b><s style="width:28.0%"></s></i><span>4,586</span></div>
      <div class="bar"><span>1700s</span><i class="st"><b style="width:31.3%"></b><s style="width:18.6%"></s></i><span>2,289</span></div>
      <div class="bar"><span>1800s</span><i class="st"><b style="width:14.5%"></b><s style="width:57.0%"></s></i><span>3,279</span></div>
      <div class="bar"><span>1900 on</span><i class="st"><b style="width:7.6%"></b><s style="width:55.3%"></s></i><span>2,884</span></div>
      <div class="legend" style="margin-top:14px"><span><i class="sw tr"></i>first English translation</span><span><i class="sw tc"></i>other books readable in English</span></div>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-illustrated">
  <div class="wrap pf">
    <h2 class="pword">Illustrated</h2>
    <div>
      <p class="lede">235,714 illustrations cropped from the pages of about 18,700 books. Each has its position on the page, a type and a description, and links back to the page it came from. Nearly all carry subject tags.</p>
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
        <tr><td>From Tier A books, images licensable</td><td class="n">107,017</td></tr>
      </table>
      <h3 style="margin-top:28px">By type</h3>
      <div class="bar"><span>Diagram</span><i style="width:100%"></i><span>82,981</span></div>
      <div class="bar"><span>Woodcut</span><i style="width:74.1%"></i><span>61,487</span></div>
      <div class="bar"><span>Engraving</span><i style="width:42.2%"></i><span>35,010</span></div>
      <div class="bar"><span>Emblem</span><i style="width:15.1%"></i><span>12,492</span></div>
      <div class="bar"><span>Portrait</span><i style="width:11.1%"></i><span>9,185</span></div>
      <div class="bar"><span>Music</span><i style="width:10.9%"></i><span>9,052</span></div>
      <div class="bar"><span>Decorative</span><i style="width:8.7%"></i><span>7,257</span></div>
      <div class="bar"><span>Map</span><i style="width:7.8%"></i><span>6,464</span></div>
      <div class="bar"><span>Frontispiece</span><i style="width:7.2%"></i><span>5,968</span></div>
      <div class="bar"><span>Symbol</span><i style="width:6.7%"></i><span>5,574</span></div>
      <div class="bar"><span>Bookplate</span><i style="width:1.7%"></i><span>1,425</span></div>
      <p class="note" style="margin-top:14px">Counted 4 November 2026, against the rights tiers of 30 October. Types are the labels the extraction model gave, counted over all 236,918 records, including the 1,204 with no crop file. The other books in the library have not all been processed.</p>
      <p class="note">Box accuracy of the current model, Gemini 3 Flash, which drew about three in five of the crops: 81.6% of boxes were tight (95% CI 68–92) and it found 95% of the pictures, on 38 pictures across 48 pages, graded by model readers with each page image open (September 2026). On 10 of those 48 pages it boxed something that was not an illustration, such as a cover label or a bookplate. About two in five crops have no model recorded, and those have not been graded.</p>
      <p>The public illustrations can be browsed in the <a href="https://sourcelibrary.org/gallery">gallery</a> and searched through the <code>search_images</code> tool on our <a href="https://sourcelibrary.org/developers">MCP server</a>.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-reviewed">
  <div class="wrap pf">
    <h2 class="pword">Checked</h2>
    <div>
      <p class="lede">Each language has its own scripts, abbreviations and habits, and models read some far better than others. So each one is worked out separately, and scholars who read it check the hard cases.</p>
      <table class="ledger">
        <tr><td>Yucatec Maya</td><td class="who">David Stuart</td></tr>
        <tr><td>Latin and Sanskrit</td><td class="who">Peter J. Forshaw</td></tr>
        <tr><td>Latin, and early printed books</td><td class="who">Paul Dijstelberge</td></tr>
      </table>
      <p>What they find goes back into how that language is read: which model, which instructions, and when a page needs a second reading. We have logged 427 experiments on reading and translation quality. Translations are tested against published human translations in fourteen languages, errors are sorted into 44 kinds, and the error rates are <a href="https://sourcelibrary.org/quality">published</a>.</p>
      <p class="note">Latin, two-fifths of the English pages: transcriptions differ from a published text of the same printing by a median 3.7% of characters (77 pages), most of it the long s read as f, and 86% of English pages were rated 4 or 5 of 5 by a model judge against a published human translation (71 pages). Figures for each language, with their samples, are on the <a href="https://sourcelibrary.org/quality">quality page</a>; as of 26 October 2026.</p>
      <p>The record of this work is kept with the text: several readings of the same page, how each was judged against the image, and each correction beside the reading it replaced. It shows where models fail on old books, and why. 1,535 people have offered to help, and readers report what they find.</p>
      <div class="photos">
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
      <p>For a training licence (counted 30 October 2026): <strong>text</strong> from 28,700 books, 4.9 million pages; <strong>images</strong> from 11,929 of them, 2.6 million pages, where the holding library permits commercial use of its scans. For 8,428 of the text books the library's scans carry non-commercial terms; that text is under legal review. For a further 8,343 the library has not stated its terms, and their images are treated as non-commercial until it does. Pages read or translated by Claude are excluded.</p>
      <p>Translations, notes and indexes are original to Source Library and published under a Creative Commons share-alike licence. Search, retrieval for a user and individual use are free; training at scale is licensed directly. The terms and the rate card are on the <a href="https://sourcelibrary.org/licensing">licensing page</a>.</p>
    </div>
  </div>
</section>

<section class="proof" id="v2-provenance">
  <div class="wrap pf">
    <h2 class="pword">Provenance</h2>
    <div>
      <p class="lede">Every page can be traced to the scan it was read from and the model that read it.</p>
      <p>Each book names the library that holds the original, with a link to its scan and, where the library gives one, its rights statement. Each transcription and translation records the model that produced it; since 28 September 2026 it also records the exact prompt, the settings, the run and the image or text it was made from, with a hash of the output. When a page is corrected or re-read, the earlier version is kept.</p>
    </div>
  </div>
</section>

<section class="proof alt" id="v2-available">
  <div class="wrap pf">
    <h2 class="pword">Available now</h2>
    <div>
      <p class="lede">The public library is available now through our streaming API and <a href="https://sourcelibrary.org/developers">MCP server</a>, with a stable citation link for every passage. The whole corpus, public and held, comprises about 21 billion tokens, three times the size of English Wikipedia: 15 billion in the original languages and 6 billion of English translation, each page aligned to its scan.</p>
      <p class="note">Measured 29 October 2026 with the o200k tokenizer over a random sample of 12,000 pages, multiplied by the exact counts of transcribed and translated pages; by the median page, about 14.5 billion. English Wikipedia’s articles hold about 5 billion words, some 6.5 billion tokens. In words the library is half as large again, 7.7 billion: Latin, Chinese and Sanskrit take more tokens per word than English.</p>
      <table class="ledger">
        <tr><td>Page views by readers, last 7 days</td><td class="n">103K</td></tr>
        <tr><td>Pages fetched by ChatGPT and Claude for their users, last 7 days</td><td class="n">28K</td></tr>
        <tr><td>Library tool calls by Claude for its users through our MCP server, last 7 days</td><td class="n">35K</td></tr>
        <tr><td>Automated requests stopped at our network edge, per day</td><td class="n">~800K</td></tr>
        <tr><td>Bulk requests rate-limited by the site, last 30 days</td><td class="n">1.9M</td></tr>
      </table>
      <p class="note">Search engines and assistants acting for a user read freely. Training crawlers get the licence terms and a preview of each book. Counted 28 October 2026 from the site's logs; the assistant figures from Cloudflare's logs by user agent (ChatGPT-User, Claude-User), 26 October–1 November, not counting search-index crawlers such as OAI-SearchBot; the edge figure is the average of 26–27 October (blocked, or challenged and not passed), from Cloudflare.</p>
      <p>Representative works include Robert Fludd's <a href="https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd">History of the Two Worlds</a> (1617); Athanasius Kircher's <a href="https://sourcelibrary.org/book/mundus-subterraneus-kircher">Mundus Subterraneus</a> (1678); the <a href="https://sourcelibrary.org/book/imperial-collection-of-mathematical-essentials-vol-2">Collected Essentials of Mathematics</a> commissioned by the Kangxi emperor (1723); Kamalākara's <a href="https://sourcelibrary.org/book/siddhanta-tattva-viveka-bhatta">Discernment of the Principles of Astronomy</a> (1658), a Sanskrit treatise that takes issue with Bhāskara; and the <a href="https://sourcelibrary.org/book/collected-works-of-the-8th-gyalwang-drukpa-kunzik-chokyi-1768-1822">collected works</a> of the eighth Gyalwang Drukpa (1768–1822). A description of <a href="https://sourcelibrary.org/dataset">the dataset</a> is also available.</p>
    </div>
  </div>
</section>

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

<section class="summary">
  <div class="wrap">
    <div class="letter">
      <p class="eyebrow">Summary</p>
      <p>Source Library is a digital library of translated historical sources: 131,000 books in more than fifty languages, over 20,000 of them readable in English, each translation set beside its original page. Among them are 11,357 works translated into English for the first time, and 2,347 from the Ritman Library in Amsterdam, available nowhere else online.</p>
      <p>Source Library is a non-profit project of Wisdom Frontiers and the Embassy of the Free Mind. We welcome conversations with partners who wish to see the remaining 20.2 million pages read and released.</p>
      <p class="sig">Derek Lomas<span>Founder, Source Library</span></p>
      <p class="addr"><a href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20AI%20partnership">derek@sourcelibrary.org</a></p>
      <p class="cta"><a class="primary" href="mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20sample%20and%20datasheet">Request a sample</a><a href="https://sourcelibrary.org/licensing">Licensing terms</a><a href="https://sourcelibrary.org/developers">API and MCP</a></p>
    </div>
  </div>
</section>
`;
