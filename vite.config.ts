import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite loads this file in Node. @types/node is not a dependency of this
// project, so declare only the part of `process` used below.
declare const process: { env: Record<string, string | undefined> };

/**
 * Builds the side panel only. The service worker and content script are
 * bundled separately by `scripts/build.mjs`, because Chrome loads those as
 * classic scripts rather than as ES modules.
 *
 * `base: './'` keeps asset URLs relative so the page works from
 * `chrome-extension://<id>/sidepanel.html` without knowing the extension id.
 */
export default defineConfig({
  root: 'src/sidepanel',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist',
    emptyOutDir: false,
    // Extensions are loaded from disk, so a source map costs nothing at
    // runtime and makes a bug report actionable. The store package omits
    // them: they are development artifacts and would treble its size.
    sourcemap: process.env.CT_SOURCEMAPS !== '0',
    target: 'chrome116',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
