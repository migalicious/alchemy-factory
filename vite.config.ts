import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /<repo-name>/; set VITE_BASE in CI.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  test: { environment: 'node' },
});
