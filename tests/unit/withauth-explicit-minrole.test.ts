/**
 * Every `withAuth(handler, …)` call in an API route names its `minRole`.
 *
 * withAuth defaults to `editor` (fail closed). Sign-up is open and every new
 * account is a `reader`, so a route that leaned on an implicit default was
 * one any visitor could reach after a free sign-in. Naming the role at each
 * call site keeps the decision visible in review: `{ minRole: 'reader' }`
 * should appear only on routes that touch the caller's own data.
 *
 * Structural check on the source (TypeScript AST), so it needs no Mongo or auth.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import ts from 'typescript';

const root = path.join(__dirname, '..', '..');
const apiDir = path.join(root, 'src/app/api');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function callsWithoutMinRole(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('withAuth(')) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const missing: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'withAuth') {
      const opts = n.arguments[1];
      const named =
        opts !== undefined &&
        ts.isObjectLiteralExpression(opts) &&
        opts.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'minRole');
      if (!named) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        missing.push(`${path.relative(root, file)}:${line}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return missing;
}

describe('withAuth call sites', () => {
  it('every API route names an explicit minRole', () => {
    const missing = routeFiles(apiDir).flatMap(callsWithoutMinRole);
    expect(missing, 'withAuth calls relying on the implicit default role').toEqual([]);
  });
});
