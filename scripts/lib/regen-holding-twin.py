import re, sys
ts = open('src/lib/holding-library.ts').read()
b = ts
b = b.replace("import type { ImageSource, ImageSourceProvider } from '@/lib/types/image-source';\n", "")
b = b.replace("export const AGGREGATOR_PROVIDERS: ReadonlySet<ImageSourceProvider> = new Set([", "export const AGGREGATOR_PROVIDERS = new Set([")
b = b.replace("const NOT_A_LIBRARY: readonly RegExp[] = [", "const NOT_A_LIBRARY = [")
b = b.replace("const HOLDING_LIBRARY_ALIASES: ReadonlyMap<string, string> = new Map(", "const HOLDING_LIBRARY_ALIASES = new Map(")
b = b.replace("function cleanHolderName(raw: string): string {", "function cleanHolderName(raw) {")
b = re.sub(r"export interface SourceCredit \{.*?\n\}\n\n", "", b, flags=re.S)
b = b.replace("""export function holdingLibraryName(
  source: Pick<ImageSource, 'contributing_library'> | null | undefined,
): string | null {""", "export function holdingLibraryName(source) {")
b = b.replace("""export function canonicalHoldingLibrary(
  source: Pick<ImageSource, 'contributing_library'> | string | null | undefined,
): string | null {""", "export function canonicalHoldingLibrary(source) {")
b = b.replace("""export function resolveSourceCredit(
  source: Pick<ImageSource, 'provider' | 'provider_name' | 'contributing_library' | 'digitized_by'> | null | undefined,
  providerName?: string,
): SourceCredit {""", "export function resolveSourceCredit(source, providerName) {")
b = b.replace("const key = (s: string) =>", "const key = (s) =>")
header = """// Scripts-side twin of src/lib/holding-library.ts — keep the two in lockstep.
// tests/unit/holding-library-credit.test.ts runs a parity check between this
// file and the TS original over every distinct custodian name in the corpus
// fixture; change one side without the other and that test fails.
//
// Why it exists: .mjs maintenance scripts can't import the TS module, and the
// harvest sweep (scripts/maintenance/harvest-holding-libraries.mjs) must decide
// which books still lack a custodian using EXACTLY the rules the site renders
// with — otherwise it re-harvests books that already display a credit, or skips
// books that don't.
//
// Regenerate after editing the TS side: python3 scripts/lib/regen-holding-twin.py

"""
open('scripts/lib/holding-library.mjs','w').write(header + b)
import subprocess
# Definitive check: does node accept it as an ES module? A leftover type
# annotation is a syntax error, which a regex sweep only guesses at (object
# literals like `{ holder: null }` look identical to an annotation).
r = subprocess.run(['node','--input-type=module','--check'], input=open('scripts/lib/holding-library.mjs').read(), capture_output=True, text=True)
if r.returncode != 0:
    print("GENERATED TWIN IS NOT VALID JS:\n" + r.stderr, file=sys.stderr); sys.exit(1)
print("regenerated scripts/lib/holding-library.mjs (syntax OK)")
