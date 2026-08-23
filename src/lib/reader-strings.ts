// Pure type import from the server-safe module — see the note in
// `src/lib/i18n.ts` about why server code (this catalogue may be read from
// `layout.tsx`'s generateMetadata) must not import `@/lib/i18n` itself.
import type { Locale } from '@/lib/locale-path';

/**
 * Chrome strings for the redesigned reader (`reader-v2`, currently
 * `Reader2C.tsx` and the small files mounted beside it: `ReaderV2Bits.tsx`,
 * `SavePanel.tsx`, `PaneEmptyState.tsx`, `RevisionHistoryPanel.tsx`,
 * `PinnedVersion.tsx`, `ContinueReading.tsx`, `ReaderSettingsControls.tsx`).
 *
 * This is groundwork only — nothing here is wired up yet. `Reader2C.tsx` is
 * owned by another session on this worktree and is deliberately NOT edited
 * here; see the accompanying report for the exact prop/hook shape it should
 * grow to consume this catalogue.
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
    more: string;
    menu: string;
    readerToolsAria: string;
    previousPage: string;
    nextPage: string;
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
    /** `Trace: click any phrase to see it in the {language}` */
    traceHint: (language: string) => string;
    traceAligning: string;
    traceUnavailable: string;
    traceRateLimited: string;
    traceClickHint: string;

    copyTranscription: string;
    copyTranslation: string;
    copied: string;

    marksMeaning: string;
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
    /** `${total} pages match` / singular */
    pagesMatch: (total: number) => string;
    pageLabel: (n: number) => string;
  };

  /** Ask-the-librarian panel. */
  librarian: {
    suggestions: string[];
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

  /** Revision history panel (public; the Restore action itself stays
   *  editor-only/English — see the file header note). */
  history: {
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

  /** "You left off on page N" banner. */
  continueReading: {
    /** "You left off on page N." */
    leftOff: (pageNumber: number) => string;
    continueLabel: string;
    dismiss: string;
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
    revisedSince: string;
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
      more: 'More',
      menu: 'Menu',
      readerToolsAria: 'Reader tools',
      previousPage: 'Previous page',
      nextPage: 'Next page',
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
      traceHint: (language) => `Trace: click any phrase to see it in the ${language}`,
      traceAligning: 'Aligning this page with the translation…',
      traceUnavailable: 'Tracing is not available for this page.',
      traceRateLimited: 'Tracing limit reached. Sign in (free) to keep going.',
      traceClickHint: 'Click any phrase to see it in the other pane.',

      copyTranscription: 'Copy the transcription',
      copyTranslation: 'Copy the translation',
      copied: 'Copied',

      marksMeaning: 'What the marks in the text mean',
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
      showLess: 'Show less',
      readFullOverview: (more) => `Read the full overview (${more} more)`,
      sections: 'Sections',
      readThisSection: 'Read this section →',
    },
    search: {
      placeholder: 'Search…',
      inputAria: 'Search this book',
      noMatches: 'No matches in this book',
      pagesMatch: (total) => `${total} ${total === 1 ? 'page matches' : 'pages match'}`,
      pageLabel: (n) => `Page ${n}`,
    },
    librarian: {
      suggestions: [
        'What is this page about?',
        'Who was the author?',
        'Explain the key concepts here',
      ],
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
    },
    cite: {
      copyCitation: 'Copy citation',
      copied: 'Copied',
    },
    share: {
      copyLink: 'Copy link to this page',
      copyLinkWithReference: 'Copy link with reference',
      postTo: 'Post to',
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
    continueReading: {
      leftOff: (pageNumber) => `You left off on page ${pageNumber}.`,
      continueLabel: 'Continue',
      dismiss: 'Dismiss',
    },
    pinnedEdition: {
      citedVersion: 'Cited version',
      resolving: 'Resolving the cited edition…',
      unresolvable: (v) => `This link cites edition v${v}, but it could not be resolved. Showing the current text.`,
      continueReadingLink: 'Continue reading →',
      pageNotInEdition: (label, date) => `This page was not part of edition ${label}, published ${date} — showing the current text.`,
      readingEdition: (label, date) => `You are reading edition ${label}, published ${date}`,
      revisedSince: 'the translation has since been revised',
      viewCurrentEdition: 'View current edition →',
    },
  },
  es: {
    toolbar: {
      contents: 'Contenido',
      guide: 'Guía',
      search: 'Buscar',
      librarian: 'Bibliotecario',
      save: 'Guardar',
      share: 'Compartir',
      cite: 'Citar',
      download: 'Descargar',
      info: 'Info',
      views: 'Vistas',
      pages: 'Páginas',
      more: 'Más',
      menu: 'Menú',
      readerToolsAria: 'Herramientas del lector',
      previousPage: 'Página anterior',
      nextPage: 'Página siguiente',
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
      traceHint: (language) => `Cotejar: haz clic en cualquier frase para verla en ${language}`,
      traceAligning: 'Alineando esta página con la traducción…',
      traceUnavailable: 'El cotejo no está disponible para esta página.',
      traceRateLimited: 'Has alcanzado el límite de cotejos. Inicia sesión (gratis) para continuar.',
      traceClickHint: 'Haz clic en cualquier frase para verla en el otro panel.',

      copyTranscription: 'Copiar la transcripción',
      copyTranslation: 'Copiar la traducción',
      copied: 'Copiado',

      marksMeaning: 'Qué significan las marcas del texto',
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
      showLess: 'Mostrar menos',
      readFullOverview: (more) => `Leer el resumen completo (${more} más)`,
      sections: 'Secciones',
      readThisSection: 'Leer esta sección →',
    },
    search: {
      placeholder: 'Buscar…',
      inputAria: 'Buscar en este libro',
      noMatches: 'Sin resultados en este libro',
      pagesMatch: (total) => `${total} ${total === 1 ? 'página coincide' : 'páginas coinciden'}`,
      pageLabel: (n) => `Página ${n}`,
    },
    librarian: {
      suggestions: [
        '¿De qué trata esta página?',
        '¿Quién fue el autor?',
        'Explica los conceptos clave aquí',
      ],
      inputAria: 'Preguntar al bibliotecario',
      ask: 'Preguntar',
      consulting: 'Consultando el texto…',
      askErrorInline: 'El bibliotecario no pudo responder en este momento — inténtalo de nuevo.',
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
    },
    cite: {
      copyCitation: 'Copiar la cita',
      copied: 'Copiado',
    },
    share: {
      copyLink: 'Copiar el enlace a esta página',
      copyLinkWithReference: 'Copiar el enlace con la referencia',
      postTo: 'Publicar en',
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
    history: {
      title: 'Historial de revisiones',
      loading: 'Cargando el historial de revisiones…',
      loadFailed: 'No se pudo cargar el historial de revisiones de esta página. Inténtalo de nuevo en un momento.',
      noRevisions: 'No hay revisiones registradas para esta página.',
      onlyMaintenance: 'Solo actividad de mantenimiento masivo, más abajo.',
      chars: 'caracteres',
      showMaintenance: (n) => `Mostrar ${n} ${n === 1 ? 'revisión' : 'revisiones'} de mantenimiento masivo`,
      hideMaintenance: (n) => `Ocultar ${n} ${n === 1 ? 'revisión' : 'revisiones'} de mantenimiento masivo`,
      maintenanceNote: 'Reparaciones del corpus y barridos de toda la biblioteca que pasaron por esta página — no lecturas nuevas del escaneo.',
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
    continueReading: {
      leftOff: (pageNumber) => `Lo dejaste en la página ${pageNumber}.`,
      continueLabel: 'Continuar',
      dismiss: 'Descartar',
    },
    pinnedEdition: {
      citedVersion: 'Versión citada',
      resolving: 'Resolviendo la edición citada…',
      unresolvable: (v) => `Este enlace cita la edición v${v}, pero no se pudo resolver. Mostrando el texto actual.`,
      continueReadingLink: 'Seguir leyendo →',
      pageNotInEdition: (label, date) => `Esta página no formaba parte de la edición ${label}, publicada el ${date} — mostrando el texto actual.`,
      readingEdition: (label, date) => `Estás leyendo la edición ${label}, publicada el ${date}`,
      revisedSince: 'la traducción se ha revisado desde entonces',
      viewCurrentEdition: 'Ver la edición actual →',
    },
  },
};

/** Reader chrome strings for `lang`. Defaults to English for an unrecognized locale. */
export function getReaderStrings(lang: Locale): ReaderStrings {
  return READER_UI_STRINGS[lang] ?? READER_UI_STRINGS.en;
}
