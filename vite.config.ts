import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
    // Extensions are loaded from disk; a source map costs nothing at runtime
    // and makes a bug report from a user actionable.
    sourcemap: true,
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
