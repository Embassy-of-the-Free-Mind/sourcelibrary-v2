// Pure type import from the server-safe module — see the note in
// `src/lib/i18n.ts` about why server code (this catalogue may be read from
// `layout.tsx`'s generateMetadata) must not import `@/lib/i18n` itself.
import type { Locale } from '@/lib/locale-path';
import type { WarningKind } from '@/lib/book-warnings';

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
    /** The stacking sheet, reached from More since the pane picker took the
     *  dock slot (#5062). */
    views: string;
    viewsBlurb: string;
    feedback: string;
    feedbackBlurb: string;
    menu: string;
    menuBlurb: string;
    /** Section headers for the mobile More sheet (#4385 follow-up). */
    groupRead: string;
    groupPage: string;
    groupReader: string;
  };

  /** Scan / OCR / translation panes: view toggle, zoom, lens, notes, trace, copy. */
  panes: {
    /** ViewToggleGroup chip labels. */
    viewScan: string;
    viewOcr: string;
    /** Header of the transcription pane; `language` is the stored `books.language`. */
    ocrPaneHeader: (language: string) => string;
    viewRoman: string;
    viewEnglish: string;
    visiblePanesAria: string;
    showPane: (label: string) => string;
    lastPaneShowing: string;
    /** Phone pane picker (#5062): the row's aria label, and the line under a
     *  translation shown on its own — `Translated from the German · view the scan`. */
    pickPaneAria: string;
    translatedFrom: (language: string) => string;
    viewTheScan: string;
    viewTheText: (language: string) => string;

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
    /** Syriac pages read by a specialist Kraken model (#4883), by route: Sophro Mhiro for
     *  manuscripts, omnisyr for print. Replaces transcribedBy + machineNotice on those pages. */
    krakenTranscript: (route: 'manuscript' | 'print') => string;
    krakenNotice: (route: 'manuscript' | 'print') => string;
    /** Label for the link under krakenNotice to the by-eye check it cites (KRAKEN_EVIDENCE_URL). */
    krakenEvidenceLink: string;
    /** Text taken from the Internet Archive's own OCR of the scan (ocr.source === 'ia_djvu'). */
    iaTranscript: (engine: string | null, year: string | null, agreement: number | null) => string;
    /** Written or corrected by a person; `model` is the display name of what they started from, if known. */
    manualTranscript: (model: string | null) => string;
    /**
     * Short forms for the transcription pane-header chip (#5186). Derived by
     * `transcriptProvenanceLabel()` from the SAME provenance as the drawer
     * sentences above, so header and drawer can never disagree. The model
     * case has no string here: the chip is the model's display name itself.
     */
    transcriptChipIa: (engine: string | null) => string;
    /** Tooltip on the Archive chip: the known failure mode, plus the sample agreement when measured. */
    transcriptChipIaTitle: (agreement: number | null) => string;
    transcriptChipManual: string;
    transcriptChipCorpus: (shortName: string) => string;
    /** Open e-text fitted to the scan (#5571): "Text: CBETA, CC BY-NC-SA 4.0". The pane line passes the full name. */
    transcriptChipTextSource: (shortName: string, license: string) => string;
    /** Drawer form: full source name, version when known, licence. */
    textSourceTranscript: (name: string, license: string, version: string | null) => string;
    /** Translation pane line and drawer line for an unreviewed machine translation (#5571). */
    machineDraftNotice: string;
    /**
     * Quality warnings from stored checks (#6199). Voice: .claude/docs/quality-statements.md — what was found, by
     * whom, when; no softening, no verdict adjectives. Each `qualityKinds` value is a clause that follows "found that".
     */
    qualityKinds: Record<WarningKind, string>;
    /** Joins the clauses of one page: at most two are named, `more` says others were found. */
    qualityFindings: (clauses: string[], more: boolean) => string;
    qualityPageReview: (o: { ai: boolean; image: boolean; findings: string; date: string }) => string;
    qualityPageDetector: (date: string) => string;
    /** `serious` is null when the check kept no per-page record. */
    qualityBook: (o: { ai: boolean; image: boolean; read: number; serious: number | null; date: string }) => string;
    qualitySeeReview: string;
    qualityDetectorLink: string;
    licenceLink: string;
    sourceLink: string;
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
    /** Attempted but not reliably legible (#4523). */
    notReliablyLegible: string;
    notReliablyLegibleBody: string;
    /**
     * The transcription is good and shown; the ENGLISH was made from an older,
     * worse reading of the page and has been taken down until it is redone
     * (#4523). Distinct from notReliablyLegible, which withholds both panes.
     */
    translationWithheld: string;
    translationWithheldBody: string;
    blankPage: string;
    readyToTranslate: string;
    readyToTranslateBody: string;
    /**
     * An English edition with no `translation.data` is not "untranslated" —
     * the pipeline never translates English. The transcription is the
     * reading text; say so, with no request CTA and no pipeline button.
     */
    englishReadingText: string;
    englishReadingTextBody: string;
    /** Pre-1700 English: a modernized reading (same field) could be made but has not been (#4958). */
    notModernized: string;
    notModernizedBody: string;
    signInToRequest: string;
    requestTranslation: string;
    /** The request POST failed, so nothing was queued. */
    requestFailed: string;
    sending: string;
    requested: string;
    thanksWillEmail: string;
    thanksWillPrioritise: string;
  };

  /** Metered reader (#4357): pane shown past the free sample for signed-out readers. */
  paneGated: {
    label: string;
    /** `…past the first {n} pages…` */
    body: (freePages: number) => string;
    signIn: string;
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
    /** Image attachments — button, the hint beside it, and its two failure states. */
    attach: string;
    attachHint: string;
    attachLimit: string;
    attachFailed: string;
    removeImage: string;
  };

  /** One quiet line above a translation whose source page was hard to read
   *  (`pageReadCaution`, src/lib/transcription-reliability.ts). */
  readCaution: {
    /** `share` is 0–1: the part of the transcription the OCR marked uncertain. */
    unclear: (share: number) => string;
    damage: string;
  };

  /** "Report a problem with this page" — inline, under the translation. */
  pageReport: {
    open: string;
    prompt: string;
    kinds: {
      garbled_source: string;
      missing_text: string;
      invented_text: string;
      wrong_image: string;
      wrong_language: string;
      translation_error: string;
    };
    commentPlaceholder: string;
    /** The three fields a `translation_error` report adds (#6120). */
    passageLabel: string;
    correctionLabel: string;
    sourceLabel: string;
    send: string;
    sending: string;
    cancel: string;
    thanks: string;
    failed: string;
  };

  /**
   * The Derge Tengyur section note under the machine-draft line (#6120). Every number comes from
   * src/data/tengyur-section-quality.json; these are only the sentences around them.
   */
  tengyurNote: {
    /** How good: the section's measured light/work/specialist split, who judged it and when. */
    rated: (a: { section: string; n: number; date: string; light: number; work: number; specialist: number }) => string;
    /** What goes wrong: the commonest kinds, then reversal/agent findings per 100 pages. */
    faults: (a: { kinds: string[]; revAgent: number; voice: boolean }) => string;
    /** n below the threshold: no rate of its own, the whole-Tengyur figures instead. */
    tooFew: (a: { section: string; n: number; of: number; date: string; light: number; revAgent: number }) => string;
    kinds: { term: string; structure: string; gloss: string; omission: string; addition: string; reversal: string; agent: string };
    /** Section-specific failure the reviewers named (#5829 Result 2, Result 5). */
    /** The Vinaya's term kind, naming the Pali offence-class names (#5829 Result 6). */
    vinayaTerms: (pct: number) => string;
    methodLink: string;
    /** Section names as a reader of this locale says them; Sanskrit names stay. */
    sectionNames: Record<string, string>;
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
        views: 'Show more than one at once.',
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
      views: 'Scan, text & translation',
      viewsBlurb: 'Show more than one at once',
      feedback: 'Send feedback',
      feedbackBlurb: 'Tell us about this page or the reader',
      menu: 'Menu',
      menuBlurb: 'The rest of the library, and your account',
      groupRead: 'Read',
      groupPage: 'This page',
      groupReader: 'Reader',
    },
    panes: {
      viewScan: 'Scan',
      viewOcr: 'OCR',
      ocrPaneHeader: (language) => `${language} · OCR`,
      viewRoman: 'Roman',
      viewEnglish: 'English',
      visiblePanesAria: 'Visible panes',
      showPane: (label) => `Show the ${label.toLowerCase()}`,
      lastPaneShowing: 'The last pane showing',
      pickPaneAria: 'Scan, text or translation',
      translatedFrom: (language) => `Translated from the ${language}`,
      viewTheScan: 'view the scan',
      viewTheText: (language) => `view the ${language} text`,

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
      krakenTranscript: (route) => route === 'print'
        ? 'Read from the scan by omnisyr, a model trained on printed Syriac.'
        : 'Read from the scan by Sophro Mhiro (Beth Mardutho), a model trained on Syriac manuscripts.',
      krakenNotice: (route) =>
        'Machine transcription, not checked by a person. ' +
        (route === 'print'
          ? 'We read five printed pages against their scans (September 2026): the words were right on all five, and on two of them lines from separate columns ran together.'
          : 'We read five manuscript pages against their scans (September 2026): three were read correctly, and two damaged pages came out as fragments.') +
        ' Check the scan wherever a reading matters.',
      krakenEvidenceLink: 'How we checked',
      iaTranscript: (engine, year, agreement) =>
        `Read from the scan by the Internet Archive's OCR${engine ? ` (${engine}${year ? `, ${year}` : ''})` : year ? ` (${year})` : ''}` +
        (agreement != null ? `, taken because it agrees with our own reading of this book's sample pages (${Math.round(agreement * 100)}% of words)` : ''),
      manualTranscript: (model) => model ? `Read from the scan by ${model}, corrected by hand` : 'Transcribed by hand',
      transcriptChipIa: (engine) => `Internet Archive OCR${engine ? ` · ${engine}` : ''}`,
      transcriptChipIaTitle: (agreement) =>
        'Archive OCR — numbers may be misread (see #5186)' +
        (agreement != null ? ` · agrees with our sample reading on ${Math.round(agreement * 100)}% of words` : ''),
      transcriptChipManual: 'Manual',
      transcriptChipCorpus: (shortName) => `Corpus: ${shortName}`,
      transcriptChipTextSource: (shortName, license) => `Text: ${shortName}, ${license}`,
      textSourceTranscript: (name, license, version) => `Text: ${name}${version ? ` (${version})` : ''}, ${license}`,
      machineDraftNotice: 'AI translation, not yet reviewed by a scholar.',
      qualityKinds: {
        wrong_page: 'the scan and the text are from different pages',
        english_other_page: 'the English belongs to a different page',
        invented_transcription: 'the transcription has text that is not on the page',
        model_notes: 'the model’s own notes stand where the text should be',
        garble_translated: 'the English translates a garbled transcription as if it were sound',
        meaning_reversed: 'the English reverses a statement or drops a qualifier',
        misread_meaning: 'a misread word changes the meaning',
        unsupported_notes: 'the notes state things the page does not say',
        missing_transcription: 'part of the page is missing from the transcription',
        missing_english: 'part of the page is missing from the English',
        number_misread: 'a number, date or quantity is misread',
        repeated_text: 'a passage is repeated that appears once on the page',
        serious_transcription: 'the transcription has a serious error',
        serious_english: 'the English has a serious error',
        serious_other: 'the page has a serious error',
      },
      qualityFindings: (clauses, more) => clauses.join(', and that ') + (more ? ', among other serious errors' : ''),
      qualityPageReview: ({ ai, image, findings, date }) =>
        `${ai ? 'An AI reviewer' : 'A reviewer'} reading this page ${image ? 'against the scan' : 'as text, without the scan,'} found that ${findings} (${date}).`,
      qualityPageDetector: (date) => `Flagged by an automated check, not yet read by a person (${date}).`,
      qualityBook: ({ ai, image, read, serious, date }) => {
        const start = `A check by ${ai ? 'an AI reviewer' : 'a reviewer'} read ${read} ${read === 1 ? 'page' : 'pages'} of this book${image ? (read === 1 ? ' against the scan' : ' against the scans') : ''} on ${date}`;
        if (serious === null) return `${start} and found serious errors.`;
        return `${start} and found serious errors on ${read === 1 ? 'it' : `${serious} of them`}.`;
      },
      qualitySeeReview: 'See the review',
      qualityDetectorLink: 'What the check looks for',
      licenceLink: 'licence',
      sourceLink: 'source',
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
      notReliablyLegible: 'Not reliably legible',
      notReliablyLegibleBody: 'We attempted to transcribe this page but could not produce a reading we trust, so we are not showing one. The scan beside this is the authoritative source.',
      translationWithheld: 'Translation withdrawn',
      translationWithheldBody: 'This page has just been re-transcribed, and the English we had was made from the older, less accurate reading. We have taken it down rather than leave a translation of text that is no longer here. A new one will follow.',
      blankPage: 'Blank page.',
      readyToTranslate: 'Ready to translate',
      readyToTranslateBody: 'OCR is complete for this page. It has not been translated into English yet.',
      englishReadingText: 'English edition',
      englishReadingTextBody: 'This book is in English — the transcription is the reading text. There is nothing to translate.',
      notModernized: 'Not yet modernized',
      notModernizedBody: 'This book is in Early Modern English. A modernized reading has not been made yet; the transcription is the reading text.',
      signInToRequest: 'Sign in to request a translation',
      requestTranslation: 'Request translation',
      requestFailed: 'That request did not go through. Try again in a moment.',
      sending: 'Sending…',
      requested: 'Requested',
      thanksWillEmail: 'Thanks — we’ll email you when this page is translated.',
      thanksWillPrioritise: 'Thanks — we’ll prioritize this book.',
    },
    paneGated: {
      label: 'Sign in to keep reading',
      body: (freePages) => `The scan is free to browse. Reading the transcription and translation past the first ${freePages} pages asks for a free account.`,
      signIn: 'Sign in — it’s free',
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
      attach: 'Add a screenshot',
      attachHint: 'or paste / drop an image',
      attachLimit: 'Up to four images',
      attachFailed: 'That image could not be uploaded. Try a smaller one.',
      removeImage: 'Remove image',
    },
    readCaution: {
      unclear: (share) => `This page was hard to read: about ${Math.round(share * 100)}% of the transcription is marked uncertain, and the English there is a best guess.`,
      damage: 'This page is damaged or faded in places, and parts of the English may rest on uncertain readings.',
    },
    pageReport: {
      open: 'Report a problem with this page',
      prompt: 'What is wrong? Choose one if it fits.',
      kinds: {
        garbled_source: 'Transcription is garbled',
        missing_text: 'Text is missing',
        invented_text: 'Translation adds things',
        wrong_image: 'Wrong page image',
        wrong_language: 'Wrong language',
        translation_error: 'The English is wrong here',
      },
      commentPlaceholder: 'Anything else? (optional)',
      passageLabel: 'The English as it reads now',
      correctionLabel: 'What it should say',
      sourceLabel: 'The original words (optional)',
      send: 'Send report',
      sending: 'Sending…',
      cancel: 'Cancel',
      thanks: 'Thank you. We will look at this page.',
      failed: 'That did not send. Try again in a moment.',
    },
    tengyurNote: {
      rated: ({ section, n, date, light, work, specialist }) =>
        `Of ${n} random ${section} pages checked against the Tibetan by AI reviewers (${date}), ${light}% needed only light edits${work ? `, ${work}% substantial revision` : ''}${specialist ? ` and ${specialist}% a specialist` : ''}.`,
      faults: ({ kinds, revAgent, voice }) =>
        `Measured errors: about ${revAgent} statements per 100 pages are reversed or attributed to the wrong speaker${voice ? ", including opponents' objections given as the author's view" : ''}${kinds.length ? `. Also common: ${kinds.join(', ')}` : ''}.`,
      tooFew: ({ section, n, of, date, light, revAgent }) =>
        `${section[0].toUpperCase()}${section.slice(1)}: too few pages reviewed for a section figure (${n ? `${n} of ${of}` : `none of ${of}`} random pages in an AI review, ${date}). Across the whole Tengyur, ${light}% of pages needed only light edits, and about ${revAgent} statements per 100 pages are reversed or attributed to the wrong speaker.`,
      kinds: {
        term: 'mistranslated technical terms',
        structure: 'misread sentence structure',
        gloss: 'inaccurate notes',
        omission: 'omitted phrases',
        addition: 'added words',
        reversal: 'reversed statements',
        agent: 'misattributed speakers',
      },
      vinayaTerms: (pct) => `mistranslated technical terms (Pali names for the offence classes on ${pct}% of Vinaya pages)`,
      methodLink: 'How this was measured',
      sectionNames: {
        'Tantra commentary': 'tantra commentary',
        'Sūtra commentary': 'sūtra commentary',
        'Grammar & sciences': 'grammar and sciences',
        Praises: 'praises',
        Letters: 'letters',
        Miscellaneous: 'miscellaneous',
        Catalogue: 'catalogue',
      },
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
        views: 'Muestra más de uno a la vez.',
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
      views: 'Escaneo, texto y traducción',
      viewsBlurb: 'Muestra más de uno a la vez',
      feedback: 'Enviar comentarios',
      feedbackBlurb: 'Cuéntanos algo sobre esta página o sobre el lector',
      menu: 'Menú',
      menuBlurb: 'El resto de la biblioteca, y tu cuenta',
      groupRead: 'Leer',
      groupPage: 'Esta página',
      groupReader: 'Lector',
    },
    panes: {
      viewScan: 'Escaneo',
      viewOcr: 'OCR',
      ocrPaneHeader: (language) => `${language} · OCR`,
      // Short chip label (matches "Roman" width); the fuller
      // "romanisedTranscription" string below spells it out.
      viewRoman: 'Latina',
      viewEnglish: 'Inglés',
      visiblePanesAria: 'Paneles visibles',
      showPane: (label) => `Mostrar ${label.toLowerCase()}`,
      lastPaneShowing: 'El único panel visible',
      pickPaneAria: 'Escaneo, texto o traducción',
      translatedFrom: (language) => `Traducido del original (${language})`,
      viewTheScan: 'ver el escaneo',
      viewTheText: (language) => `ver el texto (${language})`,

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
      krakenTranscript: (route) => route === 'print'
        ? 'Leída del escaneo por omnisyr, un modelo entrenado con siríaco impreso.'
        : 'Leída del escaneo por Sophro Mhiro (Beth Mardutho), un modelo entrenado con manuscritos siríacos.',
      krakenNotice: (route) =>
        'Transcripción automática, no revisada por una persona. ' +
        (route === 'print'
          ? 'Leímos cinco páginas impresas junto a sus escaneos (septiembre de 2026): las palabras eran correctas en las cinco, y en dos se mezclaron líneas de columnas distintas.'
          : 'Leímos cinco páginas manuscritas junto a sus escaneos (septiembre de 2026): tres se leyeron bien, y dos páginas dañadas salieron en fragmentos.') +
        ' Consulta el escaneo siempre que una lectura sea importante.',
      krakenEvidenceLink: 'Cómo lo comprobamos',
      iaTranscript: (engine, year, agreement) =>
        `Leída del escaneo por el OCR del Internet Archive${engine ? ` (${engine}${year ? `, ${year}` : ''})` : year ? ` (${year})` : ''}` +
        (agreement != null ? `, aceptada porque coincide con nuestra propia lectura de las páginas de muestra de este libro (${Math.round(agreement * 100)}% de las palabras)` : ''),
      manualTranscript: (model) => model ? `Leída del escaneo por ${model}, corregida a mano` : 'Transcrita a mano',
      transcriptChipIa: (engine) => `OCR del Internet Archive${engine ? ` · ${engine}` : ''}`,
      transcriptChipIaTitle: (agreement) =>
        'OCR del Archive — los números pueden estar mal leídos (véase #5186)' +
        (agreement != null ? ` · coincide con nuestra lectura de muestra en el ${Math.round(agreement * 100)}% de las palabras` : ''),
      transcriptChipManual: 'Manual',
      transcriptChipCorpus: (shortName) => `Corpus: ${shortName}`,
      transcriptChipTextSource: (shortName, license) => `Texto: ${shortName}, ${license === 'public domain' ? 'dominio público' : license}`,
      textSourceTranscript: (name, license, version) => `Texto: ${name}${version ? ` (${version})` : ''}, ${license === 'public domain' ? 'dominio público' : license}`,
      machineDraftNotice: 'Traducción por IA, aún no revisada por un especialista.',
      qualityKinds: {
        wrong_page: 'la imagen y el texto son de páginas distintas',
        english_other_page: 'la traducción corresponde a otra página',
        invented_transcription: 'la transcripción contiene texto que no está en la página',
        model_notes: 'las notas del propio modelo ocupan el lugar del texto',
        garble_translated: 'la traducción da por bueno un pasaje mal transcrito',
        meaning_reversed: 'la traducción invierte una afirmación u omite un matiz',
        misread_meaning: 'una palabra mal leída cambia el sentido',
        unsupported_notes: 'las notas afirman cosas que la página no dice',
        missing_transcription: 'falta parte de la página en la transcripción',
        missing_english: 'falta parte de la página en la traducción',
        number_misread: 'un número, una fecha o una cantidad están mal leídos',
        repeated_text: 'se repite un pasaje que aparece una sola vez en la página',
        serious_transcription: 'la transcripción tiene un error grave',
        serious_english: 'la traducción tiene un error grave',
        serious_other: 'la página tiene un error grave',
      },
      qualityFindings: (clauses, more) => clauses.join(', y que ') + (more ? ', entre otros errores graves' : ''),
      qualityPageReview: ({ ai, image, findings, date }) =>
        `${ai ? 'Un revisor de IA' : 'Un revisor'}, al leer esta página ${image ? 'junto a la imagen' : 'solo como texto, sin la imagen'}, encontró que ${findings} (${date}).`,
      qualityPageDetector: (date) => `Señalada por una comprobación automática; aún no la ha leído una persona (${date}).`,
      qualityBook: ({ ai, image, read, serious, date }) => {
        const start = `Una revisión hecha por ${ai ? 'un revisor de IA' : 'un revisor'} leyó ${read} ${read === 1 ? 'página' : 'páginas'} de este libro${image ? (read === 1 ? ' junto a la imagen' : ' junto a las imágenes') : ''} el ${date}`;
        if (serious === null) return `${start} y encontró errores graves.`;
        return `${start} y encontró errores graves en ${read === 1 ? 'ella' : `${serious} de ellas`}.`;
      },
      qualitySeeReview: 'Ver la revisión',
      qualityDetectorLink: 'Qué busca la comprobación',
      licenceLink: 'licencia',
      sourceLink: 'fuente',
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
      notReliablyLegible: 'Sin lectura fiable',
      notReliablyLegibleBody: 'Intentamos transcribir esta página, pero no pudimos obtener una lectura fiable, así que no mostramos ninguna. El escaneo que la acompaña es la fuente autorizada.',
      translationWithheld: 'Traducción retirada',
      translationWithheldBody: 'Acabamos de volver a transcribir esta página, y la traducción al inglés que teníamos se hizo a partir de la lectura anterior, menos exacta. La hemos retirado en lugar de dejar una traducción de un texto que ya no está aquí. Pronto habrá una nueva.',
      blankPage: 'Página en blanco.',
      readyToTranslate: 'Lista para traducir',
      readyToTranslateBody: 'La transcripción de esta página está completa. Todavía no se ha traducido al inglés.',
      englishReadingText: 'Edición en inglés',
      englishReadingTextBody: 'Este libro está en inglés — la transcripción es el texto de lectura. No hay nada que traducir.',
      notModernized: 'Aún sin modernizar',
      notModernizedBody: 'Este libro está en inglés moderno temprano. Todavía no se ha hecho una lectura modernizada; la transcripción es el texto de lectura.',
      signInToRequest: 'Inicia sesión para pedir una traducción',
      requestTranslation: 'Pedir la traducción',
      requestFailed: 'La solicitud no se ha enviado. Inténtalo de nuevo en un momento.',
      sending: 'Enviando…',
      requested: 'Solicitada',
      thanksWillEmail: 'Gracias. Te escribiremos cuando esta página esté traducida.',
      thanksWillPrioritise: 'Gracias. Daremos prioridad a este libro.',
    },
    paneGated: {
      label: 'Inicia sesión para seguir leyendo',
      body: (freePages) => `El escaneo se puede hojear libremente. Para leer la transcripción y la traducción más allá de las primeras ${freePages} páginas hace falta una cuenta gratuita.`,
      signIn: 'Inicia sesión — es gratis',
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
      attach: 'Añadir una captura',
      attachHint: 'o pega / arrastra una imagen',
      attachLimit: 'Hasta cuatro imágenes',
      attachFailed: 'No se pudo subir esa imagen. Prueba con una más pequeña.',
      removeImage: 'Quitar imagen',
    },
    readCaution: {
      unclear: (share) => `Esta página era difícil de leer: alrededor del ${Math.round(share * 100)} % de la transcripción está marcado como dudoso, y la traducción de esas partes es una conjetura.`,
      damage: 'Esta página está dañada o desvaída en algunas partes, y parte de la traducción puede basarse en lecturas dudosas.',
    },
    pageReport: {
      open: 'Informar de un problema en esta página',
      prompt: '¿Qué está mal? Elige una opción si encaja.',
      kinds: {
        garbled_source: 'La transcripción es ilegible',
        missing_text: 'Falta texto',
        invented_text: 'La traducción añade cosas',
        wrong_image: 'Imagen de página equivocada',
        wrong_language: 'Idioma equivocado',
        translation_error: 'La traducción está mal aquí',
      },
      commentPlaceholder: '¿Algo más? (opcional)',
      passageLabel: 'La traducción tal como se lee ahora',
      correctionLabel: 'Lo que debería decir',
      sourceLabel: 'Las palabras del original (opcional)',
      send: 'Enviar',
      sending: 'Enviando…',
      cancel: 'Cancelar',
      thanks: 'Gracias. Revisaremos esta página.',
      failed: 'No se ha enviado. Inténtalo de nuevo en un momento.',
    },
    tengyurNote: {
      rated: ({ section, n, date, light, work, specialist }) =>
        `De ${n} páginas al azar de ${section}, cotejadas con el tibetano por revisores de IA (${date}), el ${light} % necesitaba solo retoques${work ? `, el ${work} % una revisión sustancial` : ''}${specialist ? ` y el ${specialist} % un especialista` : ''}.`,
      faults: ({ kinds, revAgent, voice }) =>
        `Errores medidos: unas ${revAgent} afirmaciones por cada 100 páginas salen invertidas o atribuidas a otro hablante${voice ? ', entre ellas objeciones de un oponente presentadas como la opinión del autor' : ''}${kinds.length ? `. También frecuentes: ${kinds.join(', ')}` : ''}.`,
      tooFew: ({ section, n, of, date, light, revAgent }) =>
        `${section[0].toUpperCase()}${section.slice(1)}: muy pocas páginas revisadas para una cifra de la sección (${n ? `${n} de ${of}` : `ninguna de ${of}`} páginas al azar en una revisión por IA, ${date}). En todo el Tengyur, el ${light} % de las páginas necesitaba solo retoques, y unas ${revAgent} afirmaciones por cada 100 páginas salen invertidas o atribuidas a otro hablante.`,
      kinds: {
        term: 'términos técnicos mal traducidos',
        structure: 'estructura de la frase mal leída',
        gloss: 'notas inexactas',
        omission: 'frases omitidas',
        addition: 'palabras añadidas',
        reversal: 'afirmaciones invertidas',
        agent: 'hablantes mal atribuidos',
      },
      vinayaTerms: (pct) => `términos técnicos mal traducidos (nombres pali para las clases de faltas en el ${pct} % de las páginas del Vinaya)`,
      methodLink: 'Cómo se midió',
      sectionNames: {
        'Tantra commentary': 'comentario tántrico',
        'Sūtra commentary': 'comentario de sūtras',
        'Grammar & sciences': 'gramática y ciencias',
        Praises: 'himnos de alabanza',
        Letters: 'cartas',
        Miscellaneous: 'miscelánea',
        Catalogue: 'catálogo',
      },
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
  // Latin (#6254). Draft copy, to be read by a Latinist before launch.
  //
  // Two things differ from the Spanish block. First, a `/la` reader page exists
  // only for a book WRITTEN in Latin (`NATIVE_EDITION_LANGUAGE.la` is the route
  // gate), so the strings that take the book's language name it as Latin
  // outright rather than interpolating the stored English word "Latin".
  // Second, "conversio" always means the ENGLISH translation: nothing is
  // translated into Latin, and here the transcription is the reading text.
  la: {
    toolbar: {
      contents: 'Index',
      guide: 'Dux',
      search: 'Quaere',
      librarian: 'Bibliothecarius',
      save: 'Serva',
      share: 'Communica',
      cite: 'Cita',
      download: 'Deprome',
      info: 'Notitia',
      views: 'Aspectus',
      pages: 'Paginae',
      settings: 'Optiones',
      feedback: 'Scribe nobis',
      more: 'Plura',
      menu: 'Index',
      readerToolsAria: 'Instrumenta legendi',
      previousPage: 'Pagina prior',
      nextPage: 'Pagina sequens',
      previous: 'Prior',
      next: 'Sequens',
      close: 'Claude',
      jumpToPage: 'Paginam pete',
      backToTheBook: 'Ad librum redi',
      backToTheBookPage: 'Ad paginam libri redi',
      backToTheReader: 'Ad lectionem redi',
      scanFullScreen: 'Imago, toto scrinio',
      viewScanFullScreen: 'Imaginem toto scrinio specta',
    },
    panels: {
      titles: {
        save: 'Serva',
        menu: 'Index',
        contents: 'Index capitum',
        search: 'In hoc libro quaere',
        guide: 'Dux legendi',
        librarian: 'Bibliothecarium roga',
        info: 'De editione et pagina',
        cite: 'Hanc paginam cita',
        share: 'Communica',
        settings: 'Optiones legendi',
        views: 'Imago, textus, conversio',
        downloads: 'Deprome',
        history: 'Historia recensionum',
        feedback: 'Scribe nobis',
        more: 'Plura',
      },
      blurbs: {
        contents: 'Index capitum ipsius libri, ut impressus est.',
        search: 'Quaerit in textu transcripto et in descriptionibus imaginum.',
        guide: 'Summarium libri nostrum, ab intellegentia artificiali ex transcriptione confectum.',
        librarian: 'Responsa intellegentiae artificialis, hac pagina et libro circumstante nixa.',
        info: 'Quid haec pagina sit, et ex qua editione photographice descripta.',
        cite: 'Citatio quae hanc ipsam paginam indicat.',
        share: 'Nexum ad hanc paginam exscribe, vel eum publica.',
        settings: 'Quomodo textus componatur. Quae elegeris in hoc instrumento servantur.',
        views: 'Plura simul ostende.',
        downloads: 'Hanc paginam, vel totum librum, tecum aufer.',
        history: 'Omnes mutationes relatae transcriptionis et conversionis huius paginae.',
      },
      closeAria: (title) => `Claude: ${title}`,
      backToMore: 'Ad Plura redi',
    },
    moreMenu: {
      contents: 'Index capitum',
      contentsBlurb: 'Index capitum ipsius libri, ut impressus est',
      guide: 'Dux legendi',
      guideBlurb: 'Conspectus, argumenta, partes',
      search: 'In hoc libro quaere',
      searchBlurb: 'Verbum in textu transcripto inveni',
      librarian: 'Bibliothecarium roga',
      librarianBlurb: 'Quaestiones de hac pagina vel de libro',
      cite: 'Hanc paginam cita',
      citeBlurb: 'Citatio quae hanc ipsam paginam indicat',
      downloads: 'Deprome',
      downloadsBlurb: 'Haec pagina, vel totus liber, pluribus formis',
      info: 'De editione et pagina',
      infoBlurb: 'Haec pagina, et editio unde sumpta est',
      history: 'Historia recensionum',
      historyBlurb: 'Omnes mutationes relatae huius paginae',
      settings: 'Optiones legendi',
      settingsBlurb: 'Color, magnitudo litterarum, typi, notae',
      views: 'Imago, textus, conversio',
      viewsBlurb: 'Plura simul ostende',
      feedback: 'Scribe nobis',
      feedbackBlurb: 'Dic nobis de hac pagina vel de instrumento legendi',
      menu: 'Index',
      menuBlurb: 'Reliqua bibliotheca, et ratio tua',
      groupRead: 'Lege',
      groupPage: 'Haec pagina',
      groupReader: 'Instrumentum legendi',
    },
    panes: {
      viewScan: 'Imago',
      // The transcription IS the reading text on `/la`, so the pane is named for
      // what it holds rather than for how it was made.
      viewOcr: 'Latine',
      ocrPaneHeader: () => 'Textus Latinus',
      viewRoman: 'Litteris Latinis',
      viewEnglish: 'Anglice',
      visiblePanesAria: 'Tabulae quae ostenduntur',
      showPane: (label) => `Ostende: ${label}`,
      lastPaneShowing: 'Ultima tabula quae ostenditur',
      pickPaneAria: 'Imago, textus, vel conversio',
      translatedFrom: () => 'Ex Latino conversum',
      viewTheScan: 'imaginem specta',
      viewTheText: () => 'textum Latinum specta',

      originalFallback: 'Textus primigenius',
      romanisedHeader: 'Litteris Latinis',
      aiTranslated: 'Intellegentia artificiali conversum',
      aiShort: 'IA',
      aiTitle: 'Intellegentia artificiali adiuvante factum',
      corpusChip: (shortName) => `Conversio ${shortName}`,
      corpusChipTitle: (name) => `Textus Anglicus conversionem doctam sequitur (${name}); machina factus non est`,
      tabletWitness: 'Tabula testis',
      witnessCount: (index, total) => `Tabula ${index} ex ${total}`,
      witnessNotSource: (shortName) => `Textus editionem ${shortName} sequitur; ex hoc photographemate non legitur`,
      witnessAlt: (designation) => `Photographema tabulae ${designation}`,
      prevWitness: 'Tabula prior',
      nextWitness: 'Tabula sequens',
      viewOnCdli: 'Apud CDLI specta',
      noFacsimile: 'Imago nulla: haec est editio textus',
      scanAlt: (pageNumber, title) => `Imago paginae ${pageNumber} libri ${title}`,

      originalScan: 'Imago exemplaris',
      originalScanHint: 'Pagina ut photographice descripta est',
      transcriptionOf: () => 'Textus Latinus',
      transcriptionHint: 'Textus impressus, machina lectus',
      englishTranslation: 'Conversio Anglica',
      englishTranslationHint: 'Intellegentia artificiali adiuvante conversa',
      romanisedTranscription: 'Transcriptio litteris Latinis',
      romanisedTranscriptionHint: 'Eadem verba litteris Latinis scripta',

      zoomOut: 'Minue',
      zoomIn: 'Auge',
      resetZoom: 'Magnitudinem restitue',
      readingLens: 'Vitrum legendi: locum sub indice auge',
      readingLensOff: 'Vitrum legendi tolle',
      readingLensUnavailable: 'Vitrum legendi (in magnitudine 100% praesto)',

      notes: 'Notae',
      showNotes: 'Notas et glossas in textu ostende',
      hideNotes: 'Notas et glossas in textu cela',
      trace: 'Vestiga',
      turnTracingOff: 'Vestigationem tolle',
      traceFallbackLanguage: 'textu primigenio',
      traceHint: () => 'Vestigatio: locutionem quamlibet preme, ut eam in textu Latino videas',
      traceAligning: 'Haec pagina cum conversione componitur…',
      traceUnavailable: 'Vestigatio huic paginae praesto non est.',
      traceEnglishOnly: 'Vestigatio textum primigenium cum conversione Anglica confert. Ad Anglicam redi, ut ea utaris.',
      descriptionHidden: (pageTypeLabel: string) => `Pagina: ${pageTypeLabel}. Notas ostende, ut descriptionem legas.`,
      traceRateLimited: 'Finis vestigationum attactus est. Intra (gratis), ut pergas.',
      traceClickHint: 'Locutionem quamlibet preme, ut eam in altera tabula videas.',

      romanising: 'Haec pagina litteris Latinis redditur…',
      romanisingLonger: 'diutius quam solet in pagina huius magnitudinis',
      romanisingEstimate: (seconds) => `plerumque circiter ${seconds}s pro tanto textu`,
      translitFailed: 'Transcriptio litteris Latinis huius paginae confici non potuit.',
      translitNone: 'Huius paginae transcriptio litteris Latinis nondum exstat.',

      copyTranscription: 'Transcriptionem exscribe',
      copyTranslation: 'Conversionem exscribe',
      copyTransliteration: 'Transcriptionem litteris Latinis exscribe',
      copied: 'Exscriptum',

      marksMeaning: 'Quid signa in textu significent',
      marksMeaningShort: 'Quid signa significent',
      marksInText: 'Signa in textu',
      markGlossOrTerm: 'Glossa vel vocabulum',
      markGlossOrTermDesc: 'Verbum explicatum, vel vocabulum artis notatum.',
      markOnThePage: 'In pagina',
      markOnThePageDesc: 'Nota marginalis vel manus recentior, in exemplari praesens.',
      markOurNote: 'Nota nostra',
      markOurNoteDesc: 'Hic ab editore addita; in exemplari non est.',
      marksHiddenByNotes: 'Notis celatis omnia celantur.',
    },
    contents: {
      noContentsTranscribed: 'Index capitum huius editionis nondum transcriptus est. Duce legendi vel serie paginarum utere, ut per librum eas.',
      noContentsAtAll: 'Hic liber indicem capitum non habet.',
    },
    guide: {
      noGuideYet: 'Hic liber ducem legendi nondum habet.',
      requestGuide: 'Ducem legendi pete',
      requestGuideThanks: 'Gratias agimus. Hic liber in ordinem relatus est; dux hic apparebit cum confectus erit.',
      requestFailed: 'Petitio non pervenit. Paulo post iterum tempta.',
      showLess: 'Pauciora ostende',
      readFullOverview: (more) => `Totum conspectum lege (${more} plura)`,
      sections: 'Partes',
      readThisSection: 'Hanc partem lege →',
    },
    search: {
      placeholder: 'Quaere…',
      inputAria: 'In hoc libro quaere',
      noMatches: 'Nihil in hoc libro repertum',
      failed: 'Quaerere nunc non licet. Paulo post iterum tempta.',
      pagesMatch: (total) => `${total} ${total === 1 ? 'pagina congruit' : 'paginae congruunt'}`,
      pageLabel: (n) => `Pagina ${n}`,
    },
    librarian: {
      suggestions: [
        'De qua re agit haec pagina?',
        'Quis fuit auctor?',
        'Praecipuas notiones huius paginae explica',
      ],
      orStartHere: 'Vel hinc incipe',
      askAboutPage: (pageNumber) => `De p. ${pageNumber} roga…`,
      inputAria: 'Bibliothecarium roga',
      ask: 'Roga',
      consulting: 'Textus consulitur…',
      askErrorInline: 'Bibliothecarius nunc respondere non potuit. Iterum tempta.',
    },
    info: {
      thisPage: 'Haec pagina',
      thisEdition: 'Haec editio',
      howPageWasMade: 'Quomodo haec pagina facta sit',
      fieldTitle: 'Titulus',
      fieldEnglish: 'Anglice',
      fieldAuthor: 'Auctor',
      fieldLanguage: 'Lingua',
      fieldPlace: 'Locus',
      fieldPublisher: 'Typographus',
      fieldPublished: 'Editus',
      fieldFormat: 'Forma',
      fieldPages: 'Paginae',
      fieldScan: 'Imago',
      fieldTranscript: 'Transcriptio',
      scannedFrom: (pageNumber) => `Ex editione impressa photographice descripta${pageNumber != null ? `, p. ${pageNumber}` : ''}`,
      transcribedBy: (model) => `Ex imagine lecta a ${model}`,
      translatedBy: (model) => `Ex transcriptione conversa a ${model}`,
      machineNotice: 'Transcriptio et conversio machina factae menda habent. Imago fons est: eam iuxta textum lege, ubicumque lectio alicuius momenti est.',
      corpusNoScan: (witnessCount) => witnessCount > 0
        ? `Nulla: haec est editio textus digitalis. Opus in ${witnessCount} ${witnessCount === 1 ? 'tabula fictili' : 'tabulis fictilibus'} apud CDLI relatis servatur.`
        : 'Nulla: haec est editio textus digitalis; imagines paginarum nullae exstant.',
      corpusTranscript: (name, org) => `Transcriptio composita ex ${name}${org ? ` (${org})` : ''}`,
      krakenTranscript: (route) => route === 'print'
        ? 'Ex imagine lecta ab omnisyr, exemplari in libris Syriacis typis impressis exercitato.'
        : 'Ex imagine lecta a Sophro Mhiro (Beth Mardutho), exemplari in codicibus Syriacis manu scriptis exercitato.',
      krakenNotice: (route) =>
        'Transcriptio machina facta, ab homine non recognita. ' +
        (route === 'print'
          ? 'Quinque paginas typis impressas cum imaginibus contulimus (mense Septembri 2026): verba in omnibus quinque recte lecta sunt, in duabus autem versus e columnis diversis confusi sunt.'
          : 'Quinque paginas manu scriptas cum imaginibus contulimus (mense Septembri 2026): tres recte lectae sunt, duae laesae fragmentatim redditae sunt.') +
        ' Imaginem inspice, ubicumque lectio alicuius momenti est.',
      krakenEvidenceLink: 'Quomodo exploraverimus',
      iaTranscript: (engine, year, agreement) =>
        `Ex imagine lecta ab OCR Internet Archive${engine ? ` (${engine}${year ? `, ${year}` : ''})` : year ? ` (${year})` : ''}` +
        (agreement != null ? `, recepta quia cum nostra lectione paginarum huius libri delectarum consentit (${Math.round(agreement * 100)}% verborum)` : ''),
      manualTranscript: (model) => model ? `Ex imagine lecta a ${model}, manu emendata` : 'Manu transcripta',
      transcriptChipIa: (engine) => `OCR Internet Archive${engine ? ` · ${engine}` : ''}`,
      transcriptChipIaTitle: (agreement) =>
        'OCR Internet Archive: numeri perperam legi possunt (vide #5186)' +
        (agreement != null ? ` · cum lectione nostra in ${Math.round(agreement * 100)}% verborum consentit` : ''),
      transcriptChipManual: 'Manu',
      transcriptChipCorpus: (shortName) => `Corpus: ${shortName}`,
      transcriptChipTextSource: (shortName, license) => `Textus: ${shortName}, ${license}`,
      textSourceTranscript: (name, license, version) => `Textus: ${name}${version ? ` (${version})` : ''}, ${license}`,
      machineDraftNotice: 'Conversio intellegentiae artificialis, a docto nondum recensita.',
      // Latin has no neat "found that X, and that Y": each kind is a full
      // clause and the sentence frames them after a colon.
      qualityKinds: {
        wrong_page: 'imago et textus ex diversis paginis sunt',
        english_other_page: 'textus Anglicus ad aliam paginam pertinet',
        invented_transcription: 'transcriptio verba habet quae in pagina non sunt',
        model_notes: 'adnotationes ipsius machinae locum textus tenent',
        garble_translated: 'textus Anglicus transcriptionem corruptam quasi sanam convertit',
        meaning_reversed: 'textus Anglicus sententiam invertit vel exceptionem omittit',
        misread_meaning: 'verbum perperam lectum sensum mutat',
        unsupported_notes: 'adnotationes ea affirmant quae pagina non dicit',
        missing_transcription: 'pars paginae in transcriptione deest',
        missing_english: 'pars paginae in textu Anglico deest',
        number_misread: 'numerus, dies vel quantitas perperam lecta est',
        repeated_text: 'locus iteratur qui in pagina semel legitur',
        serious_transcription: 'transcriptio mendum grave habet',
        serious_english: 'textus Anglicus mendum grave habet',
        serious_other: 'pagina mendum grave habet',
      },
      qualityFindings: (clauses, more) => clauses.join('; ') + (more ? '; praeterea alia menda gravia' : ''),
      qualityPageReview: ({ ai, image, findings, date }) =>
        `${ai ? 'Recensor artificialis' : 'Recensor'} hanc paginam ${image ? 'cum imagine collatam' : 'ut textum, sine imagine,'} legens haec invenit: ${findings} (${date}).`,
      qualityPageDetector: (date) => `Probatione automataria notata, ab homine nondum lecta (${date}).`,
      qualityBook: ({ ai, image, read, serious, date }) => {
        const start = `${ai ? 'Recensor artificialis' : 'Recensor'} ${read} ${read === 1 ? 'paginam' : 'paginas'} huius libri ${image ? (read === 1 ? 'cum imagine collatam ' : 'cum imaginibus collatas ') : ''}legit (${date})`;
        if (serious === null) return `${start} et menda gravia invenit.`;
        return `${start} et menda gravia ${read === 1 ? 'in ea' : `in ${serious} earum`} invenit.`;
      },
      qualitySeeReview: 'Recensionem vide',
      qualityDetectorLink: 'Quid probatio quaerat',
      licenceLink: 'licentia',
      sourceLink: 'fons',
      corpusTranslation: (name) => `Conversio docta ex ${name}; machina facta non est`,
      corpusNotice: 'Haec pagina editionem corporis docti refert: transcriptio et conversio editorum eius opus sunt, non intellegentiae artificialis. Divisio in paginas nostra est: corpus textum per versus dividit, non per paginas.',
      corpusAiNotice: (name) => `Transcriptio ${name} sequitur; textus Anglicus ex ea machina conversus est et menda habere potest.`,
    },
    cite: {
      copyCitation: 'Citationem exscribe',
      copied: 'Exscriptum',
    },
    share: {
      copyLink: 'Nexum ad hanc paginam exscribe',
      copyLinkWithReference: 'Nexum cum citatione exscribe',
      postTo: 'Publica in',
      email: 'Epistula electronica',
    },
    paneEmpty: {
      notTranscribed: 'Nondum transcripta',
      notTranscribedBody: 'Imago adest et libere legi potest, sed haec pagina nondum transcripta est; nihil igitur est unde convertatur.',
      notReliablyLegible: 'Non satis certo legibilis',
      notReliablyLegibleBody: 'Hanc paginam transcribere conati sumus, sed lectionem cui fidamus efficere non potuimus; itaque nullam ostendimus. Imago iuxta posita fons certus est.',
      translationWithheld: 'Conversio retracta',
      translationWithheldBody: 'Haec pagina modo denuo transcripta est, et conversio Anglica quam habebamus ex lectione priore, minus accurata, facta erat. Eam sustulimus, ne conversio textus qui iam non adest relinqueretur. Nova sequetur.',
      blankPage: 'Pagina vacua.',
      readyToTranslate: 'Ad convertendum parata',
      readyToTranslateBody: 'Haec pagina iam machina lecta est. Anglice nondum conversa est.',
      englishReadingText: 'Editio Anglica',
      englishReadingTextBody: 'Hic liber Anglice scriptus est: transcriptio ipsa legenda est. Nihil est quod convertatur.',
      notModernized: 'Nondum sermone hodierno reddita',
      notModernizedBody: 'Hic liber Anglice prisco scriptus est. Sermone hodierno nondum redditus est; transcriptio ipsa legenda est.',
      signInToRequest: 'Intra, ut conversionem petas',
      requestTranslation: 'Conversionem pete',
      requestFailed: 'Petitio non pervenit. Paulo post iterum tempta.',
      sending: 'Mittitur…',
      requested: 'Petitum',
      thanksWillEmail: 'Gratias agimus: per epistulam te certiorem faciemus cum haec pagina conversa erit.',
      thanksWillPrioritise: 'Gratias agimus: hunc librum ceteris anteponemus.',
    },
    paneGated: {
      label: 'Intra, ut legere pergas',
      body: (freePages) => `Imagines libere perlustrantur. Ad transcriptionem et conversionem ultra primas ${freePages} paginas legendas ratio gratuita requiritur.`,
      signIn: 'Intra: gratis est',
    },
    save: {
      anonymousNotice: 'Sine ratione servare licet, sed in hoc instrumento tantum.',
      signInToKeep: 'Intra, ut ubique serventur',
      savedPage: 'In bibliotheca tua servata',
      savePage: 'Hanc paginam serva',
      savedBook: (title) => `Servatus: “${title}”`,
      saveBook: 'Totum librum serva',
      saveFailed: 'Servari non potuit. Iterum tempta.',
      yourLibrary: 'Bibliotheca tua',
      everythingSaved: 'Omnia quae servasti',
    },
    downloads: {
      thisPage: 'Haec pagina',
      scanOfPage: (pageNumber) => `Imago p. ${pageNumber ?? ''}`.trim(),
      scanFormatNote: 'JPEG, ea magnitudine qua in archivo servata est',
      noScanArchived: 'Huius paginae imago in archivo nulla servatur.',
      thisPageComplete: 'Haec pagina, integra',
      thisPageCompleteNote: 'Imago, transcriptio, conversio, citatio, in unum fasciculum compressae',
      dailyLimitReached: 'Finis hodiernus depromendi attactus est.',
      signInToDownload: 'Intra, ut hanc paginam depromas.',
      downloadFailed: 'Depromi non potuit. Iterum tempta.',
      wholeBook: 'Totus liber',
    },
    feedback: {
      blurb: 'Quidquid in hac pagina vel in ipso instrumento legendi mendosum est, deest, vel scitu dignum.',
      placeholder: 'Quid animadvertisti?',
      emailLabel: 'Inscriptio electronica',
      emailPlaceholder: 'tu@exemplum.com',
      emailNote: 'Tantum si responsum cupis. Ad nullam aliam rem ea utemur.',
      send: 'Mitte',
      sending: 'Mittitur…',
      thanks: 'Gratias agimus. Hoc ad nos pervenit, una cum pagina in qua eras.',
      failed: 'Mitti non potuit. Paulo post iterum tempta.',
      tooShort: 'Paulo plura prius scribe.',
      aboutPage: (pageNumber) => `Nota tua dicet te in p. ${pageNumber} fuisse.`,
      attach: 'Imaginem scrinii adde',
      attachHint: 'vel imaginem huc adglutina aut trahe',
      attachLimit: 'Ad summum quattuor imagines',
      attachFailed: 'Ea imago mitti non potuit. Minorem tempta.',
      removeImage: 'Imaginem remove',
    },
    readCaution: {
      unclear: (share) => `Haec pagina aegre lecta est: circiter ${Math.round(share * 100)}% transcriptionis incerta notantur, et conversio Anglica ibi coniectura est.`,
      damage: 'Haec pagina locis quibusdam laesa vel evanida est, et partes conversionis Anglicae lectionibus incertis niti possunt.',
    },
    pageReport: {
      open: 'Mendum huius paginae defer',
      prompt: 'Quid mendosum est? Unum elige, si convenit.',
      kinds: {
        garbled_source: 'Transcriptio corrupta est',
        missing_text: 'Textus deest',
        invented_text: 'Conversio aliquid addit',
        wrong_image: 'Imago alienae paginae',
        wrong_language: 'Lingua falsa',
      },
      commentPlaceholder: 'Aliquid aliud? (si vis)',
      send: 'Relationem mitte',
      sending: 'Mittitur…',
      cancel: 'Omitte',
      thanks: 'Gratias agimus. Hanc paginam inspiciemus.',
      failed: 'Mitti non potuit. Paulo post iterum tempta.',
    },
    history: {
      title: 'Historia recensionum',
      loading: 'Historia recensionum arcessitur…',
      loadFailed: 'Historia recensionum huius paginae arcessi non potuit. Paulo post iterum tempta.',
      noRevisions: 'Nullae recensiones huius paginae relatae sunt.',
      onlyMaintenance: 'Tantum opera curationis universae, infra.',
      chars: 'litterae',
      showMaintenance: (n) => `Ostende ${n} ${n === 1 ? 'recensionem' : 'recensiones'} curationis universae`,
      hideMaintenance: (n) => `Cela ${n} ${n === 1 ? 'recensionem' : 'recensiones'} curationis universae`,
      maintenanceNote: 'Reparationes corporis et curationes totius bibliothecae quae forte hanc paginam attigerunt; novae lectiones imaginis non sunt.',
      restoreForbidden: 'Ut editor iam non intrasti. Iterum intra, ut hanc versionem restituas.',
      restoreFailed: 'Ea versio restitui non potuit. Paulo post iterum tempta.',
      today: (time) => `Hodie ${time}`,
      yesterday: 'Heri',
      daysAgo: (n) => `abhinc ${n} d.`,
      sourceAi: 'IA',
      sourceBatch: 'Gregatim',
      sourceManual: 'Manu',
      sourceContributor: 'Adiutor',
      sourceMaintenance: 'Curatio',
      fieldTranscript: 'Transcriptio',
      fieldTranslation: 'Conversio',
    },
    settings: {
      theme: 'Color',
      themeLight: 'Clarus',
      themeSepia: 'Sepia',
      themeDark: 'Obscurus',
      textSize: 'Magnitudo litterarum',
      smallerText: 'Litterae minores',
      largerText: 'Litterae maiores',
      lineWidth: 'Latitudo versuum',
      lineWidthNarrow: 'Angusta',
      lineWidthNormal: 'Media',
      lineWidthWide: 'Lata',
      typeface: 'Typi',
      typefaceSerif: 'Serif',
      typefaceSans: 'Sans',
      lineHeight: 'Intervallum versuum',
    },
    accountMenu: {
      library: 'Bibliotheca',
      collections: 'Collectiones',
      gallery: 'Pinacotheca',
      browse: 'Perlustra',
      catalogue: 'Catalogus',
      works: 'Opera',
      explore: 'Tabulae',
      librarian: 'Bibliothecarius',
      you: 'Tu',
      yourAccount: 'Ratio tua',
      savedPages: 'Paginae servatae',
      readingHistory: 'Historia legendi',
      signIn: 'Intra',
      supportSourceLibrary: 'Source Library sustenta',
      sendFeedback: 'Scribe nobis',
      siteLanguage: 'Lingua situs',
      signOut: 'Exi',
    },
    pinnedEdition: {
      citedVersion: 'Versio citata',
      resolving: 'Editio citata quaeritur…',
      unresolvable: (v) => `Hic nexus editionem v${v} citat, sed ea inveniri non potuit. Textus praesens ostenditur.`,
      continueReadingLink: 'Legere perge →',
      pageNotInEdition: (label, date) => `Haec pagina in editione ${label}, die ${date} edita, non erat; textus praesens ostenditur.`,
      readingEdition: (label, date) => `Editionem ${label} legis, die ${date} editam.`,
      readingEditionRevised: (label, date) => `Editionem ${label} legis, die ${date} editam; conversio postea recensita est.`,
      viewCurrentEdition: 'Editionem praesentem specta →',
    },
  },
};

/** Reader chrome strings for `lang`. Defaults to English for an unrecognized locale. */
export function getReaderStrings(lang: Locale): ReaderStrings {
  return READER_UI_STRINGS[lang] ?? READER_UI_STRINGS.en;
}
