// RTL (right-to-left) languages that need special display handling
export const RTL_LANGUAGES = [
    'Arabic',
    'Hebrew',
    'Aramaic',
    'Syriac',
    'Persian',
    'Urdu'];

export function isRTLLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return RTL_LANGUAGES.some(rtl =>
    language.toLowerCase().includes(rtl.toLowerCase())
  );
}