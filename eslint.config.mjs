import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { scriptsIgnores, scriptsNoUndef } from "./eslint.scripts.config.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Plain-node scripts: `no-undef` for scripts/**/*.mjs. The block lives in
  // eslint.scripts.config.mjs so CI can run it without this file's TypeScript
  // layer (see the header there, #4702).
  scriptsIgnores,
  scriptsNoUndef,
]);

export default eslintConfig;
