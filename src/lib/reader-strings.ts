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
    /** Heading over a translation written for a page with no source text (#5903):
     *  the model described a plate or an endpaper, or wrote over a failed OCR.
     *  Not the book's words. Says "little or no text was transcribed", not "no text":
     *  the rule measures the transcription (< 30 characters), and a failed OCR
     *  leaves text on the leaf. */
    ungroundedLabel: string;
    /** The same page with the Notes toggle off. */
    ungroundedHidden: string;
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
    /** A non-blank page the pipeline marked "no translatable content" (#5903).
     *  Takes the page type, already labelled. */
    noTextPage: (pageTypeLabel: string) => string;
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

/** The Tengyur quality note in English (#6120). Hoisted so the Latin block can reuse it:
 * a `/la` reader page exists only for a book written in Latin, so a Tibetan canon volume
 *  never renders there and the note needs no Latin wording. */
const TENGYUR_NOTE_EN: ReaderStrings['tengyurNote'] = {
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
};

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
      corpusChipTitle: (name) => `The English follows the scholarly translation of the ${name}. It is not machine-made`,
      tabletWitness: 'Tablet witness',
      witnessCount: (index, total) => `Tablet ${index} of ${total}`,
      witnessNotSource: (shortName) => `The text follows the ${shortName} edition. It is not read from this photograph`,
      witnessAlt: (designation) => `Photograph of tablet ${designation}`,
      prevWitness: 'Previous tablet',
      nextWitness: 'Next tablet',
      viewOnCdli: 'View on CDLI',
      noFacsimile: 'No facsimile: this is a text edition',
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
      ungroundedLabel: 'Little or no text was transcribed on this page · written by the model',
      ungroundedHidden: 'Little or no text was transcribed on this page. Turn Notes on to read what the model wrote.',
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
      askErrorInline: "The librarian couldn't answer just now. Try again.",
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
        ? `None. This is a digital text edition. The composition survives on ${witnessCount} clay tablet${witnessCount === 1 ? '' : 's'} catalogued at CDLI.`
        : 'None. This is a digital text edition; no page images exist.',
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
      corpusTranslation: (name) => `Scholarly translation from the ${name}, not machine-made`,
      corpusNotice: 'This page reproduces a scholarly corpus edition: the transliteration and translation are the work of its editors, not of AI. The page divisions are ours; the corpus divides the text by lines, not pages.',
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
      noTextPage: (pageTypeLabel: string) => `${pageTypeLabel} page. No text to translate.`,
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
      thanksWillEmail: 'Thanks. We’ll email you when this page is translated.',
      thanksWillPrioritise: 'Thanks. We’ll prioritize this book.',
    },
    paneGated: {
      label: 'Sign in to keep reading',
      body: (freePages) => `The scan is free to browse. Reading the transcription and translation past the first ${freePages} pages asks for a free account.`,
      signIn: 'Sign in (it’s free)',
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
    tengyurNote: TENGYUR_NOTE_EN,
    history: {
      title: 'Revision history',
      loading: 'Loading revision history…',
      loadFailed: "Couldn't load revision history for this page. Try again in a moment.",
      noRevisions: 'No recorded revisions for this page.',
      onlyMaintenance: 'Only bulk-maintenance activity, below.',
      chars: 'chars',
      showMaintenance: (n) => `Show ${n} bulk-maintenance ${n === 1 ? 'revision' : 'revisions'}`,
      hideMaintenance: (n) => `Hide ${n} bulk-maintenance ${n === 1 ? 'revision' : 'revisions'}`,
      maintenanceNote: 'Corpus repairs and library-wide sweeps that happened to touch this page, not fresh readings of the scan.',
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
      pageNotInEdition: (label, date) => `This page was not part of edition ${label}, published ${date}. Showing the current text.`,
      readingEdition: (label, date) => `You are reading edition ${label}, published ${date}.`,
      readingEditionRevised: (label, date) => `You are reading edition ${label}, published ${date}. The translation has since been revised.`,
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
      corpusChipTitle: (name) => `El inglés sigue la traducción académica de ${name}. No es obra de una máquina`,
      tabletWitness: 'Tablilla testigo',
      witnessCount: (index, total) => `Tablilla ${index} de ${total}`,
      witnessNotSource: (shortName) => `El texto sigue la edición ${shortName}. No se leyó de esta fotografía`,
      witnessAlt: (designation) => `Fotografía de la tablilla ${designation}`,
      prevWitness: 'Tablilla anterior',
      nextWitness: 'Tablilla siguiente',
      viewOnCdli: 'Ver en CDLI',
      noFacsimile: 'Sin facsímil: es una edición de texto',
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
      ungroundedLabel: 'Se transcribió poco o ningún texto en esta página · escrito por el modelo',
      ungroundedHidden: 'Se transcribió poco o ningún texto en esta página. Activa las notas para leer lo que escribió el modelo.',
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
        ? `Ninguno. Es una edición digital de texto. La composición sobrevive en ${witnessCount} tablilla${witnessCount === 1 ? '' : 's'} de arcilla catalogada${witnessCount === 1 ? '' : 's'} en CDLI.`
        : 'Ninguno. Es una edición digital de texto; no existen imágenes de página.',
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
        'OCR del Archive: los números pueden estar mal leídos (véase #5186)' +
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
      corpusTranslation: (name) => `Traducción académica procedente de ${name}, no obra de una máquina`,
      corpusNotice: 'Esta página reproduce una edición académica de corpus: la transliteración y la traducción son obra de sus editores, no de la IA. La división en páginas es nuestra; el corpus divide el texto por líneas, no por páginas.',
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
      noTextPage: (pageTypeLabel: string) => `Página de ${pageTypeLabel.toLowerCase()}. No hay texto que traducir.`,
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
      signIn: 'Inicia sesión (es gratis)',
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
      ungroundedLabel: 'Paulum aut nihil textus ex hac pagina transcriptum · a machina scriptum',
      ungroundedHidden: 'Paulum aut nihil textus ex hac pagina transcriptum. Notas ostende, ut quae machina scripsit legas.',
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
      noTextPage: (pageTypeLabel: string) => `Pagina: ${pageTypeLabel}. Nihil vertendum.`,
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
        translation_error: 'Conversio Anglica hic errat',
      },
      commentPlaceholder: 'Aliquid aliud? (si vis)',
      passageLabel: 'Conversio ut nunc legitur',
      correctionLabel: 'Quid dicere debeat',
      sourceLabel: 'Verba fontis (si vis)',
      send: 'Relationem mitte',
      sending: 'Mittitur…',
      cancel: 'Omitte',
      thanks: 'Gratias agimus. Hanc paginam inspiciemus.',
      failed: 'Mitti non potuit. Paulo post iterum tempta.',
    },
    // Unreachable on /la (Latin-language books only); English kept so the type stays total.
    tengyurNote: TENGYUR_NOTE_EN,
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
  // Dutch (#6382). Draft copy, to be read by a native speaker before launch.
  //
  // As in the Latin block: a `/nl` reader page exists only for a book WRITTEN
  // in Dutch, so the strings that take the book's language name it as Dutch
  // outright rather than interpolating the stored English word "Dutch". And
  // "vertaling" always means the ENGLISH translation: nothing is translated
  // into Dutch, and here the transcription is the reading text.
  nl: {
    toolbar: {
      contents: 'Inhoud',
      guide: 'Wijzer',
      search: 'Zoeken',
      librarian: 'Bibliothecaris',
      save: 'Bewaren',
      share: 'Delen',
      cite: 'Citeren',
      download: 'Downloaden',
      info: 'Info',
      views: 'Weergave',
      pages: 'Pagina’s',
      settings: 'Instellingen',
      feedback: 'Feedback',
      more: 'Meer',
      menu: 'Menu',
      readerToolsAria: 'Leesgereedschap',
      previousPage: 'Vorige pagina',
      nextPage: 'Volgende pagina',
      previous: 'Vorige',
      next: 'Volgende',
      close: 'Sluiten',
      jumpToPage: 'Naar pagina',
      backToTheBook: 'Terug naar het boek',
      backToTheBookPage: 'Terug naar de boekpagina',
      backToTheReader: 'Terug naar de lezer',
      scanFullScreen: 'Scan, volledig scherm',
      viewScanFullScreen: 'De scan op volledig scherm bekijken',
    },
    panels: {
      titles: {
        save: 'Bewaren',
        menu: 'Menu',
        contents: 'Inhoud',
        search: 'Zoeken in dit boek',
        guide: 'Leeswijzer',
        librarian: 'Vraag het de bibliothecaris',
        info: 'Editie en pagina',
        cite: 'Deze pagina citeren',
        share: 'Delen',
        settings: 'Leesinstellingen',
        views: 'Scan, tekst en vertaling',
        downloads: 'Downloaden',
        history: 'Wijzigingsgeschiedenis',
        feedback: 'Feedback sturen',
        more: 'Meer',
      },
      blurbs: {
        contents: 'De inhoudsopgave van het boek zelf, zoals gedrukt.',
        search: 'Zoekt in de getranscribeerde tekst en in de beschrijvingen van de illustraties.',
        guide: 'Onze samenvatting van het boek, door AI geschreven op basis van de transcriptie.',
        librarian: 'Antwoorden van AI, gebaseerd op deze pagina en het boek eromheen.',
        info: 'Wat deze pagina is, en van welke editie ze is gescand.',
        cite: 'Een bronvermelding die naar precies deze pagina verwijst.',
        share: 'Kopieer een link naar deze pagina, of plaats hem online.',
        settings: 'Hoe de tekst wordt weergegeven. Je keuzes worden op dit apparaat onthouden.',
        views: 'Toon er meer dan één tegelijk.',
        downloads: 'Neem deze pagina, of het hele boek, mee.',
        history: 'Elke vastgelegde wijziging in de transcriptie en vertaling van deze pagina.',
      },
      closeAria: (title) => `${title} sluiten`,
      backToMore: 'Terug naar Meer',
    },
    moreMenu: {
      contents: 'Inhoud',
      contentsBlurb: 'De inhoudsopgave van het boek zelf, zoals gedrukt',
      guide: 'Leeswijzer',
      guideBlurb: 'Overzicht, thema’s, onderdelen',
      search: 'Zoeken in dit boek',
      searchBlurb: 'Zoek een woord in de getranscribeerde tekst',
      librarian: 'Vraag het de bibliothecaris',
      librarianBlurb: 'Vragen over deze pagina of het boek',
      cite: 'Deze pagina citeren',
      citeBlurb: 'Een bronvermelding die naar precies deze pagina verwijst',
      downloads: 'Downloaden',
      downloadsBlurb: 'Deze pagina, of het hele boek, in verschillende formaten',
      info: 'Editie en pagina',
      infoBlurb: 'Deze pagina, en de editie waar ze uit komt',
      history: 'Wijzigingsgeschiedenis',
      historyBlurb: 'Elke vastgelegde wijziging in deze pagina',
      settings: 'Leesinstellingen',
      settingsBlurb: 'Thema, tekstgrootte, letter, noten',
      views: 'Scan, tekst en vertaling',
      viewsBlurb: 'Toon er meer dan één tegelijk',
      feedback: 'Feedback sturen',
      feedbackBlurb: 'Vertel ons over deze pagina of de lezer',
      menu: 'Menu',
      menuBlurb: 'De rest van de bibliotheek, en je account',
      groupRead: 'Lezen',
      groupPage: 'Deze pagina',
      groupReader: 'Lezer',
    },
    panes: {
      viewScan: 'Scan',
      // The transcription IS the reading text on `/nl`, so the pane is named for
      // what it holds rather than for how it was made.
      viewOcr: 'Nederlands',
      ocrPaneHeader: () => 'Nederlandse tekst',
      viewRoman: 'Latijns schrift',
      viewEnglish: 'Engels',
      visiblePanesAria: 'Zichtbare panelen',
      showPane: (label) => `${label} tonen`,
      lastPaneShowing: 'Het laatste zichtbare paneel',
      pickPaneAria: 'Scan, tekst of vertaling',
      translatedFrom: () => 'Vertaald uit het Nederlands',
      viewTheScan: 'de scan bekijken',
      viewTheText: () => 'de Nederlandse tekst bekijken',

      originalFallback: 'Origineel',
      romanisedHeader: 'Latijns schrift',
      aiTranslated: 'Vertaald met AI',
      aiShort: 'AI',
      aiTitle: 'Gemaakt met hulp van AI',
      corpusChip: (shortName) => `Vertaling ${shortName}`,
      corpusChipTitle: (name) => `Het Engels volgt de wetenschappelijke vertaling van het ${name}. Het is niet door een machine gemaakt`,
      tabletWitness: 'Tablet als getuige',
      witnessCount: (index, total) => `Tablet ${index} van ${total}`,
      witnessNotSource: (shortName) => `De tekst volgt de editie van ${shortName}. Hij is niet van deze foto afgelezen`,
      witnessAlt: (designation) => `Foto van tablet ${designation}`,
      prevWitness: 'Vorige tablet',
      nextWitness: 'Volgende tablet',
      viewOnCdli: 'Bekijken op CDLI',
      noFacsimile: 'Geen facsimile: dit is een tekstuitgave',
      scanAlt: (pageNumber, title) => `Scan van pagina ${pageNumber} van ${title}`,

      originalScan: 'Originele scan',
      originalScanHint: 'De pagina zoals ze is gefotografeerd',
      transcriptionOf: () => 'Nederlandse tekst',
      transcriptionHint: 'De gedrukte tekst, door een machine gelezen',
      englishTranslation: 'Engelse vertaling',
      englishTranslationHint: 'Vertaald met hulp van AI',
      romanisedTranscription: 'Transcriptie in Latijns schrift',
      romanisedTranscriptionHint: 'Dezelfde woorden in Latijnse letters',

      zoomOut: 'Uitzoomen',
      zoomIn: 'Inzoomen',
      resetZoom: 'Zoom herstellen',
      readingLens: 'Leesloep: vergroot de plek onder de aanwijzer',
      readingLensOff: 'Leesloep uitzetten',
      readingLensUnavailable: 'Leesloep (beschikbaar op 100%)',

      notes: 'Noten',
      showNotes: 'Noten en verklaringen in de tekst tonen',
      hideNotes: 'Noten en verklaringen in de tekst verbergen',
      trace: 'Traceren',
      turnTracingOff: 'Traceren uitzetten',
      traceFallbackLanguage: 'origineel',
      traceHint: () => 'Traceren: klik op een zinsdeel om het in de Nederlandse tekst te zien',
      traceAligning: 'Deze pagina wordt naast de vertaling gelegd…',
      traceUnavailable: 'Traceren is voor deze pagina niet beschikbaar.',
      traceEnglishOnly: 'Traceren vergelijkt het origineel met de Engelse vertaling. Schakel terug naar Engels om het te gebruiken.',
      descriptionHidden: (pageTypeLabel: string) => `Pagina: ${pageTypeLabel}. Zet Noten aan om de beschrijving te lezen.`,
      ungroundedLabel: 'Weinig of geen tekst getranscribeerd op deze pagina · geschreven door het model',
      ungroundedHidden: 'Weinig of geen tekst getranscribeerd op deze pagina. Zet Noten aan om te lezen wat het model schreef.',
      traceRateLimited: 'Je hebt de limiet voor traceren bereikt. Log in (gratis) om verder te gaan.',
      traceClickHint: 'Klik op een zinsdeel om het in het andere paneel te zien.',

      romanising: 'Deze pagina wordt in Latijns schrift omgezet…',
      romanisingLonger: 'langer dan gewoonlijk voor een pagina van deze omvang',
      romanisingEstimate: (seconds) => `meestal ongeveer ${seconds}s voor zoveel tekst`,
      translitFailed: 'De transliteratie van deze pagina kon niet worden gemaakt.',
      translitNone: 'Nog geen transliteratie voor deze pagina.',

      copyTranscription: 'Transcriptie kopiëren',
      copyTranslation: 'Vertaling kopiëren',
      copyTransliteration: 'Transliteratie kopiëren',
      copied: 'Gekopieerd',

      marksMeaning: 'Wat de tekens in de tekst betekenen',
      marksMeaningShort: 'Wat de tekens betekenen',
      marksInText: 'Tekens in de tekst',
      markGlossOrTerm: 'Verklaring of term',
      markGlossOrTermDesc: 'Een uitgelegd woord, of een herkende vakterm.',
      markOnThePage: 'Op de pagina',
      markOnThePageDesc: 'Een kanttekening of een latere hand, aanwezig in het origineel.',
      markOurNote: 'Onze noot',
      markOurNoteDesc: 'Hier toegevoegd door een redacteur, niet in het origineel.',
      marksHiddenByNotes: 'Met Noten uit zijn ze allemaal verborgen.',
    },
    contents: {
      noContentsTranscribed: 'De inhoudsopgave van deze editie is nog niet getranscribeerd. Gebruik de leeswijzer of de paginastrook om door het boek te gaan.',
      noContentsAtAll: 'Dit boek heeft geen inhoudsopgave.',
    },
    guide: {
      noGuideYet: 'Dit boek heeft nog geen leeswijzer.',
      requestGuide: 'Vraag een leeswijzer aan',
      requestGuideThanks: 'Bedankt. Dit boek staat in de wachtrij voor een leeswijzer, die hier verschijnt zodra hij klaar is.',
      requestFailed: 'Dat verzoek is niet aangekomen. Probeer het zo nog eens.',
      showLess: 'Minder tonen',
      readFullOverview: (more) => `Lees het volledige overzicht (nog ${more})`,
      sections: 'Onderdelen',
      readThisSection: 'Dit onderdeel lezen →',
    },
    search: {
      placeholder: 'Zoeken…',
      inputAria: 'Zoeken in dit boek',
      noMatches: 'Niets gevonden in dit boek',
      failed: 'Zoeken is nu niet beschikbaar. Probeer het zo nog eens.',
      pagesMatch: (total) => `${total} ${total === 1 ? 'pagina gevonden' : 'pagina’s gevonden'}`,
      pageLabel: (n) => `Pagina ${n}`,
    },
    librarian: {
      suggestions: [
        'Waar gaat deze pagina over?',
        'Wie was de auteur?',
        'Leg de belangrijkste begrippen hier uit',
      ],
      orStartHere: 'Of begin hier',
      askAboutPage: (pageNumber) => `Stel een vraag over p. ${pageNumber}…`,
      inputAria: 'Vraag het de bibliothecaris',
      ask: 'Vraag',
      consulting: 'De tekst wordt geraadpleegd…',
      askErrorInline: 'De bibliothecaris kon nu geen antwoord geven. Probeer het opnieuw.',
    },
    info: {
      thisPage: 'Deze pagina',
      thisEdition: 'Deze editie',
      howPageWasMade: 'Hoe deze pagina is gemaakt',
      fieldTitle: 'Titel',
      fieldEnglish: 'Engels',
      fieldAuthor: 'Auteur',
      fieldLanguage: 'Taal',
      fieldPlace: 'Plaats',
      fieldPublisher: 'Uitgever',
      fieldPublished: 'Uitgegeven',
      fieldFormat: 'Formaat',
      fieldPages: 'Pagina’s',
      fieldScan: 'Scan',
      fieldTranscript: 'Transcriptie',
      scannedFrom: (pageNumber) => `Gefotografeerd uit de gedrukte editie${pageNumber != null ? `, p. ${pageNumber}` : ''}`,
      transcribedBy: (model) => `Van de scan gelezen door ${model}`,
      translatedBy: (model) => `Uit de transcriptie vertaald door ${model}`,
      machineNotice: 'Machinale transcriptie en vertaling bevatten fouten. De scan is de bron: lees die naast de tekst waar het op een lezing aankomt.',
      corpusNoScan: (witnessCount) => witnessCount > 0
        ? `Geen. Dit is een digitale tekstuitgave. De tekst is bewaard gebleven op ${witnessCount} ${witnessCount === 1 ? 'kleitablet' : 'kleitabletten'}, gecatalogiseerd bij CDLI.`
        : 'Geen. Dit is een digitale tekstuitgave; er bestaan geen pagina-afbeeldingen.',
      corpusTranscript: (name, org) => `Samengestelde transliteratie uit het ${name}${org ? ` (${org})` : ''}`,
      krakenTranscript: (route) => route === 'print'
        ? 'Van de scan gelezen door omnisyr, een model dat is getraind op gedrukt Syrisch.'
        : 'Van de scan gelezen door Sophro Mhiro (Beth Mardutho), een model dat is getraind op Syrische handschriften.',
      krakenNotice: (route) =>
        'Machinale transcriptie, niet door een mens gecontroleerd. ' +
        (route === 'print'
          ? 'We hebben vijf gedrukte pagina’s naast hun scans gelezen (september 2026): op alle vijf klopten de woorden, en op twee ervan liepen regels uit verschillende kolommen door elkaar.'
          : 'We hebben vijf handgeschreven pagina’s naast hun scans gelezen (september 2026): drie werden correct gelezen, en twee beschadigde pagina’s kwamen er in fragmenten uit.') +
        ' Bekijk de scan waar het op een lezing aankomt.',
      krakenEvidenceLink: 'Hoe we het hebben gecontroleerd',
      iaTranscript: (engine, year, agreement) =>
        `Van de scan gelezen door de OCR van het Internet Archive${engine ? ` (${engine}${year ? `, ${year}` : ''})` : year ? ` (${year})` : ''}` +
        (agreement != null ? `, overgenomen omdat die overeenkomt met onze eigen lezing van de proefpagina’s van dit boek (${Math.round(agreement * 100)}% van de woorden)` : ''),
      manualTranscript: (model) => model ? `Van de scan gelezen door ${model}, met de hand gecorrigeerd` : 'Met de hand getranscribeerd',
      transcriptChipIa: (engine) => `OCR van het Internet Archive${engine ? ` · ${engine}` : ''}`,
      transcriptChipIaTitle: (agreement) =>
        'OCR van het Internet Archive: getallen kunnen verkeerd gelezen zijn (zie #5186)' +
        (agreement != null ? ` · komt voor ${Math.round(agreement * 100)}% van de woorden overeen met onze proeflezing` : ''),
      transcriptChipManual: 'Handmatig',
      transcriptChipCorpus: (shortName) => `Corpus: ${shortName}`,
      transcriptChipTextSource: (shortName, license) => `Tekst: ${shortName}, ${license}`,
      textSourceTranscript: (name, license, version) => `Tekst: ${name}${version ? ` (${version})` : ''}, ${license}`,
      machineDraftNotice: 'AI-vertaling, nog niet door een wetenschapper nagekeken.',
      // Each kind is a subordinate clause (verb last): it follows "vond dat".
      qualityKinds: {
        wrong_page: 'de scan en de tekst van verschillende pagina’s zijn',
        english_other_page: 'het Engels bij een andere pagina hoort',
        invented_transcription: 'de transcriptie tekst bevat die niet op de pagina staat',
        model_notes: 'de eigen aantekeningen van het model staan waar de tekst hoort te staan',
        garble_translated: 'het Engels een onleesbare transcriptie vertaalt alsof die in orde is',
        meaning_reversed: 'het Engels een bewering omdraait of een voorbehoud weglaat',
        misread_meaning: 'een verkeerd gelezen woord de betekenis verandert',
        unsupported_notes: 'de noten dingen beweren die niet op de pagina staan',
        missing_transcription: 'een deel van de pagina in de transcriptie ontbreekt',
        missing_english: 'een deel van de pagina in het Engels ontbreekt',
        number_misread: 'een getal, datum of hoeveelheid verkeerd is gelezen',
        repeated_text: 'een passage herhaald wordt die maar één keer op de pagina staat',
        serious_transcription: 'de transcriptie een ernstige fout bevat',
        serious_english: 'het Engels een ernstige fout bevat',
        serious_other: 'de pagina een ernstige fout bevat',
      },
      qualityFindings: (clauses, more) => clauses.join(', en dat ') + (more ? ', naast andere ernstige fouten' : ''),
      qualityPageReview: ({ ai, image, findings, date }) =>
        `${ai ? 'Een AI-beoordelaar' : 'Een beoordelaar'} die deze pagina ${image ? 'naast de scan' : 'als tekst, zonder de scan,'} las, vond dat ${findings} (${date}).`,
      qualityPageDetector: (date) => `Gemarkeerd door een automatische controle, nog niet door een mens gelezen (${date}).`,
      qualityBook: ({ ai, image, read, serious, date }) => {
        const start = `Bij een controle op ${date} las ${ai ? 'een AI-beoordelaar' : 'een beoordelaar'} ${read} ${read === 1 ? 'pagina' : 'pagina’s'} van dit boek${image ? (read === 1 ? ' naast de scan' : ' naast de scans') : ''}`;
        if (serious === null) return `${start} en vond ernstige fouten.`;
        return `${start} en vond ernstige fouten ${read === 1 ? 'op die pagina' : `op ${serious} daarvan`}.`;
      },
      qualitySeeReview: 'Bekijk de beoordeling',
      qualityDetectorLink: 'Waar de controle op let',
      licenceLink: 'licentie',
      sourceLink: 'bron',
      corpusTranslation: (name) => `Wetenschappelijke vertaling uit het ${name}, niet door een machine gemaakt`,
      corpusNotice: 'Deze pagina geeft een wetenschappelijke corpuseditie weer: de transliteratie en vertaling zijn het werk van de redacteuren ervan, niet van AI. De indeling in pagina’s is van ons; het corpus deelt de tekst in regels in, niet in pagina’s.',
      corpusAiNotice: (name) => `De transliteratie volgt het ${name}; het Engels is daar een machinevertaling van en kan fouten bevatten.`,
    },
    cite: {
      copyCitation: 'Bronvermelding kopiëren',
      copied: 'Gekopieerd',
    },
    share: {
      copyLink: 'Link naar deze pagina kopiëren',
      copyLinkWithReference: 'Link met bronvermelding kopiëren',
      postTo: 'Delen op',
      email: 'E-mail',
    },
    paneEmpty: {
      notTranscribed: 'Nog niet getranscribeerd',
      notTranscribedBody: 'De scan staat hier en is vrij te lezen, maar deze pagina heeft nog geen transcriptie, dus er is nog niets om uit te vertalen.',
      notReliablyLegible: 'Niet betrouwbaar leesbaar',
      notReliablyLegibleBody: 'We hebben geprobeerd deze pagina te transcriberen, maar kwamen niet tot een lezing die we vertrouwen, dus we tonen er geen. De scan hiernaast is de gezaghebbende bron.',
      translationWithheld: 'Vertaling ingetrokken',
      translationWithheldBody: 'Deze pagina is net opnieuw getranscribeerd, en het Engels dat we hadden was gemaakt op basis van de oudere, minder nauwkeurige lezing. We hebben het weggehaald in plaats van een vertaling te laten staan van tekst die er niet meer is. Er komt een nieuwe.',
      blankPage: 'Lege pagina.',
      noTextPage: (pageTypeLabel: string) => `Pagina: ${pageTypeLabel}. Geen tekst om te vertalen.`,
      readyToTranslate: 'Klaar om te vertalen',
      readyToTranslateBody: 'De OCR van deze pagina is klaar. Ze is nog niet in het Engels vertaald.',
      englishReadingText: 'Engelse editie',
      englishReadingTextBody: 'Dit boek is in het Engels: de transcriptie is de leestekst. Er is niets te vertalen.',
      notModernized: 'Nog niet gemoderniseerd',
      notModernizedBody: 'Dit boek is in vroegmodern Engels. Er is nog geen gemoderniseerde versie; de transcriptie is de leestekst.',
      signInToRequest: 'Log in om een vertaling aan te vragen',
      requestTranslation: 'Vertaling aanvragen',
      requestFailed: 'Dat verzoek is niet aangekomen. Probeer het zo nog eens.',
      sending: 'Bezig met versturen…',
      requested: 'Aangevraagd',
      thanksWillEmail: 'Bedankt. We mailen je zodra deze pagina is vertaald.',
      thanksWillPrioritise: 'Bedankt. We geven dit boek voorrang.',
    },
    paneGated: {
      label: 'Log in om verder te lezen',
      body: (freePages) => `Door de scan kun je vrij bladeren. Om de transcriptie en vertaling na de eerste ${freePages} pagina’s te lezen, heb je een gratis account nodig.`,
      signIn: 'Inloggen (gratis)',
    },
    save: {
      anonymousNotice: 'Bewaren werkt zonder account, maar alleen op dit apparaat.',
      signInToKeep: 'Log in om ze overal te bewaren',
      savedPage: 'Bewaard in je bibliotheek',
      savePage: 'Deze pagina bewaren',
      savedBook: (title) => `“${title}” bewaard`,
      saveBook: 'Het hele boek bewaren',
      saveFailed: 'Bewaren mislukt. Probeer het opnieuw.',
      yourLibrary: 'Je bibliotheek',
      everythingSaved: 'Alles wat je hebt bewaard',
    },
    downloads: {
      thisPage: 'Deze pagina',
      scanOfPage: (pageNumber) => `De scan van p. ${pageNumber ?? ''}`.trim(),
      scanFormatNote: 'JPEG, in de resolutie waarin hij is gearchiveerd',
      noScanArchived: 'Van deze pagina is geen scan gearchiveerd.',
      thisPageComplete: 'Deze pagina, compleet',
      thisPageCompleteNote: 'Scan, transcriptie, vertaling en bronvermelding, als zip',
      dailyLimitReached: 'Je hebt de downloadlimiet voor vandaag bereikt.',
      signInToDownload: 'Log in om deze pagina te downloaden.',
      downloadFailed: 'Die download is mislukt. Probeer het opnieuw.',
      wholeBook: 'Het hele boek',
    },
    feedback: {
      blurb: 'Alles wat er mis is, ontbreekt of het weten waard is over deze pagina of de lezer zelf.',
      placeholder: 'Wat viel je op?',
      emailLabel: 'E-mail',
      emailPlaceholder: 'jij@voorbeeld.nl',
      emailNote: 'Alleen als je een antwoord wilt. We gebruiken het nergens anders voor.',
      send: 'Versturen',
      sending: 'Bezig met versturen…',
      thanks: 'Bedankt. Je bericht is bij ons aangekomen, samen met de pagina waarop je was.',
      failed: 'Dat is niet verstuurd. Probeer het zo nog eens.',
      tooShort: 'Vertel ons eerst iets meer.',
      aboutPage: (pageNumber) => `In je bericht staat dat je op p. ${pageNumber} was.`,
      attach: 'Schermafbeelding toevoegen',
      attachHint: 'of plak / sleep een afbeelding',
      attachLimit: 'Maximaal vier afbeeldingen',
      attachFailed: 'Die afbeelding kon niet worden geüpload. Probeer een kleinere.',
      removeImage: 'Afbeelding verwijderen',
    },
    readCaution: {
      unclear: (share) => `Deze pagina was moeilijk te lezen: ongeveer ${Math.round(share * 100)}% van de transcriptie is als onzeker gemarkeerd, en het Engels is daar een beste gok.`,
      damage: 'Deze pagina is hier en daar beschadigd of vervaagd, en delen van het Engels kunnen op onzekere lezingen berusten.',
    },
    pageReport: {
      open: 'Een probleem met deze pagina melden',
      prompt: 'Wat is er mis? Kies er een als die past.',
      kinds: {
        garbled_source: 'Transcriptie is onleesbaar',
        missing_text: 'Er ontbreekt tekst',
        invented_text: 'Vertaling voegt dingen toe',
        wrong_image: 'Verkeerde pagina-afbeelding',
        wrong_language: 'Verkeerde taal',
        translation_error: 'Het Engels klopt hier niet',
      },
      commentPlaceholder: 'Nog iets? (optioneel)',
      passageLabel: 'Het Engels zoals het er nu staat',
      correctionLabel: 'Wat er zou moeten staan',
      sourceLabel: 'De oorspronkelijke woorden (optioneel)',
      send: 'Melding versturen',
      sending: 'Bezig met versturen…',
      cancel: 'Annuleren',
      thanks: 'Bedankt. We gaan naar deze pagina kijken.',
      failed: 'Dat is niet verstuurd. Probeer het zo nog eens.',
    },
    // Unreachable on /nl (Dutch-language books only); English kept so the type stays total.
    tengyurNote: TENGYUR_NOTE_EN,
    history: {
      title: 'Wijzigingsgeschiedenis',
      loading: 'Wijzigingsgeschiedenis laden…',
      loadFailed: 'De wijzigingsgeschiedenis van deze pagina kon niet worden geladen. Probeer het zo nog eens.',
      noRevisions: 'Geen vastgelegde wijzigingen voor deze pagina.',
      onlyMaintenance: 'Alleen bulkonderhoud, hieronder.',
      chars: 'tekens',
      showMaintenance: (n) => `${n} ${n === 1 ? 'wijziging' : 'wijzigingen'} door bulkonderhoud tonen`,
      hideMaintenance: (n) => `${n} ${n === 1 ? 'wijziging' : 'wijzigingen'} door bulkonderhoud verbergen`,
      maintenanceNote: 'Reparaties aan het corpus en bibliotheekbrede rondes die toevallig deze pagina raakten, geen nieuwe lezingen van de scan.',
      restoreForbidden: 'Je bent niet meer als redacteur ingelogd. Log opnieuw in om deze versie terug te zetten.',
      restoreFailed: 'Die versie kon niet worden teruggezet. Probeer het zo nog eens.',
      today: (time) => `Vandaag ${time}`,
      yesterday: 'Gisteren',
      daysAgo: (n) => `${n} d geleden`,
      sourceAi: 'AI',
      sourceBatch: 'Batch',
      sourceManual: 'Handmatig',
      sourceContributor: 'Bijdrager',
      sourceMaintenance: 'Onderhoud',
      fieldTranscript: 'Transcriptie',
      fieldTranslation: 'Vertaling',
    },
    settings: {
      theme: 'Thema',
      themeLight: 'Licht',
      themeSepia: 'Sepia',
      themeDark: 'Donker',
      textSize: 'Tekstgrootte',
      smallerText: 'Kleinere tekst',
      largerText: 'Grotere tekst',
      lineWidth: 'Regelbreedte',
      lineWidthNarrow: 'Smal',
      lineWidthNormal: 'Normaal',
      lineWidthWide: 'Breed',
      typeface: 'Lettertype',
      typefaceSerif: 'Schreef',
      typefaceSans: 'Schreefloos',
      lineHeight: 'Regelafstand',
    },
    accountMenu: {
      library: 'Bibliotheek',
      collections: 'Collecties',
      gallery: 'Galerij',
      browse: 'Bladeren',
      catalogue: 'Catalogus',
      works: 'Werken',
      explore: 'Verkennen',
      librarian: 'Bibliothecaris',
      you: 'Jij',
      yourAccount: 'Je account',
      savedPages: 'Bewaarde pagina’s',
      readingHistory: 'Leesgeschiedenis',
      signIn: 'Inloggen',
      supportSourceLibrary: 'Steun Source Library',
      sendFeedback: 'Feedback sturen',
      siteLanguage: 'Taal van de site',
      signOut: 'Uitloggen',
    },
    pinnedEdition: {
      citedVersion: 'Geciteerde versie',
      resolving: 'De geciteerde editie wordt opgezocht…',
      unresolvable: (v) => `Deze link citeert editie v${v}, maar die kon niet worden gevonden. De huidige tekst wordt getoond.`,
      continueReadingLink: 'Verder lezen →',
      pageNotInEdition: (label, date) => `Deze pagina hoorde niet bij editie ${label}, verschenen op ${date}. De huidige tekst wordt getoond.`,
      readingEdition: (label, date) => `Je leest editie ${label}, verschenen op ${date}.`,
      readingEditionRevised: (label, date) => `Je leest editie ${label}, verschenen op ${date}. De vertaling is sindsdien herzien.`,
      viewCurrentEdition: 'Huidige editie bekijken →',
    },
  },
  // Chinese (#6382). Draft copy, to be read by a native editor before launch.
  //
  // Same two departures from the Spanish block as the Latin one. A `/zh` reader
  // page exists only for a book WRITTEN in Chinese, so the strings that take the
  // book's language name it as Chinese outright rather than interpolating the
  // stored English word "Chinese". And "译文/翻译" always means the ENGLISH
  // translation: nothing is translated into Chinese, and here the transcription
  // is the reading text. Labels interpolated into a sentence (`showPane`,
  // `closeAria`) join with no space, as Chinese does.
  zh: {
    toolbar: {
      contents: '目录',
      guide: '导读',
      search: '搜索',
      librarian: '图书馆员',
      save: '保存',
      share: '分享',
      cite: '引用',
      download: '下载',
      info: '信息',
      views: '视图',
      pages: '页面',
      settings: '设置',
      feedback: '反馈',
      more: '更多',
      menu: '菜单',
      readerToolsAria: '阅读工具',
      previousPage: '上一页',
      nextPage: '下一页',
      previous: '上一个',
      next: '下一个',
      close: '关闭',
      jumpToPage: '跳转到页',
      backToTheBook: '返回本书',
      backToTheBookPage: '返回本书页面',
      backToTheReader: '返回阅读器',
      scanFullScreen: '扫描图（全屏）',
      viewScanFullScreen: '全屏查看扫描图',
    },
    panels: {
      titles: {
        save: '保存',
        menu: '菜单',
        contents: '目录',
        search: '在本书中搜索',
        guide: '阅读指南',
        librarian: '询问图书馆员',
        info: '版本与页面信息',
        cite: '引用本页',
        share: '分享',
        settings: '阅读设置',
        views: '扫描图、原文与译文',
        downloads: '下载',
        history: '修订历史',
        feedback: '发送反馈',
        more: '更多',
      },
      blurbs: {
        contents: '本书自身的目录，据原书。',
        search: '搜索转录文本和插图说明。',
        guide: '我们为本书写的概要，由 AI 根据转录文本生成。',
        librarian: '由 AI 回答，依据本页及本书上下文。',
        info: '本页是什么，以及它扫描自哪个版本。',
        cite: '指向这一页的引用格式。',
        share: '复制本页链接，或分享出去。',
        settings: '文本的排版方式。您的选择会保存在本设备上。',
        views: '同时显示多个视图。',
        downloads: '将本页或整本书下载带走。',
        history: '本页转录与译文的每一次有记录的改动。',
      },
      closeAria: (title) => `关闭${title}`,
      backToMore: '返回“更多”',
    },
    moreMenu: {
      contents: '目录',
      contentsBlurb: '本书自身的目录，据原书',
      guide: '阅读指南',
      guideBlurb: '概述、主题、章节',
      search: '在本书中搜索',
      searchBlurb: '在转录文本中查找字词',
      librarian: '询问图书馆员',
      librarianBlurb: '关于本页或本书的问题',
      cite: '引用本页',
      citeBlurb: '指向这一页的引用格式',
      downloads: '下载',
      downloadsBlurb: '本页或整本书，多种格式',
      info: '版本与页面信息',
      infoBlurb: '本页，以及它所出自的版本',
      history: '修订历史',
      historyBlurb: '本页每一次有记录的改动',
      settings: '阅读设置',
      settingsBlurb: '主题、字号、字体、注释',
      views: '扫描图、原文与译文',
      viewsBlurb: '同时显示多个视图',
      feedback: '发送反馈',
      feedbackBlurb: '告诉我们关于本页或阅读器的问题',
      menu: '菜单',
      menuBlurb: '图书馆的其他部分，以及您的账户',
      groupRead: '阅读',
      groupPage: '本页',
      groupReader: '阅读器',
    },
    panes: {
      viewScan: '扫描图',
      // The transcription IS the reading text on `/zh`, so the pane is named for
      // what it holds rather than for how it was made.
      viewOcr: '中文',
      ocrPaneHeader: () => '中文原文',
      viewRoman: '罗马字',
      viewEnglish: '英文',
      visiblePanesAria: '当前显示的窗格',
      showPane: (label) => `显示${label}`,
      lastPaneShowing: '这是最后一个显示的窗格',
      pickPaneAria: '扫描图、原文或译文',
      translatedFrom: () => '译自中文',
      viewTheScan: '查看扫描图',
      viewTheText: () => '查看中文原文',

      originalFallback: '原文',
      romanisedHeader: '罗马字转写',
      aiTranslated: 'AI 翻译',
      aiShort: 'AI',
      aiTitle: '借助 AI 生成',
      corpusChip: (shortName) => `${shortName} 译本`,
      corpusChipTitle: (name) => `英文依据 ${name} 的学术译本，并非机器生成`,
      tabletWitness: '泥板见证本',
      witnessCount: (index, total) => `第 ${index} 块泥板，共 ${total} 块`,
      witnessNotSource: (shortName) => `文本依据 ${shortName} 版本，并非从这张照片识读`,
      witnessAlt: (designation) => `泥板 ${designation} 的照片`,
      prevWitness: '上一块泥板',
      nextWitness: '下一块泥板',
      viewOnCdli: '在 CDLI 查看',
      noFacsimile: '无影印图像：这是文本版',
      scanAlt: (pageNumber, title) => `《${title}》第 ${pageNumber} 页的扫描图`,

      originalScan: '原书扫描图',
      originalScanHint: '页面拍摄时的原貌',
      transcriptionOf: () => '中文原文',
      transcriptionHint: '印刷文字，由机器识读',
      englishTranslation: '英文译文',
      englishTranslationHint: '借助 AI 翻译',
      romanisedTranscription: '罗马字转写',
      romanisedTranscriptionHint: '同样的文字，以拉丁字母拼写',

      zoomOut: '缩小',
      zoomIn: '放大',
      resetZoom: '重置缩放',
      readingLens: '阅读放大镜：放大指针下的位置',
      readingLensOff: '关闭阅读放大镜',
      readingLensUnavailable: '阅读放大镜（在 100% 时可用）',

      notes: '注释',
      showNotes: '显示行内注释和释义',
      hideNotes: '隐藏行内注释和释义',
      trace: '对照',
      turnTracingOff: '关闭对照',
      traceFallbackLanguage: '原文',
      traceHint: () => '对照：点击任意短语，查看它在中文原文中的位置',
      traceAligning: '正在将本页与译文对齐…',
      traceUnavailable: '本页无法使用对照功能。',
      traceEnglishOnly: '对照功能比较原文与英文译文。请切换回英文后使用。',
      descriptionHidden: (pageTypeLabel: string) => `本页类型：${pageTypeLabel}。打开“注释”即可阅读说明。`,
      ungroundedLabel: '本页几乎未转录出文字 · 由模型撰写',
      ungroundedHidden: '本页几乎未转录出文字。打开“注释”即可阅读模型撰写的内容。',
      traceRateLimited: '已达到对照次数上限。登录（免费）后可继续使用。',
      traceClickHint: '点击任意短语，查看它在另一窗格中的对应内容。',

      romanising: '正在将本页转写为罗马字…',
      romanisingLonger: '比同样篇幅的页面通常所需的时间更长',
      romanisingEstimate: (seconds) => `这么多文本通常需要约 ${seconds} 秒`,
      translitFailed: '无法为本页生成罗马字转写。',
      translitNone: '本页尚无罗马字转写。',

      copyTranscription: '复制转录文本',
      copyTranslation: '复制译文',
      copyTransliteration: '复制罗马字转写',
      copied: '已复制',

      marksMeaning: '文中标记的含义',
      marksMeaningShort: '标记的含义',
      marksInText: '文中标记',
      markGlossOrTerm: '释义或术语',
      markGlossOrTermDesc: '对某个词的解释，或标出的专门术语。',
      markOnThePage: '原页所有',
      markOnThePageDesc: '页边批注或后人笔迹，原书上就有。',
      markOurNote: '我们的注释',
      markOurNoteDesc: '由编者在此添加，原书上没有。',
      marksHiddenByNotes: '关闭“注释”会隐藏全部标记。',
    },
    contents: {
      noContentsTranscribed: '本版本的目录尚未转录。可以通过阅读指南或页面缩略条在书中跳转。',
      noContentsAtAll: '本书没有目录。',
    },
    guide: {
      noGuideYet: '本书还没有阅读指南。',
      requestGuide: '申请阅读指南',
      requestGuideThanks: '谢谢。本书已排入生成队列，生成后会显示在这里。',
      requestFailed: '申请未能提交，请稍后再试。',
      showLess: '收起',
      readFullOverview: (more) => `阅读完整概述（还有 ${more}）`,
      sections: '章节',
      readThisSection: '阅读本节 →',
    },
    search: {
      placeholder: '搜索…',
      inputAria: '在本书中搜索',
      noMatches: '本书中没有匹配结果',
      failed: '搜索暂时不可用，请稍后再试。',
      pagesMatch: (total) => `${total} 页匹配`,
      pageLabel: (n) => `第 ${n} 页`,
    },
    librarian: {
      suggestions: [
        '这一页讲的是什么？',
        '作者是谁？',
        '解释一下这里的关键概念',
      ],
      orStartHere: '或者从这里开始',
      askAboutPage: (pageNumber) => `就第 ${pageNumber} 页提问…`,
      inputAria: '询问图书馆员',
      ask: '提问',
      consulting: '正在查阅文本…',
      askErrorInline: '图书馆员暂时无法回答，请重试。',
    },
    info: {
      thisPage: '本页',
      thisEdition: '本版本',
      howPageWasMade: '本页是如何制作的',
      fieldTitle: '书名',
      fieldEnglish: '英文',
      fieldAuthor: '作者',
      fieldLanguage: '语言',
      fieldPlace: '出版地',
      fieldPublisher: '出版者',
      fieldPublished: '出版时间',
      fieldFormat: '开本',
      fieldPages: '页数',
      fieldScan: '扫描图',
      fieldTranscript: '转录',
      scannedFrom: (pageNumber) => `拍摄自印本${pageNumber != null ? `，第 ${pageNumber} 页` : ''}`,
      transcribedBy: (model) => `由 ${model} 从扫描图识读`,
      translatedBy: (model) => `由 ${model} 根据转录文本翻译`,
      machineNotice: '机器转录和翻译都会有错误。扫描图才是依据，凡是关键的读法，请对照扫描图阅读。',
      corpusNoScan: (witnessCount) => witnessCount > 0
        ? `无。这是数字文本版。该作品保存在 CDLI 著录的 ${witnessCount} 块泥板上。`
        : '无。这是数字文本版，没有页面图像。',
      corpusTranscript: (name, org) => `综合转写，出自 ${name}${org ? `（${org}）` : ''}`,
      krakenTranscript: (route) => route === 'print'
        ? '由 omnisyr 从扫描图识读，这是一个用印刷体叙利亚文训练的模型。'
        : '由 Sophro Mhiro（Beth Mardutho）从扫描图识读，这是一个用叙利亚文手稿训练的模型。',
      krakenNotice: (route) =>
        '机器转录，未经人工核对。' +
        (route === 'print'
          ? '我们对照扫描图审读了五页印本（2026 年 9 月）：五页的字词全部正确，其中两页把不同栏的行混在了一起。'
          : '我们对照扫描图审读了五页手稿（2026 年 9 月）：三页识读正确，两页受损的页面只得到了片段。') +
        '凡是关键的读法，请核对扫描图。',
      krakenEvidenceLink: '我们如何核对',
      iaTranscript: (engine, year, agreement) =>
        `由 Internet Archive 的 OCR 从扫描图识读${engine ? `（${engine}${year ? `，${year}` : ''}）` : year ? `（${year}）` : ''}` +
        (agreement != null ? `；之所以采用，是因为它与我们对本书样本页的识读一致（${Math.round(agreement * 100)}% 的字词）` : ''),
      manualTranscript: (model) => model ? `由 ${model} 从扫描图识读，经人工校正` : '人工转录',
      transcriptChipIa: (engine) => `Internet Archive OCR${engine ? ` · ${engine}` : ''}`,
      transcriptChipIaTitle: (agreement) =>
        'Archive OCR：数字可能识读有误（见 #5186）' +
        (agreement != null ? ` · 与我们的样本识读在 ${Math.round(agreement * 100)}% 的字词上一致` : ''),
      transcriptChipManual: '人工',
      transcriptChipCorpus: (shortName) => `语料库：${shortName}`,
      transcriptChipTextSource: (shortName, license) => `文本：${shortName}，${license}`,
      textSourceTranscript: (name, license, version) => `文本：${name}${version ? `（${version}）` : ''}，${license}`,
      machineDraftNotice: 'AI 译文，尚未经学者审校。',
      qualityKinds: {
        wrong_page: '扫描图和文本来自不同的页面',
        english_other_page: '英文属于另一页',
        invented_transcription: '转录中有页面上没有的文字',
        model_notes: '本该是正文的位置放的是模型自己的说明',
        garble_translated: '英文把一段错乱的转录当作正常文本译了出来',
        meaning_reversed: '英文把一句话的意思弄反了，或漏掉了限定语',
        misread_meaning: '一个字词识读错误，改变了意思',
        unsupported_notes: '注释里写了页面上没有说的内容',
        missing_transcription: '转录中缺了页面的一部分',
        missing_english: '英文中缺了页面的一部分',
        number_misread: '数字、日期或数量识读有误',
        repeated_text: '页面上只出现一次的段落被重复了',
        serious_transcription: '转录有严重错误',
        serious_english: '英文有严重错误',
        serious_other: '本页有严重错误',
      },
      qualityFindings: (clauses, more) => clauses.join('；') + (more ? '；此外还有其他严重错误' : ''),
      qualityPageReview: ({ ai, image, findings, date }) =>
        `${ai ? 'AI 审校员' : '审校员'}${image ? '对照扫描图' : '仅阅读文本（未对照扫描图）'}审读本页，发现：${findings}（${date}）。`,
      qualityPageDetector: (date) => `由自动检查标出，尚未经人工审读（${date}）。`,
      qualityBook: ({ ai, image, read, serious, date }) => {
        const start = `${ai ? 'AI 审校员' : '审校员'}于 ${date} ${image ? '对照扫描图' : ''}审读了本书 ${read} 页`;
        if (serious === null) return `${start}，发现了严重错误。`;
        return `${start}，发现${read === 1 ? '该页' : `其中 ${serious} 页`}有严重错误。`;
      },
      qualitySeeReview: '查看审校记录',
      qualityDetectorLink: '这项检查查什么',
      licenceLink: '许可',
      sourceLink: '来源',
      corpusTranslation: (name) => `学术译本，出自 ${name}，并非机器生成`,
      corpusNotice: '本页转载一部学术语料库版本：转写和翻译出自其编者之手，而非 AI。分页是我们做的；语料库按行而不是按页划分文本。',
      corpusAiNotice: (name) => `转写依据 ${name}；英文是据此生成的机器翻译，可能有错误。`,
    },
    cite: {
      copyCitation: '复制引用',
      copied: '已复制',
    },
    share: {
      copyLink: '复制本页链接',
      copyLinkWithReference: '复制带引用信息的链接',
      postTo: '分享到',
      email: '电子邮件',
    },
    paneEmpty: {
      notTranscribed: '尚未转录',
      notTranscribedBody: '扫描图在这里，可以免费阅读，但本页还没有转录，因此也就无从翻译。',
      notReliablyLegible: '无法可靠识读',
      notReliablyLegibleBody: '我们尝试转录本页，但未能得到可信的读法，所以不予显示。旁边的扫描图是可靠的依据。',
      translationWithheld: '译文已撤下',
      translationWithheldBody: '本页刚刚重新转录，而原有的英文是根据较早、较不准确的读法译出的。我们把它撤了下来，以免留下一份所译文字已不存在的译文。新的译文随后会补上。',
      blankPage: '空白页。',
      noTextPage: (pageTypeLabel: string) => `本页类型：${pageTypeLabel}。无可翻译的文字。`,
      readyToTranslate: '可以翻译',
      readyToTranslateBody: '本页已完成 OCR，尚未译成英文。',
      englishReadingText: '英文版',
      englishReadingTextBody: '本书以英文写成，转录文本就是阅读文本，无需翻译。',
      notModernized: '尚未现代化',
      notModernizedBody: '本书以早期现代英语写成，尚未制作现代英语读本；转录文本就是阅读文本。',
      signInToRequest: '登录后申请翻译',
      requestTranslation: '申请翻译',
      requestFailed: '申请未能提交，请稍后再试。',
      sending: '正在发送…',
      requested: '已申请',
      thanksWillEmail: '谢谢。本页译好后我们会发邮件通知您。',
      thanksWillPrioritise: '谢谢。我们会优先处理这本书。',
    },
    paneGated: {
      label: '登录后继续阅读',
      body: (freePages) => `扫描图可免费浏览。阅读前 ${freePages} 页之后的转录和译文，需要一个免费账户。`,
      signIn: '登录（免费）',
    },
    save: {
      anonymousNotice: '无需账户也能保存，但仅限本设备。',
      signInToKeep: '登录后可在所有设备上保留',
      savedPage: '已保存到您的书房',
      savePage: '保存本页',
      savedBook: (title) => `已保存《${title}》`,
      saveBook: '保存整本书',
      saveFailed: '保存失败，请重试。',
      yourLibrary: '我的书房',
      everythingSaved: '您保存的全部内容',
    },
    downloads: {
      thisPage: '本页',
      scanOfPage: (pageNumber) => `${pageNumber != null ? `第 ${pageNumber} 页的` : ''}扫描图`,
      scanFormatNote: 'JPEG，按存档时的分辨率',
      noScanArchived: '本页没有存档的扫描图。',
      thisPageComplete: '本页完整内容',
      thisPageCompleteNote: '扫描图、转录、译文和引用，打包为 zip',
      dailyLimitReached: '已达到每日下载上限。',
      signInToDownload: '登录后可下载本页。',
      downloadFailed: '下载失败，请重试。',
      wholeBook: '整本书',
    },
    feedback: {
      blurb: '关于本页或阅读器本身，任何错误、缺漏或值得我们知道的事。',
      placeholder: '您发现了什么？',
      emailLabel: '邮箱',
      emailPlaceholder: 'you@example.com',
      emailNote: '仅在您希望收到回复时填写。我们不会用于其他用途。',
      send: '发送',
      sending: '正在发送…',
      thanks: '谢谢。我们已收到，连同您当时所在的页面。',
      failed: '发送失败，请稍后再试。',
      tooShort: '请再多写几句。',
      aboutPage: (pageNumber) => `您的留言会注明您当时在第 ${pageNumber} 页。`,
      attach: '添加截图',
      attachHint: '或粘贴 / 拖入图片',
      attachLimit: '最多四张图片',
      attachFailed: '这张图片无法上传，请换一张小一点的。',
      removeImage: '移除图片',
    },
    readCaution: {
      unclear: (share) => `本页较难识读：约 ${Math.round(share * 100)}% 的转录被标为不确定，这些地方的英文是尽力推测的结果。`,
      damage: '本页有些地方受损或褪色，英文的部分内容可能基于不确定的读法。',
    },
    pageReport: {
      open: '报告本页的问题',
      prompt: '哪里有问题？如有合适的选项，请选一个。',
      kinds: {
        garbled_source: '转录错乱',
        missing_text: '文字缺失',
        invented_text: '译文添加了内容',
        wrong_image: '页面图像不对',
        wrong_language: '语言不对',
        translation_error: '这里的英文有误',
      },
      commentPlaceholder: '还有别的吗？（选填）',
      passageLabel: '目前的英文',
      correctionLabel: '应该怎么说',
      sourceLabel: '原文字句（选填）',
      send: '发送报告',
      sending: '正在发送…',
      cancel: '取消',
      thanks: '谢谢。我们会检查这一页。',
      failed: '发送失败，请稍后再试。',
    },
    // Unreachable on /zh (Chinese-language books only); English kept so the type stays total.
    tengyurNote: TENGYUR_NOTE_EN,
    history: {
      title: '修订历史',
      loading: '正在加载修订历史…',
      loadFailed: '无法加载本页的修订历史，请稍后再试。',
      noRevisions: '本页没有修订记录。',
      onlyMaintenance: '只有批量维护记录，见下方。',
      chars: '字符',
      showMaintenance: (n) => `显示 ${n} 条批量维护修订`,
      hideMaintenance: (n) => `隐藏 ${n} 条批量维护修订`,
      maintenanceNote: '语料修复和全馆范围的批量处理恰好涉及本页，并非对扫描图的重新识读。',
      restoreForbidden: '您已不再以编辑身份登录。请重新登录后恢复此版本。',
      restoreFailed: '无法恢复该版本，请稍后再试。',
      today: (time) => `今天 ${time}`,
      yesterday: '昨天',
      daysAgo: (n) => `${n} 天前`,
      sourceAi: 'AI',
      sourceBatch: '批量',
      sourceManual: '人工',
      sourceContributor: '贡献者',
      sourceMaintenance: '维护',
      fieldTranscript: '转录',
      fieldTranslation: '译文',
    },
    settings: {
      theme: '主题',
      themeLight: '浅色',
      themeSepia: '暖黄',
      themeDark: '深色',
      textSize: '字号',
      smallerText: '缩小文字',
      largerText: '放大文字',
      lineWidth: '行宽',
      lineWidthNarrow: '窄',
      lineWidthNormal: '标准',
      lineWidthWide: '宽',
      typeface: '字体',
      typefaceSerif: '衬线',
      typefaceSans: '无衬线',
      lineHeight: '行距',
    },
    accountMenu: {
      library: '图书馆',
      collections: '专题',
      gallery: '图库',
      browse: '浏览',
      catalogue: '目录',
      works: '作品',
      explore: '可视化',
      librarian: '图书馆员',
      you: '我的',
      yourAccount: '我的账户',
      savedPages: '已保存的页面',
      readingHistory: '阅读记录',
      signIn: '登录',
      supportSourceLibrary: '支持 Source Library',
      sendFeedback: '发送反馈',
      siteLanguage: '网站语言',
      signOut: '退出登录',
    },
    pinnedEdition: {
      citedVersion: '所引版本',
      resolving: '正在查找所引版本…',
      unresolvable: (v) => `此链接引用的是 v${v} 版，但无法找到该版本。现显示当前文本。`,
      continueReadingLink: '继续阅读 →',
      pageNotInEdition: (label, date) => `本页不在 ${date} 发布的 ${label} 版中。现显示当前文本。`,
      readingEdition: (label, date) => `您正在阅读 ${date} 发布的 ${label} 版。`,
      readingEditionRevised: (label, date) => `您正在阅读 ${date} 发布的 ${label} 版。此后译文已有修订。`,
      viewCurrentEdition: '查看当前版本 →',
    },
  },
};

/** Reader chrome strings for `lang`. Defaults to English for an unrecognized locale. */
export function getReaderStrings(lang: Locale): ReaderStrings {
  return READER_UI_STRINGS[lang] ?? READER_UI_STRINGS.en;
}
