/** ISO-639-1 code → canonical English name */
const CODE_TO_NAME: Record<string, string> = {
  ar: 'Arabic', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
  en: 'English', es: 'Spanish', fa: 'Persian', fr: 'French', he: 'Hebrew',
  hu: 'Hungarian', it: 'Italian', ja: 'Japanese', la: 'Latin', nl: 'Dutch',
  no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ru: 'Russian', sa: 'Sanskrit',
  sv: 'Swedish', tr: 'Turkish', zh: 'Chinese',
};

/** Canonical English name → ISO-639-1 code */
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_TO_NAME).map(([code, name]) => [name.toLowerCase(), code])
);

/**
 * Expand a language list to include both ISO codes and English names.
 * e.g. ["French", "la"] → ["French", "fr", "Latin", "la"]
 *
 * Source Library books use either form depending on import source.
 * This lets filters like exclude_languages=["French"] also catch books
 * stored as "fr", and vice-versa.
 */
export function expandLanguages(langs: string[]): string[] {
  const result = new Set<string>();
  for (const lang of langs) {
    result.add(lang);
    const lower = lang.toLowerCase();
    const code = NAME_TO_CODE[lower];
    if (code) result.add(code);
    const name = CODE_TO_NAME[lower];
    if (name) result.add(name);
  }
  return [...result];
}
