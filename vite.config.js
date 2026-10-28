import { defineConfig } from 'vite';

// base: './' is required so the built assets load from file:// inside the
// Capacitor Android WebView as well as from a normal web server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5180,
    strictPort: false,
  },
  preview: {
    port: 5181,
  },
});
