// ESLint config for the plain-node script tree — scripts/**/*.mjs (#4702).
//
// Why a separate file: `node --check` validates syntax, not scope. Four
// maintenance scripts referenced an undeclared `db` and passed it (#4700); the
// nightly stage-coverage cron's last line referenced two names that were never
// declared; auto-cancel-stuck-jobs.mjs had a `*/` inside a doc comment and had
// never parsed. The TypeScript configs in eslint.config.mjs disable `no-undef`
// (tsc owns it for src/), so nothing covered these 1,100+ scripts that run
// against production Mongo.
//
// This file is loaded on its own by CI (`npx eslint -c eslint.scripts.config.mjs`)
// so the gate does not depend on eslint-config-next's TypeScript layer, which
// crashes on load under the lockfile's ESLint 10 ("Class extends value
// undefined" from @typescript-eslint/utils). eslint.config.mjs also spreads
// this block so editors get the same rule.
//
// Workflow-tool scripts (`*-workflow.mjs`) are exempt: the Claude Code Workflow
// tool injects `args`, `phase`, `log`, `parallel`, `agent` at runtime, so they
// are correct as written.

const nodeGlobals = {
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
};

// Browser globals, for the callbacks scripts hand to puppeteer's
// `page.evaluate(() => document...)` (iiif-discovery/leiden, blurry-image-sweep,
// generate-og-images, kuleuven-gap-harvest). Those bodies run in the browser,
// so `document`/`window`/`sessionStorage` are real there. The cost is that a
// stray `document` in node code is not caught; the composed eslint.config.mjs
// already allowed this via eslint-config-next's browser globals.
const browserGlobals = {
  window: "readonly", document: "readonly", navigator: "readonly", location: "readonly",
  localStorage: "readonly", sessionStorage: "readonly", HTMLElement: "readonly",
  Element: "readonly", Node: "readonly", NodeList: "readonly", Image: "readonly",
  MutationObserver: "readonly", getComputedStyle: "readonly", requestAnimationFrame: "readonly",
  XMLHttpRequest: "readonly", DOMParser: "readonly", Event: "readonly", CustomEvent: "readonly",
};

// Global ignore (its own object, no `files`): the Workflow-tool scripts use a
// top-level `return`, which is a parse error outside the tool's runtime.
export const scriptsIgnores = { ignores: ["scripts/**/*-workflow.mjs"] };

export const scriptsNoUndef = {
  files: ["scripts/**/*.mjs"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: { ...nodeGlobals, ...browserGlobals },
  },
  rules: { "no-undef": "error" },
};

export default [scriptsIgnores, scriptsNoUndef];
