#!/usr/bin/env node
/**
 * Bundle each Netlify function into one self-contained file with esbuild,
 * before Netlify packages them (netlify.toml points [functions] here).
 *
 * Netlify's own packaging (zisi, and its esbuild mode alike) produced
 * functions that crashed on start with a bare 502 whenever they loaded the
 * CommonJS modules in functions/src: an ES module bundle has no `require`
 * for their built-in requires. Here every bundle gets one from createRequire.
 * Each function's `export const config` is copied over as written, since
 * Netlify reads it from the file it deploys.
 *
 *   node scripts/bundle-functions.mjs [src=netlify/functions] [out=netlify/functions-dist]
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const SRC = resolve(process.argv[2] || 'netlify/functions');
const OUT = resolve(process.argv[3] || 'netlify/functions-dist');
const BANNER =
  "import { createRequire as __kmCreateRequire } from 'module'; const require = __kmCreateRequire(import.meta.url);";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const entries = readdirSync(SRC).filter((f) => f.endsWith('.mjs') && !f.includes('.test.'));
for (const file of entries) {
  const src = join(SRC, file);
  const out = join(OUT, file);
  const code = readFileSync(src, 'utf8');
  const config = code.match(/export const config\s*=\s*(\{[\s\S]*?\});/)?.[1];
  await build({
    stdin: { contents: `export { default } from ${JSON.stringify(src)};`, resolveDir: SRC, loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: out,
    banner: { js: BANNER },
    logLevel: 'error',
  });
  if (config) {
    if (/^(var|let|const) config\b/m.test(readFileSync(out, 'utf8'))) {
      throw new Error(`${file}: a top-level "config" in the bundle would clash with the copied export`);
    }
    appendFileSync(out, `\nexport const config = ${config};\n`);
  }
  console.log(`bundled ${basename(file)}${config ? '' : ' (no config)'}`);
}
