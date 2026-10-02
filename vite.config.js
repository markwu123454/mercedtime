import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A manifest-declared MV3 content script cannot be an ES module and cannot be
// code-split, so the two defaults we have to override are the output format and
// dynamic-import splitting. Everything else is stock Vite.
//
// CSS is deliberately NOT emitted as a file: styles are imported with `?inline`
// and injected into the shadow root (see src/lib/mount.js), because a stylesheet
// in the host page's <head> is exactly what we are escaping.
export default defineConfig({
    plugins: [react()],
    define: {
        // React reads this; without it the dev build ships and warns in the console.
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
    build: {
        outDir: 'dist',
        emptyOutDir: false,        // manifest.json + icons live in dist/ too
        target: 'chrome110',
        minify: false,             // users may want to read the shipped code; size is local anyway
        rollupOptions: {
            input: 'src/main.jsx',
            output: {
                format: 'iife',
                entryFileNames: 'mercedtime.js',
                inlineDynamicImports: true,
            },
        },
    },
});
