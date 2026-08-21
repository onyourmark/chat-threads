/**
 * Build the unpacked extension into `dist/`.
 *
 * Three steps, because Chrome wants three different things:
 *   1. Vite bundles the React side panel into dist/sidepanel.html + assets.
 *   2. esbuild bundles the service worker and content script as classic
 *      scripts (Chrome does not load content scripts as ES modules).
 *   3. manifest.json and the icons are copied across unchanged.
 */

import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
/** Source maps are on for development and off for a store package. */
const sourcemap = process.env.CT_SOURCEMAPS !== '0';

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  // 1. Side panel.
  await viteBuild({ configFile: resolve(root, 'vite.config.ts') });
  // The manifest points at sidepanel.html; Vite names it after its entry.
  if (existsSync(resolve(dist, 'index.html'))) {
    await rename(resolve(dist, 'index.html'), resolve(dist, 'sidepanel.html'));
  }

  // 2. Service worker and content script.
  const workerOptions = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    sourcemap,
    logLevel: 'info',
  };

  await esbuild({
    ...workerOptions,
    entryPoints: [resolve(root, 'src/background/index.ts')],
    outfile: resolve(dist, 'background.js'),
  });

  await esbuild({
    ...workerOptions,
    entryPoints: [resolve(root, 'src/content/index.ts')],
    outfile: resolve(dist, 'content.js'),
  });

  // 3. Manifest and icons.
  const manifest = JSON.parse(
    await readFile(resolve(root, 'manifest.json'), 'utf8'),
  );
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  // One version number, kept in package.json.
  manifest.version = pkg.version;
  await writeFile(
    resolve(dist, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const icons = resolve(root, 'public/icons');
  if (existsSync(icons)) {
    await cp(icons, resolve(dist, 'icons'), { recursive: true });
  } else {
    console.warn('No icons found in public/icons — run `npm run icons`.');
  }

  console.log('\nBuilt extension into dist/. Load that folder in Chrome.');
}

if (watch) {
  console.log('Watch mode rebuilds on demand; re-run `npm run build` to refresh.');
}

await main();
