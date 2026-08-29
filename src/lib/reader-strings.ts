// Pure type import from the server-safe module — see the note in
// `src/lib/i18n.ts` about why server code (this catalogue may be read from
// `layout.tsx`'s generateMetadata) must not import `@/lib/i18n` itself.
import type { Locale } from '@/lib/locale-path';

/**
 * Chrome strings for the redesigned reader (`reader-v2`, currently
 * `Reader2C.tsx` and the small files mounted beside it: `ReaderV2Bits.tsx`,
 * `SavePanel.tsx`, `PaneEmptyState.tsx`, `RevisionHistoryPanel.tsx`,
 * `PinnedVersion.tsx`, `ReaderSettingsControls.tsx`).
 *
 * Every component listed above reads this catalogue directly: it calls
 * `useLocale()` for the locale in the URL and `getReaderStrings(lang)` for the
 * chrome, so nothing is threaded through props or context. A new string in any
 * of those files gets a key here in BOTH languages, or it ships English to a
 * Spanish reader.
 *
 * Shape and precedent:
 * - Follows the site's established pattern (`NAV_STRINGS` in `src/lib/i18n.ts`,
 *   `READER_STRINGS`/`BOOK_STRINGS` in `src/lib/book-i18n.ts` for the OLD
 *   reader on `main` — this worktree predates that work, see the report) —
 *   one `Record<Locale, T>` object, no per-language columns, English never
 *   written into a translated slot.
 * - Vocabulary is matched to `book-i18n.ts`'s `READER_STRINGS` where the same
 *   concept already has an established Spanish rendering (previousPage,
 *   nextPage, jumpToPage, contents, searchThisBook, notes, copy/copied,
 *   readingSettings, theme names, cancel/send/sending), so the two readers
 *   don't teach a Spanish reader two different words for "next page."
 *
 * What is deliberately OUT of this catalogue:
 * - Editor-only tooling (Edit this page / Stop editing / Edit transcription /
 *   Edit translation / Cancel+Save in edit mode / Complete OCR first / Open
 *   pipeline / Restore this version / Restoring…). `.claude/docs/i18n.md`:
 *   "EDITOR tooling is deliberately NOT localized — Run OCR, Edit Prompt,
 *   Translate, the settings dialogs, the whole edit mode. It is staff-only,
 *   English is its working language, and translating it would advertise a
 *   Spanish editing workflow we do not offer." Same rule applied here.
 * - `ReaderSpanishToggle.tsx` / `ModernizedText.tsx` / `PairedEdition.tsx`
 *   content-mode strings (the EN/ES *translation-pane* toggle, the
 *   Scholarly/Modern register toggle, the one-book Marcianus overlay). These
 *   are a different axis from UI locale — which language/register the PAGE
 *   TEXT itself renders in, independent of whether the reader's own chrome is
 *   in English or Spanish — and mostly ship English UI labels around
 *   already-Spanish content today. Out of scope for this pass; flagged in the
 *   report.
 * - Anything data-driven with no fixed English source (chapter titles, guide
 *   prose, librarian answers, citation text) — these come from the database
 *   or a model, not from this file.
 */

export interface ReaderStrings {
  /** Desktop rail / mobile toolbar tool labels + top-bar nav. */
  toolbar: {
    contents: string;
    guide: string;
    search: string;
    librarian: string;
    save: string;
    share: string;
    cite: string;
    download: string;
    info: string;
    views: string;
    pages: string;
    settings: string;
    feedback: string;
    more: string;
    menu: string;
    readerToolsAria: string;
    previousPage: string;
    nextPage: string;
    /** Foot-of-page pager on mobile, where the slot is a word, not a tooltip. */
    previous: string;
    next: string;
    close: string;
    jumpToPage: string;
    backToTheBook: string;
    backToTheBookPage: string;
    backToTheReader: string;
    scanFullScreen: string;
    viewScanFullScreen: string;
  };

  /** LEFT_PANEL_TITLES / LEFT_PANEL_BLURBS — one line under each drawer title. */
  panels: {
    titles: {
      save: string;
      menu: string;
      contents: string;
      search: string;
      guide: string;
      librarian: string;
      info: string;
      cite: string;
      share: string;
      settings: string;
      views: string;
      downloads: string;
      history: string;
      feedback: string;
      more: string;
    };
    blurbs: {
      contents: string;
      search: string;
      guide: string;
      librarian: string;
      info: string;
      cite: string;
      share: string;
      settings: string;
      views: string;
      downloads: string;
      history: string;
    };
    /** `Close {title}` on the drawer's own dismiss button. */
    closeAria: (title: string) => string;
    /** Mobile only: a tool opened from More can step back to it. */
    backToMore: string;
  };

  /** MORE_TOOLS on mobile: label + one-line blurb, same ten tools as `panels`
   *  but worded for a single-line list row rather than a drawer header. */
  moreMenu: {
    contents: string;
    contentsBlurb: string;
    guide: string;
    guideBlurb: string;
    search: string;
    searchBlurb: string;
    librarian: string;
    librarianBlurb: string;
    cite: string;
    citeBlurb: string;
    downloads: string;
    downloadsBlurb: string;
    info: string;
    infoBlurb: string;
    history: string;
    historyBlurb: string;
    settings: string;
    settingsBlurb: string;
    feedback: string;
    feedbackBlurb: string;
    menu: string;
    menuBlurb: string;
  };

  /** Scan / OCR / translation panes: view toggle, zoom, lens, notes, trace, copy. */
  panes: {
    /** ViewToggleGroup chip labels. */
    viewScan: string;
    viewOcr: string;
    viewRoman: string;
    viewEnglish: string;
    visiblePanesAria: string;
    showPane: (label: string) => string;
    lastPaneShowing: string;

    /** Stands in for the book's language when the record has none, in the
     *  pane header and the Views row (`Original · OCR`). */
    originalFallback: string;
    /** Pane header over the romanisation column — shorter than the Views row. */
    romanisedHeader: string;
    /** The AI label on the romanisation pane, and its tooltip. */
    aiTranslated: string;
    aiShort: string;
    aiTitle: string;
    /** Corpus editions (#4350): chip on a translation that is the corpus's
     *  own scholarly work — must never read as AI output. */
    corpusChip: (shortName: string) => string;
    corpusChipTitle: (name: string) => string;
    /** Scan pane, when a CDLI tablet witness stands in for the missing scan. */
    tabletWitness: string;
    witnessCount: (index: number, total: number) => string;
    witnessNotSource: (shortName: string) => string;
    witnessAlt: (designation: string) => string;
    prevWitness: string;
    nextWitness: string;
    viewOnCdli: string;
    noFacsimile: string;
    /** Alt text for the facsimile itself. */
    scanAlt: (pageNumber: number, title: string) => string;

    /** Views panel row titles + hints (Scan, OCR, English, Romanised). */
    originalScan: string;
    originalScanHint: string;
    /** `{language} transcription`, e.g. "Latin transcription". */
    transcriptionOf: (language: string) => string;
    transcriptionHint: string;
    englishTranslation: string;
    englishTranslationHint: string;
    romanisedTranscription: string;
    romanisedTranscriptionHint: string;

    zoomOut: string;
    zoomIn: string;
    resetZoom: string;
    readingLens: string;
    readingLensOff: string;
    readingLensUnavailable: string;

    notes: string;
    showNotes: string;
    hideNotes: string;
    trace: string;
    turnTracingOff: string;
    /** Stands in for the book's language inside `traceHint` when the record
     *  has none — it reads mid-sentence, so it carries its own article. */
    traceFallbackLanguage: string;
    /** `Trace: click any phrase to see it in the {language}` */
    traceHint: (language: string) => string;
    traceAligning: string;
    traceUnavailable: string;
    /** Why the chip is there but dead while the Spanish translation is shown:
     *  the alignment record holds English spans only. */
    traceEnglishOnly: string;
    /** Placeholder on a page whose whole text is an AI description, with the
     *  Notes toggle off. Takes the page type, already labelled. */
    descriptionHidden: (pageTypeLabel: string) => string;
    traceRateLimited: string;
    traceClickHint: string;

    /** Romanisation pane: the wait, and the two states with no text. */
    romanising: string;
    /** Reads after the elapsed seconds, so it starts lower-case. */
    romanisingLonger: string;
    romanisingEstimate: (seconds: number) => string;
    translitFailed: string;
    translitNone: string;

    copyTranscription: string;
    copyTranslation: string;
    copyTransliteration: string;
    copied: string;

    marksMeaning: string;
    /** The same idea in a tooltip's worth of room. */
    marksMeaningShort: string;
    marksInText: string;
    markGlossOrTerm: string;
    markGlossOrTermDesc: string;
    markOnThePage: string;
    markOnThePageDesc: string;
    markOurNote: string;
    markOurNoteDesc: string;
    marksHiddenByNotes: string;
  };

  /** Contents panel. */
  contents: {
    noContentsTranscribed: string;
    noContentsAtAll: string;
  };

  /** Reading guide panel. */
  guide: {
    noGuideYet: string;
    requestGuide: string;
    requestGuideThanks: string;
    /** The request POST failed, so nothing was queued. */
    requestFailed: string;
    showLess: string;
    readFullOverview: (more: number) => string;
    sections: string;
    readThisSection: string;
  };

  /** Search-this-book panel. */
  search: {
    placeholder: string;
    inputAria: string;
    noMatches: string;
    /** The search itself failed (rate limited, offline), as opposed to finding nothing. */
    failed: string;
    /** `${total} pages match` / singular */
    pagesMatch: (total: number) => string;
    pageLabel: (n: number) => string;
  };

  /** Ask-the-librarian panel. */
  librarian: {
    suggestions: string[];
    /** Sits over the suggestions, under the field they are an alternative to. */
    orStartHere: string;
    /** `Ask about p. {n}…` in the composer. */
    askAboutPage: (pageNumber: number | string) => string;
    inputAria: string;
    ask: string;
    consulting: string;
    askErrorInline: string;
  };

  /** Edition & page info panel. */
  info: {
    thisPage: string;
    thisEdition: string;
    howPageWasMade: string;
    fieldTitle: string;
    fieldEnglish: string;
    fieldAuthor: string;
    fieldLanguage: string;
    fieldPlace: string;
    fieldPublisher: string;
    fieldPublished: string;
    fieldFormat: string;
    fieldPages: string;
    fieldScan: string;
    fieldTranscript: string;
    /** "Photographed from the printed edition, p. N" */
    scannedFrom: (pageNumber?: number) => string;
    /** "Read from the scan by {model}" */
    transcribedBy: (model: string) => string;
    /** "Translated from the transcript by {model}" */
    translatedBy: (model: string) => string;
    machineNotice: string;
    /** Corpus editions (#4350): no scan exists, and the text (for ETCSL, the
     *  translation too) is the corpus editors' scholarly work, not AI's. */
    corpusNoScan: (witnessCount: number) => string;
    corpusTranscript: (name: string, org?: string) => string;
    corpusTranslation: (name: string) => string;
    corpusNotice: string;
    corpusAiNotice: (name: string) => string;
  };

  /** Cite panel. */
  cite: {
    copyCitation: string;
    copied: string;
  };

  /** Share panel. */
  share: {
    copyLink: string;
    copyLinkWithReference: string;
    postTo: string;
    /** The only share target that is a common noun — the rest are brand names
     *  and stay as they are written everywhere else. */
    email: string;
  };

  /**
   * A text pane with nothing in it (PaneEmptyState). The editor states there
   * ("Complete OCR first", "Open pipeline") stay in English with the rest of
   * the editor tooling — see the file header.
   */
  paneEmpty: {
    notTranscribed: string;
    notTranscribedBody: string;
    blankPage: string;
    readyToTranslate: string;
    readyToTranslateBody: string;
    signInToRequest: string;
    requestTranslation: string;
    /** The request POST failed, so nothing was queued. */
    requestFailed: string;
    sending: string;
    requested: string;
    thanksWillEmail: string;
    thanksWillPrioritise: string;
  };

  /** Save panel (likes, not folders — see SavePanel.tsx's own comment). */
  save: {
    anonymousNotice: string;
    signInToKeep: string;
    savedPage: string;
    savePage: string;
    /** `Saved "{title}"` */
    savedBook: (title: string) => string;
    saveBook: string;
    saveFailed: string;
    yourLibrary: string;
    everythingSaved: string;
  };

  /** Download panel. */
  downloads: {
    thisPage: string;
    /** "The scan of p. N" */
    scanOfPage: (pageNumber?: number) => string;
    scanFormatNote: string;
    noScanArchived: string;
    thisPageComplete: string;
    thisPageCompleteNote: string;
    dailyLimitReached: string;
    signInToDownload: string;
    downloadFailed: string;
    wholeBook: string;
  };

  /** Feedback panel — a note to us about this page or the reader itself. */
  feedback: {
    blurb: string;
    placeholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    emailNote: string;
    send: string;
    sending: string;
    thanks: string;
    failed: string;
    tooShort: string;
    /** Reminds the reader which page the note will carry. */
    aboutPage: (pageNumber: number | string) => string;
  };

  /** Revision history panel (public; the Restore action itself stays
   *  editor-only/English — see the file header note). */
  history: {
    /** A restore that came back 403, and one that failed some other way. */
    restoreForbidden: string;
    restoreFailed: string;
    title: string;
    loading: string;
    loadFailed: string;
    noRevisions: string;
    onlyMaintenance: string;
    chars: string;
    /** "Show N bulk-maintenance revisions" / "Hide …" */
    showMaintenance: (n: number) => string;
    hideMaintenance: (n: number) => string;
    maintenanceNote: string;
    /** Relative dates on a revision row. `today` takes an already-formatted time. */
    today: (time: string) => string;
    yesterday: string;
    daysAgo: (n: number) => string;
    sourceAi: string;
    sourceBatch: string;
    sourceManual: string;
    sourceContributor: string;
    sourceMaintenance: string;
    fieldTranscript: string;
    fieldTranslation: string;
  };

  /** Reading settings panel/popover. */
  settings: {
    theme: string;
    themeLight: string;
    themeSepia: string;
    themeDark: string;
    textSize: string;
    smallerText: string;
    largerText: string;
    lineWidth: string;
    lineWidthNarrow: string;
    lineWidthNormal: string;
    lineWidthWide: string;
    typeface: string;
    typefaceSerif: string;
    typefaceSans: string;
    lineHeight: string;
  };

  /** Reader account/menu panel (library links, account, site language). */
  accountMenu: {
    library: string;
    collections: string;
    gallery: string;
    browse: string;
    catalogue: string;
    works: string;
    explore: string;
    librarian: string;
    you: string;
    yourAccount: string;
    savedPages: string;
    readingHistory: string;
    signIn: string;
    supportSourceLibrary: string;
    sendFeedback: string;
    siteLanguage: string;
    signOut: string;
  };


  /** Citation-pinned (`?v=`) edition banner. */
  pinnedEdition: {
    citedVersion: string;
    resolving: string;
    /** "This link cites edition v{v}, but it could not be resolved. Showing the current text." */
    unresolvable: (v: string) => string;
    continueReadingLink: string;
    /** "This page was not part of edition {label}, published {date} — showing the current text." */
    pageNotInEdition: (label: string, date: string) => string;
    /** "You are reading edition {label}, published {date}" */
    readingEdition: (label: string, date: string) => string;
    /**
     * The same line for an edition the translation has moved on from. One
     * whole sentence per locale rather than a suffix glued on at render time:
     * the clause that joins them is punctuation, and punctuation is not the
     * same in both languages.
     */
    readingEditionRevised: (label: string, date: string) => string;
    viewCurrentEdition: string;
  };
}

export const READER_UI_STRINGS: Record<Locale, ReaderStrings> = {
  en: {
    toolbar: {
      contents: 'Contents',
      guide: 'Guide',
      search: 'Search',
      librarian: 'Librarian',
      save: 'Save',
      share: 'Share',
      cite: 'Cite',
      download: 'Download',
      info: 'Info',
      views: 'Views',
      pages: 'Pages',
      settings: 'Settings',
      feedback: 'Feedback',
      more: 'More',
      menu: 'Menu',
      readerToolsAria: 'Reader tools',
      previousPage: 'Previous page',
      nextPage: 'Next page',
      previous: 'Previous',
      next: 'Next',
      close: 'Close',
      jumpToPage: 'Jump to page',
      backToTheBook: 'Back to the book',
      backToTheBookPage: 'Back to the book page',
      backToTheReader: 'Back to the reader',
      scanFullScreen: 'Scan, full screen',
      viewScanFullScreen: 'View the scan full screen',
    },
    panels: {
      titles: {
        save: 'Save',
        menu: 'Menu',
        contents: 'Contents',
        search: 'Search this book',
        guide: 'Reading guide',
        librarian: 'Ask the librarian',
        info: 'Edition & page info',
        cite: 'Cite this page',
        share: 'Share',
        settings: 'Reading settings',
        views: 'Scan, text & translation',
        downloads: 'Download',
        history: 'Revision history',
        feedback: 'Send feedback',
        more: 'More',
      },
      blurbs: {
        contents: 'The book’s own table of contents, as printed.',
        search: 'Searches the transcribed text and the descriptions of the illustrations.',
        guide: 'Our summary of the book, written by AI over the transcription.',
        librarian: 'Answers from AI, grounded in this page and the book around it.',
        info: 'What this page is, and the edition it was scanned from.',
        cite: 'A citation that points at this exact page.',
        share: 'Copy a link to this page, or post it.',
        settings: 'How the text is set. Your choices are remembered on this device.',
        views: 'Which panes are showing.',
        downloads: 'Take this page, or the whole book, away with you.',
        history: 'Every recorded change to this page’s transcription and translation.',
      },
      closeAria: (title) => `Close ${title.toLowerCase()}`,
      backToMore: 'Back to More',
    },
    moreMenu: {
      contents: 'Contents',
      contentsBlurb: 'The book’s own table of contents, as printed',
      guide: 'Reading guide',
      guideBlurb: 'Overview, themes, sections',
      search: 'Search this book',
      searchBlurb: 'Find a word in the transcribed text',
      librarian: 'Ask the librarian',
      librarianBlurb: 'Questions about this page or the book',
      cite: 'Cite this page',
      citeBlurb: 'A citation that points at this exact page',
      downloads: 'Download',
      downloadsBlurb: 'This page, or the whole book, in several formats',
      info: 'Edition & page info',
      infoBlurb: 'This page, and the edition it comes from',
      history: 'Revision history',
      historyBlurb: 'Every recorded change to this page',
      settings: 'Reading settings',
      settingsBlurb: 'Theme, text size, typeface, notes',
      feedback: 'Send feedback',
      feedbackBlurb: 'Tell us about this page or the reader',
      menu: 'Menu',
      menuBlurb: 'The rest of the library, and your account',
    },
    panes: {
      viewScan: 'Scan',
      viewOcr: 'OCR',
      viewRoman: 'Roman',
      viewEnglish: 'English',
      visiblePanesAria: 'Visible panes',
      showPane: (label) => `Show the ${label.toLowerCase()}`,
      lastPaneShowing: 'The last pane showing',

      originalFallback: 'Original',
      romanisedHeader: 'Romanised',
      aiTranslated: 'AI translated',
      aiShort: 'AI',
      aiTitle: 'Produced with AI assistance',
      corpusChip: (shortName) => `${shortName} translation`,
      corpusChipTitle: (name) => `The English follows the scholarly translation of the ${name} — it is not machine-made`,
      tabletWitness: 'Tablet witness',
      witnessCount: (index, total) => `Tablet ${index} of ${total}`,
      witnessNotSource: (shortName) => `The text follows the ${shortName} edition — it is not read from this photograph`,
      witnessAlt: (designation) => `Photograph of tablet ${designation}`,
      prevWitness: 'Previous tablet',
      nextWitness: 'Next tablet',
      viewOnCdli: 'View on CDLI',
      noFacsimile: 'No facsimile — this is a text edition',
      scanAlt: (pageNumber, title) => `Scan of page ${pageNumber} of ${title}`,

      originalScan: 'Original scan',
      originalScanHint: 'The page as it was photographed',
      transcriptionOf: (language) => `${language} transcription`,
      transcriptionHint: 'The printed text, read by machine',
      englishTranslation: 'English translation',
      englishTranslationHint: 'Translated with AI assistance',
      romanisedTranscription: 'Romanised transcription',
      romanisedTranscriptionHint: 'The same words in Latin letters',

      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      resetZoom: 'Reset zoom',
      readingLens: 'Reading lens: magnify the spot under the pointer',
      readingLensOff: 'Turn the reading lens off',
      readingLensUnavailable: 'Reading lens (available at 100%)',

      notes: 'Notes',
      showNotes: 'Show inline notes and glosses',
      hideNotes: 'Hide inline notes and glosses',
      trace: 'Trace',
      turnTracingOff: 'Turn tracing off',
      traceFallbackLanguage: 'original',
      traceHint: (language) => `Trace: click any phrase to see it in the ${language}`,
      traceAligning: 'Aligning this page with the translation…',
      traceUnavailable: 'Tracing is not available for this page.',
      traceEnglishOnly: 'Tracing compares the original with the English translation. Switch back to English to use it.',
      descriptionHidden: (pageTypeLabel: string) => `${pageTypeLabel} page. Turn Notes on to read the description.`,
      traceRateLimited: 'Tracing limit reached. Sign in (free) to keep going.',
      traceClickHint: 'Click any phrase to see it in the other pane.',

      romanising: 'Romanising this page…',
      romanisingLonger: 'longer than usual for a page this size',
      romanisingEstimate: (seconds) => `usually about ${seconds}s for this much text`,
      translitFailed: 'The transliteration could not be generated for this page.',
      translitNone: 'No transliteration for this page yet.',

      copyTranscription: 'Copy the transcription',
      copyTranslation: 'Copy the translation',
      copyTransliteration: 'Copy the transliteration',
      copied: 'Copied',

      marksMeaning: 'What the marks in the text mean',
      marksMeaningShort: 'What the marks mean',
      marksInText: 'Marks in the text',
      markGlossOrTerm: 'Gloss or term',
      markGlossOrTermDesc: 'A word explained, or a technical term identified.',
      markOnThePage: 'On the page',
      markOnThePageDesc: 'A marginal note or a later hand, present on the original.',
      markOurNote: 'Our note',
      markOurNoteDesc: 'Added here by an editor, not on the original.',
      marksHiddenByNotes: 'Notes hides all of them.',
    },
    contents: {
      noContentsTranscribed: 'This edition’s table of contents has not been transcribed yet. Use the reading guide or the page strip to move around.',
      noContentsAtAll: 'This book has no table of contents.',
    },
    guide: {
      noGuideYet: 'This book does not have a reading guide yet.',
      requestGuide: 'Request a reading guide',
      requestGuideThanks: 'Thanks. This book is queued for a guide, and it will appear here once the pass runs.',
      requestFailed: 'That request did not go through. Try again in a moment.',
      showLess: 'Show less',
      readFullOverview: (more) => `Read the full overview (${more} more)`,
      sections: 'Sections',
      readThisSection: 'Read this section →',
    },
    search: {
      placeholder: 'Search…',
      inputAria: 'Search this book',
      noMatches: 'No matches in this book',
      failed: 'Search is unavailable right now. Try again in a moment.',
      pagesMatch: (total) => `${total} ${total === 1 ? 'page matches' : 'pages match'}`,
      pageLabel: (n) => `Page ${n}`,
    },
    librarian: {
      suggestions: [
        'What is this page about?',
        'Who was the author?',
        'Explain the key concepts here',
      ],
      orStartHere: 'Or start here',
      askAboutPage: (pageNumber) => `Ask about p. ${pageNumber}…`,
      inputAria: 'Ask the librarian',
      ask: 'Ask',
      consulting: 'Consulting the text…',
      askErrorInline: "The librarian couldn't answer just now — try again.",
    },
    info: {
      thisPage: 'This page',
      thisEdition: 'This edition',
      howPageWasMade: 'How this page was made',
      fieldTitle: 'Title',
      fieldEnglish: 'English',
      fieldAuthor: 'Author',
      fieldLanguage: 'Language',
      fieldPlace: 'Place',
      fieldPublisher: 'Publisher',
      fieldPublished: 'Published',
      fieldFormat: 'Format',
      fieldPages: 'Pages',
      fieldScan: 'Scan',
      fieldTranscript: 'Transcript',
      scannedFrom: (pageNumber) => `Photographed from the printed edition${pageNumber != null ? `, p. ${pageNumber}` : ''}`,
      transcribedBy: (model) => `Read from the scan by ${model}`,
      translatedBy: (model) => `Translated from the transcript by ${model}`,
      machineNotice: 'Machine transcription and translation carry errors. The scan is the source, so read it alongside the text wherever a reading matters.',
      corpusNoScan: (witnessCount) => witnessCount > 0
        ? `None — this is a digital text edition. The composition survives on ${witnessCount} clay tablet${witnessCount === 1 ? '' : 's'} catalogued at CDLI.`
        : 'None — this is a digital text edition; no page images exist.',
      corpusTranscript: (name, org) => `Composite transliteration from the ${name}${org ? ` (${org})` : ''}`,
      corpusTranslation: (name) => `Scholarly translation from the ${name} — not machine-made`,
      corpusNotice: 'This page reproduces a scholarly corpus edition: the transliteration and translation are the work of its editors, not of AI. The page divisions are ours — the corpus divides the text by lines, not pages.',
      corpusAiNotice: (name) => `The transliteration follows the ${name}; the English is a machine translation of it and may contain errors.`,
    },
    cite: {
      copyCitation: 'Copy citation',
      copied: 'Copied',
    },
    share: {
      copyLink: 'Copy link to this page',
      copyLinkWithReference: 'Copy link with reference',
      postTo: 'Post to',
      email: 'Email',
    },
    paneEmpty: {
      notTranscribed: 'Not transcribed yet',
      notTranscribedBody: 'The scan is here and free to read, but this page has no transcription yet, so there is nothing to translate from.',
      blankPage: 'Blank page.',
      readyToTranslate: 'Ready to translate',
      readyToTranslateBody: 'OCR is complete for this page. It has not been translated into English yet.',
      signInToRequest: 'Sign in to request a translation',
      requestTranslation: 'Request translation',
      requestFailed: 'That request did not go through. Try again in a moment.',
      sending: 'Sending…',
      requested: 'Requested',
      thanksWillEmail: 'Thanks — we’ll email you when this page is translated.',
      thanksWillPrioritise: 'Thanks — we’ll prioritize this book.',
    },
    save: {
      anonymousNotice: 'Saves work without an account, on this device only.',
      signInToKeep: 'Sign in to keep them everywhere',
      savedPage: 'Saved to your library',
      savePage: 'Save this page',
      savedBook: (title) => `Saved “${title}”`,
      saveBook: 'Save the whole book',
      saveFailed: 'Save failed. Try again.',
      yourLibrary: 'Your library',
      everythingSaved: 'Everything you’ve saved',
    },
    downloads: {
      thisPage: 'This page',
      scanOfPage: (pageNumber) => `The scan of p. ${pageNumber ?? ''}`.trim(),
      scanFormatNote: 'JPEG, at the resolution it was archived',
      noScanArchived: 'No scan is archived for this page.',
      thisPageComplete: 'This page, complete',
      thisPageCompleteNote: 'Scan, transcription, translation and citation, zipped',
      dailyLimitReached: 'Daily download limit reached.',
      signInToDownload: 'Sign in to download this page.',
      downloadFailed: 'That download failed. Try again.',
      wholeBook: 'The whole book',
    },
    feedback: {
      blurb: 'Anything wrong, missing, or worth knowing about this page or the reader itself.',
      placeholder: 'What did you notice?',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      emailNote: 'Only if you would like a reply. We will not use it for anything else.',
      send: 'Send',
      sending: 'Sending…',
      thanks: 'Thank you. This has reached us, along with the page you were on.',
      failed: 'That did not send. Try again in a moment.',
      tooShort: 'Tell us a little more first.',
      aboutPage: (pageNumber) => `Your note will say you were on p. ${pageNumber}.`,
    },
    history: {
      title: 'Revision history',
      loading: 'Loading revision history…',
      loadFailed: "Couldn't load revision history for this page. Try again in a moment.",
      noRevisions: 'No recorded revisions for this page.',
      onlyMaintenance: 'Only bulk-maintenance activity, below.',
      chars: 'chars',
      showMaintenance: (n) => `Show ${n} bulk-maintenance ${n === 1 ? 'revision' : 'revisions'}`,
      hideMaintenance: (n) => `Hide ${n} bulk-maintenance ${n === 1 ? 'revision' : 'revisions'}`,
      maintenanceNote: 'Corpus repairs and library-wide sweeps that happened to touch this page — not fresh readings of the scan.',
      restoreForbidden: 'You are not signed in as an editor any more. Sign in again to restore this version.',
      restoreFailed: 'That version could not be restored. Try again in a moment.',
      today: (time) => `Today ${time}`,
      yesterday: 'Yesterday',
      daysAgo: (n) => `${n}d ago`,
      sourceAi: 'AI',
      sourceBatch: 'Batch',
      sourceManual: 'Manual',
      sourceContributor: 'Contrib',
      sourceMaintenance: 'Maintenance',
      fieldTranscript: 'Transcript',
      fieldTranslation: 'Translation',
    },
    settings: {
      theme: 'Theme',
      themeLight: 'Light',
      themeSepia: 'Sepia',
      themeDark: 'Dark',
      textSize: 'Text size',
      smallerText: 'Smaller text',
      largerText: 'Larger text',
      lineWidth: 'Line width',
      lineWidthNarrow: 'Narrow',
      lineWidthNormal: 'Normal',
      lineWidthWide: 'Wide',
      typeface: 'Typeface',
      typefaceSerif: 'Serif',
      typefaceSans: 'Sans',
      lineHeight: 'Line height',
    },
    accountMenu: {
      library: 'Library',
      collections: 'Collections',
      gallery: 'Gallery',
      browse: 'Browse',
      catalogue: 'Catalogue',
      works: 'Works',
      explore: 'Explore',
      librarian: 'Librarian',
      you: 'You',
      yourAccount: 'Your account',
      savedPages: 'Saved pages',
      readingHistory: 'Reading history',
      signIn: 'Sign in',
      supportSourceLibrary: 'Support Source Library',
      sendFeedback: 'Send feedback',
      siteLanguage: 'Site language',
      signOut: 'Sign out',
    },
    pinnedEdition: {
      citedVersion: 'Cited version',
      resolving: 'Resolving the cited edition…',
      unresolvable: (v) => `This link cites edition v${v}, but it could not be resolved. Showing the current text.`,
      continueReadingLink: 'Continue reading →',
      pageNotInEdition: (label, date) => `This page was not part of edition ${label}, published ${date} — showing the current text.`,
      readingEdition: (label, date) => `You are reading edition ${label}, published ${date}.`,
      readingEditionRevised: (label, date) => `You are reading edition ${label}, published ${date} — the translation has since been revised.`,
      viewCurrentEdition: 'View current edition →',
    },
  },
  es: {
    toolbar: {
      contents: 'Contenido',
      guide: 'Guía',
      search: 'Buscar',
      // NOT 'Bibliotecario' (the word the site nav and this catalogue's own
      // `accountMenu` use): a rail label sits in a 48px slot at 8.5px, and
      // thirteen characters wrap onto a second line. The rail names the
      // action, the drawer it opens still says "Preguntar al bibliotecario".
      librarian: 'Preguntar',
      save: 'Guardar',
      share: 'Compartir',
      cite: 'Citar',
      download: 'Descargar',
      info: 'Info',
      views: 'Vistas',
      pages: 'Páginas',
      settings: 'Ajustes',
      feedback: 'Comentarios',
      more: 'Más',
      menu: 'Menú',
      readerToolsAria: 'Herramientas del lector',
      previousPage: 'Página anterior',
      nextPage: 'Página siguiente',
      previous: 'Anterior',
      next: 'Siguiente',
      close: 'Cerrar',
      jumpToPage: 'Ir a una página',
      backToTheBook: 'Volver al libro',
      backToTheBookPage: 'Volver a la página del libro',
      backToTheReader: 'Volver al lector',
      scanFullScreen: 'Escaneo, pantalla completa',
      viewScanFullScreen: 'Ver el escaneo a pantalla completa',
    },
    panels: {
      titles: {
        save: 'Guardar',
        menu: 'Menú',
        contents: 'Contenido',
        search: 'Buscar en este libro',
        guide: 'Guía de lectura',
        librarian: 'Preguntar al bibliotecario',
        info: 'Datos de la edición y la página',
        cite: 'Citar esta página',
        share: 'Compartir',
        settings: 'Ajustes de lectura',
        views: 'Escaneo, texto y traducción',
        downloads: 'Descargar',
        history: 'Historial de revisiones',
        feedback: 'Enviar comentarios',
        more: 'Más',
      },
      blurbs: {
        contents: 'El índice original del libro, tal como fue impreso.',
        search: 'Busca en el texto transcrito y en las descripciones de las ilustraciones.',
        guide: 'Nuestro resumen del libro, generado por IA a partir de la transcripción.',
        librarian: 'Respuestas de la IA, basadas en esta página y en el libro que la rodea.',
        info: 'Qué es esta página y de qué edición procede el escaneo.',
        cite: 'Una cita que remite exactamente a esta página.',
        share: 'Copia un enlace a esta página, o compártelo.',
        settings: 'Cómo se presenta el texto. Tus preferencias se recuerdan en este dispositivo.',
        views: 'Qué paneles se muestran.',
        downloads: 'Llévate esta página, o el libro entero.',
        history: 'Todos los cambios registrados en la transcripción y la traducción de esta página.',
      },
      closeAria: (title) => `Cerrar ${title.toLowerCase()}`,
      backToMore: 'Volver a Más',
    },
    moreMenu: {
      contents: 'Contenido',
      contentsBlurb: 'El índice original del libro, tal como fue impreso',
      guide: 'Guía de lectura',
      guideBlurb: 'Resumen, temas, secciones',
      search: 'Buscar en este libro',
      searchBlurb: 'Busca una palabra en el texto transcrito',
      librarian: 'Preguntar al bibliotecario',
      librarianBlurb: 'Preguntas sobre esta página o el libro',
      cite: 'Citar esta página',
      citeBlurb: 'Una cita que remite exactamente a esta página',
      downloads: 'Descargar',
      downloadsBlurb: 'Esta página, o el libro entero, en varios formatos',
      info: 'Datos de la edición y la página',
      infoBlurb: 'Esta página, y la edición de la que procede',
      history: 'Historial de revisiones',
      historyBlurb: 'Todos los cambios registrados en esta página',
      settings: 'Ajustes de lectura',
      settingsBlurb: 'Tema, tamaño de letra, tipografía, notas',
      feedback: 'Enviar comentarios',
      feedbackBlurb: 'Cuéntanos algo sobre esta página o sobre el lector',
      menu: 'Menú',
      menuBlurb: 'El resto de la biblioteca, y tu cuenta',
    },
    panes: {
      viewScan: 'Escaneo',
      viewOcr: 'OCR',
      // Short chip label (matches "Roman" width); the fuller
      // "romanisedTranscription" string below spells it out.
      viewRoman: 'Latina',
      viewEnglish: 'Inglés',
      visiblePanesAria: 'Paneles visibles',
      showPane: (label) => `Mostrar ${label.toLowerCase()}`,
      lastPaneShowing: 'El único panel visible',

      originalFallback: 'Original',
      romanisedHeader: 'Romanizada',
      aiTranslated: 'Traducido por IA',
      aiShort: 'IA',
      aiTitle: 'Generado con ayuda de IA',
      corpusChip: (shortName) => `Traducción ${shortName}`,
      corpusChipTitle: (name) => `El inglés sigue la traducción académica de ${name} — no es obra de una máquina`,
      tabletWitness: 'Tablilla testigo',
      witnessCount: (index, total) => `Tablilla ${index} de ${total}`,
      witnessNotSource: (shortName) => `El texto sigue la edición ${shortName} — no se leyó de esta fotografía`,
      witnessAlt: (designation) => `Fotografía de la tablilla ${designation}`,
      prevWitness: 'Tablilla anterior',
      nextWitness: 'Tablilla siguiente',
      viewOnCdli: 'Ver en CDLI',
      noFacsimile: 'Sin facsímil — es una edición de texto',
      scanAlt: (pageNumber, title) => `Escaneo de la página ${pageNumber} de ${title}`,

      originalScan: 'Escaneo original',
      originalScanHint: 'La página tal como fue fotografiada',
      transcriptionOf: (language) => `Transcripción (${language})`,
      transcriptionHint: 'El texto impreso, leído por una máquina',
      englishTranslation: 'Traducción al inglés',
      englishTranslationHint: 'Traducida con ayuda de IA',
      romanisedTranscription: 'Transcripción romanizada',
      romanisedTranscriptionHint: 'Las mismas palabras en letras latinas',

      zoomOut: 'Alejar',
      zoomIn: 'Acercar',
      resetZoom: 'Restablecer el zoom',
      readingLens: 'Lupa de lectura: amplía la zona bajo el puntero',
      readingLensOff: 'Desactivar la lupa de lectura',
      readingLensUnavailable: 'Lupa de lectura (disponible al 100%)',

      notes: 'Notas',
      showNotes: 'Mostrar notas y glosas en el texto',
      hideNotes: 'Ocultar notas y glosas en el texto',
      // "Trace" (click a phrase to see it aligned in the other pane) has no
      // single fixed Spanish rendering in the rest of the site to match — this
      // is a judgment call, worth a native-speaker check. "Cotejar" ("to
      // collate/compare texts") reads naturally to a Spanish-speaking scholar
      // for exactly this action.
      trace: 'Cotejar',
      turnTracingOff: 'Desactivar el cotejo',
      traceFallbackLanguage: 'el original',
      traceHint: (language) => `Cotejar: haz clic en cualquier frase para verla en ${language}`,
      traceAligning: 'Alineando esta página con la traducción…',
      traceUnavailable: 'El cotejo no está disponible para esta página.',
      traceEnglishOnly: 'El cotejo compara el original con la traducción al inglés. Vuelve al inglés para usarlo.',
      descriptionHidden: (pageTypeLabel: string) => `Página de ${pageTypeLabel.toLowerCase()}. Activa las notas para leer la descripción.`,
      traceRateLimited: 'Has alcanzado el límite de cotejos. Inicia sesión (gratis) para continuar.',
      traceClickHint: 'Haz clic en cualquier frase para verla en el otro panel.',

      romanising: 'Romanizando esta página…',
      romanisingLonger: 'más de lo habitual para una página de este tamaño',
      romanisingEstimate: (seconds) => `normalmente unos ${seconds} s para esta cantidad de texto`,
      translitFailed: 'No se pudo generar la transliteración de esta página.',
      translitNone: 'Todavía no hay transliteración de esta página.',

      copyTranscription: 'Copiar la transcripción',
      copyTranslation: 'Copiar la traducción',
      copyTransliteration: 'Copiar la transliteración',
      copied: 'Copiado',

      marksMeaning: 'Qué significan las marcas del texto',
      marksMeaningShort: 'Qué significan las marcas',
      marksInText: 'Marcas en el texto',
      markGlossOrTerm: 'Glosa o término',
      markGlossOrTermDesc: 'Una palabra explicada, o un término técnico señalado.',
      markOnThePage: 'En la página',
      markOnThePageDesc: 'Una nota marginal o una mano posterior, presente en el original.',
      markOurNote: 'Nota nuestra',
      markOurNoteDesc: 'Añadida aquí por un editor; no está en el original.',
      marksHiddenByNotes: 'El botón «Notas» las oculta todas.',
    },
    contents: {
      noContentsTranscribed: 'El índice de esta edición aún no se ha transcrito. Usa la guía de lectura o la tira de páginas para moverte.',
      noContentsAtAll: 'Este libro no tiene índice.',
    },
    guide: {
      noGuideYet: 'Este libro todavía no tiene una guía de lectura.',
      requestGuide: 'Solicitar una guía de lectura',
      requestGuideThanks: 'Gracias. Este libro está en la cola para recibir una guía, y aparecerá aquí en cuanto se procese.',
      requestFailed: 'La solicitud no se ha enviado. Inténtalo de nuevo en un momento.',
      showLess: 'Mostrar menos',
      readFullOverview: (more) => `Leer el resumen completo (${more} más)`,
      sections: 'Secciones',
      readThisSection: 'Leer esta sección →',
    },
    search: {
      placeholder: 'Buscar…',
      inputAria: 'Buscar en este libro',
      noMatches: 'Sin resultados en este libro',
      failed: 'La búsqueda no está disponible ahora mismo. Inténtalo de nuevo en un momento.',
      pagesMatch: (total) => `${total} ${total === 1 ? 'página coincide' : 'páginas coinciden'}`,
      pageLabel: (n) => `Página ${n}`,
    },
    librarian: {
      suggestions: [
        '¿De qué trata esta página?',
        '¿Quién fue el autor?',
        'Explica los conceptos clave aquí',
      ],
      orStartHere: 'O empieza por aquí',
      askAboutPage: (pageNumber) => `Pregunta sobre la p. ${pageNumber}…`,
      inputAria: 'Preguntar al bibliotecario',
      ask: 'Preguntar',
      consulting: 'Consultando el texto…',
      askErrorInline: 'El bibliotecario no ha podido responder ahora mismo. Inténtalo de nuevo.',
    },
    info: {
      thisPage: 'Esta página',
      thisEdition: 'Esta edición',
      howPageWasMade: 'Cómo se hizo esta página',
      fieldTitle: 'Título',
      fieldEnglish: 'Inglés',
      fieldAuthor: 'Autor',
      fieldLanguage: 'Idioma',
      fieldPlace: 'Lugar',
      fieldPublisher: 'Editorial',
      fieldPublished: 'Publicado',
      fieldFormat: 'Formato',
      fieldPages: 'Páginas',
      fieldScan: 'Escaneo',
      fieldTranscript: 'Transcripción',
      scannedFrom: (pageNumber) => `Fotografiada a partir de la edición impresa${pageNumber != null ? `, p. ${pageNumber}` : ''}`,
      transcribedBy: (model) => `Leída del escaneo por ${model}`,
      translatedBy: (model) => `Traducida de la transcripción por ${model}`,
      machineNotice: 'La transcripción y la traducción automáticas contienen errores. El escaneo es la fuente, así que léelo junto al texto siempre que una lectura sea importante.',
      corpusNoScan: (witnessCount) => witnessCount > 0
        ? `Ninguno — es una edición digital de texto. La composición sobrevive en ${witnessCount} tablilla${witnessCount === 1 ? '' : 's'} de arcilla catalogada${witnessCount === 1 ? '' : 's'} en CDLI.`
        : 'Ninguno — es una edición digital de texto; no existen imágenes de página.',
      corpusTranscript: (name, org) => `Transliteración compuesta procedente de ${name}${org ? ` (${org})` : ''}`,
      corpusTranslation: (name) => `Traducción académica procedente de ${name} — no es obra de una máquina`,
      corpusNotice: 'Esta página reproduce una edición académica de corpus: la transliteración y la traducción son obra de sus editores, no de la IA. La división en páginas es nuestra — el corpus divide el texto por líneas, no por páginas.',
      corpusAiNotice: (name) => `La transliteración sigue ${name}; el inglés es una traducción automática de ella y puede contener errores.`,
    },
    cite: {
      copyCitation: 'Copiar la cita',
      copied: 'Copiado',
    },
    share: {
      copyLink: 'Copiar el enlace a esta página',
      copyLinkWithReference: 'Copiar el enlace con la referencia',
      postTo: 'Publicar en',
      email: 'Correo',
    },
    paneEmpty: {
      notTranscribed: 'Aún sin transcribir',
      notTranscribedBody: 'El escaneo está aquí y se puede leer libremente, pero esta página todavía no tiene transcripción, así que no hay nada de donde traducir.',
      blankPage: 'Página en blanco.',
      readyToTranslate: 'Lista para traducir',
      readyToTranslateBody: 'La transcripción de esta página está completa. Todavía no se ha traducido al inglés.',
      signInToRequest: 'Inicia sesión para pedir una traducción',
      requestTranslation: 'Pedir la traducción',
      requestFailed: 'La solicitud no se ha enviado. Inténtalo de nuevo en un momento.',
      sending: 'Enviando…',
      requested: 'Solicitada',
      thanksWillEmail: 'Gracias. Te escribiremos cuando esta página esté traducida.',
      thanksWillPrioritise: 'Gracias. Daremos prioridad a este libro.',
    },
    save: {
      anonymousNotice: 'Puedes guardar sin una cuenta; se guarda solo en este dispositivo.',
      signInToKeep: 'Inicia sesión para conservarlos en todas partes',
      savedPage: 'Guardada en tu biblioteca',
      savePage: 'Guardar esta página',
      savedBook: (title) => `Guardaste “${title}”`,
      saveBook: 'Guardar el libro entero',
      saveFailed: 'No se pudo guardar. Inténtalo de nuevo.',
      yourLibrary: 'Tu biblioteca',
      everythingSaved: 'Todo lo que has guardado',
    },
    downloads: {
      thisPage: 'Esta página',
      scanOfPage: (pageNumber) => `El escaneo de la p. ${pageNumber ?? ''}`.trim(),
      scanFormatNote: 'JPEG, en la resolución con la que se archivó',
      noScanArchived: 'No hay ningún escaneo archivado para esta página.',
      thisPageComplete: 'Esta página, completa',
      thisPageCompleteNote: 'Escaneo, transcripción, traducción y cita, en un zip',
      dailyLimitReached: 'Se alcanzó el límite diario de descargas.',
      signInToDownload: 'Inicia sesión para descargar esta página.',
      downloadFailed: 'La descarga falló. Inténtalo de nuevo.',
      wholeBook: 'El libro entero',
    },
    feedback: {
      blurb: 'Cualquier cosa que esté mal, que falte o que convenga saber sobre esta página o sobre el lector.',
      placeholder: '¿Qué has visto?',
      emailLabel: 'Correo electrónico',
      emailPlaceholder: 'tu@ejemplo.com',
      emailNote: 'Solo si quieres que te respondamos. No lo usaremos para nada más.',
      send: 'Enviar',
      sending: 'Enviando…',
      thanks: 'Gracias. Nos ha llegado, junto con la página en la que estabas.',
      failed: 'No se ha enviado. Inténtalo de nuevo en un momento.',
      tooShort: 'Cuéntanos un poco más primero.',
      aboutPage: (pageNumber) => `Tu mensaje indicará que estabas en la p. ${pageNumber}.`,
    },
    history: {
      title: 'Historial de revisiones',
      loading: 'Cargando el historial de revisiones…',
      loadFailed: 'No se pudo cargar el historial de revisiones de esta página. Inténtalo de nuevo en un momento.',
      noRevisions: 'No hay revisiones registradas para esta página.',
      onlyMaintenance: 'Solo actividad de mantenimiento masivo, más abajo.',
      chars: 'caracteres',
      showMaintenance: (n) => `Mostrar ${n} ${n === 1 ? 'revisión' : 'revisiones'} de mantenimiento masivo`,
      hideMaintenance: (n) => `Ocultar ${n} ${n === 1 ? 'revisión' : 'revisiones'} de mantenimiento masivo`,
      maintenanceNote: 'Reparaciones del corpus y barridos de toda la biblioteca que pasaron por esta página, no lecturas nuevas del escaneo.',
      restoreForbidden: 'Ya no tienes la sesión de editor iniciada. Vuelve a entrar para restaurar esta versión.',
      restoreFailed: 'No se ha podido restaurar esa versión. Inténtalo de nuevo en un momento.',
      today: (time) => `Hoy ${time}`,
      yesterday: 'Ayer',
      daysAgo: (n) => `hace ${n} d`,
      sourceAi: 'IA',
      sourceBatch: 'Lote',
      sourceManual: 'Manual',
      sourceContributor: 'Colab.',
      sourceMaintenance: 'Mantenimiento',
      fieldTranscript: 'Transcripción',
      fieldTranslation: 'Traducción',
    },
    settings: {
      theme: 'Tema',
      themeLight: 'Claro',
      themeSepia: 'Sepia',
      themeDark: 'Oscuro',
      textSize: 'Tamaño de letra',
      smallerText: 'Letra más pequeña',
      largerText: 'Letra más grande',
      lineWidth: 'Ancho de línea',
      lineWidthNarrow: 'Estrecho',
      lineWidthNormal: 'Normal',
      lineWidthWide: 'Ancho',
      typeface: 'Tipografía',
      typefaceSerif: 'Con remates',
      typefaceSans: 'De palo seco',
      lineHeight: 'Interlineado',
    },
    accountMenu: {
      library: 'Biblioteca',
      collections: 'Colecciones',
      gallery: 'Galería',
      browse: 'Explorar',
      catalogue: 'Catálogo',
      works: 'Obras',
      explore: 'Visualizaciones',
      librarian: 'Bibliotecario',
      you: 'Tú',
      yourAccount: 'Tu cuenta',
      savedPages: 'Páginas guardadas',
      readingHistory: 'Historial de lectura',
      signIn: 'Iniciar sesión',
      supportSourceLibrary: 'Apoya Source Library',
      sendFeedback: 'Enviar comentarios',
      siteLanguage: 'Idioma del sitio',
      signOut: 'Cerrar sesión',
    },
    pinnedEdition: {
      citedVersion: 'Versión citada',
      resolving: 'Resolviendo la edición citada…',
      unresolvable: (v) => `Este enlace cita la edición v${v}, pero no se pudo resolver. Mostrando el texto actual.`,
      continueReadingLink: 'Seguir leyendo →',
      pageNotInEdition: (label, date) => `Esta página no formaba parte de la edición ${label}, publicada el ${date}; se muestra el texto actual.`,
      readingEdition: (label, date) => `Estás leyendo la edición ${label}, publicada el ${date}.`,
      readingEditionRevised: (label, date) => `Estás leyendo la edición ${label}, publicada el ${date}; la traducción se ha revisado desde entonces.`,
      viewCurrentEdition: 'Ver la edición actual →',
    },
  },
};

/** Reader chrome strings for `lang`. Defaults to English for an unrecognized locale. */
export function getReaderStrings(lang: Locale): ReaderStrings {
  return READER_UI_STRINGS[lang] ?? READER_UI_STRINGS.en;
}
