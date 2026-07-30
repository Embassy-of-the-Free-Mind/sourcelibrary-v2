import re, sys, subprocess
ts = open('src/lib/field-provenance.ts').read()
b = ts
b = b.replace("import type { FieldProvenanceEntry } from '@/lib/types/book';\n", "")
b = re.sub(r"/\*\* Fields required on every stamp.*?\n\}\n\n", "", b, flags=re.S)
b = re.sub(r"export interface ProvenanceUpdate \{.*?\n\}\n\n", "", b, flags=re.S)
b = b.replace("export class ProvenanceError extends Error {}", "export class ProvenanceError extends Error {}")
b = b.replace("export function normalizeProvenance(input: ProvenanceInput): FieldProvenanceEntry {", "export function normalizeProvenance(input) {")
b = b.replace("export function provenanceUpdate(field: string, input: ProvenanceInput): ProvenanceUpdate {", "export function provenanceUpdate(field, input) {")
b = b.replace("export function isStampContradicted(entry: FieldProvenanceEntry | undefined, value: unknown, placeholder: (v: string) => boolean): boolean {", "export function isStampContradicted(entry, value, placeholder) {")
header = """// Scripts-side twin of src/lib/field-provenance.ts — keep the two in lockstep.
// tests/unit/field-provenance.test.ts pins parity; regenerate after editing the
// TS side: python3 scripts/lib/regen-field-provenance-twin.py
//
// Why it exists: the .mjs maintenance sweeps are the heaviest writers of
// bibliographic provenance, and they cannot import the TS module.

"""
open('scripts/lib/field-provenance.mjs','w').write(header + b)
r = subprocess.run(['node','--input-type=module','--check'], input=open('scripts/lib/field-provenance.mjs').read(), capture_output=True, text=True)
if r.returncode != 0:
    print("GENERATED TWIN IS NOT VALID JS:\n" + r.stderr, file=sys.stderr); sys.exit(1)
print("regenerated scripts/lib/field-provenance.mjs (syntax OK)")
