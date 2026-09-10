import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // Plain-node scripts. `node --check` validates syntax, not scope: four
  // scripts referenced an undeclared `db` and passed it (#4700), and the
  // nightly stage-coverage cron threw a ReferenceError on its last line for
  // a month. The TypeScript configs above disable `no-undef` (tsc owns it for
  // src/), so nothing covered scripts/**/*.mjs until #4702.
  {
    files: ["scripts/**/*.mjs"],
    ignores: ["scripts/**/*-workflow.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly", console: "readonly", fetch: "readonly", Buffer: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", setImmediate: "readonly", clearImmediate: "readonly",
        URL: "readonly", URLSearchParams: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly", AbortSignal: "readonly",
        AbortController: "readonly", structuredClone: "readonly", crypto: "readonly",
        performance: "readonly", __dirname: "readonly", __filename: "readonly",
        require: "readonly", module: "readonly", exports: "readonly", global: "readonly",
        globalThis: "readonly", Blob: "readonly", FormData: "readonly", Headers: "readonly",
        Request: "readonly", Response: "readonly", ReadableStream: "readonly",
        WritableStream: "readonly", queueMicrotask: "readonly", btoa: "readonly", atob: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
  // Workflow-tool scripts (`*-workflow.mjs`) run inside the Claude Code
  // Workflow tool, which injects `args`, `phase`, `log`, `parallel`, `agent`
  // at runtime — they are correct as written, so no-undef stays off for them.
]);

export default eslintConfig;
